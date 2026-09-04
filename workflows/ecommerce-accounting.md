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
