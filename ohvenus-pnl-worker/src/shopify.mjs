const API_VERSION = "2026-07";
const MYR = "MYR";

function requireValue(value, name) {
  const trimmed = String(value || "").trim();
  if (!trimmed) throw new Error(`${name} is not configured`);
  return trimmed;
}

function isoDate(date) { return date.toISOString().slice(0, 10); }

export function assertLocalDate(localDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error("localDate must use the ISO local-date format");
  const parsed = new Date(`${localDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || isoDate(parsed) !== localDate) throw new Error("localDate must be a real calendar date");
}

export function shiftDate(localDate, days) {
  assertLocalDate(localDate);
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function localDateForInstant(instant, timeZone) {
  const date = new Date(instant);
  if (!Number.isFinite(date.valueOf())) throw new Error("Shopify returned an invalid timestamp");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function previousLocalDate(instant, timeZone) {
  return shiftDate(localDateForInstant(instant, timeZone), -1);
}

function moneySen(money, field) {
  if (!money || money.currencyCode !== MYR) throw new Error(`${field} was not denominated in MYR`);
  const amount = Number(money.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${field} had an invalid amount`);
  return Math.round(amount * 100);
}

function shopMoney(set, field) { return moneySen(set?.shopMoney, field); }

function gatewayKey(gateway) {
  const value = String(gateway || "").toLowerCase();
  if (value.includes("stripe")) return "stripe";
  if (value.includes("billplz")) return "billplz";
  return "other_payment";
}

async function accessToken(env, fetcher) {
  const domain = requireValue(env.SHOPIFY_SHOP_DOMAIN, "SHOPIFY_SHOP_DOMAIN");
  const response = await fetcher(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: requireValue(env.SHOPIFY_CLIENT_ID, "SHOPIFY_CLIENT_ID"),
      client_secret: requireValue(env.SHOPIFY_CLIENT_SECRET, "SHOPIFY_CLIENT_SECRET"),
      grant_type: "client_credentials"
    })
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(`Shopify authentication failed with HTTP ${response.status}`);
  return body.access_token;
}

async function graphql(env, token, query, variables, fetcher) {
  const domain = requireValue(env.SHOPIFY_SHOP_DOMAIN, "SHOPIFY_SHOP_DOMAIN");
  const response = await fetcher(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-shopify-access-token": token },
    body: JSON.stringify({ query, variables })
  });
  const body = await response.json();
  if (!response.ok || body.errors?.length) {
    const code = body.errors?.map((error) => error.extensions?.code || error.message).join(",") || `HTTP_${response.status}`;
    throw new Error(`Shopify GraphQL failed: ${code}`);
  }
  return body.data;
}

const IDENTITY_QUERY = `
  query AppIdentity {
    shop { name currencyCode ianaTimezone primaryDomain { host } }
    currentAppInstallation {
      accessScopes { handle }
      app { title handle }
    }
  }
`;

