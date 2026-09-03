import test from "node:test";
import assert from "node:assert/strict";
import { localDateForInstant, previousLocalDate, readShopifyDay } from "../src/shopify.mjs";

const env = {
  TIME_ZONE: "Asia/Kuala_Lumpur",
  SHOPIFY_SHOP_DOMAIN: "9s4j4j-8d.myshopify.com",
  SHOPIFY_PRIMARY_DOMAIN: "ohvenus.shop",
  SHOPIFY_CLIENT_ID: "client",
  SHOPIFY_CLIENT_SECRET: "secret"
};

test("converts timestamps and selects the previous Malaysia date", () => {
  assert.equal(localDateForInstant("2026-09-01T16:30:00Z", env.TIME_ZONE), "2026-09-02");
  assert.equal(previousLocalDate("2026-09-03T04:00:00Z", env.TIME_ZONE), "2026-09-02");
});

test("uses a buffered query but keeps only the exact Malaysia local day", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/admin/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
    }
    return new Response(JSON.stringify({
      data: {
        shop: {
          name: "Oh! Venus",
          currencyCode: "MYR",
          ianaTimezone: "Asia/Kuala_Lumpur",
          primaryDomain: { host: "ohvenus.shop" }
        },
        orders: {
          nodes: [
            {
              id: "gid://shopify/Order/1",
              name: "#1",
              processedAt: "2026-09-01T16:30:00Z",
              test: false,
              currentTotalPriceSet: { shopMoney: { amount: "12.34", currencyCode: "MYR" } }
            },
            {
              id: "gid://shopify/Order/2",
              name: "#2",
              processedAt: "2026-09-02T16:30:00Z",
              test: false,
              currentTotalPriceSet: { shopMoney: { amount: "99.00", currencyCode: "MYR" } }
            }
          ],
          pageInfo: { hasNextPage: false, endCursor: null }
        }
      }
    }), { status: 200 });
  };

  const result = await readShopifyDay(env, "2026-09-02", fetcher);
  assert.equal(result.orderCount, 1);
  assert.equal(result.grossCollectedSen, 1234);
  assert.deepEqual(result.orderIds, ["gid://shopify/Order/1"]);
  const requestBody = JSON.parse(calls[1].options.body);
  assert.match(requestBody.variables.query, /processed_at:>=2026-09-01/);
  assert.match(requestBody.variables.query, /processed_at:<=2026-09-03/);
});

test("fails closed when the shop identity does not match", async () => {
  const fetcher = async (url) => {
    if (url.endsWith("/admin/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
    }
    return new Response(JSON.stringify({
      data: {
        shop: {
          name: "Wrong Shop",
          currencyCode: "MYR",
          ianaTimezone: "Asia/Kuala_Lumpur",
          primaryDomain: { host: "wrong.example" }
        },
        orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }
      }
    }), { status: 200 });
  };
  await assert.rejects(() => readShopifyDay(env, "2026-09-02", fetcher), /did not match Oh! Venus/);
});
