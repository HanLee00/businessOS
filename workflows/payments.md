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
