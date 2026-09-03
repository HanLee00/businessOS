import test from "node:test";
import assert from "node:assert/strict";
import { buildJournalPreview, calculateDailyPnl } from "../src/calculation.mjs";
import { resolveAccountIds } from "../src/accounts.mjs";

const snapshot = {
  currency: "MYR",
  localDate: "2026-09-01",
  revenue: {
    productSalesSen: 10000,
    shippingIncomeSen: 1000,
    discountsSen: 500,
    refundsSen: 0,
    taxesSen: 0
  },
  cogsSen: 3000,
  courierSen: 650,
  metaAdsSen: 2000,
  payments: [
    { gateway: "stripe", status: "success", amountSen: 7000 },
    { gateway: "billplz", status: "success", amountSen: 3500 },
    { gateway: "stripe", status: "failed", amountSen: 9999 }
  ]
};

test("calculates the confirmed payment and Meta-derived costs", () => {
  const result = calculateDailyPnl(snapshot);
  assert.equal(result.operatingExpenses.stripeFeesSen, 310);
  assert.equal(result.operatingExpenses.billplzFeesSen, 125);
  assert.equal(result.operatingExpenses.metaPlatformFeesSen, 160);
  assert.equal(result.directCosts.packagingSen, 40);
  assert.equal(result.netProfitSen, 4215);
});

test("builds a balanced draft journal", () => {
  const result = buildJournalPreview(snapshot, { stripe: 6690, billplz: 3375 });
  assert.equal(result.status, "draft");
  assert.equal(result.debitsSen, result.creditsSen);
  assert.equal(result.reference, "OHV-PNL-2026-09-01");
});

test("resolves every journal line to an approved Zoho account", () => {
  const preview = buildJournalPreview(snapshot, { stripe: 6690, billplz: 3375 });
  const resolved = resolveAccountIds(preview);
  assert.ok(resolved.journalLines.every((line) => /^\d+$/.test(line.accountId)));
});

test("blocks a settlement mismatch", () => {
  assert.throws(
    () => buildJournalPreview(snapshot, { stripe: 1 }),
    /does not equal expected settlement/
  );
});

test("blocks non-MYR data", () => {
  assert.throws(() => calculateDailyPnl({ ...snapshot, currency: "USD" }), /Expected MYR/);
});

test("blocks an invalid local date", () => {
  assert.throws(() => calculateDailyPnl({ ...snapshot, localDate: "09/01/2026" }), /localDate/);
});

test("rounds percentage rules to the nearest sen", () => {
  const result = calculateDailyPnl({ ...snapshot, metaAdsSen: 101 });
  assert.equal(result.operatingExpenses.metaPlatformFeesSen, 8);
  assert.equal(result.directCosts.packagingSen, 2);
});
