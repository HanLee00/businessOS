# EXECUTE — Start Here

Entry point for any device acting on Business OS, including devices with no local
file access that read this repository over the web.

## Rules that always apply

1. **State the business before acting.** Gaia Gifts Co or Oh! Venus. Never infer it
   from conversation. There is no default.
2. **Pass the Zoho organization ID explicitly** on every accounting call.
   Gaia `933894797`. Oh! Venus `933897042`. Never rely on Zoho's current organization.
3. **This repository holds instructions, never data.** No counters, balances,
   customer records, or "last known" values. Zoho Books, Shopify, and the other
   connected tools are the only sources of truth. If a file here disagrees with a
   live system, the live system wins - stop and surface the conflict.
4. **Preview before consequence.** Show totals and the payload, get approval, then write.
5. **Approval gates** are defined in `architecture/approval-boundaries.md`.
   Drafting is A2. Sending, posting, and recording payment are A3 and each needs
   its own explicit approval - never inferred from a request to create a draft.

## Close-out — capture before reporting done

Two events mean a rule was just learned. Both require a write **before** the
task is reported complete, not after:

1. **The owner corrects something.** A correction is a rule. Write it to its
   single home, commit, push.
2. **A tool or API behaves unexpectedly.** Write it to that workflow's failure
   modes, commit, push.

Then name the file you updated in the reply. That last part is not bookkeeping —
it is how the owner sees the capture happen, and catches it when it does not.

`memory/README.md` states which file is the home for which kind of fact, and the
one-fact-one-file rule. Never write a rule into a second file; link to its home.

## Task routing

| Request | Read this |
|---|---|
| Create an invoice | `workflows/invoicing/README.md` **then** `businesses/<id>/document-defaults.yaml` |
| Log an invoice to the shirt-orders sheet | `workflows/invoice-to-sheets.md` (Gaia apparel orders only) |
| Generate/share a PDF of an invoice, quotation, or receipt | `workflows/pdf-delivery.md` — offer proactively whenever one is discussed |
| Create a quotation | `workflows/quotations.md` — **not yet run live, supervise it** |
| Record a payment / receipt | `workflows/payments.md` — A3, do not run from a remote device |
| Sales or accounting report | `reporting/pnl-specification.md` — **account mapping unreviewed, see known-issues** |
| Oh! Venus commerce accounting | `workflows/ecommerce-accounting.md` |
| Customer email | `workflows/customer-support.md` |
| Add a new business | `templates/onboarding/business-intake.md` |

Business specifics live in `businesses/<business_id>/`. Read the profile and
`workflows.md` before touching that business's integrations.

## Reference, not instruction

`memory/` and `architecture/` explain decisions and design. They record why things
are the way they are - they are not execution steps and may lag the live systems.
`memory/known-issues.md` is worth reading before any first-time workflow.

## Current readiness

| Workflow | State |
|---|---|
| Gaia invoicing | Verified in production. Safe to run. |
| Invoice → shirt-orders sheet | Verified on 5 invoices. Owner edits the sheet live — re-locate anchors before every write. |
| Gaia quotations | Documented, never executed. Run once supervised first. |
| Payments / receipts | Documented. Owner device only. |
| Reporting | Blocked on account-mapping review. |
| Oh! Venus writes | Untested. |
