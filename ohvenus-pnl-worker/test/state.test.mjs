import test from "node:test";
import assert from "node:assert/strict";
import { OhVenusPnlState } from "../src/state.mjs";

function state() {
  const values = new Map();
  return { storage: { async get(key) { return values.get(key); }, async put(key, value) { values.set(key, value); } } };
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
