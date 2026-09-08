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

test("balances a refund-only day where refunds exceed new sales", () => {
  // No new orders; a MYR 200 refund of a prior-day order lands today.
  const preview = buildJournalPreview({
    currency: "MYR",
    localDate: "2026-09-06",
    revenue: { productSalesSen: 0, shippingIncomeSen: 0, discountsSen: 0, refundsSen: 20000, taxesSen: 0 },
    cogsSen: 0,
    cogsReversalSen: 6000,
    courierSen: 0,
    metaAdsSen: 0,
    payments: []
  }, { stripe: -20000 });

  assert.equal(preview.debitsSen, preview.creditsSen);
  assert.equal(preview.revenue.netRevenueSen, -20000);
  assert.equal(preview.directCosts.netCogsSen, -6000);
  // Refund reverses revenue and reverses COGS: -20000 + 6000 = -14000.
  assert.equal(preview.netProfitSen, -14000);
  const clearing = preview.journalLines.find((line) => line.accountKey === "stripe_clearing");
  assert.deepEqual({ debit: clearing.debitSen, credit: clearing.creditSen }, { debit: 0, credit: 20000 });
  const cogsPayable = preview.journalLines.find((line) => line.accountKey === "cogs_payable");
  assert.equal(cogsPayable.debitSen, 6000);
});

test("nets a same-day sale and refund without unbalancing the journal", () => {
  const preview = buildJournalPreview({
    currency: "MYR",
    localDate: "2026-09-06",
    revenue: { productSalesSen: 30000, shippingIncomeSen: 1500, discountsSen: 0, refundsSen: 10000, taxesSen: 0 },
    cogsSen: 9000,
    cogsReversalSen: 3000,
    courierSen: 649,
    metaAdsSen: 8172,
    payments: [{ gateway: "stripe", status: "success", amountSen: 31500 }]
  }, { stripe: 31500 - 10000 - (Math.round(31500 * 0.03) + 100) });

  assert.equal(preview.debitsSen, preview.creditsSen);
  assert.equal(preview.directCosts.netCogsSen, 6000);
  assert.equal(preview.revenue.netRevenueSen, 21500);
});
