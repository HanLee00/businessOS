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
    : new Response(JSON.stringify({ status_code: 200, data: { shipment_number: "S1", shipment_details: { reference: "#1180", coll_date: "2026-09-02 16:00:00", awb_number: "A1" }, pricing: { price: "6.12", total_price: "6.49", currency_code: "MYR" } } }));
  const result = await readEasyParcelDay(env, "2026-09-03", ["#1180"], fetcher);
  assert.equal(result.courierCostSen, 649);
  assert.equal(result.shipmentCount, 1);
});

test("uses BYOC shipment and EasyParcel charges together", async () => {
  const { env } = envWithVault();
  const fetcher = async (url) => String(url).endsWith("/shipment/list")
    ? new Response(JSON.stringify({ status_code: 200, data: [{ shipment_number: "S2" }] }))
    : new Response(JSON.stringify({ status_code: 200, data: { shipment_number: "S2", shipment_details: { reference: "#1180", coll_date: "2026-09-02 16:00:00" }, pricing: { total_price: "0.50", shipment_price: "7.00", byoc_charges: "0.50", currency_code: "MYR" } } }));
  const result = await readEasyParcelDay(env, "2026-09-03", ["#1180"], fetcher);
  assert.equal(result.courierCostSen, 750);
});

test("treats a 404 shipment list as an empty day", async () => {
  const { env } = envWithVault();
  const result = await readEasyParcelDay(env, "2026-09-03", ["#1180"], async () => new Response("", { status: 404 }));
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
  await assert.rejects(() => readEasyParcelDay(env, "2026-09-03", ["#1180"], fetcher), /duplicate shipment S0/);
});

test("fails closed on invalid dates and source mismatches", async () => {
  const { env } = envWithVault();
  await assert.rejects(() => readEasyParcelDay(env, "2026-02-30", ["#1180"], async () => {}), /real calendar date/);
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
    await assert.rejects(() => readEasyParcelDay(env, "2026-09-03", ["#1180"], fetcher), expected);
  }
});

test("exposes every price component so a preview can be reconciled to the invoice", async () => {
  const fetcher = async (url) => {
    if (url.includes("/shipment/list")) {
      return new Response(JSON.stringify({ status_code: "200", data: [{ shipment_number: "ES-1", awb: "AWB1" }], has_more: false }));
    }
    return new Response(JSON.stringify({ status_code: "200", data: {
      shipment_number: "ES-1",
      shipment_details: { reference: "#1180", coll_date: "2026-09-05 16:00:00", awb_number: "AWB1" },
      pricing: { total_price: "6.49", shipment_price: "6.29", addon_price: "0.20", currency_code: "MYR" }
    } }));
  };
  const env = {
    TIME_ZONE: "Asia/Kuala_Lumpur", EASYPARCEL_ACCOUNT_REGION: "Malaysia",
    EASYPARCEL_TOKEN_VAULT: { idFromName: () => "id", get: () => ({ fetch: async () => Response.json({ accessToken: "t" }) }) }
  };
  const result = await readEasyParcelDay(env, "2026-09-06", ["#1180"], fetcher);
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
      shipment_details: { reference: "#1180", coll_date: "2026-09-05 16:00:00", awb_number: "AWB2" },
      pricing: { total_price: "6.49", total_amount: "6.69", currency_code: "MYR" }
    } }));
  };
  const env = {
    TIME_ZONE: "Asia/Kuala_Lumpur", EASYPARCEL_ACCOUNT_REGION: "Malaysia",
    EASYPARCEL_TOKEN_VAULT: { idFromName: () => "id", get: () => ({ fetch: async () => Response.json({ accessToken: "t" }) }) }
  };
  const result = await readEasyParcelDay(env, "2026-09-06", ["#1180"], fetcher);
  assert.equal(result.shipments[0].priceUnderChosen, 20);
  assert.equal(result.priceReviewRequiredCount, 1);
});

const vaultEnv = (extra = {}) => ({
  TIME_ZONE: "Asia/Kuala_Lumpur", EASYPARCEL_ACCOUNT_REGION: "Malaysia",
  EASYPARCEL_TOKEN_VAULT: { idFromName: () => "id", get: () => ({ fetch: async () => Response.json({ accessToken: "t" }) }) },
  ...extra
});

// Reproduces the real ES-2608-MGPMS payload for Shopify order #1178.
const maskedFetcher = async (url) => {
  if (url.includes("/shipment/list")) {
    return new Response(JSON.stringify({ status_code: "200", data: [{ shipment_number: "ES-2608-MGPMS", awb: "7328089358633416" }], has_more: false }));
  }
  return new Response(JSON.stringify({ status_code: "200", data: {
    shipment_number: "ES-2608-MGPMS",
    shipment_details: { reference: "#1180", coll_date: "2026-08-31 16:00:00", awb_number: "7328089358633416" },
    pricing: { shipment_price: "6.12", tax_price: "0.37", total_price: "6.49", insurance: null, sms_notification: null, currency_code: "MYR" }
  } }));
};

