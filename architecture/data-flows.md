# Data Flows

## Gaia quote-to-cash

```text
Request -> Business OS validation -> Gaia Zoho draft quotation
        -> owner review -> customer send -> approval
        -> Gaia Zoho invoice -> payment evidence -> payment record
```

Each financial call includes organization `933894797`. Drafting, sending, converting, and recording payment are distinct steps with their own approvals.

## Oh! Venus commerce-to-accounting

```text
Shopify detailed orders/refunds/discounts/shipping
        -> period summary and external expense reconciliation
        -> reviewed accounting payload
        -> Oh! Venus Zoho organization 933897042
        -> business P&L -> combined owner reporting layer
```

Do not create one Zoho invoice per Shopify order unless a legal or operational requirement is documented. Summaries must preserve period, currency, source totals, refunds, fees, and reconciliation evidence.

## Combined reporting

```text
Gaia accounting report -----+
                             +-> normalized read-only model -> owner dashboard
Oh! Venus accounting report +
```

The dashboard combines metrics, not ledgers. Shared expenses require a documented allocation method and must reconcile to their source entries.
