const LIST_API_BASE = "https://api.easyparcel.com/open_api/2026-06";
const DETAIL_API_BASE = "https://api.easyparcel.com/open_api/2026-03";
const TOKEN_URL = "https://api.easyparcel.com/oauth/token";
const TOKEN_OBJECT_NAME = "ohvenus-oauth";
const TOKEN_KEY = "oauth";

function requireValue(value, name) {
  const trimmed = String(value || "").trim();
  if (!trimmed) throw new Error(`${name} is not configured`);
  return trimmed;
}

function assertLocalDate(localDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error("localDate must use the ISO local-date format");
  const parsed = new Date(`${localDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== localDate) {
    throw new Error("localDate must be a real calendar date");
  }
}

function assertScope(env) {
  if (requireValue(env.TIME_ZONE, "TIME_ZONE") !== "Asia/Kuala_Lumpur") {
    throw new Error("EasyParcel timezone did not match Oh! Venus");
  }
  if (requireValue(env.EASYPARCEL_ACCOUNT_REGION, "EASYPARCEL_ACCOUNT_REGION") !== "Malaysia") {
    throw new Error("EasyParcel account region did not match Oh! Venus");
  }
}

async function responseBody(response) {
  try {
    return await response.json();
  } catch {
    throw new Error(`EasyParcel returned non-JSON with HTTP ${response.status}`);
  }
}

function expiresAtMs(body, now) {
  if (body.expires_at) {
    const parsed = Date.parse(body.expires_at);
    if (Number.isFinite(parsed)) return parsed;
  }
  const seconds = Number(body.expires_in);
  return Number.isFinite(seconds) && seconds > 0 ? now + seconds * 1000 : now + 55 * 60 * 1000;
}

async function requestRefreshedTokens(env, refreshToken, fetcher, now) {
  const clientId = requireValue(env.EASYPARCEL_CLIENT_ID, "EASYPARCEL_CLIENT_ID");
  const clientSecret = requireValue(env.EASYPARCEL_CLIENT_SECRET, "EASYPARCEL_CLIENT_SECRET");
  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      redirect_uri: requireValue(env.EASYPARCEL_REDIRECT_URI, "EASYPARCEL_REDIRECT_URI"),
      refresh_token: refreshToken
    })
  });
  const body = await responseBody(response);
  if (!response.ok || !String(body.access_token || "").trim()) {
    throw new Error(`EasyParcel token refresh failed with HTTP ${response.status}`);
  }
  return {
    accessToken: String(body.access_token).trim(),
    refreshToken: String(body.refresh_token || refreshToken).trim(),
    expiresAtMs: expiresAtMs(body, now)
  };
}

export class EasyParcelTokenVault {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.refreshPromise = null;
  }

  async accessToken(now = Date.now()) {
    const stored = await this.state.storage.get(TOKEN_KEY);
    if (stored?.accessToken && Number(stored.expiresAtMs) > now + 5 * 60 * 1000) return String(stored.accessToken);
    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        const current = await this.state.storage.get(TOKEN_KEY);
        if (current?.accessToken && Number(current.expiresAtMs) > Date.now() + 5 * 60 * 1000) {
          return String(current.accessToken);
        }
        const refreshToken = String(current?.refreshToken || this.env.EASYPARCEL_REFRESH_TOKEN || "").trim();
        if (!refreshToken) throw new Error("EASYPARCEL_REFRESH_TOKEN is not configured");
        const tokens = await requestRefreshedTokens(this.env, refreshToken, this.env.EASYPARCEL_FETCHER || fetch, Date.now());
        await this.state.storage.put(TOKEN_KEY, tokens);
        return tokens.accessToken;
      })().finally(() => { this.refreshPromise = null; });
    }
    return this.refreshPromise;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/access-token") return new Response("not found", { status: 404 });
    try {
      return Response.json({ accessToken: await this.accessToken() });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "EasyParcel token access failed" }, { status: 503 });
    }
  }
}

async function accessToken(env) {
  if (!env.EASYPARCEL_TOKEN_VAULT) throw new Error("EASYPARCEL_TOKEN_VAULT is not configured");
  const id = env.EASYPARCEL_TOKEN_VAULT.idFromName(TOKEN_OBJECT_NAME);
  const response = await env.EASYPARCEL_TOKEN_VAULT.get(id).fetch("https://token-vault/access-token", { method: "POST" });
  const body = await responseBody(response);
  if (!response.ok || !String(body.accessToken || "").trim()) {
    throw new Error(`EasyParcel token vault failed with HTTP ${response.status}`);
  }
  return String(body.accessToken).trim();
}

async function postJson(url, token, payload, fetcher, allowNotFound = false) {
  const response = await fetcher(url, {
    method: "POST",
    headers: { accept: "application/json", authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": "OhVenus-Daily-PNL/1.0" },
    body: JSON.stringify(payload)
  });
  if (allowNotFound && response.status === 404) return null;
  const body = await responseBody(response);
  if (!response.ok || (body.status_code != null && String(body.status_code) !== "200")) {
    throw new Error(`EasyParcel shipment read failed with HTTP ${response.status}`);
  }
  return body;
}

async function listShipments(localDate, token, fetcher) {
  const shipments = [];
  const seenCursors = new Set();
  const seenShipments = new Set();
  let cursor;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const payload = { date_from: localDate, date_to: localDate, limit: 250 };
    if (cursor) payload.before_shipment_number = cursor;
    const body = await postJson(`${LIST_API_BASE}/shipment/list`, token, payload, fetcher, true);
    if (!body) break;
    if (!Array.isArray(body.data)) throw new Error("EasyParcel shipment list had an invalid shape");
    const page = body.data.filter((item) => item && typeof item === "object");
    for (const item of page) {
      const shipmentNumber = String(item.shipment_number || "").trim();
      if (!shipmentNumber) throw new Error("EasyParcel shipment had no shipment number");
      if (seenShipments.has(shipmentNumber)) throw new Error(`EasyParcel returned duplicate shipment ${shipmentNumber}`);
      seenShipments.add(shipmentNumber);
      shipments.push(item);
    }
    const hasMore = body.has_more ?? body.pagination?.has_more ?? body.meta?.has_more;
    if (!page.length || page.length < 250 || hasMore === false) break;
    cursor = String(page.at(-1)?.shipment_number || "").trim();
    if (!cursor || seenCursors.has(cursor)) throw new Error("EasyParcel shipment pagination cursor was invalid");
    seenCursors.add(cursor);
    if (pageNumber === 99) throw new Error("EasyParcel shipment pagination exceeded 100 pages");
  }
  return shipments;
}

function detailMoneyValue(pricing) {
  const total = pricing.total_price == null || pricing.total_price === "" ? null : Number(pricing.total_price);
  const shipment = pricing.shipment_price == null || pricing.shipment_price === "" ? null : Number(pricing.shipment_price);
  if (pricing.byoc_charges != null && pricing.byoc_charges !== "" && shipment != null) return shipment + (total || 0);
  if (total != null && (total !== 0 || shipment == null)) return total;
  if (shipment != null) return shipment;
  if (pricing.total_amount != null && pricing.total_amount !== "") return Number(pricing.total_amount);
  return null;
}

async function shipmentCost(listed, token, fetcher) {
  const shipmentNumber = String(listed.shipment_number || "").trim();
  const body = await postJson(`${DETAIL_API_BASE}/shipment/details`, token, { shipment_number: shipmentNumber }, fetcher);
  const detail = Array.isArray(body.data) ? body.data[0] : body.data;
  if (!detail || typeof detail !== "object" || String(detail.shipment_number || "").trim() !== shipmentNumber) {
    throw new Error(`EasyParcel shipment identity mismatch for ${shipmentNumber}`);
  }
  const listedAwb = String(listed.awb || listed.awb_number || "").trim();
  const detailAwb = String(detail.shipment_details?.awb_number || "").trim();
  if (listedAwb && detailAwb && listedAwb !== detailAwb) throw new Error(`EasyParcel AWB identity mismatch for ${shipmentNumber}`);
  const pricing = detail.pricing && typeof detail.pricing === "object" ? detail.pricing : {};
  const amount = detailMoneyValue(pricing);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`EasyParcel shipment ${shipmentNumber} had no valid final price`);
  const currency = String(pricing.currency_code || pricing.currency || detail.currency_code || "").trim();
  if (currency !== "MYR") throw new Error(`EasyParcel shipment ${shipmentNumber} was not denominated in MYR`);
  return { shipmentNumber, awbNumber: detailAwb || listedAwb || null, costSen: Math.round(amount * 100) };
}

export async function readEasyParcelDay(env, localDate, fetcher = fetch) {
  assertLocalDate(localDate);
  assertScope(env);
  const token = await accessToken(env);
  const listed = await listShipments(localDate, token, fetcher);
  const shipments = await Promise.all(listed.map((item) => shipmentCost(item, token, fetcher)));
  return {
    source: "easyparcel",
    localDate,
    account: { region: "Malaysia", currency: "MYR", timeZone: "Asia/Kuala_Lumpur" },
    currency: "MYR",
    shipmentCount: shipments.length,
    courierCostSen: shipments.reduce((total, shipment) => total + shipment.costSen, 0),
    shipments
  };
}
