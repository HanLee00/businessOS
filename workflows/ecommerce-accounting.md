# Ecommerce Accounting Workflow

This workflow applies to Oh! Venus.

Shopify is the detailed commerce source. Summaries must account for gross sales, discounts, refunds, shipping collected, taxes where applicable, payment fees, COGS, fulfillment, courier, advertising, apps/subscriptions, chargebacks, samples, and other approved operating expenses.

Every summary includes a period, source report/export reference, currency, reconciliation difference, accounting mapping, and an idempotency key. Write only to Zoho organization `933897042` after review. Keep one record per approved summary period rather than one invoice per Shopify order unless requirements change.

## Confirmed delivery architecture

- Zoho Books is the only owner-facing P&L interface. Do not introduce a Google
  Sheet or a second reporting database for this workflow.
- Run the hosted calculation at `04:00 UTC` (`12:00 Asia/Kuala_Lumpur`) for the
  completed prior Malaysia calendar day. Cloudflare Workers Free is the approved
  initial runtime; measure actual limits and move plans only if observed usage
  requires it.
- A missed scheduled run must be recovered by scanning for missing local dates on
  the next successful invocation. The owner's Mac is not part of the production
  schedule and may be off.
- The first seven successful daily outputs remain **draft manual journals** for
  supervised comparison. Drafts are visible under Accountant > Manual Journals
  but do not affect the standard Profit and Loss report.
- Publishing a journal changes the accounting ledger and remains a separate A3
  action. Do not enable automatic publishing without explicit owner approval
  after the seven-run review.
- Use one deterministic reference per local day: `OHV-PNL-<local-date>`. A rerun
  updates the same draft or reports an exception; it never creates a second
  journal for that date.

## Zoho account mapping status

The live Oh! Venus chart was reviewed read-only on 2026-09-02. Exact existing
accounts and proposed additions live in `reporting/account-mapping.yaml`. Before
creating an account or journal, preview and approve the complete balanced mapping.
Do not post daily Shopify revenue when another Zoho sales record or bank
categorization already represents the same activity; duplicate detection is a
required precondition.

## Confirmed daily cost rules

- Count only successful payment transactions.
- Stripe payment fee is `3%` of the successful transaction amount plus `MYR 1.00`
  per successful transaction.
- Billplz payment fee is `MYR 1.25` per successful transaction.
- For each day's actual Meta ad spend, recognize an additional `8%` as Meta-related
  fees and `2%` as packaging cost. The combined expense derived from Meta spend is
  therefore `actual Meta spend * 1.10`, split into the three separately visible
  components: base ad spend, Meta-related fees, and packaging.
- These owner-confirmed rules apply until the owner replaces them. Preserve each
  component separately in the accounting mapping; do not post the 10% uplift as
  undifferentiated advertising spend.

## Failure modes verified in live reads

- Shopify's order-search parser can misread ISO timestamp filters containing a
  timezone offset and return an adjacent local-day order. Fetch a buffered date
  range, convert each returned `processedAt` value to `Asia/Kuala_Lumpur`, and
  apply the exact local-day boundary in the reconciliation code. Treat Shopify
  search warnings as a failed boundary check, not as a valid empty or complete
  result.
- Shopify order transactions for external gateways such as Billplz and Stripe
  can return an empty `fees` array. Empty means the fee is unavailable from that
  Shopify record, not that the fee was zero. Read the gateway settlement source
  or an approved fee rule before posting payment-processing expense.
- Shopify fulfillments created by the EasyParcel app expose the courier and an
  EasyParcel tracking URL/AWB, but the inspected orders had no EasyParcel cost
  metafield. Shopify's shipping line is the amount charged to the customer, not
  the merchant's actual courier expense. Match the AWB to EasyParcel and read the
  shipment price there.
- The existing `EASYPARCEL_API_KEY` authenticates successfully against the legacy
  Individual API, but it receives HTTP 401 from the OAuth-based shipment-list
  endpoint. It cannot be treated as shipment-price access. Connect the Oh! Venus
  EasyParcel account through the current OAuth Developer Hub before automating
  shipment-list/detail reads; keep all credentials in the approved secret store.
