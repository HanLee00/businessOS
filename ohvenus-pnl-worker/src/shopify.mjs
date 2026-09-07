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

const ORDERS_QUERY = `
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
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function normalizeOrder(order) {
  if (order.lineItems.pageInfo.hasNextPage) throw new Error(`Shopify order ${order.name} exceeded 250 line items`);
  let productSalesSen = 0;
  let cogsSen = 0;
  for (const line of order.lineItems.nodes) {
    productSalesSen += shopMoney(line.originalUnitPriceSet, "Shopify product price") * line.quantity;
    const cost = line.variant?.inventoryItem?.unitCost;
    if (!cost) throw new Error(`Shopify line ${line.id} had no product unit cost`);
    cogsSen += moneySen(cost, "Shopify product unit cost") * line.currentQuantity;
  }

  const payments = [];
  const clearingByGatewaySen = {};
  let successfulSalesSen = 0;
  let refundsSen = 0;
  for (const transaction of order.transactions) {
    if (String(transaction.status).toUpperCase() !== "SUCCESS") continue;
    const kind = String(transaction.kind).toUpperCase();
    const amountSen = shopMoney(transaction.amountSet, "Shopify transaction");
    const gateway = gatewayKey(transaction.gateway);
    if (kind === "SALE" || kind === "CAPTURE") {
      successfulSalesSen += amountSen;
      payments.push({ gateway, status: "success", amountSen, transactionId: transaction.id });
      clearingByGatewaySen[gateway] = (clearingByGatewaySen[gateway] || 0) + amountSen;
    } else if (kind === "REFUND") {
      refundsSen += amountSen;
      clearingByGatewaySen[gateway] = (clearingByGatewaySen[gateway] || 0) - amountSen;
    }
  }

  return {
    orderId: order.id,
    orderName: order.name,
    productSalesSen,
    shippingIncomeSen: shopMoney(order.totalShippingPriceSet, "Shopify shipping income"),
    discountsSen: shopMoney(order.totalDiscountsSet, "Shopify discounts"),
    refundsSen,
    taxesSen: shopMoney(order.totalTaxSet, "Shopify taxes"),
    cogsSen,
    successfulSalesSen,
    payments,
    clearingByGatewaySen
  };
}

function addByKey(target, source) {
  for (const [key, value] of Object.entries(source)) target[key] = (target[key] || 0) + value;
}

export async function readShopifyDay(env, localDate, fetcher = fetch) {
  assertLocalDate(localDate);
  const timeZone = requireValue(env.TIME_ZONE, "TIME_ZONE");
  if (timeZone !== "Asia/Kuala_Lumpur") throw new Error("Shopify timezone did not match Oh! Venus");
  const token = await accessToken(env, fetcher);
  const query = `processed_at:>=${shiftDate(localDate, -1)} processed_at:<=${shiftDate(localDate, 1)}`;
  const matched = [];
  let after = null;
  let shop = null;

  for (;;) {
    const data = await graphql(env, token, ORDERS_QUERY, { query, after }, fetcher);
    shop ||= data.shop;
    for (const order of data.orders.nodes) {
      if (!order.test && localDateForInstant(order.processedAt, timeZone) === localDate) matched.push(order);
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
    if (!after) throw new Error("Shopify order pagination cursor was missing");
  }

  const expectedHost = requireValue(env.SHOPIFY_PRIMARY_DOMAIN, "SHOPIFY_PRIMARY_DOMAIN");
  if (shop.primaryDomain.host !== expectedHost || shop.currencyCode !== MYR || shop.ianaTimezone !== timeZone) {
    throw new Error("Shopify identity, currency, or timezone did not match Oh! Venus");
  }

  const orders = matched.map(normalizeOrder);
  const clearingByGatewaySen = {};
  for (const order of orders) addByKey(clearingByGatewaySen, order.clearingByGatewaySen);
  const result = {
    source: "shopify",
    localDate,
    shop: { name: shop.name, primaryDomain: shop.primaryDomain.host, currency: shop.currencyCode, timeZone: shop.ianaTimezone },
    orderCount: orders.length,
    orderIds: orders.map((order) => order.orderId),
    revenue: {
      productSalesSen: orders.reduce((sum, order) => sum + order.productSalesSen, 0),
      shippingIncomeSen: orders.reduce((sum, order) => sum + order.shippingIncomeSen, 0),
      discountsSen: orders.reduce((sum, order) => sum + order.discountsSen, 0),
      refundsSen: orders.reduce((sum, order) => sum + order.refundsSen, 0),
      taxesSen: orders.reduce((sum, order) => sum + order.taxesSen, 0)
    },
    cogsSen: orders.reduce((sum, order) => sum + order.cogsSen, 0),
    payments: orders.flatMap((order) => order.payments),
    clearingByGatewaySen
  };
  result.grossCollectedSen = result.revenue.productSalesSen + result.revenue.shippingIncomeSen
    - result.revenue.discountsSen - result.revenue.refundsSen + result.revenue.taxesSen;
  const transactionNetSen = orders.reduce((sum, order) => sum + order.successfulSalesSen - order.refundsSen, 0);
  if (result.grossCollectedSen !== transactionNetSen) {
    throw new Error(`Shopify revenue ${result.grossCollectedSen} did not reconcile to successful transactions ${transactionNetSen}`);
  }
  return result;
}
