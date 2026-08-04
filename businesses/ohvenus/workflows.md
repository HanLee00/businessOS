# Oh! Venus Workflows

## Ecommerce accounting

1. Read detailed orders, discounts, refunds, shipping, and product sales from Shopify.
2. Add external costs such as product, packaging, fulfillment, courier, payment fees, ads, subscriptions, samples, and chargebacks.
3. Reconcile a daily, weekly, or monthly summary to source totals.
4. Preview the accounting payload and pass organization `933897042` explicitly.
5. Write only the approved summary to Zoho Books.
6. Produce the separate Oh! Venus P&L before combining owner-level metrics.

Do not create one Zoho invoice per Shopify order unless a documented requirement overrides the summarized-accounting policy.

## Post-trial test

After the organization is actually on the Free plan, verify read access and one harmless supervised summary write. Do not treat Premium Trial write success as proof that Free-plan API writes will work.
