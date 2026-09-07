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
    ...overrides
  };
}

function fetcherFor(orders, shopOverrides = {}) {
  return async (url) => {
    if (url.endsWith("/admin/oauth/access_token")) return new Response(JSON.stringify({ access_token: "token" }));
    return new Response(JSON.stringify({ data: {
      shop: { name: "Oh! Venus", currencyCode: "MYR", ianaTimezone: "Asia/Kuala_Lumpur", primaryDomain: { host: "ohvenus.shop" }, ...shopOverrides },
      orders: { nodes: orders, pageInfo: { hasNextPage: false, endCursor: null } }
    } }));
  };
}

test("converts timestamps and selects the previous Malaysia date", () => {
  assert.equal(localDateForInstant("2026-09-01T16:30:00Z", env.TIME_ZONE), "2026-09-02");
  assert.equal(previousLocalDate("2026-09-03T04:00:00Z", env.TIME_ZONE), "2026-09-02");
});

test("normalizes sales, shipping, discounts, transactions, refunds, and COGS", async () => {
  const refunded = order({ transactions: [
    { id: "T1", kind: "SALE", status: "SUCCESS", gateway: "Stripe Card Payments", amountSet: money("100.00") },
    { id: "T2", kind: "REFUND", status: "SUCCESS", gateway: "Stripe Card Payments", amountSet: money("20.00") },
    { id: "T3", kind: "SALE", status: "FAILURE", gateway: "Stripe Card Payments", amountSet: money("999.00") }
  ] });
  const result = await readShopifyDay(env, "2026-09-02", fetcherFor([refunded]));
  assert.deepEqual(result.revenue, { productSalesSen: 10000, shippingIncomeSen: 1500, discountsSen: 1500, refundsSen: 2000, taxesSen: 0 });
  assert.equal(result.grossCollectedSen, 8000);
  assert.equal(result.cogsSen, 3000);
  assert.equal(result.payments.length, 1);
  assert.deepEqual(result.clearingByGatewaySen, { stripe: 8000 });
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