- The legacy EasyParcel gateway can return HTTP 403 to clients that use a generic
  runtime HTTP signature. The Oh! Venus CLI sends an explicit application user
  agent and JSON accept header. A 403 from a newly implemented client must be
  checked as a gateway/request-signature issue before rotating a credential that
  still works through another verified client.
- EasyParcel's shipment-list `pricing.price` can be lower than the detail record's
  `pricing.total_price`; one live shipment returned MYR 6.12 in the list and MYR
  6.49 in details. The list value is not the final P&L courier cost. For every
  listed shipment, retrieve details, verify the shipment number and AWB match, and
  use the full detail amount (including the documented BYOC composition where
  applicable). Fail the reconciliation if a detail price or identity check fails.
- Composio's Zoho proxy rejects the shortened `/books/v3/...` path with `Invalid
  URL Passed` before reaching Zoho. Use Zoho's complete documented
  `https://www.zohoapis.com/books/v3/...` endpoint for proxy calls, then verify
  every created record through a standard Zoho list/read action.
- Active Composio connections inside Codex prove interactive access but are not
  automatically Cloudflare credentials. A hosted Worker may use Composio only
  with a scoped Composio project API key, pinned toolkit versions, and connected
  account IDs visible to that same project. Verify those IDs with read-only
  Shopify shop and Meta ad-account calls before storing the key in Cloudflare;
  if the existing managed connections are not visible, use separate direct
  Shopify and Meta credentials instead.
- The owner-created Composio project key returned zero connected accounts on
  2026-09-03 even though Codex could read the managed Shopify and Meta
  connections. That project offers both toolkits but requires its own auth
  configurations. The hosted Worker therefore uses the already-verified Oh!
  Venus Shopify client-credentials app directly; it grants `read_orders`,
  `read_all_orders`, `read_products`, and MYR unit-cost access.
- The hosted Meta credential uses dedicated system user `meta-token`
  (`61592569623337`). That user is assigned only ad account `OHVENUS`
  (`act_1383191923615307`) with partial `View performance` access. Meta required
  full access to the `ads-codex` app before it exposed token permissions; after
  that app assignment was refreshed, generate a non-expiring token with only
  `ads_read`. Do not use the existing Conversions API system user for this
  workflow because its token wizard forcibly bundles `ads_management`.
- Store the Meta token only as Cloudflare secret `META_ACCESS_TOKEN`. Before
  accepting spend, verify the account ID, name, active status, MYR currency,
  `Asia/Kuala_Lumpur` timezone, and exact requested local date. Treat a missing
  spend row as zero; fail closed on every identity, date, or amount mismatch.
- Meta's browser Copy control can leave the system clipboard empty under browser
  automation. Validate the full token value against the Graph API before storing
  it, and immediately remove any protected temporary handoff file.
- A preview credential uploaded to Cloudflare through non-interactive standard
  input can include surrounding whitespace. Trim both the stored preview secret
  and bearer token before comparison; still reject missing or unequal values.
- A new Cloudflare account can accept a Worker upload but refuse to publish it
  until a `workers.dev` subdomain is registered. Complete the one-time subdomain
  onboarding, disable per-deployment preview URLs, redeploy, and verify the
  stable Worker route and cron before treating the runtime as available.

## Read-only courier-cost CLI

The supported EasyParcel command-line client lives in `easyparcel-sync/`. It can
verify the legacy account connection, run the OAuth authorization-code flow through
a local loopback callback, list shipment prices, retrieve one shipment, and produce
a date-bounded JSON courier-cost total. `easyparcel oauth-connect` accepts the client
secret through a hidden terminal prompt and saves returned credentials only to the
Git-ignored, owner-only `.env` file. Its default output deliberately excludes sender
and receiver personal data. The CLI contains no shipment submission, cancellation,
payment, or other operational write action.
OAuth access tokens are short-lived. Before a shipment read, the CLI checks the
recorded expiry and refreshes tokens within five minutes of expiry using the stored
refresh token and Developer Hub client credentials. A hosted job must preserve the
rotated refresh token in its secret store; it must not rely on a copied access token.

