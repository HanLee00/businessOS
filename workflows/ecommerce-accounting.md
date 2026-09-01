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
