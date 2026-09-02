"""Small, dependency-free clients for EasyParcel's read APIs."""

from __future__ import annotations

import json
import base64
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Iterable


OPEN_API_BASE = "https://api.easyparcel.com/open_api/2026-06"
DETAIL_API_BASE = "https://api.easyparcel.com/open_api/2026-03"
LEGACY_API_BASE = "https://connect.easyparcel.my/"
DEFAULT_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "OhVenus-EasyParcel-CLI/0.1",
}


class EasyParcelError(RuntimeError):
    """A sanitized EasyParcel or transport error."""

    def __init__(self, message: str, *, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class HttpTransport:
    """HTTP transport kept injectable so all client behavior can be unit tested."""

    def __init__(self, timeout: float = 30.0):
        self.timeout = timeout

    def post_json(
        self, url: str, payload: dict[str, Any], headers: dict[str, str]
    ) -> dict[str, Any]:
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={**DEFAULT_HEADERS, "Content-Type": "application/json", **headers},
            method="POST",
        )
        return self._open_json(request)

    def post_form(
        self,
        url: str,
        payload: dict[str, str],
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        request = urllib.request.Request(
            url,
            data=urllib.parse.urlencode(payload).encode("utf-8"),
            headers={
                **DEFAULT_HEADERS,
                "Content-Type": "application/x-www-form-urlencoded",
                **(headers or {}),
            },
            method="POST",
        )
        return self._open_json(request)

    def _open_json(self, request: urllib.request.Request) -> dict[str, Any]:
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            message = _response_message(body) or f"EasyParcel returned HTTP {exc.code}"
            raise EasyParcelError(message, status_code=exc.code) from None
        except urllib.error.URLError as exc:
            raise EasyParcelError(f"Could not reach EasyParcel: {exc.reason}") from None
        except TimeoutError:
            raise EasyParcelError("EasyParcel request timed out") from None

        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            raise EasyParcelError("EasyParcel returned a non-JSON response") from None
        if not isinstance(parsed, dict):
            raise EasyParcelError("EasyParcel returned an unexpected response shape")
        return parsed


def _response_message(body: str) -> str | None:
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    message = parsed.get("message")
    if isinstance(message, str) and message.strip():
        return message.strip()
    error = parsed.get("error")
    if isinstance(error, dict):
        name = error.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return None


@dataclass
class OpenApiClient:
    access_token: str
    transport: HttpTransport
    base_url: str = OPEN_API_BASE
    detail_base_url: str = DETAIL_API_BASE

    def __post_init__(self) -> None:
        if not self.access_token.strip():
            raise EasyParcelError("EASYPARCEL_ACCESS_TOKEN is required")

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.transport.post_json(
            f"{self.base_url.rstrip('/')}/{path.lstrip('/')}",
            payload,
            {"Authorization": f"Bearer {self.access_token}"},
        )
        status = response.get("status_code")
        if status is not None and str(status) != "200":
            raise EasyParcelError(
                str(response.get("message") or "EasyParcel request failed"),
                status_code=_int_or_none(status),
            )
        return response

    def list_shipments(
        self,
        *,
        date_from: str | None = None,
        date_to: str | None = None,
        status_code: str | None = None,
        limit: int = 250,
        fetch_all: bool = False,
        max_pages: int = 100,
    ) -> list[dict[str, Any]]:
        if not 1 <= limit <= 250:
            raise EasyParcelError("limit must be between 1 and 250")

        base_payload: dict[str, Any] = {"limit": limit}
        if date_from:
            base_payload["date_from"] = date_from
        if date_to:
            base_payload["date_to"] = date_to
        if status_code:
            base_payload["shipment_status_code"] = status_code

        results: list[dict[str, Any]] = []
        cursor: str | None = None
        seen_cursors: set[str] = set()
        for _ in range(max_pages):
            payload = dict(base_payload)
            if cursor:
                payload["before_shipment_number"] = cursor
            try:
                response = self._post("shipment/list", payload)
            except EasyParcelError as exc:
                # The listing endpoint documents 404 for a valid filter with no
                # matching shipments. For reconciliation that is an empty day.
                if exc.status_code == 404:
                    break
                raise
            data = response.get("data", [])
            if not isinstance(data, list):
                raise EasyParcelError("Shipment list returned an unexpected data shape")
            page = [item for item in data if isinstance(item, dict)]
            results.extend(page)

            if not fetch_all or not page or len(page) < limit:
                break
            has_more = _has_more(response)
            if has_more is False:
                break
            next_cursor = str(page[-1].get("shipment_number") or "").strip()
            if not next_cursor:
                raise EasyParcelError("Shipment pagination response had no cursor")
            if next_cursor in seen_cursors:
                raise EasyParcelError("Shipment pagination cursor repeated")
            seen_cursors.add(next_cursor)
            cursor = next_cursor
        else:
            raise EasyParcelError(f"Stopped after the safety limit of {max_pages} pages")
        return results

    def shipment_details(self, shipment_number: str) -> dict[str, Any]:
        response = self.transport.post_json(
            f"{self.detail_base_url.rstrip('/')}/shipment/details",
            {"shipment_number": shipment_number.strip()},
            {"Authorization": f"Bearer {self.access_token}"},
        )
        status = response.get("status_code")
        if status is not None and str(status) != "200":
            raise EasyParcelError(
                str(response.get("message") or "EasyParcel request failed"),
                status_code=_int_or_none(status),
            )
        data = response.get("data")
        if isinstance(data, list):
            if not data or not isinstance(data[0], dict):
                raise EasyParcelError("Shipment details returned no record")
            return data[0]
        if isinstance(data, dict):
            return data
        raise EasyParcelError("Shipment details returned an unexpected data shape")

    def hydrate_shipment_details(
        self, shipments: Iterable[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Fetch complete pricing for list records and verify shipment identity."""
        details: list[dict[str, Any]] = []
        for listed in shipments:
            shipment_number = str(listed.get("shipment_number") or "").strip()
            if not shipment_number:
                raise EasyParcelError("Shipment list record had no shipment number")
            detail = self.shipment_details(shipment_number)
            returned_number = str(detail.get("shipment_number") or "").strip()
            if returned_number != shipment_number:
                raise EasyParcelError(
                    f"Shipment detail identity mismatch for {shipment_number}"
                )
            listed_awb = str(listed.get("awb") or listed.get("awb_number") or "").strip()
            detail_fields = detail.get("shipment_details")
            detail_awb = ""
            if isinstance(detail_fields, dict):
                detail_awb = str(detail_fields.get("awb_number") or "").strip()
            if listed_awb and detail_awb and listed_awb != detail_awb:
                raise EasyParcelError(f"Shipment AWB mismatch for {shipment_number}")
            details.append(detail)
        return details


@dataclass
class LegacyClient:
    api_key: str
    transport: HttpTransport
    base_url: str = LEGACY_API_BASE

    def __post_init__(self) -> None:
        if not self.api_key.strip():
            raise EasyParcelError("EASYPARCEL_API_KEY is required")

    def check_access(self) -> dict[str, Any]:
        url = f"{self.base_url.rstrip('/')}/?ac=EPCheckCreditBalance"
        response = self.transport.post_form(url, {"api": self.api_key})
        status = str(response.get("api_status") or "").strip().lower()
        if status != "success":
            raise EasyParcelError(
                str(response.get("error_remark") or response.get("message") or "Legacy authentication failed")
            )
        return {"authenticated": True, "api": "legacy_individual"}


def normalize_shipment(item: dict[str, Any]) -> dict[str, Any]:
    """Return only reconciliation fields; intentionally omit sender/receiver PII."""
    pricing = item.get("pricing") if isinstance(item.get("pricing"), dict) else {}
    courier = item.get("courier") if isinstance(item.get("courier"), dict) else {}
    status = item.get("status") if isinstance(item.get("status"), dict) else {}
    details = (
        item.get("shipment_details")
        if isinstance(item.get("shipment_details"), dict)
        else {}
    )
    currency = _first(
        pricing,
        "currency_code",
        "currency",
    ) or item.get("currency_code")
    price, price_source = _merchant_cost(pricing)
    return {
        "shipment_number": item.get("shipment_number"),
        "awb_number": item.get("awb") or item.get("awb_number") or details.get("awb_number"),
        "collection_date": (
            item.get("coll_date")
            or item.get("collection_date")
            or details.get("coll_date")
        ),
        "status_code": (
            status.get("code")
            or item.get("shipment_status_code")
            or details.get("shipment_status_code")
        ),
        "status": (
            status.get("name")
            or item.get("shipment_status")
            or details.get("shipment_status")
        ),
        "courier": (
            courier.get("courier_name")
            or courier.get("name")
            or item.get("courier_name")
        ),
        "currency": currency,
        "actual_shipping_cost": _decimal_string(price),
        "price_source": price_source,
    }


def summarize_costs(shipments: Iterable[dict[str, Any]]) -> dict[str, Any]:
    normalized = [normalize_shipment(item) for item in shipments]
    currencies = {row["currency"] for row in normalized if row["currency"]}
    if len(currencies) > 1:
        raise EasyParcelError("Cannot total shipments with mixed currencies")
    total = Decimal("0")
    missing = 0
    for row in normalized:
        value = row["actual_shipping_cost"]
        if value is None:
            missing += 1
            continue
        total += Decimal(value)
    return {
        "currency": next(iter(currencies), None),
        "shipment_count": len(normalized),
        "priced_shipment_count": len(normalized) - missing,
        "missing_price_count": missing,
        "total_actual_shipping_cost": format(
            total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), "f"
        ),
        "shipments": normalized,
    }


def build_authorize_url(client_id: str, redirect_uri: str, state: str) -> str:
    if not client_id.strip():
        raise EasyParcelError("EASYPARCEL_CLIENT_ID is required")
    if not redirect_uri.strip():
        raise EasyParcelError("EASYPARCEL_REDIRECT_URI is required")
    params = urllib.parse.urlencode(
        {"client_id": client_id, "redirect_uri": redirect_uri, "state": state}
    )
    return f"https://api.easyparcel.com/oauth/login?{params}"


def exchange_authorization_code(
    *,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    code: str,
    state: str,
    transport: HttpTransport,
) -> dict[str, Any]:
    if not all(value.strip() for value in (client_id, client_secret, redirect_uri, code)):
        raise EasyParcelError("OAuth client ID, secret, redirect URI, and code are required")
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    response = transport.post_form(
        "https://api.easyparcel.com/oauth/token",
        {
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
            "code": code,
            "state": state,
        },
        {"Authorization": f"Basic {basic}"},
    )
    access_token = response.get("access_token")
    if not isinstance(access_token, str) or not access_token.strip():
        raise EasyParcelError(
            str(response.get("message") or response.get("error_description") or "EasyParcel did not return an access token")
        )
    return response


def refresh_access_token(
    *,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    refresh_token: str,
    transport: HttpTransport,
) -> dict[str, Any]:
    if not all(
        value.strip()
        for value in (client_id, client_secret, redirect_uri, refresh_token)
    ):
        raise EasyParcelError(
            "OAuth client ID, secret, redirect URI, and refresh token are required"
        )
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    response = transport.post_form(
        "https://api.easyparcel.com/oauth/token",
        {
            "grant_type": "refresh_token",
            "redirect_uri": redirect_uri,
            "refresh_token": refresh_token,
        },
        {"Authorization": f"Basic {basic}"},
    )
    access_token = response.get("access_token")
    if not isinstance(access_token, str) or not access_token.strip():
        raise EasyParcelError(
            str(response.get("message") or response.get("error_description") or "EasyParcel did not refresh the access token")
        )
    return response


def _first(mapping: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value not in (None, ""):
            return value
    return None


def _merchant_cost(pricing: dict[str, Any]) -> tuple[Any, str | None]:
    """Choose the merchant's full cost using EasyParcel's documented semantics."""
    if "price" in pricing and pricing.get("price") not in (None, ""):
        return pricing["price"], "listing.price"
    if "total_amount" in pricing and pricing.get("total_amount") not in (None, ""):
        return pricing["total_amount"], "pricing.total_amount"

    total_price = _decimal_or_none(pricing.get("total_price"))
    shipment_price = _decimal_or_none(pricing.get("shipment_price"))
    is_byoc = pricing.get("byoc_charges") not in (None, "")
    if is_byoc and shipment_price is not None:
        # For BYOC, total_price is what EasyParcel receives and shipment_price
        # is billed separately by the courier. Both are merchant costs.
        return shipment_price + (total_price or Decimal("0")), "byoc.shipment_plus_total"
    if total_price is not None and (total_price != 0 or shipment_price is None):
        return total_price, "pricing.total_price"
    if shipment_price is not None:
        return shipment_price, "pricing.shipment_price"
    return None, None


def _decimal_string(value: Any) -> str | None:
    if value in (None, ""):
        return None
    try:
        return format(
            Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            "f",
        )
    except (InvalidOperation, ValueError):
        return None


def _decimal_or_none(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _has_more(response: dict[str, Any]) -> bool | None:
    for container in (response, response.get("pagination"), response.get("meta")):
        if isinstance(container, dict) and "has_more" in container:
            return bool(container["has_more"])
    return None


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
