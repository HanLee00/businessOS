# Oh! Venus Daily P&L Worker

Cloudflare Worker for the approved Zoho-only daily P&L workflow. The current
implementation is deliberately `preview_only`: it calculates the confirmed fee
rules, constructs a balanced draft-journal preview, rejects non-MYR data and
settlement mismatches, and never writes to Zoho.

The cron expression is `0 4 * * *`, which is noon in Malaysia. The deployed
Shopify adapter authenticates with short-lived client-credential tokens, fetches
a buffered order range, and retains only orders whose `processedAt` falls on the
exact Malaysia local day. The Meta adapter uses a non-expiring system-user token
with only `ads_read`; that user has only `View performance` access to the
OHVENUS ad account. It verifies account identity, active status, MYR currency,
Malaysia timezone, and the exact requested date before returning spend. Scheduled
output contains aggregate counts and sen totals only. EasyParcel, Zoho draft
creation, and missed-date state are added only after their corresponding review
gates.

The preview-only deployment is available at
`https://ohvenus-daily-pnl.ohvenus-shop.workers.dev`. `GET /health` exposes only
deployment mode and organization routing. `POST /preview` rejects access unless
the `PREVIEW_TOKEN` secret is configured and supplied.

## Local checks

Run `npm test` and `npm run deploy`. The latter performs a Cloudflare dry-run and
does not publish the Worker.

`PREVIEW_TOKEN` must be supplied as a Worker secret before the authenticated
`POST /preview` route is used. Do not store credentials in this repository.
`SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` are also Worker secrets. The shop
domain and expected public domain are non-secret deployment variables.
`META_ACCESS_TOKEN` is a Worker secret; the expected Meta account routing fields
are non-secret deployment variables.
