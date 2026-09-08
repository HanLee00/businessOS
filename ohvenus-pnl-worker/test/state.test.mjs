import test from "node:test";
import assert from "node:assert/strict";
import { OhVenusPnlState } from "../src/state.mjs";

function state() {
  const values = new Map();
  return { storage: {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
    async list({ prefix } = {}) {
      const out = new Map();
      for (const [key, value] of values) if (!prefix || key.startsWith(prefix)) out.set(key, value);
      return out;
    }
  } };
}

async function request(object, path, body) {
  return object.fetch(new Request(`https://state${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

test("recovers every missing date after the last successful run", async () => {
  const object = new OhVenusPnlState(state());
  await request(object, "/record", { localDate: "2026-09-03", reference: "OHV-PNL-2026-09-03", fingerprint: "a" });
  const response = await request(object, "/dates", { targetDate: "2026-09-06" });
  assert.deepEqual((await response.json()).dates, ["2026-09-04", "2026-09-05", "2026-09-06"]);
});

test("uses one deterministic record and reports duplicate or changed reruns", async () => {
  const object = new OhVenusPnlState(state());
  const run = { localDate: "2026-09-06", reference: "OHV-PNL-2026-09-06", fingerprint: "a" };
  assert.deepEqual(await (await request(object, "/record", run)).json(), { duplicate: false, changed: false });
  assert.deepEqual(await (await request(object, "/record", run)).json(), { duplicate: true, changed: false });
  assert.deepEqual(await (await request(object, "/record", { ...run, fingerprint: "b" })).json(), { duplicate: false, changed: true });
  const invalid = await request(object, "/record", { ...run, reference: "wrong" });
  assert.equal(invalid.status, 400);
});

test("drains a long backlog a few days per run and reports what is left", async () => {
  const object = new OhVenusPnlState(state());
  await request(object, "/record", { localDate: "2026-09-01", reference: "OHV-PNL-2026-09-01", fingerprint: "a" });
  const body = await (await request(object, "/dates", { targetDate: "2026-09-10" })).json();
  assert.deepEqual(body.dates, ["2026-09-02", "2026-09-03", "2026-09-04"]);
  assert.equal(body.pendingAfterRun, 6);

  for (const localDate of body.dates) {
    await request(object, "/record", { localDate, reference: `OHV-PNL-${localDate}`, fingerprint: "a" });
  }
  const next = await (await request(object, "/dates", { targetDate: "2026-09-10" })).json();
  assert.deepEqual(next.dates, ["2026-09-05", "2026-09-06", "2026-09-07"]);
  assert.equal(next.pendingAfterRun, 3);
});

test("reports no work and no backlog once caught up", async () => {
  const object = new OhVenusPnlState(state());
  await request(object, "/record", { localDate: "2026-09-06", reference: "OHV-PNL-2026-09-06", fingerprint: "a" });
  const body = await (await request(object, "/dates", { targetDate: "2026-09-06" })).json();
  assert.deepEqual(body.dates, []);
  assert.equal(body.pendingAfterRun, 0);
});

test("rotates rescans oldest-first across the window", async () => {
  const object = new OhVenusPnlState(state());
  for (const d of ["2026-09-01","2026-09-02","2026-09-03","2026-09-04"]) {
    await request(object, "/record", { localDate: d, reference: `OHV-PNL-${d}`, fingerprint: "a", checkedAt: "2026-09-05T04:00:00Z" });
  }
  // Never-rescanned days come first, oldest first.
  const first = await (await request(object, "/rescan-dates", { targetDate: "2026-09-05" })).json();
  assert.deepEqual(first.dates, ["2026-09-01","2026-09-02"]);
  assert.equal(first.windowSize, 4);

  for (const d of first.dates) {
    await request(object, "/record", { localDate: d, reference: `OHV-PNL-${d}`, fingerprint: "a", checkedAt: "x", rescannedAt: "2026-09-05T05:00:00Z" });
  }
  // Next run moves on to the days not yet revisited.
  const second = await (await request(object, "/rescan-dates", { targetDate: "2026-09-05" })).json();
  assert.deepEqual(second.dates, ["2026-09-03","2026-09-04"]);
});

test("never rescans a date being calculated fresh in the same run", async () => {
  const object = new OhVenusPnlState(state());
  await request(object, "/record", { localDate: "2026-09-04", reference: "OHV-PNL-2026-09-04", fingerprint: "a" });
  const body = await (await request(object, "/rescan-dates", { targetDate: "2026-09-05", exclude: ["2026-09-04"] })).json();
  assert.deepEqual(body.dates, []);
});

test("detects a late courier cost arriving after the day was first calculated", async () => {
  const object = new OhVenusPnlState(state());
  const base = { localDate: "2026-09-06", reference: "OHV-PNL-2026-09-06" };
  // First run: the AWB had not been bought yet.
  await request(object, "/record", { ...base, fingerprint: "no-courier", checkedAt: "2026-09-07T04:00:00Z" });
  // Rescan once the shipment exists.
  const res = await (await request(object, "/record", { ...base, fingerprint: "with-courier", checkedAt: "2026-09-09T04:00:00Z", rescannedAt: "2026-09-09T04:00:00Z" })).json();
  assert.deepEqual(res, { duplicate: false, changed: true });
});

test("keeps the original first-seen time and the latest rescan time", async () => {
  const object = new OhVenusPnlState(state());
  const base = { localDate: "2026-09-06", reference: "OHV-PNL-2026-09-06", fingerprint: "a" };
  await request(object, "/record", { ...base, checkedAt: "2026-09-07T04:00:00Z" });
  await request(object, "/record", { ...base, checkedAt: "2026-09-09T04:00:00Z", rescannedAt: "2026-09-09T04:00:00Z" });
  const again = await (await request(object, "/rescan-dates", { targetDate: "2026-09-10" })).json();
  assert.deepEqual(again.dates, ["2026-09-06"]);
});

test("stores the full financial summary and reads back run history", async () => {
  const object = new OhVenusPnlState(state());
  for (const d of ["2026-09-05", "2026-09-06"]) {
    await request(object, "/record", {
      localDate: d, reference: `OHV-PNL-${d}`, fingerprint: "a", checkedAt: `${d}T04:00:00Z`,
      summary: { netProfitSen: 28741, debitsSen: 117858, creditsSen: 117858, easyParcelCourierCostSen: 1338 }
    });
  }
  const res = await new OhVenusPnlState({ storage: object.state.storage }).fetch(new Request("https://state/runs"));
  const body = await res.json();
  assert.equal(body.count, 2);
  // Newest first, with the figures intact rather than just a fingerprint.
  assert.equal(body.runs[0].localDate, "2026-09-06");
  assert.equal(body.runs[0].summary.netProfitSen, 28741);
  assert.equal(body.runs[0].summary.easyParcelCourierCostSen, 1338);
  assert.equal(body.lastSuccessfulDate, "2026-09-06");
});

test("keeps the stored summary when a rescan finds no change", async () => {
  const object = new OhVenusPnlState(state());
  const base = { localDate: "2026-09-06", reference: "OHV-PNL-2026-09-06", fingerprint: "a" };
  await request(object, "/record", { ...base, checkedAt: "2026-09-07T04:00:00Z", summary: { netProfitSen: 28741 } });
  await request(object, "/record", { ...base, checkedAt: "2026-09-09T04:00:00Z", rescannedAt: "2026-09-09T04:00:00Z", summary: { netProfitSen: 28741 } });
  const body = await (await new OhVenusPnlState({ storage: object.state.storage }).fetch(new Request("https://state/runs"))).json();
  assert.equal(body.runs[0].summary.netProfitSen, 28741);
  assert.equal(body.runs[0].firstSeenAt, "2026-09-07T04:00:00Z");
});
