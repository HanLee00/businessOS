# Approval Boundaries

## Risk levels

| Level | Typical actions | Default behavior |
|---|---|---|
| A0 — Observe | Inspect configuration, read authorized records, check connection status | Allowed when requested and scoped |
| A1 — Prepare | Draft locally, validate inputs, calculate preview, assemble API payload without submitting | Allowed when requested |
| A2 — Create reversible draft | Create an unsent draft invoice/quote/email/event | Require explicit confirmation naming business and action |
| A3 — External or financial effect | Send to customer, finalize/post invoice, record payment, issue credit/refund, place order, enable automation | Require explicit confirmation immediately before action |
| A4 — Destructive or security-sensitive | Delete records, rotate/revoke access, change permissions, bulk edits | Require explicit confirmation of exact scope and recovery plan |

## Universal preflight

Before any A2–A4 action, verify:

- exact `business_id` and external organization/store/mailbox;
- intended action and target records;
- customer/vendor identity from the system of record;
- currency, tax, totals, dates, and payment terms when financial;
- sender/recipient and attachments when communicative;
- duplicate/idempotency check;
- requested approval level and rollback or correction path.

## Test-data rule

Use clearly labeled synthetic data. Do not invent a real-looking recipient address. A test payload must set `send: false`, `post: false`, and `record_payment: false`. If the external platform cannot guarantee isolation, keep the test local until the owner approves a draft in a designated test organization or live organization.
