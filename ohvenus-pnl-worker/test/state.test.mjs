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
