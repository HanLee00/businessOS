# Invoice → Google Sheets Logging

Mirrors created Gaia invoices into the `Gaia Shirt Orders` spreadsheet.
One-way only: Zoho → Sheets. Nothing in the sheet ever writes back to Zoho.

## Scope

- **Trigger:** a Gaia invoice is created. Not quotations, not receipts, not payments-only.
- **Filter:** apparel orders only. Use the template decision as the test —
  `Standard Template` (uniforms/clothing) → log. `Gift` template → skip.
  Non-apparel *lines inside* an apparel order are included; a purely gift/merch
  order is skipped entirely.
- **Target:** spreadsheet `1tw_uLdDpnGAEAhlZwyRDA_a_EZvs3crLDYyKVVIsaQU`, tab `2026 SHIRTS`.

## Rule 1 — never trust a remembered row number

The owner edits this sheet by hand, concurrently. Rows shift underneath you mid-task.
A row number read even one step earlier may already be wrong, and writing to a stale
number can overwrite a header or an existing order.

Before **every** write:

1. Re-read the region and locate the anchor by content — the month name in column A,
   or the `PENDING` label in column B.
2. Derive the target row from that anchor in the same read.
3. Write immediately.
4. Read back and confirm the values landed in the row you intended.

Never carry a row number across turns. Never reuse one from an earlier read.

## Rule 2 — duplicate guard

Before writing, search column B for `IV<invoice_number>`. If present, stop and report.
Never write the same invoice twice.

## Placement

| Payment status | Destination | Colour on column B | BALANCE |
|---|---|---|---|
| Pending | `PENDING` block, first free row below the last entry. No date. | Yellow `#ffff00` | Full invoice total |
| Fully paid | Month block for the **invoice date** month | Green | Blank |
| Partially paid | Month block for the **invoice date** month | Orange `#ff9900` | Outstanding balance |

Ask payment status as part of the existing invoice-approval step — not as a second
gate afterwards. Most invoices are Pending.

### Month-block insert point

Locate the month header row, then find that block's totals row (the row containing
`=SUM(...)`). Insert **above** the totals row so the SUM range expands to include it.
If the block has no totals row yet, write into the first empty row after the header.
Do not use "first empty row" logic on a block that already has a totals row — the new
row would land below it and fall outside the monthly total.

Totals rows are added by the owner at month end, not automatically.

## Column mapping

| Col | Field | Source |
|---|---|---|
| A | DATE | Zoho `date` → `D/M`. Blank for PENDING rows. |
| B | NAME | `IV<invoice_number> - <customer_name>` |
| C | BALANCE | Zoho `balance`. Blank when zero. |
| D | STATUS | **Owner-owned. See below.** |
| E | PHONE | Customer phone — **always write as text** |
| F | PRODUCT | `X<qty> <CODE>`, comma-separated per distinct item |
| G | SUPPLIER | Not in Zoho. Blank unless the owner states it. |
| H | PRICE PER PC | Line rates, pipe-separated (`40 | 26.4`) |
| I | SALES | Zoho `total` — includes shipping |
| J | COST | Not in Zoho. Blank unless the owner states it. |

### Column D is the owner's production status

Values are production state plus an optional payment flag:
`PROCESSING`, `COMPLETED`, `PROCESSING, HALF-PAID`, `PROCESSING, PEND SUBMIT`,
`REFUNDED, COMPLETED`.

Zoho does not know production status. Only ever **append** the payment flag to
whatever is already there. Never overwrite the cell. If the cell is empty and the
invoice is part-paid, write `PROCESSING, HALF-PAID` as the safe default.

### Phone numbers must be written as text

Malaysian local numbers begin with `0`. Writing them with `USER_ENTERED` parses them
as a number and silently strips the leading zero — `0176688436` becomes `176688436`.
Write phone with `value_input_option: RAW`, and verify on read-back.

### Product codes

Format: `X<total qty> <CODE>`, comma-separated for multiple distinct items.

- Collapse multiple lines of the *same* item into one entry, summing quantities.
  Four size lines of `L01` totalling 20 pieces → `X20 L01`.
- Use **piece counts**, not batch counts. A "150pcs batch" line with Zoho quantity 1
  is written as `X150 BUTTON`.
- The code is the leading token of the Zoho item name where one exists —
  `CRP7200 Microfibre Polo Tshirt 160gsm` → `CRP7200`.
- Where the item has no code, match the existing vocabulary in column F rather than
  inventing a new label. `Sublimation Polo Tshirt` → `SUB POLO`, not `SUBLIMATION POLO`.

Codes already in use (not exhaustive — check column F before inventing one):
`L01 L02 L03 L17 QD04 QD06 QD33 QD54 QD73 QD74 QD79 NHB2400 NHB2401 NHB2424
HC01 HC24 HC27 TT02 TT03 JK02 MH01 RC01 RC03 RC12 AG180 AG3220 CRP1600 CRP3100
CRP7200 M34 M38 M2000 US16 US1300 US1900 CP01 CP02 LT27 SUB POLO SUB RN SUB TSHIRT
CUSTOM MADE POLO CUSTOM POLO`

If no reasonable match exists, ask rather than guess — an invented code fragments the
history and breaks the owner's ability to search by product.

## Payment updates

When a payment is recorded through this workflow: update BALANCE, append the payment
flag to STATUS, recolour column B, and if the row was in `PENDING`, move it into the
month block for its invoice date.

Moving a row is insert-then-delete, in that order, re-locating anchors between the two
steps. `PENDING` sits below every month block, so deleting from it does not disturb any
month SUM range.

## Reconcile

Payments recorded directly in the Zoho UI never reach the sheet — the event-driven sync
only fires on actions taken through this workflow. Invoice `3016` was part-paid this way
and the sheet had no idea.

Run a reconcile on demand, and at month end before totals are added:

1. `ZOHO_BOOKS_LIST_INVOICES` for the organization.
2. For each invoice present in the sheet, compare Zoho `balance` against column C.
3. Report every mismatch. Do not auto-correct — surface the drift and let the owner
   decide, since the sheet may carry deliberate manual adjustments.

## Result contract

Report: which invoice, which block and row it landed in, the colour applied, and any
column left blank pending owner input. State plainly if the duplicate guard stopped a
write.
