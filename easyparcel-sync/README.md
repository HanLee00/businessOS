# Oh! Venus EasyParcel CLI

A small read-only command-line tool for accessing EasyParcel and extracting the
actual courier costs needed by the Oh! Venus daily P&L. It intentionally does not
create, submit, cancel, or pay for shipments.

## What works

- Verify the existing legacy Individual API key without displaying the wallet balance.
- Generate the URL used to authorize the current EasyParcel OAuth API.
- List shipment reconciliation fields by date.
- Retrieve one shipment by its EasyParcel shipment number.
- Export a period's actual shipping-cost total and individual AWB-level costs as JSON.
- Omit sender/receiver names, addresses, phone numbers, and other customer data.

The legacy API key cannot retrieve prices from the current shipment endpoints.
Shipment commands therefore require an OAuth access token from an EasyParcel
Developer Hub application authorized against the live Oh! Venus account.

## Setup

Python 3.10 or newer is sufficient; the CLI has no third-party runtime dependencies.

```bash
cd /Users/hanlee/Developer/businessOS/easyparcel-sync
cp .env.example .env
python3 -m venv .venv
.venv/bin/python -m pip install -e .
```

Keep these values in `.env` (which Git ignores):

```dotenv
EASYPARCEL_API_KEY=existing-legacy-key
EASYPARCEL_ACCESS_TOKEN=current-oauth-access-token
EASYPARCEL_CLIENT_ID=developer-hub-client-id
EASYPARCEL_REDIRECT_URI=http://127.0.0.1:8080/callback
```

Do not commit the `.env` file or paste credentials into shell arguments.

## Commands

Verify the existing legacy connection:

```bash
easyparcel legacy-check
```

Create the OAuth login URL after adding the client ID and redirect URI:

```bash
easyparcel oauth-url
```

After opening that URL and completing authorization, exchange the returned code
for an access token at EasyParcel's OAuth token endpoint, then save only the token
in the approved local secret file as `EASYPARCEL_ACCESS_TOKEN`. The official flow
uses `https://api.easyparcel.com/oauth/token` with HTTP Basic authentication from
the Developer Hub client ID and secret.

List shipment costs:

```bash
easyparcel shipments --from 2026-09-01 --to 2026-09-01 --all
```

Get one shipment:

```bash
easyparcel shipment ES-XXXX-XXXXX
```

Produce the daily P&L courier-cost input:

```bash
easyparcel costs --from 2026-09-01 --to 2026-09-01
```

Every command emits JSON. Failures go to standard error and return a non-zero
exit code, which makes the CLI suitable for a hosted daily job.

## Verification

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
PYTHONPATH=src python3 -m easyparcel_cli --help
```

API behavior is based on EasyParcel's official current Open API reference:
https://easyparcel.github.io/OpenAPI/
