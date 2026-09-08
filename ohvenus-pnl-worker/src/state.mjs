import { shiftDate } from "./shopify.mjs";

const STATE_OBJECT_NAME = "ohvenus-daily-pnl";

// Each recovered day costs a Shopify order page, a Shopify refund page, a Meta
// read and one EasyParcel call per shipment. Cloudflare caps subrequests per
// invocation, so a backlog is drained a few days per run instead of all at once.
export const MAX_DAYS_PER_RUN = 3;
// Completed days are revisited so a late refund, a corrected order, or an AWB
// bought after the day was first calculated is surfaced. Rotating oldest-first
// covers the whole window every few runs without blowing the subrequest budget.
export const RESCAN_WINDOW_DAYS = 7;
export const RESCAN_DAYS_PER_RUN = 2;

function dateRange(start, end, maxDays = MAX_DAYS_PER_RUN) {
  const dates = [];
  for (let date = start; date <= end && dates.length < maxDays; date = shiftDate(date, 1)) {
    dates.push(date);
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
      const dates = startDate <= targetDate ? dateRange(startDate, targetDate) : [];
      let pending = 0;
      if (dates.length) {
        for (let date = shiftDate(dates.at(-1), 1); date <= targetDate; date = shiftDate(date, 1)) pending += 1;
      }
      return Response.json({ dates, pendingAfterRun: pending });
    }
    if (request.method === "POST" && url.pathname === "/rescan-dates") {
      const { targetDate, exclude = [] } = await request.json();
      const skip = new Set(exclude);
      const candidates = [];
      for (let offset = 1; offset <= RESCAN_WINDOW_DAYS; offset += 1) {
        const date = shiftDate(targetDate, -offset);
        if (skip.has(date)) continue;
        const run = await this.state.storage.get(`run:${date}`);
        if (!run) continue;
        candidates.push({ date, rescannedAt: run.rescannedAt || "" });
      }
      // Never rescanned first, then least recently rescanned.
      candidates.sort((a, b) => (a.rescannedAt || "").localeCompare(b.rescannedAt || "") || a.date.localeCompare(b.date));
      return Response.json({
        dates: candidates.slice(0, RESCAN_DAYS_PER_RUN).map((entry) => entry.date),
        windowSize: candidates.length
      });
    }
    if (request.method === "POST" && url.pathname === "/record") {
      const run = await request.json();
      const expectedReference = `OHV-PNL-${run.localDate}`;
      if (run.reference !== expectedReference) return Response.json({ error: "deterministic reference mismatch" }, { status: 400 });
      const key = `run:${run.localDate}`;
      const existing = await this.state.storage.get(key);
      await this.state.storage.put(key, {
        ...run,
        firstSeenAt: existing?.firstSeenAt || run.checkedAt,
        rescannedAt: run.rescannedAt || existing?.rescannedAt
      });
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

export async function recoveryDates(env, targetDate) { return post(env, "/dates", { targetDate }); }

export async function rescanDates(env, targetDate, exclude) {
  return post(env, "/rescan-dates", { targetDate, exclude });
}

export async function recordRun(env, result, { rescan = false } = {}) {
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
    rescannedAt: rescan ? new Date().toISOString() : undefined,
    writeAttempted: false
  });
}
