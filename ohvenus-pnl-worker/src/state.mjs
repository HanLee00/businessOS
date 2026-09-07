import { shiftDate } from "./shopify.mjs";

const STATE_OBJECT_NAME = "ohvenus-daily-pnl";

function dateRange(start, end, maxDays = 31) {
  const dates = [];
  for (let date = start; date <= end; date = shiftDate(date, 1)) {
    dates.push(date);
    if (dates.length > maxDays) throw new Error(`Missed-day recovery exceeded ${maxDays} days`);
  }
  return dates;
}

export class OhVenusPnlState {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/dates") {
      const { targetDate } = await request.json();
      const lastSuccessfulDate = await this.state.storage.get("lastSuccessfulDate");
      const startDate = lastSuccessfulDate ? shiftDate(lastSuccessfulDate, 1) : targetDate;
      return Response.json({ dates: startDate <= targetDate ? dateRange(startDate, targetDate) : [] });
    }
    if (request.method === "POST" && url.pathname === "/record") {
      const run = await request.json();
      const expectedReference = `OHV-PNL-${run.localDate}`;
      if (run.reference !== expectedReference) return Response.json({ error: "deterministic reference mismatch" }, { status: 400 });
      const key = `run:${run.localDate}`;
      const existing = await this.state.storage.get(key);
      await this.state.storage.put(key, run);
      const lastSuccessfulDate = await this.state.storage.get("lastSuccessfulDate");
      if (!lastSuccessfulDate || run.localDate > lastSuccessfulDate) await this.state.storage.put("lastSuccessfulDate", run.localDate);
      return Response.json({ duplicate: existing?.fingerprint === run.fingerprint, changed: Boolean(existing && existing.fingerprint !== run.fingerprint) });
    }
    return new Response("not found", { status: 404 });
  }
}

function stub(env) {
  if (!env.PNL_RUN_STATE) throw new Error("PNL_RUN_STATE is not configured");
  return env.PNL_RUN_STATE.get(env.PNL_RUN_STATE.idFromName(STATE_OBJECT_NAME));
}

async function post(env, path, body) {
  const response = await stub(env).fetch(`https://pnl-state${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `P&L state failed with HTTP ${response.status}`);
  return result;
}

export async function recoveryDates(env, targetDate) { return (await post(env, "/dates", { targetDate })).dates; }

export async function recordRun(env, result) {
  const fingerprintInput = JSON.stringify({
    reference: result.reference,
    shopify: result.sources.shopify,
    meta: result.sources.meta,
    easyparcel: result.sources.easyparcel,
    preview: result.preview
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprintInput));
  const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return post(env, "/record", {
    localDate: result.preview.localDate,
    reference: result.reference,
    fingerprint,
    checkedAt: new Date().toISOString(),
    writeAttempted: false
  });
}
