# Invoicing Workflow

The executable safety specification lives in `invoicing/README.md` with its synthetic request and validator.

Every invoice action must include:

- explicit `business_id` and matching Zoho organization ID;
- resolved existing customer/item IDs or a separately approved creation plan;
- dates, currency, tax treatment, terms, quantities, rates, discounts, and total;
- duplicate reference lookup;
- immutable `send: false`, `post: false`, and `record_payment: false` for a draft test.

Sending, finalizing/posting, payment recording, voiding, and deletion are separate actions. Never infer them from a request to create or test a draft.