test("adds the account addon the detail API omits, matching the RM6.69 invoice", async () => {
  const env = vaultEnv({ EASYPARCEL_ADDON_PER_SHIPMENT_SEN: "20" });
  const result = await readEasyParcelDay(env, "2026-09-01", ["#1180"], maskedFetcher);
  const shipment = result.shipments[0];
  assert.equal(shipment.apiCostSen, 649);
  assert.equal(shipment.addonSen, 20);
  assert.equal(shipment.costSen, 669);
  assert.equal(result.courierCostSen, 669);
  assert.equal(result.apiCourierCostSen, 649);
  assert.equal(result.addonCourierCostSen, 20);
});

test("applies no addon when masking is switched off", async () => {
  const result = await readEasyParcelDay(vaultEnv(), "2026-09-01", ["#1180"], maskedFetcher);
  assert.equal(result.courierCostSen, 649);
  assert.equal(result.addonCourierCostSen, 0);
});

test("rejects a malformed addon setting instead of guessing", async () => {
  const env = vaultEnv({ EASYPARCEL_ADDON_PER_SHIPMENT_SEN: "0.20" });
  await assert.rejects(() => readEasyParcelDay(env, "2026-09-01", ["#1180"], maskedFetcher), /whole number of sen/);
});

test("recovers when another client rotated the stored refresh token", async () => {
  const storage = new Map([["oauth", { accessToken: "old", refreshToken: "dead", expiresAtMs: 0 }]]);
  const attempts = [];
  const fetcher = async (url, options) => {
    const sent = new URLSearchParams(options.body).get("refresh_token");
    attempts.push(sent);
    if (sent === "dead") return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    return new Response(JSON.stringify({ access_token: "fresh", refresh_token: "rotated", expires_in: 3600 }));
  };
  const vault = new EasyParcelTokenVault(
    { storage: { async get(k) { return storage.get(k); }, async put(k, v) { storage.set(k, v); } } },
    { EASYPARCEL_CLIENT_ID: "id", EASYPARCEL_CLIENT_SECRET: "secret", EASYPARCEL_REDIRECT_URI: "http://127.0.0.1:8080/callback",
      EASYPARCEL_REFRESH_TOKEN: "bootstrap", EASYPARCEL_FETCHER: fetcher }
  );
  assert.equal(await vault.accessToken(), "fresh");
  // Tried the stored token first, then fell back to the re-uploaded secret.
  assert.deepEqual(attempts, ["dead", "bootstrap"]);
  assert.equal(storage.get("oauth").refreshToken, "rotated");
});

test("books courier cost on the order's day even when collection is days later", async () => {
  const detail = {
    "ES-MINE":  { coll_date: "2026-09-10 16:00:00", price: "6.49", ref: "#1181" },
    "ES-OTHER": { coll_date: "2026-09-05 16:00:00", price: "9.99", ref: "#1177" }
  };
  const fetcher = async (url, options) => {
    if (url.includes("/shipment/list")) {
      return new Response(JSON.stringify({ status_code: "200", data: [
        { shipment_number: "ES-MINE" }, { shipment_number: "ES-OTHER" }
      ], has_more: false }));
    }
    const sn = JSON.parse(options.body).shipment_number;
    const d = detail[sn];
    return new Response(JSON.stringify({ status_code: "200", data: {
      shipment_number: sn,
      shipment_details: { coll_date: d.coll_date, awb_number: `AWB-${sn}`, reference: d.ref },
      pricing: { total_price: d.price, currency_code: "MYR" }
    } }));
  };
  // Only #1181 was ordered on this day. Its parcel is collected four days later
  // and still belongs here; #1177's parcel belongs to an earlier day.
  const result = await readEasyParcelDay(vaultEnv(), "2026-09-06", ["#1181"], fetcher);
  assert.equal(result.shipmentCount, 1);
  assert.equal(result.shipments[0].shipmentNumber, "ES-MINE");
  assert.equal(result.shipments[0].collectionLocalDate, "2026-09-11");
  assert.equal(result.courierCostSen, 649);
  assert.equal(result.basis, "order_date");
  assert.equal(result.ordersWithoutShipment, 0);
});

test("reports an order whose shipment is not booked yet", async () => {
  const fetcher = async (url) => url.includes("/shipment/list")
    ? new Response(JSON.stringify({ status_code: "200", data: [], has_more: false }))
    : new Response(JSON.stringify({ status_code: "200", data: {} }));
  const result = await readEasyParcelDay(vaultEnv(), "2026-09-06", ["#1181", "#1182"], fetcher);
  assert.equal(result.shipmentCount, 0);
  assert.equal(result.courierCostSen, 0);
  assert.equal(result.ordersWithoutShipment, 2);
});

test("fails closed when a shipment has no collection date", async () => {
  const fetcher = async (url) => url.includes("/shipment/list")
    ? new Response(JSON.stringify({ status_code: "200", data: [{ shipment_number: "S9" }], has_more: false }))
    : new Response(JSON.stringify({ status_code: "200", data: { shipment_number: "S9", shipment_details: { reference: "#1180" }, pricing: { total_price: "6.49", currency_code: "MYR" } } }));
  await assert.rejects(() => readEasyParcelDay(vaultEnv(), "2026-09-06", ["#1180"], fetcher), /no collection date/);
});
