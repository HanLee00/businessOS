# Security Model

## Identity and access

- The owner uses a private account and retains administration of both Zoho organizations.
- Staff receive named accounts scoped only to their business.
- Gaia staff must not access Oh! Venus; Oh! Venus staff must not access Gaia.
- Shared owner credentials are prohibited.

## Connection controls

- Connections live in the provider/Composio secret store, not this repository.
- Business profiles store only non-secret connection names and external scope IDs.
- Every external write is routed with the explicit scope from the selected profile.
- The current/default Zoho organization is ignored.

## Financial controls

- Preview totals, currency, dates, tax, contact, item, and duplicate key before writing.
- Sending, posting/finalizing, recording payment, refunds, voids, and deletion are separately approval-gated.
- Test records use synthetic labels, no customer email, minimal value, and a recorded cleanup decision.

## Evidence

Record timestamps, business ID, organization ID, action, external record ID/status, and whether a message or payment event occurred. Never record tokens, bank details, full customer payloads, or private mailbox content.
