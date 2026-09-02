from __future__ import annotations

import unittest

from easyparcel_cli.client import (
    EasyParcelError,
    LegacyClient,
    OpenApiClient,
    build_authorize_url,
    normalize_shipment,
    summarize_costs,
)


class FakeTransport:
    def __init__(self, json_responses=None, form_response=None):
        self.json_responses = list(json_responses or [])
        self.form_response = form_response or {}
        self.calls = []

    def post_json(self, url, payload, headers):
        self.calls.append((url, payload, headers))
        return self.json_responses.pop(0)

    def post_form(self, url, payload):
        self.calls.append((url, payload))
        return self.form_response


class OpenApiClientTests(unittest.TestCase):
    def test_list_shipments_paginates_with_last_shipment_number(self):
        transport = FakeTransport(
            json_responses=[
                {
                    "status_code": 200,
                    "data": [
                        {"shipment_number": "ES-2"},
                        {"shipment_number": "ES-1"},
                    ],
                },
                {"status_code": 200, "data": [{"shipment_number": "ES-0"}]},
            ]
        )
        client = OpenApiClient("token", transport)
        result = client.list_shipments(limit=2, fetch_all=True)

        self.assertEqual([x["shipment_number"] for x in result], ["ES-2", "ES-1", "ES-0"])
        self.assertEqual(transport.calls[1][1]["before_shipment_number"], "ES-1")
        self.assertEqual(transport.calls[0][2]["Authorization"], "Bearer token")

    def test_non_200_api_status_is_an_error(self):
        transport = FakeTransport(json_responses=[{"status_code": 401, "message": "Invalid token"}])
        client = OpenApiClient("token", transport)
        with self.assertRaisesRegex(EasyParcelError, "Invalid token"):
            client.list_shipments()

    def test_details_accepts_list_response(self):
        transport = FakeTransport(
            json_responses=[{"status_code": 200, "data": [{"shipment_number": "ES-1"}]}]
        )
        client = OpenApiClient("token", transport)
        self.assertEqual(client.shipment_details("ES-1")["shipment_number"], "ES-1")
        self.assertIn("/open_api/2026-03/shipment/details", transport.calls[0][0])

    def test_list_treats_documented_404_as_empty(self):
        class NotFoundTransport(FakeTransport):
            def post_json(self, url, payload, headers):
                raise EasyParcelError("No shipments", status_code=404)

        client = OpenApiClient("token", NotFoundTransport())
        self.assertEqual(client.list_shipments(fetch_all=True), [])


class NormalizationTests(unittest.TestCase):
    def test_normalize_omits_customer_data_and_reads_price(self):
        result = normalize_shipment(
            {
                "shipment_number": "ES-1",
                "awb_number": "AWB-1",
                "coll_date": "2026-09-01",
                "receiver": {"name": "Do not expose"},
                "courier": {"name": "DHL"},
                "pricing": {"currency_code": "MYR", "price": "12.345"},
            }
        )
        self.assertNotIn("receiver", result)
        self.assertEqual(result["actual_shipping_cost"], "12.35")
        self.assertEqual(result["currency"], "MYR")

    def test_normalize_reads_nested_detail_fields(self):
        result = normalize_shipment(
            {
                "shipment_number": "ES-1",
                "shipment_details": {
                    "awb_number": "AWB-2",
                    "coll_date": "2026-09-01 00:00:00",
                    "shipment_status_code": 7,
                    "shipment_status": "Scheduled",
                },
                "courier": {"courier_name": "Aramex"},
                "pricing": {
                    "currency_code": "MYR",
                    "total_price": "0.00",
                    "shipment_price": "9.80",
                },
            }
        )
        self.assertEqual(result["awb_number"], "AWB-2")
        self.assertEqual(result["courier"], "Aramex")
        self.assertEqual(result["actual_shipping_cost"], "9.80")
        self.assertEqual(result["price_source"], "pricing.shipment_price")

    def test_byoc_detail_adds_direct_courier_and_easyparcel_costs(self):
        result = normalize_shipment(
            {
                "pricing": {
                    "currency_code": "MYR",
                    "total_price": "1.50",
                    "shipment_price": "8.00",
                    "byoc_charges": "1.40",
                    "byoc_charges_tax": "0.10",
                }
            }
        )
        self.assertEqual(result["actual_shipping_cost"], "9.50")
        self.assertEqual(result["price_source"], "byoc.shipment_plus_total")

    def test_summarize_costs_tracks_missing_prices(self):
        result = summarize_costs(
            [
                {"pricing": {"currency_code": "MYR", "price": "4.10"}},
                {"pricing": {"currency_code": "MYR", "price": "5.20"}},
                {"pricing": {"currency_code": "MYR"}},
            ]
        )
        self.assertEqual(result["total_actual_shipping_cost"], "9.30")
        self.assertEqual(result["missing_price_count"], 1)

    def test_mixed_currency_total_is_rejected(self):
        with self.assertRaisesRegex(EasyParcelError, "mixed currencies"):
            summarize_costs(
                [
                    {"pricing": {"currency_code": "MYR", "price": "1"}},
                    {"pricing": {"currency_code": "SGD", "price": "1"}},
                ]
            )


class LegacyAndOauthTests(unittest.TestCase):
    def test_legacy_check_never_returns_balance(self):
        transport = FakeTransport(
            form_response={"api_status": "Success", "result": {"credit": "999.00"}}
        )
        result = LegacyClient("secret", transport).check_access()
        self.assertEqual(result, {"authenticated": True, "api": "legacy_individual"})

    def test_authorize_url_encodes_parameters(self):
        url = build_authorize_url("client id", "http://127.0.0.1/callback", "state")
        self.assertIn("client_id=client+id", url)
        self.assertIn("redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback", url)


if __name__ == "__main__":
    unittest.main()
