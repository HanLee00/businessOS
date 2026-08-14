# Payment Workflow

1. Select the business and explicit Zoho organization.
2. Resolve the invoice and confirm customer, number, currency, balance, and status.
3. Obtain payment evidence or explicit owner confirmation.
4. Preview amount, date, method, reference, destination account, and resulting balance.
5. Record payment only under A3 approval. If the invoice is still a draft, the same
   preview and approval must explicitly include marking it sent **without emailing**
   before the payment is applied.
6. Re-read both the invoice and its payment list. Return the Zoho payment ID,
   payment date/reference, `payment_made`, balance, status, and email state.
7. For a Gaia apparel invoice, the same approval also covers the Gaia Shirt Orders
   sheet mirror - see `workflows/invoice-to-sheets.md`'s "Payment updates" section.
   Apply the sheet move/recolour/balance update in the same run as the Zoho write,
   not as a separate follow-up. This workflow only owns the Zoho side; the sheet
   mechanics (row placement, colour, column mapping) live there, not here.

Never mark paid from an email claim alone. Never record a payment twice; search by invoice, amount, date, and reference first.

## Verified Zoho Books execution path

The connected Zoho Books toolkit does not currently expose a native
create-customer-payment action. The verified fallback is the connected Zoho Books
API proxy:

1. If required, call `ZOHO_BOOKS_MARK_INVOICE_AS_SENT`. This changes the draft to
   sent without emailing the customer. The invoice `date` remains unchanged, while
   Zoho sets `issued_date` to the day the action occurs.
2. Discover the active cash/bank accounts at run time; never cache an account ID or
   assume that the receiving bank is configured in Zoho.
3. `POST https://www.zohoapis.com/books/v3/customerpayments` with
   `organization_id` as a query parameter and a body containing `customer_id`,
   `payment_mode`, `amount`, `date`, `reference_number`, `description`, the selected
   `account_id`, and `invoices[]` with `invoice_id` and `amount_applied`.
4. Treat a successful create response as provisional until
   `ZOHO_BOOKS_GET_INVOICE` shows the new `payment_made`/`balance` and
   `ZOHO_BOOKS_LIST_INVOICE_PAYMENTS` returns the same payment ID and reference.

This path was verified under supervision on 2026-08-13: one draft was marked sent
without email, one full bank-transfer payment was created, the invoice read back as
paid with zero balance, and the payment list returned the same payment record.

### Failure modes already hit in production

1. **A payment recorded here does not, by itself, update the Gaia Shirt Orders
   sheet.** This workflow only covers the Zoho write. On 2026-08-14, a Gaia
   invoice (3027) was marked sent and paid in full through this path, and the
   sheet update was skipped entirely - the row was left sitting in `PENDING`
   with a stale balance until the owner asked why the sheet hadn't moved.
   `workflows/invoice-to-sheets.md` already documents the required sheet steps
   under "Payment updates - Zoho first, always"; the gap was that nothing in
   *this* file pointed to it, so a run following only the payments route missed
   it. Always treat step 7 above as part of recording a Gaia payment, not an
   optional add-on.
