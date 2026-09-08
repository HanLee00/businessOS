import test from "node:test";
import assert from "node:assert/strict";
import {
  assertOhVenusOrganization,
  toJournalPayload,
  upsertDailyJournal,
  OHVENUS_ORGANIZATION_ID
} from "../src/zoho.mjs";

const env = {
  ZOHO_ORGANIZATION_ID: OHVENUS_ORGANIZATION_ID,
  ZOHO_CLIENT_ID: "client",
  ZOHO_CLIENT_SECRET: "secret",
  ZOHO_REFRESH_TOKEN: "refresh"
};

const preview = {
  localDate: "2026-09-06",
  reference: "OHV-PNL-2026-09-06",
  netProfitSen: 28741,
  debitsSen: 75800,
  creditsSen: 75800,
  journalLines: [
    { accountKey: "sales", accountId: "907512000000000388", debitSen: 0, creditSen: 72800 },
    { accountKey: "cogs", accountId: "907512000000034003", debitSen: 32400, creditSen: 3000 },
    { accountKey: "stripe_clearing", accountId: "907512000000120002", debitSen: 43400, creditSen: 0 }
  ]
};

function fetcherFor(handlers) {
  return async (url, options = {}) => {
    if (url.startsWith("https://accounts.zoho.com")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    }
    return handlers(url, options);
  };
}

test("refuses to write to the Gaia organization", () => {
  assert.throws(
    () => assertOhVenusOrganization({ ZOHO_ORGANIZATION_ID: "933894797" }),
    /is not Oh! Venus; refusing to write/
  );
  assert.equal(assertOhVenusOrganization(env), "933897042");
});

test("sends the Oh! Venus organization id on every call", async () => {
  const seen = [];
  const fetcher = fetcherFor(async (url) => {
    seen.push(url);
    if (url.includes("/journals?")) return new Response(JSON.stringify({ code: 0, journals: [] }));
    return new Response(JSON.stringify({ code: 0, journal: { journal_id: "J1" } }));
  });
  await upsertDailyJournal(env, preview, { fetcher });
  assert.ok(seen.length > 0);
  for (const url of seen) assert.match(url, /organization_id=933897042/);
  // Gaia's organization must never appear in any request.
  for (const url of seen) assert.doesNotMatch(url, /933894797/);
});

test("splits an account carrying both a debit and a credit into two lines", () => {
  const payload = toJournalPayload(preview, { status: "published" });
  const cogs = payload.line_items.filter((l) => l.description === "cogs");
  assert.equal(cogs.length, 2);
  assert.deepEqual(cogs.map((l) => l.debit_or_credit).sort(), ["credit", "debit"]);
  assert.equal(cogs.find((l) => l.debit_or_credit === "debit").amount, 324);
  assert.equal(cogs.find((l) => l.debit_or_credit === "credit").amount, 30);
});

test("refuses to post an unbalanced or empty journal", () => {
  assert.throws(() => toJournalPayload({ ...preview, journalLines: [] }, { status: "published" }), /empty journal/);
  const skewed = { ...preview, journalLines: [{ accountKey: "sales", accountId: "A", debitSen: 100, creditSen: 0 }] };
  assert.throws(() => toJournalPayload(skewed, { status: "published" }), /unbalanced journal/);
});

test("creates the journal once and does not duplicate it on a repeat run", async () => {
  const calls = [];
  let stored = null;
  const fetcher = fetcherFor(async (url, options) => {
    if (options.method === "GET" || (!options.method && url.includes("/journals?"))) {
      return new Response(JSON.stringify({ code: 0, journals: stored ? [stored] : [] }));
    }
    if (options.method === "POST") {
      calls.push("POST");
      stored = { journal_id: "J1", reference_number: preview.reference, total: 758.00, status: "published" };
      return new Response(JSON.stringify({ code: 0, journal: stored }));
    }
    calls.push("PUT");
    return new Response(JSON.stringify({ code: 0, journal: stored }));
  });

  const first = await upsertDailyJournal(env, preview, { fetcher });
  assert.equal(first.action, "created");
  const second = await upsertDailyJournal(env, preview, { fetcher });
  // Same figures on a rescan must not create a second journal or rewrite one.
  assert.equal(second.action, "unchanged");
  assert.deepEqual(calls, ["POST"]);
});

test("updates the existing journal when a rescan changes the day", async () => {
  const stored = { journal_id: "J1", reference_number: preview.reference, total: 750.00, status: "published" };
  const calls = [];
  const fetcher = fetcherFor(async (url, options) => {
    if (!options.method || options.method === "GET") {
      return new Response(JSON.stringify({ code: 0, journals: [stored] }));
    }
    calls.push(`${options.method} ${url.split("?")[0].split("/books/v3")[1]}`);
    return new Response(JSON.stringify({ code: 0, journal: { ...stored, total: 758.00 } }));
  });
  const result = await upsertDailyJournal(env, preview, { fetcher });
  assert.equal(result.action, "updated");
  assert.equal(result.journalId, "J1");
  assert.deepEqual(calls, ["PUT /journals/J1"]);
});

test("refuses to guess when Zoho holds two journals for one reference", async () => {
  const dup = { journal_id: "J1", reference_number: preview.reference, total: 758.00, status: "published" };
  const fetcher = fetcherFor(async () => new Response(JSON.stringify({ code: 0, journals: [dup, { ...dup, journal_id: "J2" }] })));
  await assert.rejects(() => upsertDailyJournal(env, preview, { fetcher }), /refusing to guess/);
});

test("posts published for the P&L report and draft when asked", async () => {
  const bodies = [];
  const fetcher = fetcherFor(async (url, options) => {
    if (!options.method || options.method === "GET") return new Response(JSON.stringify({ code: 0, journals: [] }));
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ code: 0, journal: { journal_id: "J1" } }));
  });
  await upsertDailyJournal(env, preview, { fetcher, status: "published" });
  await upsertDailyJournal(env, preview, { fetcher, status: "draft" });
  assert.deepEqual(bodies.map((b) => b.status), ["published", "draft"]);
  assert.equal(bodies[0].reference_number, "OHV-PNL-2026-09-06");
  assert.equal(bodies[0].journal_date, "2026-09-06");
});
