"""Command-line interface for read-only EasyParcel reconciliation."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import secrets
import sys
import time
import webbrowser
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import parse_qs, urlparse

from .client import (
    EasyParcelError,
    HttpTransport,
    LegacyClient,
    OpenApiClient,
    build_authorize_url,
    exchange_authorization_code,
    normalize_shipment,
    refresh_access_token,
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

    oauth_connect = commands.add_parser(
        "oauth-connect",
        help="interactively authorize EasyParcel and save tokens to the protected env file",
    )
    oauth_connect.add_argument("--client-id")
    oauth_connect.add_argument("--redirect-uri")
    oauth_connect.add_argument("--no-browser", action="store_true")
    oauth_connect.add_argument("--wait-seconds", type=int, default=300)
    oauth_connect.set_defaults(handler=_oauth_connect)

    oauth_refresh = commands.add_parser(
        "oauth-refresh", help="refresh the OAuth access token immediately"
    )
    oauth_refresh.set_defaults(handler=_oauth_refresh)

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
    return OpenApiClient(_oauth_access_token(args), _transport(args))


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


def _oauth_connect(args: argparse.Namespace) -> dict[str, Any]:
    client_id = (
        args.client_id
        or os.environ.get("EASYPARCEL_CLIENT_ID")
        or input("EasyParcel Client ID: ").strip()
    )
    client_secret = os.environ.get("EASYPARCEL_CLIENT_SECRET") or getpass.getpass(
        "EasyParcel Client Secret (hidden): "
    ).strip()
    redirect_uri = (
        args.redirect_uri
        or os.environ.get("EASYPARCEL_REDIRECT_URI")
        or "http://127.0.0.1:8080/callback"
    )
    callback_url = urlparse(redirect_uri)
    if callback_url.scheme != "http" or callback_url.hostname not in {
        "127.0.0.1",
        "localhost",
    }:
        raise EasyParcelError(
            "oauth-connect requires a loopback HTTP redirect such as http://127.0.0.1:8080/callback"
        )
    if not callback_url.port:
        raise EasyParcelError("The OAuth redirect URI must include a local port")
    if args.wait_seconds < 30 or args.wait_seconds > 900:
        raise EasyParcelError("--wait-seconds must be between 30 and 900")

    state = secrets.token_urlsafe(24)
    authorize_url = build_authorize_url(client_id, redirect_uri, state)
    callback: dict[str, str] = {}
    expected_path = callback_url.path or "/"

    class CallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - standard library callback name
            parsed = urlparse(self.path)
            if parsed.path != expected_path:
                self.send_error(404)
                return
            values = parse_qs(parsed.query)
            for key in ("code", "state", "error", "error_description"):
                if values.get(key):
                    callback[key] = values[key][0]
            body = (
                b"<h1>EasyParcel connected</h1><p>You can close this tab and return to Terminal.</p>"
                if callback.get("code")
                else b"<h1>EasyParcel authorization failed</h1><p>Return to Terminal for details.</p>"
            )
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *values: Any) -> None:
            return

    try:
        server = HTTPServer((callback_url.hostname, callback_url.port), CallbackHandler)
    except OSError as exc:
        raise EasyParcelError(f"Could not start the local OAuth callback: {exc}") from None

    print("Opening EasyParcel authorization in your browser...", file=sys.stderr)
    print(f"If it does not open, visit:\n{authorize_url}", file=sys.stderr)
    if not args.no_browser:
        webbrowser.open(authorize_url)
    deadline = time.monotonic() + args.wait_seconds
    try:
        while not callback and time.monotonic() < deadline:
            server.timeout = min(1.0, max(0.0, deadline - time.monotonic()))
            server.handle_request()
    finally:
        server.server_close()

    if not callback:
        raise EasyParcelError("Timed out waiting for EasyParcel authorization")
    if callback.get("error"):
        raise EasyParcelError(callback.get("error_description") or callback["error"])
    returned_state = callback.get("state", "")
    if not secrets.compare_digest(returned_state, state):
        raise EasyParcelError("OAuth state mismatch; authorization was not saved")
    code = callback.get("code", "")
    token = exchange_authorization_code(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri,
        code=code,
        state=state,
        transport=_transport(args),
    )
    updates = {
        "EASYPARCEL_CLIENT_ID": client_id,
        "EASYPARCEL_CLIENT_SECRET": client_secret,
        "EASYPARCEL_REDIRECT_URI": redirect_uri,
        "EASYPARCEL_ACCESS_TOKEN": str(token["access_token"]),
    }
    if token.get("refresh_token"):
        updates["EASYPARCEL_REFRESH_TOKEN"] = str(token["refresh_token"])
    if token.get("expires_at"):
        updates["EASYPARCEL_TOKEN_EXPIRES_AT"] = str(token["expires_at"])
    update_env(args.env_file, updates)
    return {
        "ok": True,
        "oauth_connected": True,
        "credentials_saved_to": str(args.env_file.resolve()),
        "token_expires_at": token.get("expires_at"),
    }


def _oauth_access_token(args: argparse.Namespace) -> str:
    access_token = os.environ.get("EASYPARCEL_ACCESS_TOKEN", "")
    expires_at = os.environ.get("EASYPARCEL_TOKEN_EXPIRES_AT", "")
    if access_token and (not expires_at or not _token_expires_soon(expires_at)):
        return access_token
    if not os.environ.get("EASYPARCEL_REFRESH_TOKEN"):
        raise EasyParcelError(
            "EASYPARCEL_ACCESS_TOKEN is required; run easyparcel oauth-connect"
        )
    return _refresh_oauth(args)["access_token"]


def _oauth_refresh(args: argparse.Namespace) -> dict[str, Any]:
    token = _refresh_oauth(args)
    return {
        "ok": True,
        "oauth_refreshed": True,
        "credentials_saved_to": str(args.env_file.resolve()),
        "token_expires_at": token.get("expires_at"),
    }


def _refresh_oauth(args: argparse.Namespace) -> dict[str, Any]:
    token = refresh_access_token(
        client_id=os.environ.get("EASYPARCEL_CLIENT_ID", ""),
        client_secret=os.environ.get("EASYPARCEL_CLIENT_SECRET", ""),
        redirect_uri=os.environ.get("EASYPARCEL_REDIRECT_URI", ""),
        refresh_token=os.environ.get("EASYPARCEL_REFRESH_TOKEN", ""),
        transport=_transport(args),
    )
    updates = {"EASYPARCEL_ACCESS_TOKEN": str(token["access_token"])}
    if token.get("refresh_token"):
        updates["EASYPARCEL_REFRESH_TOKEN"] = str(token["refresh_token"])
    if token.get("expires_at"):
        updates["EASYPARCEL_TOKEN_EXPIRES_AT"] = str(token["expires_at"])
    update_env(args.env_file, updates)
    os.environ.update(updates)
    return token


def _token_expires_soon(value: str) -> bool:
    try:
        expires_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
    except ValueError:
        raise EasyParcelError("EASYPARCEL_TOKEN_EXPIRES_AT is not a valid timestamp") from None
    return expires_at <= datetime.now(timezone.utc) + timedelta(minutes=5)


def update_env(path: Path, updates: dict[str, str]) -> None:
    """Atomically update selected .env keys without printing secret values."""
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    remaining = dict(updates)
    output: list[str] = []
    for line in existing:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in remaining:
                output.append(f"{key}={remaining.pop(key)}")
                continue
        output.append(line)
    if output and output[-1] != "":
        output.append("")
    output.extend(f"{key}={value}" for key, value in remaining.items())
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
    try:
        temporary.write_text("\n".join(output) + "\n", encoding="utf-8")
        temporary.chmod(0o600)
        temporary.replace(path)
        path.chmod(0o600)
    finally:
        if temporary.exists():
            temporary.unlink()


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
    client = _open_client(args)
    records = client.list_shipments(
        date_from=start,
        date_to=end,
        status_code=args.status_code,
        limit=args.limit,
        fetch_all=True,
    )
    details = client.hydrate_shipment_details(records)
    return {
        "ok": True,
        "period": {"from": start, "to": end},
        "pricing_basis": "shipment_details",
        **summarize_costs(details),
    }


def _iso_date(value: str, label: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise EasyParcelError(f"{label} must be YYYY-MM-DD") from None


if __name__ == "__main__":
    raise SystemExit(main())
