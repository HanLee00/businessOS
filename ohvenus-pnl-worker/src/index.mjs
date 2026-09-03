import { buildJournalPreview } from "./calculation.mjs";
import { resolveAccountIds } from "./accounts.mjs";
import { previousLocalDate, readShopifyDay } from "./shopify.mjs";

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
    return json({ ok: false, error: "not found" }, 404);
  },

  async scheduled(controller, env) {
    if (env.MODE !== "preview_only") {
      throw new Error("Only preview_only mode is implemented and approved");
    }
    const localDate = previousLocalDate(controller.scheduledTime || Date.now(), env.TIME_ZONE);
    const shopify = await readShopifyDay(env, localDate);
    console.log(JSON.stringify({
      event: "ohvenus_pnl_schedule_checked",
      mode: env.MODE,
      organizationId: env.ZOHO_ORGANIZATION_ID,
      localDate,
      shopifyOrderCount: shopify.orderCount,
      shopifyGrossCollectedSen: shopify.grossCollectedSen,
      writeAttempted: false
    }));
  }
};
