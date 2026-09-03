import { buildJournalPreview } from "./calculation.mjs";
import { resolveAccountIds } from "./accounts.mjs";

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function authorized(request, env) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(env.PREVIEW_TOKEN && token === env.PREVIEW_TOKEN);
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
    return json({ ok: false, error: "not found" }, 404);
  },

  async scheduled(_controller, env) {
    if (env.MODE !== "preview_only") {
      throw new Error("Only preview_only mode is implemented and approved");
    }
    console.log(JSON.stringify({
      event: "ohvenus_pnl_schedule_checked",
      mode: env.MODE,
      organizationId: env.ZOHO_ORGANIZATION_ID,
      writeAttempted: false
    }));
  }
};
