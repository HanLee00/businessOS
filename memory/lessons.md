# Lessons

## 2026-08-04 — Zoho item variants need an explicit representation

Gaia item creation through Composio succeeded and did not send communication. The returned Zoho Books item reported `has_variant: false`; for the tested tool, a requested variation was preserved as the item SKU and description while the exact base product name remained unchanged. Use a native item-group/variant workflow only after its API/tool behavior is separately discovered and verified.

## 2026-08-04 — Direct invoice creation uses the Zoho Books API proxy

The available Composio tool search exposed invoice read, update, send, and status actions but not a native direct create-invoice tool. The connected Zoho proxy successfully created a draft using Zoho's documented full endpoint `https://www.zohoapis.com/books/v3/invoices`; the shortened proxy path was rejected and created nothing. Read-back, PDF rendering, no-email state, totals, and cross-organization isolation were verified.