const REFUNDS_QUERY = `
  query DailyRefunds($query: String!, $after: String) {
    shop { name currencyCode ianaTimezone primaryDomain { host } }
    orders(first: 100, after: $after, query: $query, sortKey: UPDATED_AT) {
      nodes {
        id name processedAt test
        refunds {
          id createdAt
          totalRefundedSet { shopMoney { amount currencyCode } }
          refundLineItems(first: 250) {
            nodes {
              quantity
              lineItem { id variant { inventoryItem { unitCost { amount currencyCode } } } }
            }
            pageInfo { hasNextPage }
          }
          transactions(first: 50) {
            nodes { id kind status gateway processedAt amountSet { shopMoney { amount currencyCode } } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const FULFILLMENTS_FIELD = "fulfillments(first: 20) { trackingInfo { number } }";

const ORDERS_QUERY_TEMPLATE = `
  query DailyOrders($query: String!, $after: String) {
    shop { name currencyCode ianaTimezone primaryDomain { host } }
    orders(first: 100, after: $after, query: $query, sortKey: PROCESSED_AT) {
      nodes {
        id name processedAt test
        totalDiscountsSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        lineItems(first: 250) {
          nodes {
            id quantity currentQuantity
            originalUnitPriceSet { shopMoney { amount currencyCode } }
            variant { inventoryItem { unitCost { amount currencyCode } } }
          }
          pageInfo { hasNextPage }
        }
        transactions(first: 250) {
          id kind status gateway processedAt
          amountSet { shopMoney { amount currencyCode } }
        }
        __FULFILLMENTS__
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function ordersQuery(withFulfillments) {
  return ORDERS_QUERY_TEMPLATE.replace("__FULFILLMENTS__", withFulfillments ? FULFILLMENTS_FIELD : "");
}

function isAccessError(error) {
  return /ACCESS_DENIED|access denied|not approved|required access/i.test(String(error?.message || ""));
}

function normalizeOrder(order) {
  if (order.lineItems.pageInfo.hasNextPage) throw new Error(`Shopify order ${order.name} exceeded 250 line items`);
  let productSalesSen = 0;
  let cogsSen = 0;
  for (const line of order.lineItems.nodes) {
    productSalesSen += shopMoney(line.originalUnitPriceSet, "Shopify product price") * line.quantity;
    const cost = line.variant?.inventoryItem?.unitCost;
    if (!cost) throw new Error(`Shopify line ${line.id} had no product unit cost`);
    cogsSen += moneySen(cost, "Shopify product unit cost") * line.quantity;
  }

  // Sales-side only. Refunds are recognised on the date the refund itself was
  // processed (see readRefundsForDay), never on the order's date, so a past day
  // never changes retroactively.
  const payments = [];
  const clearingByGatewaySen = {};
  let successfulSalesSen = 0;
  for (const transaction of order.transactions) {
    if (String(transaction.status).toUpperCase() !== "SUCCESS") continue;
    const kind = String(transaction.kind).toUpperCase();
    if (kind !== "SALE" && kind !== "CAPTURE") continue;
    const amountSen = shopMoney(transaction.amountSet, "Shopify transaction");
    const gateway = gatewayKey(transaction.gateway);
    successfulSalesSen += amountSen;
    payments.push({ gateway, status: "success", amountSen, transactionId: transaction.id });
    clearingByGatewaySen[gateway] = (clearingByGatewaySen[gateway] || 0) + amountSen;
  }

  const trackingNumbers = (order.fulfillments || [])
    .flatMap((fulfillment) => fulfillment.trackingInfo || [])
    .map((info) => String(info.number || "").trim())
    .filter(Boolean);

  return {
    orderId: order.id,
    orderName: order.name,
    trackingNumbers,
    productSalesSen,
    shippingIncomeSen: shopMoney(order.totalShippingPriceSet, "Shopify shipping income"),
    discountsSen: shopMoney(order.totalDiscountsSet, "Shopify discounts"),
    taxesSen: shopMoney(order.totalTaxSet, "Shopify taxes"),
    cogsSen,
    successfulSalesSen,
    payments,
    clearingByGatewaySen
  };
}

function normalizeRefund(order, refund, timeZone) {
  if (refund.refundLineItems.pageInfo.hasNextPage) {
    throw new Error(`Shopify refund ${refund.id} exceeded 250 refund line items`);
  }
  const amountSen = shopMoney(refund.totalRefundedSet, "Shopify refund total");
  let cogsReversalSen = 0;
  for (const line of refund.refundLineItems.nodes) {
    const cost = line.lineItem?.variant?.inventoryItem?.unitCost;
    if (!cost) throw new Error(`Shopify refund line on ${order.name} had no product unit cost`);
    cogsReversalSen += moneySen(cost, "Shopify product unit cost") * line.quantity;
  }
  const clearingByGatewaySen = {};
  let settledSen = 0;
  for (const transaction of refund.transactions.nodes) {
    if (String(transaction.status).toUpperCase() !== "SUCCESS") continue;
    if (String(transaction.kind).toUpperCase() !== "REFUND") continue;
    const txnSen = shopMoney(transaction.amountSet, "Shopify refund transaction");
    const gateway = gatewayKey(transaction.gateway);
    settledSen += txnSen;
    clearingByGatewaySen[gateway] = (clearingByGatewaySen[gateway] || 0) + txnSen;
  }
  if (settledSen !== amountSen) {
    throw new Error(`Shopify refund ${refund.id} total ${amountSen} did not reconcile to transactions ${settledSen}`);
  }
  return {
    orderId: order.id,
    orderName: order.name,
    refundId: refund.id,
    refundedAt: refund.createdAt,
    orderLocalDate: localDateForInstant(order.processedAt, timeZone),
    amountSen,
    cogsReversalSen,
    clearingByGatewaySen
  };
}

function addByKey(target, source) {
  for (const [key, value] of Object.entries(source)) target[key] = (target[key] || 0) + value;
}

async function paginate(env, token, query, variables, fetcher, onPage) {
  let after = null;
  let shop = null;
  for (;;) {
    const data = await graphql(env, token, query, { ...variables, after }, fetcher);
    shop ||= data.shop;
    onPage(data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
    if (!after) throw new Error("Shopify order pagination cursor was missing");
  }
  return shop;
}

function assertShop(shop, env, timeZone) {
  const expectedHost = requireValue(env.SHOPIFY_PRIMARY_DOMAIN, "SHOPIFY_PRIMARY_DOMAIN");
  if (!shop || shop.primaryDomain.host !== expectedHost || shop.currencyCode !== MYR || shop.ianaTimezone !== timeZone) {
    throw new Error("Shopify identity, currency, or timezone did not match Oh! Venus");
  }
}

// Refunds are matched on the refund's own createdAt, so a refund against an
// order of any age lands on the day the money actually went back.
export async function readRefundsForDay(env, localDate, token, timeZone, fetcher) {
  const query = `updated_at:>=${shiftDate(localDate, -1)} updated_at:<=${shiftDate(localDate, 1)}`;
  const refunds = [];
  const shop = await paginate(env, token, REFUNDS_QUERY, { query }, fetcher, (nodes) => {
    for (const order of nodes) {
      if (order.test) continue;
      for (const refund of order.refunds || []) {
        if (localDateForInstant(refund.createdAt, timeZone) !== localDate) continue;
        refunds.push(normalizeRefund(order, refund, timeZone));
      }
    }
  });
  return { shop, refunds };
}

// Reports which Shopify app the Worker actually authenticates as, and what it
// was granted. This is the only way to confirm the scopes were added to the
// right app, since the client id is a write-only secret.
export async function readShopifyIdentity(env, fetcher = fetch) {
  const token = await accessToken(env, fetcher);
  const data = await graphql(env, token, IDENTITY_QUERY, {}, fetcher);
  const install = data.currentAppInstallation || {};
  const scopes = (install.accessScopes || []).map((scope) => scope.handle).sort();
  const required = [
    "read_assigned_fulfillment_orders",
    "read_merchant_managed_fulfillment_orders",
    "read_third_party_fulfillment_orders"
  ];
  return {
    app: { title: install.app?.title || null, handle: install.app?.handle || null },
    shop: {
      name: data.shop.name,
      primaryDomain: data.shop.primaryDomain.host,
      currency: data.shop.currencyCode,
      timeZone: data.shop.ianaTimezone
    },
    grantedScopes: scopes,
    missingFulfillmentScopes: required.filter((scope) => !scopes.includes(scope)),
    courierAttributionReady: required.every((scope) => scopes.includes(scope))
  };
}

export async function readShopifyDay(env, localDate, fetcher = fetch) {
  assertLocalDate(localDate);
  const timeZone = requireValue(env.TIME_ZONE, "TIME_ZONE");
  if (timeZone !== "Asia/Kuala_Lumpur") throw new Error("Shopify timezone did not match Oh! Venus");
  const token = await accessToken(env, fetcher);
  const query = `processed_at:>=${shiftDate(localDate, -1)} processed_at:<=${shiftDate(localDate, 1)}`;
  // Per-order courier attribution needs fulfillment tracking numbers. If the app
  // lacks the fulfillment read scopes, fall back to a P&L without attribution
  // rather than failing the whole day.
  let matched = [];
  let shop = null;
  let courierAttributionAvailable = true;
  const collect = (nodes) => {
    for (const order of nodes) {
      if (!order.test && localDateForInstant(order.processedAt, timeZone) === localDate) matched.push(order);
    }
  };
  try {
    shop = await paginate(env, token, ordersQuery(true), { query }, fetcher, collect);
  } catch (error) {
    if (!isAccessError(error)) throw error;
    matched = [];
    courierAttributionAvailable = false;
    shop = await paginate(env, token, ordersQuery(false), { query }, fetcher, collect);
  }
  assertShop(shop, env, timeZone);

  const orders = matched.map(normalizeOrder);
  const { shop: refundShop, refunds } = await readRefundsForDay(env, localDate, token, timeZone, fetcher);
  assertShop(refundShop, env, timeZone);

  const clearingByGatewaySen = {};
  for (const order of orders) addByKey(clearingByGatewaySen, order.clearingByGatewaySen);
  for (const refund of refunds) {
    for (const [gateway, amount] of Object.entries(refund.clearingByGatewaySen)) {
      clearingByGatewaySen[gateway] = (clearingByGatewaySen[gateway] || 0) - amount;
    }
  }

  const refundsSen = refunds.reduce((sum, refund) => sum + refund.amountSen, 0);
  const cogsReversalSen = refunds.reduce((sum, refund) => sum + refund.cogsReversalSen, 0);
  const result = {
    source: "shopify",
    localDate,
    shop: { name: shop.name, primaryDomain: shop.primaryDomain.host, currency: shop.currencyCode, timeZone: shop.ianaTimezone },
    orderCount: orders.length,
    orderIds: orders.map((order) => order.orderId),
    orders,
    courierAttributionAvailable,
    revenue: {
      productSalesSen: orders.reduce((sum, order) => sum + order.productSalesSen, 0),
      shippingIncomeSen: orders.reduce((sum, order) => sum + order.shippingIncomeSen, 0),
      discountsSen: orders.reduce((sum, order) => sum + order.discountsSen, 0),
      refundsSen,
      taxesSen: orders.reduce((sum, order) => sum + order.taxesSen, 0)
    },
    cogsSen: orders.reduce((sum, order) => sum + order.cogsSen, 0),
    cogsReversalSen,
    refundCount: refunds.length,
    refunds,
    payments: orders.flatMap((order) => order.payments),
    clearingByGatewaySen
  };
  // Sales side must reconcile on its own; refunds reconcile inside normalizeRefund.
  const salesRevenueSen = result.revenue.productSalesSen + result.revenue.shippingIncomeSen
    - result.revenue.discountsSen + result.revenue.taxesSen;
  const transactionNetSen = orders.reduce((sum, order) => sum + order.successfulSalesSen, 0);
  if (salesRevenueSen !== transactionNetSen) {
    throw new Error(`Shopify revenue ${salesRevenueSen} did not reconcile to successful transactions ${transactionNetSen}`);
  }
  result.grossCollectedSen = salesRevenueSen - refundsSen;
  return result;
}
