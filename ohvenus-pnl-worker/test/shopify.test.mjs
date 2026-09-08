import test from "node:test";
import assert from "node:assert/strict";
import { localDateForInstant, previousLocalDate, readShopifyDay } from "../src/shopify.mjs";

const env = { TIME_ZONE: "Asia/Kuala_Lumpur", SHOPIFY_SHOP_DOMAIN: "9s4j4j-8d.myshopify.com", SHOPIFY_PRIMARY_DOMAIN: "ohvenus.shop", SHOPIFY_CLIENT_ID: "client", SHOPIFY_CLIENT_SECRET: "secret" };
const money = (amount) => ({ shopMoney: { amount, currencyCode: "MYR" } });

function order(overrides = {}) {
  return {
    id: "gid://shopify/Order/1", name: "#1", processedAt: "2026-09-01T16:30:00Z", test: false,
    totalDiscountsSet: money("15.00"), totalTaxSet: money("0.00"), totalShippingPriceSet: money("15.00"),
    lineItems: { nodes: [{ id: "gid://shopify/LineItem/1", quantity: 1, currentQuantity: 1, originalUnitPriceSet: money("100.00"), variant: { inventoryItem: { unitCost: { amount: "30.00", currencyCode: "MYR" } } } }], pageInfo: { hasNextPage: false } },
    transactions: [{ id: "T1", kind: "SALE", status: "SUCCESS", gateway: "Stripe Card Payments", amountSet: money("100.00") }],
    refunds: [],
    fulfillments: [{ trackingInfo: [{ number: "7328089358633416" }] }],
    ...overrides
  };
}

function refund(overrides = {}) {
  return {
    id: "gid://shopify/Refund/1", createdAt: "2026-09-01T16:30:00Z",
    totalRefundedSet: money("20.00"),
    refundLineItems: { nodes: [], pageInfo: { hasNextPage: false } },
    transactions: { nodes: [{ id: "R1", kind: "REFUND", status: "SUCCESS", gateway: "Stripe Card Payments", processedAt: "2026-09-01T16:30:00Z", amountSet: money("20.00") }] },
    ...overrides
  };
}

function fetcherFor(orders, shopOverrides = {}, refundOrders = null) {
  const shop = { name: "Oh! Venus", currencyCode: "MYR", ianaTimezone: "Asia/Kuala_Lumpur", primaryDomain: { host: "ohvenus.shop" }, ...shopOverrides };
  return async (url, options) => {
    if (url.endsWith("/admin/oauth/access_token")) return new Response(JSON.stringify({ access_token: "token" }));
    const isRefundQuery = String(options?.body || "").includes("DailyRefunds");
    const nodes = isRefundQuery ? (refundOrders ?? orders) : orders;
    return new Response(JSON.stringify({ data: {
      shop,
      orders: { nodes, pageInfo: { hasNextPage: false, endCursor: null } }
    } }));
  };
}

test("converts timestamps and selects the previous Malaysia date", () => {
  assert.equal(localDateForInstant("2026-09-01T16:30:00Z", env.TIME_ZONE), "2026-09-02");
  assert.equal(previousLocalDate("2026-09-03T04:00:00Z", env.TIME_ZONE), "2026-09-02");
});

test("normalizes sales, shipping, discounts, transactions, refunds, and COGS", async () => {
  // Refund is recorded against the refund's own date, not the order's.
  const refunded = order({ refunds: [refund()] });
  const result = await readShopifyDay(env, "2026-09-02", fetcherFor([refunded]));
  assert.deepEqual(result.revenue, { productSalesSen: 10000, shippingIncomeSen: 1500, discountsSen: 1500, refundsSen: 2000, taxesSen: 0 });
  assert.equal(result.grossCollectedSen, 8000);
  assert.equal(result.cogsSen, 3000);
  assert.equal(result.payments.length, 1);
  assert.deepEqual(result.clearingByGatewaySen, { stripe: 8000 });
});

