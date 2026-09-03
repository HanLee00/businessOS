# Oh! Venus Daily P&L Worker

Cloudflare Worker for the approved Zoho-only daily P&L workflow. The current
implementation is deliberately `preview_only`: it calculates the confirmed fee
rules, constructs a balanced draft-journal preview, rejects non-MYR data and
settlement mismatches, and never writes to Zoho.

The cron expression is `0 4 * * *`, which is noon in Malaysia. Production source
adapters, secret storage, missed-date state, Zoho account IDs, and draft-journal
creation are added only after their corresponding review gates.

The preview-only deployment is available at
`https://ohvenus-daily-pnl.ohvenus-shop.workers.dev`. `GET /health` exposes only
deployment mode and organization routing. `POST /preview` rejects access unless
the `PREVIEW_TOKEN` secret is configured and supplied.

## Local checks

Run `npm test` and `npm run deploy`. The latter performs a Cloudflare dry-run and
does not publish the Worker.

`PREVIEW_TOKEN` must be supplied as a Worker secret before the authenticated
`POST /preview` route is used. Do not store credentials in this repository.
