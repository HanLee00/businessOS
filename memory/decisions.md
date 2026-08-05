# Decision Log

## 2026-08-03 — Business OS is a separate control project

- **Status:** Confirmed
- **Decision:** Keep `/Users/hanlee/Developer/businessOS` separate from `/Users/hanlee/Developer/Gaia` and `/Users/hanlee/Developer/OhVenus`.
- **Reason:** Shared standards and workflows should be reusable without merging business-specific knowledge or operations.

## 2026-08-03 — External applications remain systems of record

- **Status:** Confirmed
- **Decision:** Use Business OS and conversational agents as the orchestration interface; keep accounting data in Zoho Books and other domain records in their designated applications.
- **Reason:** Avoid rebuilding accounting, commerce, messaging, or file-management databases inside chat or local documents.

## 2026-08-03 — Tests stop at preview unless separately approved

- **Status:** Confirmed
- **Decision:** A test authorizes local validation and payload preview only. Creating drafts, sending documents, posting transactions, or using real customer details requires explicit confirmation at the relevant boundary.
- **Reason:** Prevent unintended customer communication or financial side effects.

## 2026-08-03 — Explicit Zoho organization routing

- **Status:** Confirmed
- **Decision:** Route Gaia Books actions only to organization `933894797` and Oh! Venus Books actions only to organization `933897042`. Never use the current/default Zoho organization implicitly.
- **Reason:** The connected Zoho account contains both businesses; explicit routing prevents cross-ledger writes.

## 2026-08-03 — Subscription targets remain separate

- **Status:** Confirmed target; billing state still unverified
- **Decision:** Gaia targets Zoho Books Standard with monthly billing; Oh! Venus targets the Free plan and must not receive a paid renewal.
- **Reason:** Gaia needs regular accounting workflows while Oh! Venus is intended to use summarized ecommerce accounting with a lower-cost fallback.

## 2026-08-04 — Gaia document identity and numbering

- **Status:** Confirmed
- **Decision:** Use `gaiagiftsco@gmail.com` on Gaia business documents. Do not display a personal account email. Continue the existing Bookipi invoice sequence rather than restarting at one; the live number is read from Zoho at run time and never cached in this repository.
- **Reason:** Preserve brand identity and sequence continuity without keeping a counter that can drift from the ledger.

## 2026-08-04 — Gaia default invoice wording

- **Status:** Confirmed
- **Decision:** Use full payment before delivery and a 7-14 working-day lead time measured from full payment plus written final-artwork confirmation.
- **Reason:** The wording is clearer about when production lead time begins.

## 2026-08-04 — Gaia invoice template v1

- **Status:** Confirmed
- **Decision:** Standardize Gaia invoices on `gaia_invoice_v1`: A4, minimal layout, small black Gaia mark at the upper-left, website displayed as `gaiagifts.co`, sage `#606F52` for the table header and small rules, and pale sage `#EEF3E9` for the balance band.
- **Reason:** Adds a restrained, earthy brand cue while keeping invoices professional, readable, and reusable.

## 2026-08-04 — Gaia invoice export naming

- **Status:** Confirmed
- **Decision:** Name exported Gaia invoice PDFs as `IV #<invoice_number> - <customer_company_name>.pdf`.
- **Reason:** Places the invoice number first for filing and reconciliation while keeping the customer immediately identifiable.

## 2026-08-04 — Gaia shipping fee rules

- **Status:** Confirmed
- **Decision:** Automatically add MYR 15 shipping to West Malaysia invoices containing up to and including 100 product pieces. For West Malaysia orders above 100 pieces, ask the owner whether the shipping fee changes before invoice creation. For every East Malaysia order, ask the owner for the shipping fee before invoice creation. If the delivery region is missing or ambiguous, stop and ask.
- **Reason:** Standardize routine local delivery charges while keeping high-quantity and East Malaysia freight under owner control.

## 2026-08-06 — GitHub is the published library; the local folder is the vault

- **Status:** Confirmed
- **Decision:** `/Users/hanlee/Developer/businessOS` is the working master. The
  public GitHub repository `HanLee00/businessOS` is a synced copy that devices
  without local file access read for instructions. Push after every instruction
  change. `session-handoff.md` stays local and gitignored.
- **Reason:** A second device needs the SOPs without needing the filesystem, and
  a public repo on the same account avoids auth complexity. The repository holds
  instructions only, so nothing sensitive is published.

## 2026-08-06 — One fact, one file

- **Status:** Confirmed
- **Decision:** Every rule, gotcha, or convention lives in exactly one file.
  Other files link to it and never restate it. Execution rules go in
  `businesses/<id>/document-defaults.yaml`, API gotchas in the relevant
  `workflows/**/README.md`, durable constraints in `memory/known-issues.md`,
  rationale in `memory/decisions.md`, verified learnings in `memory/lessons.md`.
- **Reason:** Duplicated facts drift. The invoice-numbering method was wrong in
  one of its two homes for days after being fixed in the other.

## 2026-08-06 — Corrections are captured before the task is reported complete

- **Status:** Confirmed
- **Decision:** When the owner corrects a rule, or an API behaves unexpectedly,
  write it to its single home and commit before reporting the task done, and
  state in the reply which file was updated.
- **Reason:** `memory/` went two days without an entry while the work continued,
  because recording depended on remembering to. Naming the file in the reply
  makes a missed capture visible to the owner.

## 2026-08-06 — Gaia item master naming

- **Status:** Confirmed
- **Decision:** Item names lead with the product code where one exists, then the
  product name, then GSM - `QD04 Microfibre Round Neck Tshirt - 160gsm`. Where a
  product line has no code, name it plainly and never invent one.
- **Reason:** The code is how the owner searches and reconciles; burying or
  omitting it breaks lookup against the shirt-orders sheet.

## 2026-08-04 — Gaia shipping uses the fixed invoice-level format

- **Status:** Confirmed
- **Decision:** Enter every Gaia shipping fee in Zoho's invoice-level Shipping Charges field so it appears below product subtotal. Never create shipping as a product/service item row. Treat the previously created shipping item as legacy and do not use it.
- **Reason:** Keeps product lines clean and ensures every Gaia invoice follows the owner's fixed financial-summary format.
