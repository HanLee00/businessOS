# Gaia Workflows

## Quote to cash

1. Validate customer, products/services, pricing, delivery, deposit, lead time, currency, tax, and expiry.
2. Resolve shipping before creating an invoice: automatically add MYR 15 for West Malaysia orders up to and including 100 product pieces; ask the owner whether the fee changes for West Malaysia orders above 100 pieces; ask the owner for the fee for every East Malaysia order; ask when the destination is unclear. Always use Zoho's invoice-level Shipping Charges field below product subtotal; never add shipping as an item row.
3. Create a draft quotation only in Zoho organization `933894797` after the applicable approval gate.
4. Return the quotation number/status/PDF preview for review.
5. Send only when explicitly instructed and recipient details are confirmed.
6. Convert an accepted quotation to an invoice only when instructed.
7. Record payment only from evidence or explicit confirmation.
8. Keep receipt and accounting status in Zoho Books.

## Document detail placement

Item master records stay generic (for example `Custom Made Polo Tshirt`). Fabric,
weight, colour, print method, print positions, and sizes vary per order and belong
in the invoice or quotation **line item description**, never in the item master.
