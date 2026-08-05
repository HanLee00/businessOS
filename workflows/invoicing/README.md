# Safe Invoice Workflow

## Goal

Prepare and, only when separately approved, create an unsent invoice draft in the
correct Zoho Books organization without contacting a customer or recording a
financial event beyond the approved draft.

## Modes

- `validate_only` (A1): local schema, totals, and policy checks; no connector call.
- `preview_external` (A1): read-only organization/contact/item lookups and proposed payload; no write.
- `create_draft` (A2): one explicitly approved unsent draft; external write.
- Sending, finalizing/posting, and payment recording are **not** modes of this workflow.

## Preflight checks

1. `business_id` is stated explicitly. Never infer it from conversation.
2. The Zoho organization ID matches the selected business profile.
3. Currency and tax treatment match the organization.
4. Contact and item references resolve to existing records, or a creation plan is
   separately approved.
5. Resolve delivery region and total product-piece quantity, then apply the
   business shipping policy.
6. Gaia shipping: West Malaysia at 100 pieces or fewer gets MYR 15 automatically in
   Zoho's invoice-level `shipping_charge` field. Above 100 pieces, ask the owner.
   East Malaysia requires an owner-supplied fee. Ambiguous destination stops for
   clarification. Shipping is **never** a line item.
7. Read the next invoice number live from Zoho (see below). Never use a cached number.
8. Duplicate reference/customer lookup returns no conflict.
9. Show the owner dates, quantities, rates, shipping, discounts, tax, and total.
10. `create_draft` proceeds only after explicit approval naming the business.
11. Every line item description follows `line_item_description_format` in
    `document-defaults.yaml`: no comma-separated specs. Item/variant name (plus
    any variant detail such as colour or material) on its own line, then a
    labelled section per detail group (e.g. "HEATPRESS PRINT:" for apparel, or
    numbered components for a gift set) with one line per position/component,
    then a labelled breakdown (size, quantity, etc.) with one line per entry.
    This applies to every order type, not apparel only.
12. `reference_number` is set — format `<CUSTOMERCODE>-<YYYYMMDD>-<ITEMCODE>` —
    via the raw PUT proxy (the update wrapper silently drops this field). Confirm
    it saved by reading the invoice back, not by trusting the write response.

## Invoice numbering

There is no counter in this repository. Zoho Books owns the sequence.

Read recent invoices with `ZOHO_BOOKS_LIST_INVOICES` and take the **numeric maximum**
of `invoice_number`, then increment. Confirm with the owner before writing.

Do **not** sort by `created_time` to find the next number. That returns the most
recently *created* invoice, which is not necessarily the highest numbered - any
backdated or out-of-order creation silently produces a duplicate number.

Note also that Zoho's maximum is not automatically the business's maximum. Invoice
numbers from the previous system (IV2979-IV3011 and earlier) exist in the Gaia Shirt
Orders sheet but were never in Zoho. Zoho's sequence currently sits above them, so a
Zoho-only read is safe today. If that ever stops being true, cross-check the sheet.

## Verified execution path

The Composio wrapper toolset has **no plain `CREATE_INVOICE` action** - only list,
get, update, delete, recurring, and create-from-salesorder. This is a gap in the
wrapper list, not an access limitation. The same authenticated connection reaches
the full Zoho Books REST API through the workbench helper:

```python
proxy_execute(
    method='POST',
    endpoint='https://www.zohoapis.com/books/v3/invoices',
    toolkit='ZOHO_BOOKS',
    query_params={'organization_id': '<org id>'},
    body={...}
)
```

Use the full documented endpoint. A shortened proxy path is rejected and creates nothing.

### Three failure modes already hit in production

1. **Do not send `invoice_number` on creation.** Zoho rejects it with code 4097
   ("Number entered does not match the auto-generated number") even when
   `ignore_auto_number_generation: true` is in the POST body. Create without a
   number, then set the correct number in a follow-up `ZOHO_BOOKS_UPDATE_INVOICE`
   call passing both `invoice_number` and `ignore_auto_number_generation: true`.
2. **`line_items` on update is a full replace, not a merge.** An update that omits
   existing lines silently deletes them from the invoice. Always resend the complete
   array, including `line_item_id` for every line being kept.
3. **`ZOHO_BOOKS_UPDATE_INVOICE`'s wrapper schema has no `reference_number` field,
   and its behaviour with that field is unreliable.** Two identical calls in one
   batch produced different outcomes - one invoice saved the reference number, the
   other did not. Prefer the raw proxy for this field:
   `PUT /invoices/{invoice_id}` with `reference_number` in the body. Always resend
   `line_items` here too, for the same full-replace reason as above.
4. **An immediate read-back can return stale data.** Zoho has read-after-write lag.
   A field can read as empty seconds after a write and be correctly set minutes
   later - this repository recorded a false "silent drop" conclusion that way and
   documented the wrong cause. Confirm number, subtotal, shipping, total, line
   count, line item descriptions match the required format, `reference_number`,
   `status: draft`, and `is_emailed: false` - but treat a *negative* result from an
   immediate read as unconfirmed, not as failure. Re-check on a later separate call
   before concluding a write failed, and never re-run a create on that basis.
5. **The workbench's `proxy_execute` session can go stale mid-task**, reporting
   "project API key has been revoked or has expired" even seconds after a fresh
   session was generated. This is not fixed by requesting a new session - it is a
   sandbox-level auth issue distinct from the Zoho connection itself, which keeps
   working fine through the standard wrapper tools throughout. If proxy_execute
   fails this way, fall back to wrapper tools for whatever doesn't need the proxy,
   and retry the proxy-only steps in a later session rather than looping on it.

### Required fields on every Gaia invoice

- `notes` - payment terms and lead time (see `businesses/gaia/document-defaults.yaml`)
- `terms` - the PAYMENT DETAILS bank block
- `shipping_charge` - invoice-level, never a line item
- `template_id` - see Template selection below
- `reference_number` - always set, see Reference number below

Order-specific detail (fabric, colour, print positions and sizes) belongs in the
**line item description**, not in the item master record. Item masters stay generic
because these vary per order. Write each distinct detail on its own line - never
comma-separate a print spec or size breakdown onto one line. Exact format and a
worked example are in `businesses/<id>/document-defaults.yaml` under
`line_item_description_format`.

### Template selection

Two Gaia templates exist in Zoho: `Standard Template` (`726115000000017001`,
default, uniforms and clothing) and `Gift` (`726115000000122002`, gift and merch
orders). Pick by what the order actually contains, not by customer - the same
customer can get either template depending on the order. Full mapping is in
`businesses/gaia/document-defaults.yaml` under `templates`.

### Reference number

Always set `reference_number`, whether or not the customer supplied a real PO -
format `<CUSTOMERCODE>-<YYYYMMDD>-<ITEMCODE>`. It is an internal lookup key, not a
claim that it's the customer's own PO number. See the wrapper-tool gap above for
how to actually set it.

## Result contract

Return: selected business and organization, calculated totals, whether an external
write occurred, and for an approved draft the Zoho invoice ID, number, and status.
State plainly which actions were not performed.
