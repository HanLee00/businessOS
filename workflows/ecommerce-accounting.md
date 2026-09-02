# Ecommerce Accounting Workflow

This workflow applies to Oh! Venus.

Shopify is the detailed commerce source. Summaries must account for gross sales, discounts, refunds, shipping collected, taxes where applicable, payment fees, COGS, fulfillment, courier, advertising, apps/subscriptions, chargebacks, samples, and other approved operating expenses.

Every summary includes a period, source report/export reference, currency, reconciliation difference, accounting mapping, and an idempotency key. Write only to Zoho organization `933897042` after review. Keep one record per approved summary period rather than one invoice per Shopify order unless requirements change.

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
