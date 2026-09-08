const ACCOUNTS_URL = "https://accounts.zoho.com/oauth/v2/token";
const BOOKS_BASE = "https://www.zohoapis.com/books/v3";
// Oh! Venus only. Gaia is organization 933894797 and must never be written to
// from this Worker, so the id is pinned here as well as checked from config.
export const OHVENUS_ORGANIZATION_ID = "933897042";

function requireValue(value, name) {
  const trimmed = String(value || "").trim();
  if (!trimmed) throw new Error(`${name} is not configured`);
  return trimmed;
}

export function assertOhVenusOrganization(env) {
  const configured = requireValue(env.ZOHO_ORGANIZATION_ID, "ZOHO_ORGANIZATION_ID");
  if (configured !== OHVENUS_ORGANIZATION_ID) {
    throw new Error(`Zoho organization ${configured} is not Oh! Venus; refusing to write`);
  }
  return configured;
}

async function body(response) {
  try {
    return await response.json();
  } catch {
    throw new Error(`Zoho returned non-JSON with HTTP ${response.status}`);
  }
}

// Zoho throttles the refresh-token grant hard ("too many requests
// continuously"). A single invocation can write several journals (a backfill
// plus rescans), and the isolate is reused across invocations, so the access
// token is cached and reused until shortly before it expires.
let cachedToken = null;

export async function accessToken(env, fetcher = fetch) {
  const refreshToken = requireValue(env.ZOHO_REFRESH_TOKEN, "ZOHO_REFRESH_TOKEN");
  const now = Date.now();
  if (cachedToken && cachedToken.refreshToken === refreshToken && cachedToken.expiresAt > now) {
    return cachedToken.token;
  }
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: requireValue(env.ZOHO_CLIENT_ID, "ZOHO_CLIENT_ID"),
    client_secret: requireValue(env.ZOHO_CLIENT_SECRET, "ZOHO_CLIENT_SECRET"),
    grant_type: "refresh_token"
  });
  const response = await fetcher(`${ACCOUNTS_URL}?${params}`, { method: "POST" });
  const result = await body(response);
  const token = String(result.access_token || "").trim();
  if (!response.ok || !token) {
    const detail = String(result.error_description || result.error || "").trim();
    throw new Error(`Zoho token refresh failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  const ttlSeconds = Number(result.expires_in) > 0 ? Number(result.expires_in) : 3600;
  cachedToken = { token, refreshToken, expiresAt: now + (ttlSeconds - 120) * 1000 };
  return token;
}

async function call(env, token, method, path, payload, fetcher) {
  const organizationId = assertOhVenusOrganization(env);
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetcher(`${BOOKS_BASE}${path}${separator}organization_id=${organizationId}`, {
    method,
    headers: {
      authorization: `Zoho-oauthtoken ${token}`,
      ...(payload ? { "content-type": "application/json" } : {})
    },
    ...(payload ? { body: JSON.stringify(payload) } : {})
  });
  const result = await body(response);
  if (!response.ok || (result.code != null && Number(result.code) !== 0)) {
    const detail = String(result.message || "").trim();
    throw new Error(
      `Zoho ${method} ${path} failed with HTTP ${response.status} code ${result.code}` +
        (detail ? `: ${detail}` : "")
    );
  }
  return result;
}

// One Zoho line per direction. An account carrying both a debit and a credit,
// such as COGS with a refund reversal, stays visible as two lines.
export function toJournalPayload(preview, { status }) {
  const lineItems = [];
  for (const line of preview.journalLines) {
    if (line.debitSen) {
      lineItems.push({ account_id: line.accountId, debit_or_credit: "debit", amount: line.debitSen / 100, description: line.accountKey });
    }
    if (line.creditSen) {
      lineItems.push({ account_id: line.accountId, debit_or_credit: "credit", amount: line.creditSen / 100, description: line.accountKey });
    }
  }
  if (!lineItems.length) throw new Error("Refusing to post an empty journal");
  const debits = lineItems.filter((l) => l.debit_or_credit === "debit").reduce((s, l) => s + Math.round(l.amount * 100), 0);
  const credits = lineItems.filter((l) => l.debit_or_credit === "credit").reduce((s, l) => s + Math.round(l.amount * 100), 0);
  if (debits !== credits) throw new Error(`Refusing to post an unbalanced journal: ${debits} vs ${credits}`);
  return {
    journal_date: preview.localDate,
    reference_number: preview.reference,
    notes: `Oh! Venus daily P&L. Net profit MYR ${(preview.netProfitSen / 100).toFixed(2)}.`,
    line_items: lineItems,
    status
  };
}

export async function findJournalByReference(env, token, reference, fetcher = fetch) {
  const result = await call(env, token, "GET", `/journals?reference_number=${encodeURIComponent(reference)}`, null, fetcher);
  const matches = (result.journals || []).filter((j) => String(j.reference_number || "").trim() === reference);
  if (matches.length > 1) throw new Error(`Zoho has ${matches.length} journals for ${reference}; refusing to guess`);
  return matches[0] || null;
}

// Idempotent on the deterministic reference: create once, update when the day's
// figures change, and do nothing when they have not.
export async function upsertDailyJournal(env, preview, { status = "published", fetcher = fetch } = {}) {
  assertOhVenusOrganization(env);
  const token = await accessToken(env, fetcher);
  const payload = toJournalPayload(preview, { status });
  const existing = await findJournalByReference(env, token, preview.reference, fetcher);

  if (!existing) {
    const created = await call(env, token, "POST", "/journals", payload, fetcher);
    return { action: "created", journalId: created.journal?.journal_id || null, reference: preview.reference, status };
  }

  const sameTotal = Math.round(Number(existing.total || 0) * 100) === preview.debitsSen;
  if (sameTotal && String(existing.status || "").toLowerCase() === status) {
    return { action: "unchanged", journalId: existing.journal_id, reference: preview.reference, status };
  }
  const updated = await call(env, token, "PUT", `/journals/${existing.journal_id}`, payload, fetcher);
  return { action: "updated", journalId: updated.journal?.journal_id || existing.journal_id, reference: preview.reference, status };
}
