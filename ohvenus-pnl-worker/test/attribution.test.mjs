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
  assert.equal(result.attributedCount, 1);
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

test("matches on the EasyParcel order reference across days", () => {
  // The order was placed on an earlier day, so AWB matching alone would miss it.
  const shopify = { orders: [{ orderId: "O1", orderName: "#1180", trackingNumbers: [] }] };
  const easyparcel = { shipments: [{ shipmentNumber: "ES-2609-4YQQR", awbNumber: "7027093038788956", orderReference: "#1180", costSen: 669 }] };
  const result = matchCourierCostsToOrders(shopify, easyparcel);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.matchedByReferenceCount, 1);
  assert.equal(result.perOrder[0].orderName, "#1180");
  assert.equal(result.perOrder[0].matchedBy, "reference");
});

test("falls back to AWB when EasyParcel carries no reference", () => {
  const shopify = { orders: [{ orderId: "O1", orderName: "#1178", trackingNumbers: ["7328089358633416"] }] };
  const easyparcel = { shipments: [{ shipmentNumber: "ES-1", awbNumber: "7328089358633416", orderReference: null, costSen: 669 }] };
  const result = matchCourierCostsToOrders(shopify, easyparcel);
  assert.equal(result.matchedByAwbCount, 1);
  assert.equal(result.perOrder[0].matchedBy, "awb");
});

test("tolerates a reference written without the hash", () => {
  const shopify = { orders: [{ orderId: "O1", orderName: "#1181", trackingNumbers: [] }] };
  const easyparcel = { shipments: [{ shipmentNumber: "ES-2", awbNumber: null, orderReference: "1181", costSen: 669 }] };
  assert.equal(matchCourierCostsToOrders(shopify, easyparcel).matchedCount, 1);
});

test("still attributes a shipment whose order was placed on another day", () => {
  // Orders normally ship the next day, so this is the common case, not an error.
  const easyparcel = { shipments: [{ shipmentNumber: "ES-3", awbNumber: "X", orderReference: "#1181", costSen: 669 }] };
  const result = matchCourierCostsToOrders({ orders: [] }, easyparcel);
  assert.equal(result.matchedCount, 0);
  assert.equal(result.otherDayCount, 1);
  assert.equal(result.attributedCount, 1);
  assert.equal(result.unmatchedCount, 0);
  assert.equal(result.otherDayCourierCostSen, 669);
  assert.equal(result.attributedToOrderFromAnotherDay[0].orderName, "#1181");
});

test("reports a shipment with no reference at all as genuinely unattributed", () => {
  const easyparcel = { shipments: [{ shipmentNumber: "ES-4", awbNumber: "ZZ", orderReference: null, costSen: 669 }] };
  const result = matchCourierCostsToOrders({ orders: [] }, easyparcel);
  assert.equal(result.unmatchedCount, 1);
  assert.equal(result.attributedCount, 0);
  assert.equal(result.unmatchedCourierCostSen, 669);
});
