import test from "node:test";
import assert from "node:assert/strict";
import { EasyParcelTokenVault, readEasyParcelDay } from "../src/easyparcel.mjs";

function stateStore(initial = null) {
  let value = initial;
  return {
    storage: { async get() { return value; }, async put(_key, next) { value = next; } },
    value() { return value; }
  };
}

function tokenNamespace(vault) {
  return {
    idFromName(name) { return name; },
    get() { return { fetch: (url, options) => vault.fetch(new Request(url, options)) }; }
  };
}

function envWithVault(fetcher, initial = { accessToken: "access", refreshToken: "refresh", expiresAtMs: 9_999_999_999_999 }) {
  const state = stateStore(initial);
  const vault = new EasyParcelTokenVault(state, {
    EASYPARCEL_CLIENT_ID: "client",
    EASYPARCEL_CLIENT_SECRET: "secret",
    EASYPARCEL_REDIRECT_URI: "http://127.0.0.1:8080/callback",
    EASYPARCEL_REFRESH_TOKEN: "refresh-1",
    EASYPARCEL_FETCHER: fetcher
  });
  return {
    state,
    env: {
      TIME_ZONE: "Asia/Kuala_Lumpur",
      EASYPARCEL_ACCOUNT_REGION: "Malaysia",
      EASYPARCEL_TOKEN_VAULT: tokenNamespace(vault)
    }
  };
}

test("refreshes once under concurrency and preserves the rotated refresh token", async () => {
  let refreshCalls = 0;
  const fetcher = async () => {
    refreshCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 }));
  };
  const state = stateStore();
  const vault = new EasyParcelTokenVault(state, {
    EASYPARCEL_CLIENT_ID: "client",
    EASYPARCEL_CLIENT_SECRET: "secret",
    EASYPARCEL_REDIRECT_URI: "http://127.0.0.1:8080/callback",
    EASYPARCEL_REFRESH_TOKEN: "refresh-1",
    EASYPARCEL_FETCHER: fetcher
  });
  const [first, second] = await Promise.all([vault.accessToken(1_000_000), vault.accessToken(1_000_000)]);
  assert.equal(first, "access-2");
  assert.equal(second, "access-2");
  assert.equal(refreshCalls, 1);
  assert.equal(state.value().refreshToken, "refresh-2");
});

test("totals the full detail price even when detail contains a lower price", async () => {
  const { env } = envWithVault();
  const fetcher = async (url) => String(url).endsWith("/shipment/list")
    ? new Response(JSON.stringify({ status_code: 200, data: [{ shipment_number: "S1", awb: "A1" }] }))
    : new Response(JSON.stringify({ status_code: 200, data: { shipment_number: "S1", shipment_details: { awb_number: "A1" }, pricing: { price: "6.12", total_price: "6.49", currency_code: "MYR" } } }));
  const result = await readEasyParcelDay(env, "2026-09-03", fetcher);
  assert.equal(result.courierCostSen, 649);
  assert.equal(result.shipmentCount, 1);
});

test("uses BYOC shipment and EasyParcel charges together", async () => {
  const { env } = envWithVault();
  const fetcher = async (url) => String(url).endsWith("/shipment/list")
    ? new Response(JSON.stringify({ status_code: 200, data: [{ shipment_number: "S2" }] }))
    : new Response(JSON.stringify({ status_code: 200, data: { shipment_number: "S2", pricing: { total_price: "0.50", shipment_price: "7.00", byoc_charges: "0.50", currency_code: "MYR" } } }));
  const result = await readEasyParcelDay(env, "2026-09-03", fetcher);
  assert.equal(result.courierCostSen, 750);
});

test("treats a 404 shipment list as an empty day", async () => {
  const { env } = envWithVault();
  const result = await readEasyParcelDay(env, "2026-09-03", async () => new Response("", { status: 404 }));
  assert.equal(result.shipmentCount, 0);
  assert.equal(result.courierCostSen, 0);
});

