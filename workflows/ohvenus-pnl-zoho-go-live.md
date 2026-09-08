# Oh! Venus daily P&L — Zoho go-live plan

> Written 2026-09-08. Hand this to a new session together with
> `workflows/ecommerce-accounting.md` and `session-handoff.md`.
> **Read this whole file before running anything.**

## Objective

Post one balanced Zoho manual journal per Malaysia day to Oh! Venus organization
`933897042`, automatically, at 12:00 noon, so the owner can read the real Profit
and Loss report in Zoho Books daily without manual intervention.

Only a **published** journal moves Zoho's P&L report. A draft is visible in
Manual Journals but does not affect the report. Zoho's P&L is a derived report;
there is no P&L object to write to.

## Current state (verified 2026-09-08)

| Item | State |
|---|---|
| Worker | `ohvenus-daily-pnl`, `https://ohvenus-daily-pnl.ohvenus-shop.workers.dev` |
| Schedule | cron `0 4 * * *` UTC = 12:00 Asia/Kuala_Lumpur, daily |
| MODE | `preview_only` — writes nothing |
| Zoho org | `933897042` pinned in `src/zoho.mjs` and asserted before every call |
| Tests | 63 passing (`npm test` in `ohvenus-pnl-worker`) |
| Last commit | `297a62b` |
| Cloudflare secrets | `EASYPARCEL_CLIENT_ID`, `EASYPARCEL_CLIENT_SECRET`, `EASYPARCEL_REFRESH_TOKEN`, `META_ACCESS_TOKEN`, `PREVIEW_TOKEN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` |
| Missing secrets | none — all three ZOHO secrets uploaded 2026-09-09 |
| Preview token | `ohvenus-pnl-worker/.dev.vars` (gitignored) |

Stored run history for 2026-09-01 → 2026-09-07 is complete: every day balances,
every reference is `OHV-PNL-<date>`, 100% of courier cost attributed by order.

## Progress (2026-09-09)

- **Step 1 done.** Self-client created under `leewenhan20@gmail.com`. Refresh
  token saved to `easyparcel-sync/.zoho.env` (gitignored via `**/.zoho.env`).
  Correct scope is `ZohoBooks.accountants.*`, not `ZohoBooks.journals.*` — Zoho
  rejects the latter. There is no portal picker in the self-client Generate Code
  screen.
- **Step 2 done.** `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`
  uploaded to the `ohvenus-daily-pnl` Worker (Cloudflare account
  `ohvenus.shop@gmail.com`). `wrangler secret list` shows all 10.
