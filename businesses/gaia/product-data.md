# Gaia Product Data Routing

Use this file whenever a Gaia quotation, invoice, costing request, or margin check
needs a GWW product code, supplier, specification, confidential supplier cost, size
band, or large-size price uplift. This file contains routing and calculation rules
only; Business OS never copies the product catalogue into this repository.

## Product-domain boundary

- Apparel, garments, uniforms, and workwear use the GWW sources documented below.
- Gifts and merchandise use Gaia Gifts Co product sources, not GWW. That source is
  not yet configured in Business OS and will be added in a future session. Until it
  exists, stop and ask for the Gaia Gifts Co source rather than searching GWW or
  guessing product details, costs, or surcharges.

This boundary determines where product facts come from. Invoice template selection
still follows `document-defaults.yaml` based on the order's actual contents.

## Sources and precedence

### Local master

The canonical structured GWW product database is:

- Root: `/Users/hanlee/Developer/Gaia/Gaia-Work-Wear/product-database/`
- Read first: `README.md`
- Product identity/specifications: `products.csv`
- Supplier costs and size bands: `prices.csv`
- Historical comparison only: `snapshots/`
- Original evidence: supplier PDFs under
  `/Users/hanlee/Developer/Gaia/Gaia-Work-Wear/catalogs/`

Join `products.csv` and `prices.csv` on `sku`. Match an exact `sku` or an
unambiguous supplier plus `supplier_code`; never match on a similar-looking product
name alone. Read the price row whose `size_band` contains the requested size and
whose `tier` is the applicable supplier-cost tier. `available_sizes` describes what
exists; it does not determine the price.

Catalogue costs, stock, MOQs, and lead times are time-sensitive. Read the source and
effective dates, surface stale or conflicting data, and obtain current supplier
confirmation before making a commitment where freshness matters. A blank value is
unknown, not zero.

### Mobile fallback

When the local files are unavailable, use the private Google Sheet mirror:

- Spreadsheet: `GWW-SHIRT-CATALOGS-2026`
- Spreadsheet ID: `1pV-8AMKXsEj88uBYNFIHKJ2BmwX2-YNX8KjYV7HNqCA`
- Link: https://docs.google.com/spreadsheets/d/1pV-8AMKXsEj88uBYNFIHKJ2BmwX2-YNX8KjYV7HNqCA/edit
- Owner/account: `gaiagiftsco@gmail.com`

Read the Sheet's `guide` tab before using `catalog` or `prices`. The Sheet is a
read-only mobile mirror, not the master and not a two-way sync. It covers all
four suppliers at parity with the local master — Oren Sport, Rightway,
Esping/Le'fonse, and Megah Textile, 531 products / 914 price points, extracted
2026-08-11 — verified directly against the live Sheet via the Composio
`googlesheets` connection on 2026-08-22 (spot-checked rows from each of the
four suppliers in both `catalog` and `prices`). Use the Sheet only when the
requested code is present and its source/effective date is acceptable. If the
code is absent or the Sheet conflicts with the local master or supplier
confirmation, stop and surface the limitation rather than guessing.

Note: this file previously stated the Sheet contained Oren Sport only, dated
the same 2026-08-11. That was wrong at the time of the 2026-08-22 check — the
mirror already had full coverage and the file was never corrected after the
sync happened. See `memory/lessons.md`, 2026-08-22.

## Selling price, supplier cost, and size uplift

These are different values and must never be substituted for one another:

- **Client base selling price:** comes from the owner's instruction or an approved
  quotation. Never derive it from a GWW supplier cost, RRP, or MAP unless the owner
  explicitly requests a markup calculation.
- **Supplier cost:** comes from the applicable GWW `prices.csv` row. It is internal
  and confidential. Never place it, the supplier name, or margin information on a
  customer-facing quotation or invoice.
- **Large-size uplift:** for each requested size, subtract the applicable base-band
  supplier cost from that size band's supplier cost. Add that difference to the
  approved client base selling price unless the owner gives a different surcharge or
  markup rule.

Formula:

`customer size rate = approved client base price + (size-band supplier cost - base-band supplier cost)`

Do not add another markup to the size uplift unless the owner explicitly instructs
it. If several requested sizes share the same final customer rate, they may share one
invoice line/rate tier while the description retains the complete size breakdown. If
rates differ, use separate lines or rate tiers. Follow `document-defaults.yaml` for
the customer-facing line-item description format.

## Required lookup sequence

1. Confirm the selected business is Gaia Gifts Co and identify the GWW supplier code.
2. Obtain the approved client base selling price from the owner or approved quote.
3. Resolve the exact product and requested sizes in the local master, or use the
   mobile Sheet fallback within its documented coverage.
4. Check product status, availability, price tier, size band, effective date, and
   source. Resolve colour-specific or limited-offer tiers explicitly.
5. Calculate any size uplift from supplier-cost differences; never use the supplier
   cost itself as the customer rate.
6. Preview the customer rate tiers and totals for owner approval. Supplier costs may
   be shown separately as internal calculation evidence, never inside the customer
   document payload.
7. If any code, tier, size band, price, freshness, or source is missing or ambiguous,
   stop and ask. Never invent a surcharge or silently use an older price.

This lookup authorizes no external write. Draft creation, sending, posting, and
payment recording remain subject to their existing approval boundaries.