## Hosted Shopify app identity

- The Worker authenticates as the Shopify custom app **`seo-optimizer-read-only`**
  (`seo-optimizer-readonly-1`) via client credentials, not through Composio and
  not via `ohvenus-composio`. The client id is a write-only Cloudflare secret, so
  `POST /source-check/identity` is the only way to confirm which app is in use.
- Granted: `read_all_orders`, `read_content`, `read_customers`,
  `read_online_store_navigation`, `read_online_store_pages`, `read_orders`,
  `read_products`.

## Hosted preview verification

- On 2026-09-07, Worker version `1bc6478c-a7a1-40ed-ab53-bf1d14010aa0`
  combined Shopify, Meta Ads, and EasyParcel in `preview_only` mode. EasyParcel
  OAuth rotation is serialized in a SQLite-backed Durable Object; its bootstrap
  credentials remain Cloudflare secrets.
- The 2026-09-06 hosted EasyParcel result matched the local CLI: one
  identity-matched shipment at MYR 6.49 using the shipment-detail
  `pricing.total_price`. Duplicate shipments, identity mismatches, missing final
  prices, non-MYR amounts, and invalid dates fail closed.
- The same date normalized two Shopify orders into MYR 728.00 product sales,
  MYR 30.00 shipping income, MYR 30.00 discounts, no refunds, two successful
  gateway transactions, and MYR 324.00 COGS. With MYR 81.72 Meta spend, the
  preview balanced at MYR 1,178.38 per side and reported MYR 294.30 net profit.
- A supervised recovery test seeded 2026-09-04, recovered 2026-09-05 and
  2026-09-06 in order, and returned no work on an immediate repeat. State is
  stored outside this instruction repository and keyed by `OHV-PNL-YYYY-MM-DD`.
- Composio verified organization `933897042` as active Oh! Venus in MYR and
  `Asia/Kuala_Lumpur`, and found no journal for `OHV-PNL-2026-09-06`. No Zoho
  record was created or changed.
## Refund recognition (owner decision, 2026-09-08)

- A refund is recognised on the **date the refund itself was processed**, never
  on the date of the original order. `Order.refunds[].createdAt` in the shop's
  local timezone selects the day; the order may be of any age.
- Refunds are read through a separate `updated_at`-windowed query, so a refund
  against an order placed weeks earlier still lands on the day the money left
  the account.
- A refund also reverses that order's COGS for the returned quantity
  (`cogsReversalSen`), so stock returning to inventory is not counted as cost.
- Consequence: a completed day never changes retroactively. Sales-side COGS uses
  the original ordered quantity so a later refund cannot rewrite a past day.
- A day whose refunds exceed its new sales legitimately reports negative net
  revenue and a negative gateway clearing balance. Both are represented in the
  journal as credits and still balance.

## EasyParcel omits addon charges (verified 2026-09-08)

- The shipment-detail `pricing` object returns only `shipment_price` and
  `tax_price` (6% SST on shipping), summing to `total_price`. Every addon slot
  (`insurance`, `sms_notification`, `whatsapp_notification`, `email_notification`,
  `awb_branding`, `ddp`) was null. The shipment-list price is lower still, at
  base shipping alone.
- The portal invoice for `ES-2608-MGPMS` (order `#1178`) shows Base Shipping
  MYR 6.12, Delivery Tax MYR 0.37, Mask Sender Details MYR 0.09, Mask Parcel
  Details MYR 0.09, and MYR 0.01 tax on each mask line: MYR 6.69 paid. The API
  reports MYR 6.49. The mask charges are not exposed by any endpoint.
- Courier cost is therefore `apiCostSen` plus `EASYPARCEL_ADDON_PER_SHIPMENT_SEN`
  (currently 20 sen), reported separately as `apiCourierCostSen` and
  `addonCourierCostSen` so the configured portion stays visible. Set it to 0 if
  account-level masking is turned off, and revisit if EasyParcel changes rates.
