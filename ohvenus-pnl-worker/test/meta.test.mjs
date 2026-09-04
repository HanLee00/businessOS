import test from "node:test";
import assert from "node:assert/strict";
import { readMetaAdsDay } from "../src/meta.mjs";

const env = {
  TIME_ZONE: "Asia/Kuala_Lumpur",
  META_GRAPH_VERSION: "v26.0",
  META_AD_ACCOUNT_ID: "act_1383191923615307",
  META_AD_ACCOUNT_NAME: "OHVENUS",
  META_AD_ACCOUNT_CURRENCY: "MYR",
  META_AD_ACCOUNT_TIME_ZONE: "Asia/Kuala_Lumpur",
  META_ACCESS_TOKEN: "secret"
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

test("reads exact-day spend from the verified OhVenus account", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), options });
    if (!String(url).includes("/insights")) {
      return response({
        id: "act_1383191923615307",
        account_id: "1383191923615307",
        name: "OHVENUS",
        currency: "MYR",
        timezone_name: "Asia/Kuala_Lumpur",
        account_status: 1
      });
    }
    return response({ data: [{ spend: "123.45", date_start: "2026-09-02", date_stop: "2026-09-02" }] });
  };

  const result = await readMetaAdsDay(env, "2026-09-02", fetcher);
  assert.equal(result.spendSen, 12345);
  assert.equal(result.account.name, "OHVENUS");
  assert.equal(calls[0].options.headers.authorization, "Bearer secret");
  assert.ok(!calls[0].url.includes("secret"));
  const insightsUrl = new URL(calls[1].url);
  assert.deepEqual(JSON.parse(insightsUrl.searchParams.get("time_range")), {
    since: "2026-09-02",
    until: "2026-09-02"
  });
});

test("returns zero when Meta has no spend row for the day", async () => {
  const fetcher = async (url) => String(url).includes("/insights")
    ? response({ data: [] })
    : response({
      id: "act_1383191923615307",
      account_id: "1383191923615307",
      name: "OHVENUS",
      currency: "MYR",
      timezone_name: "Asia/Kuala_Lumpur",
      account_status: 1
    });
  const result = await readMetaAdsDay(env, "2026-09-02", fetcher);
  assert.equal(result.spendSen, 0);
});

test("fails closed on the wrong account identity", async () => {
  const fetcher = async () => response({
    id: "act_999",
    account_id: "999",
    name: "OTHER",
    currency: "USD",
    timezone_name: "UTC",
    account_status: 1
  });
  await assert.rejects(() => readMetaAdsDay(env, "2026-09-02", fetcher), /did not match Oh! Venus/);
});

test("fails closed when Meta returns a different day", async () => {
  const fetcher = async (url) => String(url).includes("/insights")
    ? response({ data: [{ spend: "1.00", date_start: "2026-09-01", date_stop: "2026-09-01" }] })
    : response({
      id: "act_1383191923615307",
      account_id: "1383191923615307",
      name: "OHVENUS",
      currency: "MYR",
      timezone_name: "Asia/Kuala_Lumpur",
      account_status: 1
    });
  await assert.rejects(() => readMetaAdsDay(env, "2026-09-02", fetcher), /outside the requested local date/);
});
