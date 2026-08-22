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

## Remote or phone-only sessions

A session with no local filesystem access (phone app, any device other than the
owner's Mac) depends entirely on what is actually pushed to `HanLee00/businessOS`
and on its own client having a live, authenticated connection to each external
system (Zoho Books, Shopify, Gmail, Sheets) — connector state is account-level via
Composio/the platform's own connectors, not tied to any one device, but it is
tied to which client the connection was set up in. Before trusting these
instructions or running a workflow from such a session:

1. Confirm the instructions being read are current: check that this file and the
   relevant workflow file carry no unresolved "uncommitted" or "unpushed" note
   from the owner's last session, and if in doubt, ask the owner to confirm the
   local vault is pushed before proceeding.
2. Confirm the specific action's required connector is actually reachable from
   the current client — do not assume parity with a different client (e.g. a
   Composio-backed Zoho Books connection authenticated for one app is not
   automatically available in another). A read that fails or a tool that is
   simply absent from the current session means stop and say so, not fall back
   to a different, unverified execution path.
3. For Gaia apparel product/cost lookups specifically: the mobile-reachable
   source (`businesses/gaia/product-data.md`'s Sheet mirror) currently covers a
   subset of suppliers only. See that file for current coverage before quoting
   or invoicing a supplier not yet mirrored — stop and ask rather than
   estimating a supplier cost.

## Close-out — capture before reporting done

Two events mean a rule was just learned. Both require a write **before** the
task is reported complete, not after:

1. **The owner corrects something.** A correction is a rule. Write it to its
   single home, commit, push.
2. **A tool or API behaves unexpectedly.** Write it to that workflow's failure
   modes, commit, push.

Then name the file you updated in the reply. That last part is not bookkeeping —
it is how the owner sees the capture happen, and catches it when it does not.

**A task that edited any instruction file is not complete until `git push`
has actually succeeded** — not staged, not committed, pushed. A local-only
commit is invisible to every device without local access; per the "Remote or
phone-only sessions" section above, that includes the owner's phone. If push
fails or is skipped, say so explicitly in the reply rather than reporting the
task done.

`memory/README.md` states which file is the home for which kind of fact, and the
one-fact-one-file rule. Never write a rule into a second file; link to its home.

## Task routing

| Request | Read this |
|---|---|
| Create an invoice | `workflows/invoicing/README.md` **then** `businesses/<id>/document-defaults.yaml`; for Gaia/GWW product facts, costs, or size uplifts also read `businesses/gaia/product-data.md` |
| Log an invoice to the shirt-orders sheet | `workflows/invoice-to-sheets.md` (Gaia apparel orders only) |
| Generate/share a PDF of an invoice, quotation, or receipt | `workflows/pdf-delivery.md` — offer proactively whenever one is discussed |
| Create a quotation | `workflows/quotations.md`; for Gaia/GWW product facts, costs, or size uplifts also read `businesses/gaia/product-data.md` — **not yet run live, supervise it** |
| Look up a Gaia/GWW product, supplier cost, or size uplift | `businesses/gaia/product-data.md` |
| Record a payment / receipt | `workflows/payments.md` — A3 |
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
| Invoice → shirt-orders sheet | Verified on 6 invoices, including a paid-row move. Owner edits the sheet live — re-locate anchors before every write. |
| Gaia quotations | Documented, never executed. Run once supervised first. |
| Payments / receipts | A3 approval required. Remote-device restriction lifted 2026-08-18 by owner instruction; Gaia payments (invoices 3018, 3023, 3029) recorded from a cloud session under A3 approval. |
| Reporting | Blocked on account-mapping review. |
| Oh! Venus writes | Untested. |