- Verified across every shipment from 2026-08-25 to 2026-09-08: masked parcels
  are a constant MYR 6.12 + 0.37, so the addon is flat per shipment and does not
  scale with parcel size.

## EasyParcel refresh tokens are single-use

- The hosted vault and the local CLI cannot share one refresh token. A local
  `oauth-connect` invalidates the hosted copy and vice versa.
- The vault now falls back to the `EASYPARCEL_REFRESH_TOKEN` secret when its
  stored token is rejected, so re-uploading that secret is enough to recover.
  Before this, an externally rotated token bricked the hosted read permanently.

## Courier cost is recognised on the order's date (owner decision, 2026-09-08)

- `coll_date` is the only date the shipment API exposes. There is no booking,
  payment, or created date anywhere in the record.
- `coll_date` is the *scheduled* collection date, not an event that has happened:
  `ES-2609-DA9AH` carried a future `coll_date` while its status was still
  `Schedule In Arrangement`. It can also move if collection is rescheduled.
- It is also returned in UTC at `16:00:00`, which is 00:00 the next day in
  Malaysia, so filtering the list on its raw date part booked cost a day early.
  Confirmed against the portal, which shows `2026-09-01` for the shipment whose
  `coll_date` is `2026-08-31 16:00:00`.
- The AWB is bought and the wallet debited when the order is placed, so the
  expense is incurred on the order's day. Courier cost is therefore assigned to
  the day of the Shopify order named in `shipment_details.reference`, matching
  each order's courier cost to the revenue that caused it in the same period.
- The shipment list is scanned from one day before to `COLLECTION_LOOKAHEAD_DAYS`
  (7) after the target day, so a parcel collected days later is still found and
  still booked to its order's day.
- Known gap: an order whose shipment is not booked by the time the day is
  calculated reports under `ordersWithoutShipment` and its courier cost appears
  only on a later rescan. This is the courier form of the late-adjustment
  control and must be resolved before any journal write.

## Per-order courier attribution

- EasyParcel's `shipment_details.reference` carries the Shopify order name it was
  booked against, so that is the primary link. AWB against the order's
  fulfillment tracking numbers is the fallback, and only ever matches an order
  placed on the same day.
- Orders normally ship the day after they are placed, so a shipment whose
  reference names an order outside the current day is still fully attributed and
  is reported under `attributedToOrderFromAnotherDay`. Only a shipment with no
  usable reference counts as `unattributed`.
- Courier cost is recognised on the day the parcel was collected, while the sale
  is recognised on the day the order was placed. A day can therefore show two
  orders and one shipment without anything being missing. Verified 2026-09-06:
  orders `#1180` and `#1181` were both placed that day, `#1180` shipped that day
  and `#1181` shipped on 2026-09-07.
- `Order.fulfillments.trackingInfo` resolves on `read_orders` / `read_all_orders`.
  The fulfillment-order scopes listed by schema validation are only required for
  `FulfillmentOrder` objects, which this Worker never reads. Attribution works on
  the current grant; verified live on 2026-09-07 at 1/1 matched.
- If order read access were ever lost, the day still produces a complete and
  correct P&L with `courierAttributionAvailable: false` and no per-order
  breakdown.
- A shipment whose order was placed on an earlier day cannot match inside a
  single day's order set. It is reported under `unattributed`, never dropped,
  and its cost is still included in the day's courier total.

## Runtime limits

- Missed-day recovery drains at most `MAX_DAYS_PER_RUN` (3) days per invocation
  and reports `pendingAfterRun`, so a backlog cannot exceed Cloudflare's
  per-invocation subrequest budget. The daily cron drains the remainder.
- EasyParcel shipment-detail reads run at concurrency 5 and fail closed above 40
  shipments in a day rather than silently exceeding the subrequest limit.

- Remaining control: completed dates are not yet periodically reopened for other
  late source adjustments. Refund timing is now handled at source, but a bounded
  late-adjustment rescan is still required before any journal write. Note that
  re-running an old date relies on the order still falling inside the
  `updated_at` window, so a very late correction can still be missed.
