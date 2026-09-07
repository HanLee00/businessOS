import { buildJournalPreview } from "./calculation.mjs";
import { resolveAccountIds } from "./accounts.mjs";
import { previousLocalDate, readShopifyDay } from "./shopify.mjs";
import { readMetaAdsDay } from "./meta.mjs";
import { readEasyParcelDay } from "./easyparcel.mjs";
import { recoveryDates, recordRun } from "./state.mjs";
export { EasyParcelTokenVault } from "./easyparcel.mjs";
export { OhVenusPnlState } from "./state.mjs";

async function dailyPreview(env, localDate) {
  const [shopify, meta, easyparcel] = await Promise.all([
    readShopifyDay(env, localDate),
    readMetaAdsDay(env, localDate),
    readEasyParcelDay(env, localDate)
  ]);
  const snapshot = {
    currency: "MYR",
    localDate,
    revenue: shopify.revenue,
    cogsSen: shopify.cogsSen,
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
    preview: resolveAccountIds(calculated),
    writeAttempted: false
  };
}

async function runRecovery(env, targetDate) {
  const results = [];
  for (const localDate of await recoveryDates(env, targetDate)) {
    const result = await dailyPreview(env, localDate);
    const state = await recordRun(env, result);
    results.push({
      localDate,
      reference: result.reference,
      shopifyOrderCount: result.sources.shopify.orderCount,
      shopifyGrossCollectedSen: result.sources.shopify.grossCollectedSen,
      metaAdsSpendSen: result.sources.meta.spendSen,
      easyParcelShipmentCount: result.sources.easyparcel.shipmentCount,
      easyParcelCourierCostSen: result.sources.easyparcel.courierCostSen,
      debitsSen: result.preview.debitsSen,
      creditsSen: result.preview.creditsSen,
      duplicate: state.duplicate,
      changed: state.changed,
      writeAttempted: false
    });
  }
  return results;
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
        const source = await readEasyParcelDay(env, localDate);
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
        return json({ ok: true, results: await runRecovery(env, targetDate) });
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
    for (const summary of await runRecovery(env, targetDate)) {
      console.log(JSON.stringify({
        event: "ohvenus_pnl_preview_completed",
        mode: env.MODE,
        organizationId: env.ZOHO_ORGANIZATION_ID,
        ...summary,
        writeAttempted: false
      }));
    }
  }
};
