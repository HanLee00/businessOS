const API_VERSION = "2026-07";

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(localDate, days) {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function localDateForInstant(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function previousLocalDate(instant, timeZone) {
  const today = localDateForInstant(instant, timeZone);
  return shiftDate(today, -1);
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
  if (!response.ok || !body.access_token) {
    throw new Error(`Shopify authentication failed with HTTP ${response.status}`);
  }
  return body.access_token;
}

async function graphql(env, token, query, variables, fetcher) {
  const domain = requireValue(env.SHOPIFY_SHOP_DOMAIN, "SHOPIFY_SHOP_DOMAIN");
  const response = await fetcher(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-access-token": token
    },
    body: JSON.stringify({ query, variables })
  });
  const body = await response.json();
  if (!response.ok || body.errors?.length) {
    const code = body.errors?.[0]?.extensions?.code || `HTTP_${response.status}`;
    throw new Error(`Shopify GraphQL failed: ${code}`);
  }
  return body.data;
}

const ORDERS_QUERY = `
  query DailyOrders($query: String!, $after: String) {
    shop { name currencyCode ianaTimezone primaryDomain { host } }
    orders(first: 100, after: $after, query: $query, sortKey: PROCESSED_AT) {
      nodes {
        id
        name
        processedAt
        test
        displayFinancialStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function readShopifyDay(env, localDate, fetcher = fetch) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    throw new Error("localDate must use the ISO local-date format");
  }
  const timeZone = env.TIME_ZONE || "Asia/Kuala_Lumpur";
  const token = await accessToken(env, fetcher);
  const query = `processed_at:>=${shiftDate(localDate, -1)} processed_at:<=${shiftDate(localDate, 1)}`;
  const matched = [];
  let after = null;
  let shop = null;

  for (;;) {
    const data = await graphql(env, token, ORDERS_QUERY, { query, after }, fetcher);
    shop ||= data.shop;
    for (const order of data.orders.nodes) {
      if (!order.test && localDateForInstant(order.processedAt, timeZone) === localDate) {
        matched.push(order);
      }
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }

  const expectedHost = env.SHOPIFY_PRIMARY_DOMAIN || "ohvenus.shop";
  if (shop.primaryDomain.host !== expectedHost || shop.currencyCode !== "MYR" || shop.ianaTimezone !== timeZone) {
    throw new Error("Shopify identity, currency, or timezone did not match Oh! Venus");
  }

  return {
    source: "shopify",
    localDate,
    shop: {
      name: shop.name,
      primaryDomain: shop.primaryDomain.host,
      currency: shop.currencyCode,
      timeZone: shop.ianaTimezone
    },
    orderCount: matched.length,
    orderIds: matched.map((order) => order.id),
    grossCollectedSen: matched.reduce((total, order) => {
      const money = order.currentTotalPriceSet.shopMoney;
      if (money.currencyCode !== "MYR") throw new Error("Shopify order was not denominated in MYR");
      return total + Math.round(Number(money.amount) * 100);
    }, 0)
  };
}
