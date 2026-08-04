# System Overview

Business OS is the shared operating and governance layer across multiple separate businesses.

```text
Owner / conversational interface
        |
        v
Business OS routing, policy, previews, approvals
        |
        +-- Gaia Gifts Co
        |     +-- Zoho Books 933894797
        |     +-- Gaia mailbox and files (mapping pending)
        |
        +-- Oh! Venus
              +-- Shopify detailed commerce ledger
              +-- Zoho Books 933897042 summarized accounting
              +-- Oh! Venus mailbox and files (mapping pending)
```

Zoho Books remains the accounting ledger. Shopify remains the detailed source for Oh! Venus orders, discounts, refunds, shipping, and product sales. Reporting surfaces may combine metrics, but accounting records remain separated by organization.

Canonical details live in:

- `businesses/registry.yaml`
- `integrations/map.yaml`
- `architecture/source-of-truth.md`
- `architecture/approval-boundaries.md`
