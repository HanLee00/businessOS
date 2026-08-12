# PDF Delivery — Invoices, Quotations, Receipts

## Trigger

After a draft invoice is created, or on request for any existing invoice,
quotation, or receipt reachable through this connection.

## Why not Zoho's native share

Zoho's own "Share via WhatsApp" / in-app share export names the file with only
the document number (e.g. `3024.pdf`) and cannot be reconfigured through this
connection. Never rely on it when the owner needs a customer-labelled file.

## Steps

1. Fetch the PDF via `ZOHO_BOOKS_GET_INVOICE` (or the equivalent GET action for
   quotations/receipts) with `accept: pdf`, the document ID, and
   `organization_id`. This returns a temporary presigned URL, not inline bytes.
2. Download the bytes inside the Composio workbench — its network reaches the
   presigned storage URL; the assistant's own sandbox does not. Base64-encode
   the bytes and print them.
3. **Verify before decoding — do not skip this.** Printing then retyping a
   large base64 blob into the next tool call is not a reliable copy. A single
   character can silently flip in transit with no error raised; the file
   still "looks like" a PDF (correct magic bytes) but fails to open, or opens
   with a corrupted trailer. In the workbench, split the base64 into ~2000-char
   chunks and print a sha256 of each chunk plus the full-file sha256 and byte
   length. After relaying each chunk into the assistant's sandbox, hash it
   again there and compare before concatenating. Only decode and write the
   file once every chunk hash and the whole-file hash match. If any chunk
   fails, re-fetch that one chunk — do not silently ship an unverified file.
4. Decode the verified base64 in the assistant's own sandbox and save to the
   outputs folder with the filename `IV #<invoice_number> - <company_name>.pdf`,
   matching `file_naming` in `businesses/gaia/document-defaults.yaml`.
5. Share it via `present_files` so it appears as a file card in the chat for
   the owner to forward on themselves — WhatsApp or anywhere else.

## Scope

Not limited to invoices created in the current session, and not limited to
invoices at all. Applies to any invoice, quotation, or receipt reachable
through this connection, whether just created or pre-existing.

## Standing offer

Whenever a draft or existing invoice, quotation, or receipt is discussed in
conversation, offer to generate and share the correctly-named PDF per this
workflow, without waiting to be asked.

## Known limitation — not fixable from here

Zoho's native in-app share-to-WhatsApp button always defaults to the bare
document number. There is no setting reachable through this connection that
changes that behaviour. This is a permanent platform constraint, not an open
bug — do not re-investigate it.
