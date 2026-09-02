"""Command-line interface for read-only EasyParcel reconciliation."""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
from datetime import date
from pathlib import Path
from typing import Any, Sequence

from .client import (
    EasyParcelError,
    HttpTransport,
    LegacyClient,
    OpenApiClient,
    build_authorize_url,
    normalize_shipment,
    summarize_costs,
)


def load_env(path: Path) -> None:
    """Load a simple .env file without replacing already-set environment values."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        prog="easyparcel",
        description="Read-only EasyParcel access for Oh! Venus courier-cost reconciliation.",
    )
    root.add_argument(
        "--env-file",
        type=Path,
        default=Path(".env"),
        help="credential file (default: .env in the current directory)",
    )
    root.add_argument("--timeout", type=float, default=30.0)
    commands = root.add_subparsers(dest="command", required=True)

    legacy = commands.add_parser("legacy-check", help="verify the existing legacy API key")
    legacy.set_defaults(handler=_legacy_check)

    oauth_url = commands.add_parser(
        "oauth-url", help="generate the EasyParcel OAuth authorization URL"
    )
    oauth_url.add_argument("--client-id")
    oauth_url.add_argument("--redirect-uri")
    oauth_url.add_argument("--state")
    oauth_url.set_defaults(handler=_oauth_url)

    list_parser = commands.add_parser("shipments", help="list shipment cost records")
    _date_filters(list_parser)
    list_parser.add_argument("--status-code")
    list_parser.add_argument("--limit", type=int, default=250)
    list_parser.add_argument("--all", action="store_true", help="follow all cursor pages")
    list_parser.set_defaults(handler=_shipments)

    detail = commands.add_parser("shipment", help="get one shipment's reconciliation fields")
    detail.add_argument("shipment_number")
    detail.set_defaults(handler=_shipment)

    costs = commands.add_parser("costs", help="summarize actual shipping costs for a period")
    _date_filters(costs, required=True)
    costs.add_argument("--status-code")
    costs.add_argument("--limit", type=int, default=250)
    costs.set_defaults(handler=_costs)
    return root


def _date_filters(command: argparse.ArgumentParser, *, required: bool = False) -> None:
    command.add_argument("--from", dest="date_from", required=required)
    command.add_argument("--to", dest="date_to", required=required)


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    load_env(args.env_file)
    try:
        result = args.handler(args)
    except EasyParcelError as exc:
        error: dict[str, Any] = {"ok": False, "error": str(exc)}
        if exc.status_code is not None:
            error["status_code"] = exc.status_code
        print(json.dumps(error, indent=2), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


def _transport(args: argparse.Namespace) -> HttpTransport:
    return HttpTransport(timeout=args.timeout)


def _open_client(args: argparse.Namespace) -> OpenApiClient:
    return OpenApiClient(
        os.environ.get("EASYPARCEL_ACCESS_TOKEN", ""), _transport(args)
    )


def _legacy_check(args: argparse.Namespace) -> dict[str, Any]:
    client = LegacyClient(os.environ.get("EASYPARCEL_API_KEY", ""), _transport(args))
    return {"ok": True, **client.check_access()}


def _oauth_url(args: argparse.Namespace) -> dict[str, Any]:
    state = args.state or secrets.token_urlsafe(24)
    url = build_authorize_url(
        args.client_id or os.environ.get("EASYPARCEL_CLIENT_ID", ""),
        args.redirect_uri or os.environ.get("EASYPARCEL_REDIRECT_URI", ""),
        state,
    )
    return {"authorization_url": url, "state": state}


def _validated_dates(args: argparse.Namespace) -> tuple[str | None, str | None]:
    start = _iso_date(args.date_from, "--from") if args.date_from else None
    end = _iso_date(args.date_to, "--to") if args.date_to else None
    if start and end and start > end:
        raise EasyParcelError("--from must be on or before --to")
    return start, end


def _shipments(args: argparse.Namespace) -> dict[str, Any]:
    start, end = _validated_dates(args)
    records = _open_client(args).list_shipments(
        date_from=start,
        date_to=end,
        status_code=args.status_code,
        limit=args.limit,
        fetch_all=args.all,
    )
    normalized = [normalize_shipment(item) for item in records]
    return {"ok": True, "shipment_count": len(normalized), "shipments": normalized}


def _shipment(args: argparse.Namespace) -> dict[str, Any]:
    shipment_number = args.shipment_number.strip()
    if not shipment_number:
        raise EasyParcelError("shipment_number is required")
    record = _open_client(args).shipment_details(shipment_number)
    return {"ok": True, "shipment": normalize_shipment(record)}


def _costs(args: argparse.Namespace) -> dict[str, Any]:
    start, end = _validated_dates(args)
    records = _open_client(args).list_shipments(
        date_from=start,
        date_to=end,
        status_code=args.status_code,
        limit=args.limit,
        fetch_all=True,
    )
    return {"ok": True, "period": {"from": start, "to": end}, **summarize_costs(records)}


def _iso_date(value: str, label: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise EasyParcelError(f"{label} must be YYYY-MM-DD") from None


if __name__ == "__main__":
    raise SystemExit(main())
