import { buildJournalPreview } from "./calculation.mjs";
import { resolveAccountIds } from "./accounts.mjs";
import { previousLocalDate, readShopifyDay, readShopifyIdentity } from "./shopify.mjs";
import { readMetaAdsDay } from "./meta.mjs";
import { readEasyParcelDay, createShipmentCache } from "./easyparcel.mjs";
import { recoveryDates, rescanDates, recordRun, listRuns, MAX_DAYS_PER_RUN } from "./state.mjs";
export { EasyParcelTokenVault } from "./easyparcel.mjs";
export { OhVenusPnlState } from "./state.mjs";

// Links each EasyParcel shipment cost to the Shopify order it shipped, by AWB.
// A shipment whose order was placed on an earlier day cannot match inside a
// single day's order set, so it is reported as unmatched rather than hidden.
export function matchCourierCostsToOrders(shopify, easyparcel) {
  const orders = shopify.orders || [];
  // EasyParcel stores the Shopify order name it was booked against, which links
  // a shipment to its order whatever day that order was placed. AWB matching is
  // kept as a fallback and only ever finds orders within the same day.
  const byReference = new Map();
  const byAwb = new Map();
  for (const order of orders) {
    const name = String(order.orderName || "").trim();
    if (name) byReference.set(name.replace(/^#/, "").toLowerCase(), order);
    for (const tracking of order.trackingNumbers || []) byAwb.set(tracking, order);
  }

  const matched = [];
  const otherDay = [];
  const unmatched = [];
  for (const shipment of easyparcel.shipments) {
    const reference = String(shipment.orderReference || "").trim().replace(/^#/, "").toLowerCase();
    let order = reference ? byReference.get(reference) : null;
    let matchedBy = order ? "reference" : null;
    if (!order && shipment.awbNumber) {
      order = byAwb.get(shipment.awbNumber);
      if (order) matchedBy = "awb";
    }
    const entry = {
      shipmentNumber: shipment.shipmentNumber,
      awbNumber: shipment.awbNumber,
      orderReference: shipment.orderReference || null,
      courierCostSen: shipment.courierCostSen ?? shipment.costSen,
      orderId: order?.orderId || null,
      orderName: order?.orderName || shipment.orderReference || null,
      matchedBy
    };
    if (order) matched.push(entry);
    // Orders usually ship the day after they are placed, so a shipment whose
    // reference names an order outside this day is still fully attributed. Only
    // a shipment with no usable reference is genuinely unknown.
    else if (entry.orderReference) otherDay.push(entry);
    else unmatched.push(entry);
  }
  const sum = (list) => list.reduce((total, entry) => total + entry.courierCostSen, 0);
  return {
    matchedCount: matched.length,
    otherDayCount: otherDay.length,
    unmatchedCount: unmatched.length,
    attributedCount: matched.length + otherDay.length,
    matchedByReferenceCount: matched.filter((entry) => entry.matchedBy === "reference").length,
    matchedByAwbCount: matched.filter((entry) => entry.matchedBy === "awb").length,
    matchedCourierCostSen: sum(matched),
    otherDayCourierCostSen: sum(otherDay),
    unmatchedCourierCostSen: sum(unmatched),
    perOrder: matched,
    attributedToOrderFromAnotherDay: otherDay,
    unattributed: unmatched
  };
}

async function dailyPreview(env, localDate, cache = null) {
  // EasyParcel is keyed off this day's order names, so Shopify is read first.
  const [shopify, meta] = await Promise.all([
    readShopifyDay(env, localDate),
    readMetaAdsDay(env, localDate)
  ]);
  const orderReferences = (shopify.orders || []).map((order) => order.orderName);
  const easyparcel = await readEasyParcelDay(env, localDate, orderReferences, fetch, cache);
  const snapshot = {
    currency: "MYR",
    localDate,
    revenue: shopify.revenue,
    cogsSen: shopify.cogsSen,
    cogsReversalSen: shopify.cogsReversalSen,
    courierSen: easyparcel.courierCostSen,
    metaAdsSen: meta.spendSen,
    payments: shopify.payments
  };
  const calculated = buildJournalPreview(snapshot, {
    ...shopify.clearingByGatewaySen,
    stripe: (shopify.clearingByGatewaySen.stripe || 0)
      - snapshot.payments.filter((payment) => payment.gateway === "stripe").reduce((sum, payment) => sum + Math.round(payment.amountSen * 0.03) + 100, 0),
    billplz: (shopify.clearingByGatewaySen.billplz || 0)
      - snapshot.payments.filter((payment) => payment.gateway === "billplz").length * 125
  });
  return {
    reference: calculated.reference,
    mode: env.MODE,
    organizationId: env.ZOHO_ORGANIZATION_ID,
    sources: { shopify, meta, easyparcel },
    courierAttribution: matchCourierCostsToOrders(shopify, easyparcel),
    preview: resolveAccountIds(calculated),
    writeAttempted: false
  };
}

function summarize(localDate, result, state, mode) {
  return {
    localDate,
    mode,
    reference: result.reference,
    shopifyOrderCount: result.sources.shopify.orderCount,
    shopifyGrossCollectedSen: result.sources.shopify.grossCollectedSen,
    metaAdsSpendSen: result.sources.meta.spendSen,
    easyParcelShipmentCount: result.sources.easyparcel.shipmentCount,
    easyParcelCourierCostSen: result.sources.easyparcel.courierCostSen,
    ordersWithoutShipment: result.sources.easyparcel.ordersWithoutShipment,
    shopifyRefundCount: result.sources.shopify.refundCount,
    shopifyRefundsSen: result.sources.shopify.revenue.refundsSen,
    courierMatchedCount: result.courierAttribution.matchedCount,
    courierAttributedCount: result.courierAttribution.attributedCount,
    courierUnmatchedCount: result.courierAttribution.unmatchedCount,
    debitsSen: result.preview.debitsSen,
    creditsSen: result.preview.creditsSen,
    netProfitSen: result.preview.netProfitSen,
    duplicate: state.duplicate,
    changed: state.changed,
    writeAttempted: false
  };
}

async function runRecovery(env, targetDate, backfillDates = null) {
  const cache = createShipmentCache();
  const results = [];
  // An explicit list records specific earlier days that recovery, which only
  // moves forward from the last successful date, would never revisit.
  const { dates, pendingAfterRun } = backfillDates
    ? { dates: backfillDates.slice(0, MAX_DAYS_PER_RUN), pendingAfterRun: Math.max(backfillDates.length - MAX_DAYS_PER_RUN, 0) }
    : await recoveryDates(env, targetDate);
  for (const localDate of dates) {
    const result = await dailyPreview(env, localDate, cache);
    const summary = summarize(localDate, result, { duplicate: false, changed: false }, "new");
    const state = await recordRun(env, result, { summary });
    results.push({ ...summarize(localDate, result, state, "new"), pendingAfterRun });
  }

  // Revisit completed days so a late refund, a corrected order, or an AWB bought
  // after the day was first calculated is surfaced instead of going unnoticed.
  const rescans = [];
  const { dates: toRescan, windowSize } = await rescanDates(env, targetDate, dates);
  for (const localDate of toRescan) {
    const result = await dailyPreview(env, localDate, cache);
    const summary = summarize(localDate, result, { duplicate: false, changed: false }, "rescan");
    const state = await recordRun(env, result, { rescan: true, summary });
    rescans.push({ ...summarize(localDate, result, state, "rescan"), rescanWindowSize: windowSize });
  }
  return { results, rescans, changedDates: rescans.filter((r) => r.changed).map((r) => r.localDate) };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function authorized(request, env) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const expected = String(env.PREVIEW_TOKEN || "").trim();
  return Boolean(expected && token === expected);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, mode: env.MODE, organizationId: env.ZOHO_ORGANIZATION_ID });
    }
    if (request.method === "GET" && url.pathname === "/runs") {
      if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
      try {
        const limit = Number(url.searchParams.get("limit")) || 31;
        return json({ ok: true, ...await listRuns(env, limit) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "run history failed" }, 400);
      }
    }
    if (request.method === "POST" && url.pathname === "/preview") {
      if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
      try {
        const input = await request.json();
        const preview = buildJournalPreview(input.snapshot, input.clearingByGatewaySen);
        return json({ ok: true, preview: resolveAccountIds(preview) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "invalid input" }, 400);
      }
    }
    if (request.method === "POST" && url.pathname === "/source-check/identity") {
      if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
      try {
        return json({ ok: true, identity: await readShopifyIdentity(env) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "identity check failed" }, 400);
      }
    }
    if (request.method === "POST" && url.pathname === "/source-check/shopify") {
      if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
      try {
        const input = await request.json().catch(() => ({}));
        const localDate = input.localDate || previousLocalDate(Date.now(), env.TIME_ZONE);
        const source = await readShopifyDay(env, localDate);
        return json({ ok: true, source });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "source check failed" }, 400);
      }
    }
    if (request.method === "POST" && url.pathname === "/source-check/meta") {
      if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
      try {
        const input = await request.json().catch(() => ({}));
        const localDate = input.localDate || previousLocalDate(Date.now(), env.TIME_ZONE);
        const source = await readMetaAdsDay(env, localDate);
        return json({ ok: true, source });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "source check failed" }, 400);
      }
    }
    if (request.method === "POST" && url.pathname === "/source-check/easyparcel") {
      if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
      try {
        const input = await request.json().catch(() => ({}));
        const localDate = input.localDate || previousLocalDate(Date.now(), env.TIME_ZONE);
        const references = Array.isArray(input.orderReferences) ? input.orderReferences : null;
        const source = await readEasyParcelDay(env, localDate, references ?? (await readShopifyDay(env, localDate)).orders.map((o) => o.orderName));
        return json({ ok: true, source });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "source check failed" }, 400);
      }
    }
    if (request.method === "POST" && url.pathname === "/daily-preview") {
      if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
      try {
        if (env.MODE !== "preview_only") throw new Error("Only preview_only mode is implemented and approved");
        if (env.ZOHO_ORGANIZATION_ID !== "933897042") throw new Error("Zoho organization did not match Oh! Venus");
        const input = await request.json().catch(() => ({}));
        const localDate = input.localDate || previousLocalDate(Date.now(), env.TIME_ZONE);
        return json({ ok: true, result: await dailyPreview(env, localDate) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "daily preview failed" }, 400);
      }
    }
    if (request.method === "POST" && url.pathname === "/recover-previews") {
      if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
      try {
        if (env.MODE !== "preview_only") throw new Error("Only preview_only mode is implemented and approved");
        if (env.ZOHO_ORGANIZATION_ID !== "933897042") throw new Error("Zoho organization did not match Oh! Venus");
        const input = await request.json().catch(() => ({}));
        const targetDate = input.targetDate || previousLocalDate(Date.now(), env.TIME_ZONE);
        const backfill = Array.isArray(input.backfillDates) && input.backfillDates.length ? input.backfillDates : null;
        if (backfill) {
          for (const date of backfill) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("backfillDates must be ISO local dates");
            if (date >= previousLocalDate(Date.now(), env.TIME_ZONE) + "\uffff") throw new Error("cannot backfill a future date");
          }
        }
        const recovery = await runRecovery(env, targetDate, backfill);
        return json({ ok: true, ...recovery });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "preview recovery failed" }, 400);
      }
    }
    return json({ ok: false, error: "not found" }, 404);
  },

  async scheduled(controller, env) {
    if (env.MODE !== "preview_only") {
      throw new Error("Only preview_only mode is implemented and approved");
    }
    const targetDate = previousLocalDate(controller.scheduledTime || Date.now(), env.TIME_ZONE);
    if (env.ZOHO_ORGANIZATION_ID !== "933897042") throw new Error("Zoho organization did not match Oh! Venus");
    const { results, rescans, changedDates } = await runRecovery(env, targetDate);
    for (const summary of [...results, ...rescans]) {
      console.log(JSON.stringify({
        event: "ohvenus_pnl_preview_completed",
        mode: env.MODE,
        organizationId: env.ZOHO_ORGANIZATION_ID,
        ...summary,
        writeAttempted: false
      }));
    }
    if (changedDates.length) {
      console.log(JSON.stringify({
        event: "ohvenus_pnl_late_adjustment_detected",
        mode: env.MODE,
        organizationId: env.ZOHO_ORGANIZATION_ID,
        changedDates,
        writeAttempted: false
      }));
    }
  }
};
