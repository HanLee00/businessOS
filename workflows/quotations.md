# Quotation Workflow

Primary initial business: Gaia Gifts Co (`933894797`).

Required inputs: selected business, existing customer or approved customer creation, line items, quantities, rates, currency, tax treatment, delivery, deposit/payment terms, lead time, expiry, and notes.

For Gaia/GWW product codes, supplier costs, size bands, or large-size uplifts, follow
`businesses/gaia/product-data.md` before calculating customer line rates. The GWW
supplier cost is not the client selling price.

Stages:

1. Validate inputs and calculate totals locally.
2. Resolve the customer and items in the selected accounting organization.
3. Preview the exact Zoho payload and duplicate key.
4. Create a draft under the documented A2 boundary.
5. Return number, status, totals, and PDF availability.
6. Send only under a separate A3 approval with confirmed recipient.
7. Convert to invoice only after customer acceptance and instruction.
