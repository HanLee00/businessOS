# Zoho Books Integration Runbook

## Role

Zoho Books is the intended system of record for quotations, invoices, payments, expenses, taxes, and financial reporting. Business OS prepares and routes actions; it does not reproduce the ledger.

## Required setup per business

- Authorized Zoho Books connection or API access method
- Exact organization ID and verified organization display name
- Legal entity name
- Base currency and timezone
- Tax registration and tax-treatment rules
- Invoice numbering behavior (Zoho-managed unless explicitly changed)
- Default payment terms
- Approved item/customer creation policy
- Test strategy: sandbox/test organization or live organization with controlled draft records

Do not store tokens or client secrets in this repository.

## Connection acceptance check

The integration is ready for preview when a read-only request can return the selected organization's ID, display name, base currency, and available invoice fields. It is ready for draft creation only after the owner confirms the organization and test strategy.

## Safe invoice progression

1. Validate the request locally against `templates/invoice-request.yaml`.
2. Verify the connection read-only and compare the organization to the business profile.
3. Resolve customer and item IDs without creating them.
4. Render the proposed invoice payload and totals.
5. Ask for explicit approval to create an **unsent draft**.
6. Create the draft with `send: false`, then return its Zoho ID/status for review.
7. Sending, finalizing/posting, recording payment, or deleting/correcting the draft are separate approval-gated actions.

## Execution notes

Invoice creation goes through the Zoho Books REST API via `proxy_execute`; the
Composio wrapper list has no plain create-invoice action. The verified path and its
known failure modes are documented in `workflows/invoicing/README.md`.