test("rejects duplicate shipment records instead of double counting", async () => {
  const { env } = envWithVault();
  const firstPage = Array.from({ length: 250 }, (_, index) => ({ shipment_number: `S${index}` }));
  let page = 0;
  const fetcher = async () => {
    page += 1;
    return new Response(JSON.stringify({ status_code: 200, has_more: page === 1, data: page === 1 ? firstPage : [{ shipment_number: "S0" }] }));
  };
  await assert.rejects(() => readEasyParcelDay(env, "2026-09-03", fetcher), /duplicate shipment S0/);
});

test("fails closed on invalid dates and source mismatches", async () => {
  const { env } = envWithVault();
  await assert.rejects(() => readEasyParcelDay(env, "2026-02-30", async () => {}), /real calendar date/);
  await assert.rejects(() => readEasyParcelDay({ ...env, TIME_ZONE: "UTC" }, "2026-09-03", async () => {}), /timezone did not match/);
  const cases = [
    [{ shipment_number: "WRONG", pricing: { total_price: "1", currency_code: "MYR" } }, /identity mismatch/],
    [{ shipment_number: "S1", pricing: { total_price: "1", currency_code: "USD" } }, /not denominated in MYR/],
    [{ shipment_number: "S1", pricing: { currency_code: "MYR" } }, /no valid final price/]
  ];
  for (const [detail, expected] of cases) {
    const fetcher = async (url) => String(url).endsWith("/shipment/list")
      ? new Response(JSON.stringify({ status_code: 200, data: [{ shipment_number: "S1" }] }))
      : new Response(JSON.stringify({ status_code: 200, data: detail }));
    await assert.rejects(() => readEasyParcelDay(env, "2026-09-03", fetcher), expected);
  }
});

test("exposes every price component so a preview can be reconciled to the invoice", async () => {
  const fetcher = async (url) => {
    if (url.includes("/shipment/list")) {
      return new Response(JSON.stringify({ status_code: "200", data: [{ shipment_number: "ES-1", awb: "AWB1" }], has_more: false }));
    }
    return new Response(JSON.stringify({ status_code: "200", data: {
      shipment_number: "ES-1",
      shipment_details: { awb_number: "AWB1" },
      pricing: { total_price: "6.49", shipment_price: "6.29", addon_price: "0.20", currency_code: "MYR" }
    } }));
  };
  const env = {
    TIME_ZONE: "Asia/Kuala_Lumpur", EASYPARCEL_ACCOUNT_REGION: "Malaysia",
    EASYPARCEL_TOKEN_VAULT: { idFromName: () => "id", get: () => ({ fetch: async () => Response.json({ accessToken: "t" }) }) }
  };
  const result = await readEasyParcelDay(env, "2026-09-06", fetcher);
  const shipment = result.shipments[0];
  assert.equal(shipment.priceSource, "pricing.total_price");
  // Each component EasyParcel returned is preserved for reconciliation.
  assert.equal(shipment.priceComponents.total_price, 649);
  assert.equal(shipment.priceComponents.shipment_price, 629);
  assert.equal(shipment.priceComponents.addon_price, 20);
});

test("flags a shipment whose chosen price is smaller than a returned component", async () => {
  const fetcher = async (url) => {
    if (url.includes("/shipment/list")) {
      return new Response(JSON.stringify({ status_code: "200", data: [{ shipment_number: "ES-2", awb: "AWB2" }], has_more: false }));
    }
    return new Response(JSON.stringify({ status_code: "200", data: {
      shipment_number: "ES-2",
      shipment_details: { awb_number: "AWB2" },
      pricing: { total_price: "6.49", total_amount: "6.69", currency_code: "MYR" }
    } }));
  };
  const env = {
    TIME_ZONE: "Asia/Kuala_Lumpur", EASYPARCEL_ACCOUNT_REGION: "Malaysia",
    EASYPARCEL_TOKEN_VAULT: { idFromName: () => "id", get: () => ({ fetch: async () => Response.json({ accessToken: "t" }) }) }
  };
  const result = await readEasyParcelDay(env, "2026-09-06", fetcher);
  assert.equal(result.shipments[0].priceUnderChosen, 20);
  assert.equal(result.priceReviewRequiredCount, 1);
});