test("books a refund on the refund date, not the original order date", async () => {
  // Order was placed weeks earlier; only the refund lands on 2026-09-02.
  const oldOrder = order({
    id: "gid://shopify/Order/9", name: "#9", processedAt: "2026-08-01T04:00:00Z",
    refunds: [refund({
      refundLineItems: { nodes: [{ quantity: 1, lineItem: { id: "L1", variant: { inventoryItem: { unitCost: { amount: "30.00", currencyCode: "MYR" } } } } }], pageInfo: { hasNextPage: false } }
    })]
  });
  // Sales query returns nothing for the day; refund query returns the old order.
  const result = await readShopifyDay(env, "2026-09-02", fetcherFor([], {}, [oldOrder]));
  assert.equal(result.orderCount, 0);
  assert.equal(result.refundCount, 1);
  assert.equal(result.revenue.refundsSen, 2000);
  assert.equal(result.cogsReversalSen, 3000);
  assert.deepEqual(result.clearingByGatewaySen, { stripe: -2000 });
  assert.equal(result.refunds[0].orderLocalDate, "2026-08-01");
});

test("ignores a refund created on a different local day", async () => {
  const other = order({ refunds: [refund({ createdAt: "2026-09-05T04:00:00Z" })] });
  const result = await readShopifyDay(env, "2026-09-02", fetcherFor([other]));
  assert.equal(result.refundCount, 0);
  assert.equal(result.revenue.refundsSen, 0);
});

test("rejects a refund whose transactions do not match its total", async () => {
  const bad = order({ refunds: [refund({ totalRefundedSet: money("50.00") })] });
  await assert.rejects(() => readShopifyDay(env, "2026-09-02", fetcherFor([bad])), /did not reconcile to transactions/);
});

test("uses a buffered query but keeps only the exact Malaysia local day", async () => {
  const calls = [];
  const base = fetcherFor([order(), order({ id: "gid://shopify/Order/2", processedAt: "2026-09-02T16:30:00Z" })]);
  const fetcher = async (url, options) => { calls.push({ url, options }); return base(url, options); };
  const result = await readShopifyDay(env, "2026-09-02", fetcher);
  assert.equal(result.orderCount, 1);
  const requestBody = JSON.parse(calls[1].options.body);
  assert.match(requestBody.variables.query, /processed_at:>=2026-09-01/);
  assert.match(requestBody.variables.query, /processed_at:<=2026-09-03/);
});

test("fails closed on shop mismatch, missing COGS, and transaction mismatch", async () => {
  await assert.rejects(() => readShopifyDay(env, "2026-09-02", fetcherFor([], { primaryDomain: { host: "wrong.example" } })), /did not match Oh! Venus/);
  const missingCost = order();
  missingCost.lineItems.nodes[0].variant.inventoryItem.unitCost = null;
  await assert.rejects(() => readShopifyDay(env, "2026-09-02", fetcherFor([missingCost])), /no product unit cost/);
  await assert.rejects(() => readShopifyDay(env, "2026-09-02", fetcherFor([order({ transactions: [] })])), /did not reconcile/);
});

test("exposes fulfillment tracking numbers for courier-cost attribution", async () => {
  const result = await readShopifyDay(env, "2026-09-02", fetcherFor([order()]));
  assert.deepEqual(result.orders[0].trackingNumbers, ["7328089358633416"]);
});

test("falls back to a P&L without attribution when fulfillment scopes are missing", async () => {
  const base = fetcherFor([order()]);
  let sawFulfillments = false;
  const fetcher = async (url, options) => {
    const body = String(options?.body || "");
    if (body.includes("fulfillments")) {
      sawFulfillments = true;
      return new Response(JSON.stringify({ errors: [{ extensions: { code: "ACCESS_DENIED" }, message: "required access scope" }] }));
    }
    if (body.includes("DailyOrders")) {
      // Shopify would not return the field that was not requested.
      const stripped = order();
      delete stripped.fulfillments;
      return fetcherFor([stripped])(url, options);
    }
    return base(url, options);
  };
  const result = await readShopifyDay(env, "2026-09-02", fetcher);
  assert.equal(sawFulfillments, true);
  assert.equal(result.courierAttributionAvailable, false);
  // The day's money is still complete and correct.
  assert.equal(result.orderCount, 1);
  assert.equal(result.revenue.productSalesSen, 10000);
  assert.deepEqual(result.orders[0].trackingNumbers, []);
});

test("reports attribution as available when scopes are granted", async () => {
  const result = await readShopifyDay(env, "2026-09-02", fetcherFor([order()]));
  assert.equal(result.courierAttributionAvailable, true);
});