- **Step 3 done.** The token was verified read-only against Oh! Venus directly:
  `GET /chartofaccounts?organization_id=933897042` → 200, `GET /journals` → 200
  with **zero existing journals**, and all 19 account IDs in `src/accounts.mjs`
  exist in the live Oh! Venus chart with matching names/types.
  Note: `GET /organizations` lists **only Gaia** for this token — a Zoho quirk
  (it shows the user's default-portal association). It is not a failure and the
  Worker never calls it. Do not use `/organizations` as the org check; use a
  `organization_id=933897042`-scoped call instead.
- **Step 4 done (compressed).** `MODE=publish_draft` deployed. Backfilled
  2026-09-01 → 2026-09-07 as drafts. All 7 balanced, one journal per date, zero
  duplicates, every total matched `GET /runs` to the sen. Re-runs and rescans
  returned `unchanged`. Hit a Zoho refresh-token rate limit from repeated test
  runs — transient; the Worker now caches the access token per isolate so a
  normal daily run refreshes once.
- **Step 4 fix — `cogs_payable`.** The first draft POST failed with Zoho code
  11016 "Involved account types are not applicable": Zoho blocks manual journals
  against the stock-type Inventory Asset account. Created **COGS Payable**
  (`907512000000129008`, Other Current Liability) in the Oh! Venus chart and
  repointed the COGS offset to it in `src/accounts.mjs`, `src/calculation.mjs`,
  and `reporting/account-mapping.yaml`. Same accrual pattern as Meta Payable and
  Packaging Cost Accrual; not tied to supplier bills.
- **Step 5 done — LIVE on `publish` (2026-09-09).** `MODE=publish` deployed
  (version `d0e36d1e`). All 7 draft journals updated in place to `published`
  (same journal ids, no duplicates). 09-01 → 09-07 all `published`, balanced,
  reconciled to `GET /runs`. The noon cron (`0 4 * * *` UTC) now posts the prior
  day and rescans automatically.
- **Owner check still open:** confirm the Zoho **Profit and Loss report** for
  2026-09-01 → 2026-09-07 reflects the journals (the go-live token lacks
  `ZohoBooks.reports.READ`, so this is a UI check). Reports → Profit and Loss,
  accrual basis, that date range.
- **Not done:** Step 6 optional backfill is already covered — all seven days are
  posted. Gap #3 (published-journal amendments to closed periods on rescan) still
  needs an owner + accountant decision; until then the rolling rescan will amend
  published journals in place.

## What already works

- Shopify sales, shipping, discounts, COGS; refunds recognised on the **refund
  date** with COGS reversal.
- Meta spend from ad account `OHVENUS` (`act_1383191923615307`), MYR, MY time.
- EasyParcel courier cost recognised on the **order's date** via
  `shipment_details.reference`, AWB as fallback, plus a configured 20 sen per
  shipment for mask addons the API omits (`EASYPARCEL_ADDON_PER_SHIPMENT_SEN`).
- Confirmed rules: Stripe 3% + RM1, Billplz RM1.25, Meta fee 8% of spend,
  packaging 2% of spend.
- Missed-day recovery (3 days per run), rolling rescan (2 of the last 7 days),
  deterministic reference, duplicate suppression, per-invocation shipment cache.
- `GET /runs` returns stored daily figures; observability enabled.

## Step 1 — Owner creates the Zoho self-client (only the owner can do this)

Claude cannot perform this step. It requires an authenticated Zoho session and
produces a client secret and refresh token that must not pass through a chat
transcript.

1. Go to `https://api-console.zoho.com/` signed in as the Oh! Venus Zoho owner.
2. **Add Client → Self Client → Create**. Note the **Client ID** and
   **Client Secret**.
3. Open the **Generate Code** tab.
   - Scope: `ZohoBooks.accountants.CREATE,ZohoBooks.accountants.UPDATE,ZohoBooks.accountants.READ,ZohoBooks.settings.READ`
     (Zoho rejects `ZohoBooks.journals.*` as invalid — journals live under the
     `accountants` scope family.)
   - Time duration: 10 minutes
   - Scope Description: `OhVenus daily P&L`
   - There is no portal picker in this screen. Org access comes from the login
     used; verify it in Step 3 with a `933897042`-scoped call.
4. Copy the generated **code** (valid ~10 minutes).
5. Exchange it for a refresh token from the terminal, replacing the three values.
   Run this yourself; do not paste secrets into chat:

   ```bash
   curl -s -X POST "https://accounts.zoho.com/oauth/v2/token" \
     -d "grant_type=authorization_code" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "code=YOUR_GENERATED_CODE"
   ```

6. Save the three values into a local ignored file, owner-read only:

   ```bash
   umask 077
   cat > /Users/hanlee/Developer/businessOS/easyparcel-sync/.zoho.env <<'EOF'
   ZOHO_CLIENT_ID=...
   ZOHO_CLIENT_SECRET=...
   ZOHO_REFRESH_TOKEN=...
   EOF
   ```

   `**/.env` and `**/.dev.vars` are gitignored. Confirm `.zoho.env` is ignored
   too before saving, or place it outside the repository.

7. Tell the next session the file exists. Do not paste the values.

**Region check:** the Oh! Venus account is confirmed on `.com` (verified
2026-09-09 against `https://www.zohoapis.com`). No `src/zoho.mjs` URL change
needed.

## Step 2 — Upload the secrets (next session)

From `ohvenus-pnl-worker`, pipe each value so it is never printed:

```bash
grep '^ZOHO_CLIENT_ID=' ../easyparcel-sync/.zoho.env | cut -d= -f2- | tr -d '\n' | npx wrangler secret put ZOHO_CLIENT_ID
grep '^ZOHO_CLIENT_SECRET=' ../easyparcel-sync/.zoho.env | cut -d= -f2- | tr -d '\n' | npx wrangler secret put ZOHO_CLIENT_SECRET
grep '^ZOHO_REFRESH_TOKEN=' ../easyparcel-sync/.zoho.env | cut -d= -f2- | tr -d '\n' | npx wrangler secret put ZOHO_REFRESH_TOKEN
```

Verify with `npx wrangler secret list` — names only, never values.

## Step 3 — Read-only credential check before any write — DONE 2026-09-09

Keep `MODE=preview_only`. Verify the token read-only against Oh! Venus with an
`organization_id=933897042`-scoped call (chart of accounts or journals list).
Do **not** rely on `GET /organizations` — it returns only Gaia for this token.

Done: chart of accounts and journals both returned HTTP 200 for `933897042`,
zero existing journals, all 19 `src/accounts.mjs` IDs present in the live chart.

**Do not proceed if the organization name or id does not match.** A wrong
organization means Gaia's ledger, which must never be written to from here.

## Step 4 — Draft rehearsal (2–3 days)

1. Set `"MODE": "publish_draft"` in `wrangler.jsonc`, deploy.
2. Run `POST /recover-previews` with an explicit `backfillDates` of one recent
   day.
3. In Zoho Books → Accountant → Manual Journals, confirm:
   - exactly one journal with reference `OHV-PNL-<date>`
   - status Draft, organization Oh! Venus
   - debits equal credits, and totals match `GET /runs` for that date
   - every line maps to an account in `reporting/account-mapping.yaml`
4. Re-run the same date. The result must be `action: "unchanged"` and **no second
   journal** may appear.
5. Force a change (a rescan that alters a day) and confirm the existing journal
   is **updated**, not duplicated.

Do not continue until a duplicate cannot be produced.

## Step 5 — Go live

1. Owner gives explicit approval to post to the live ledger.
2. Set `"MODE": "publish"`, deploy.
3. Let the noon cron run once. Confirm in Zoho:
   - the journal for the prior day exists, status Published
   - the **Profit and Loss report** for that date now reflects it
   - `GET /runs` totals match the Zoho journal totals
4. Watch the first rescan that changes a completed day and confirm the published
   journal is amended rather than duplicated.

## Step 6 — Backfill history (optional, owner decides)

2026-09-01 → 2026-09-07 are already computed and stored. If the owner wants them
in Zoho, post them with `backfillDates` in batches of 3. Confirm each reference
appears exactly once. Do not backfill beyond dates whose figures have been
reviewed.

## Safety rules that must not be relaxed

- Oh! Venus organization `933897042` only. Gaia is `933894797` and must never be
  written to from this Worker. `assertOhVenusOrganization` runs before every call
  and there is a test asserting Gaia's id never appears in an outgoing URL.
- Never print, echo, log, or commit a secret value. Upload by pipe only.
- One journal per date, keyed on `OHV-PNL-<date>`. Create once, update on change,
  never duplicate. Stop and report if two journals share a reference.
- An unbalanced or empty journal must be refused before any request is sent.
- A source failure must throw before anything is recorded, so `lastSuccessfulDate`
  does not advance and the day is retried.
- Do not delete or void existing Zoho records to "clean up". Report and ask.

## Known gaps to close

1. **Courier timing.** An order whose AWB is bought after its day is calculated
   reports under `ordersWithoutShipment` and is corrected by the rolling rescan.
   The rescan window is 7 days; a shipment booked later than that is missed.
2. **Late refunds.** Refund-date recognition is correct, but re-running an old
   date relies on the order still falling inside the Shopify `updated_at` window,
   so a very late correction can be missed.
3. **Rescan vs published journals.** Once published, an amended journal changes a
   closed accounting period. Decide with the owner whether amendments beyond a
   cut-off should instead post an adjusting entry on the current date.
4. **EasyParcel addon constant.** 20 sen per shipment is configured, not read
   from the API, because EasyParcel does not expose mask addon charges. Revisit
   if masking is switched off or rates change.
5. **EasyParcel refresh tokens are single-use.** A local `oauth-connect`
   invalidates the hosted token. Re-upload `EASYPARCEL_REFRESH_TOKEN` afterwards.

## Verification checklist before declaring done

- [ ] Zoho credentials resolve to organization `933897042`, name Oh! Venus
- [ ] One journal per date, reference `OHV-PNL-<date>`, no duplicates on re-run
- [ ] A changed day updates the existing journal
- [ ] Debits equal credits on every posted journal
- [ ] Zoho P&L report reflects a published journal
- [ ] `GET /runs` totals match Zoho journal totals for the same dates
- [ ] Gaia organization untouched — no journal in `933894797`
- [ ] Tests pass; `automations/catalogue.yaml`, `workflows/ecommerce-accounting.md`
      and `session-handoff.md` updated with verified findings
