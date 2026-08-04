# Source-of-Truth Map

| Record or decision | Authoritative owner | Business OS role |
|---|---|---|
| Quotations, invoices, payments, expenses, tax records, P&L | Zoho Books organization for the selected business | Route, prepare, validate, and reference external IDs |
| Oh! Venus orders, products, inventory status | Oh! Venus Shopify store | Route and summarize; never shadow the catalogue or order database |
| Customer/vendor master data | Approved CRM/accounting/commerce system for that business | Reference the external ID; avoid local copies |
| Sent/received business email | Authorized mailbox | Draft, search, and summarize under approval rules |
| Working files and final documents | Approved business Drive location | Route by folder ID and link; avoid duplicating files here |
| Meetings and reminders | Approved calendar | Prepare or create events under approval rules |
| Business-specific operating context | That business's project folder | Point to the project; do not merge content into Business OS |
| Cross-business standards, routing, approvals, and automation definitions | Business OS | Canonical local documentation |
| Credentials and tokens | Approved secret store/provider connection | Record only connection name, state, and owner |

## Conflict rule

If Business OS memory or chat conflicts with a live system of record, pause the action, surface the discrepancy, and resolve it before writing. Do not silently pick one value for financial, customer, tax, sender, or fulfillment data.
