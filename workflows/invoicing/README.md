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

## Invoice numbering

There is no counter in this repository. Zoho Books owns the sequence.

Read the most recent invoice with `ZOHO_BOOKS_LIST_INVOICES`
(`sort_column: created_time`, `sort_order: D`, `per_page: 1`), take its
`invoice_number`, and increment. Confirm the result with the owner before writing.

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
3. **Always read the invoice back after writing.** Confirm number, subtotal,
   shipping, total, line count, `status: draft`, and `is_emailed: false`.

### Required fields on every Gaia invoice

- `notes` - payment terms and lead time (see `businesses/gaia/document-defaults.yaml`)
- `terms` - the PAYMENT DETAILS bank block
- `shipping_charge` - invoice-level, never a line item
- `template_id` - the Gaia standard template

Order-specific detail (fabric, colour, print positions and sizes) belongs in the
**line item description**, not in the item master record. Item masters stay generic
because these vary per order.

## Result contract

Return: selected business and organization, calculated totals, whether an external
write occurred, and for an approved draft the Zoho invoice ID, number, and status.
State plainly which actions were not performed.
