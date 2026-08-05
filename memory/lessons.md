# Lessons

## 2026-08-04 — Zoho item variants need an explicit representation

Gaia item creation through Composio succeeded and did not send communication. The returned Zoho Books item reported `has_variant: false`; for the tested tool, a requested variation was preserved as the item SKU and description while the exact base product name remained unchanged. Use a native item-group/variant workflow only after its API/tool behavior is separately discovered and verified.

## 2026-08-06 — A wrong conclusion outlived the evidence that disproved it

`reference_number` read back empty seconds after a write, and that single
negative read was recorded as "the wrapper silently drops the field" in two
files. It was wrong: the write had succeeded and Zoho's read-after-write lag
produced the false negative. The claim survived because it was written as
settled fact rather than as one observation. Treat an immediate negative
read-back as unconfirmed, and write findings at the confidence they were
earned at.

## 2026-08-06 — Duplicated facts drift; only one copy gets fixed

The invoice-numbering method was documented in both
`workflows/invoicing/README.md` and `businesses/gaia/document-defaults.yaml`.
The bug was found and fixed in the first; the second silently kept the wrong
method for days while both files were being read on every invoice. Rules are
now single-sourced: one home per fact, others link to it.

## 2026-08-06 — The sheet has concurrent human editors

Row numbers held across even one step go stale - the owner edits the sheet by
hand while a task is running. Rows had shifted, a manual row had been inserted,
and a STATUS value had been corrected between two steps of the same task.
Re-locate anchors by content immediately before every write.

## 2026-08-06 — Google Sheets parses phone numbers as numbers

`value_input_option: USER_ENTERED` stripped the leading zero from a Malaysian
phone number, turning `0176688436` into `176688436`. Use `RAW` for phone
numbers and verify on read-back.

## 2026-08-06 — Zoho's invoice status label hides partial payment

A correctly recorded partial payment on invoice 3016 displayed as "Overdue",
not "Partially Paid", because the due date had passed. The `status` field holds
one label and due-date state wins. Read `payment_made` and `balance` to
determine payment state; never infer it from the status label.

## 2026-08-04 — Direct invoice creation uses the Zoho Books API proxy

The available Composio tool search exposed invoice read, update, send, and status actions but not a native direct create-invoice tool. The connected Zoho proxy successfully created a draft using Zoho's documented full endpoint `https://www.zohoapis.com/books/v3/invoices`; the shortened proxy path was rejected and created nothing. Read-back, PDF rendering, no-email state, totals, and cross-organization isolation were verified.
