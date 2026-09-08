import test from "node:test";
import assert from "node:assert/strict";
import { matchCourierCostsToOrders } from "../src/index.mjs";

test("attributes each EasyParcel cost to the order it shipped", () => {
  const shopify = {
    orders: [
      { orderId: "gid://shopify/Order/1", orderName: "#1178", trackingNumbers: ["7328089358633416"] },
      { orderId: "gid://shopify/Order/2", orderName: "#1179", trackingNumbers: ["9999999999999999"] }
    ]
  };
  const easyparcel = {
    shipments: [
      { shipmentNumber: "ES-2608-MGPMS", awbNumber: "7328089358633416", costSen: 649 },
      { shipmentNumber: "ES-2608-OTHER", awbNumber: "1111111111111111", costSen: 800 }
    ]
  };

  const result = matchCourierCostsToOrders(shopify, easyparcel);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.unmatchedCount, 1);
  assert.equal(result.matchedCourierCostSen, 649);
  assert.equal(result.unmatchedCourierCostSen, 800);
  assert.equal(result.perOrder[0].orderName, "#1178");
  assert.equal(result.perOrder[0].courierCostSen, 649);
  // An unmatched shipment is surfaced, never silently dropped.
  assert.equal(result.unattributed[0].shipmentNumber, "ES-2608-OTHER");
  assert.equal(result.unattributed[0].orderId, null);
});

test("totals every shipment whether or not it matched an order", () => {
  const easyparcel = { shipments: [
    { shipmentNumber: "A", awbNumber: "1", costSen: 500 },
    { shipmentNumber: "B", awbNumber: "2", costSen: 700 }
  ] };
  const result = matchCourierCostsToOrders({ orders: [] }, easyparcel);
  assert.equal(result.matchedCourierCostSen + result.unmatchedCourierCostSen, 1200);
});
