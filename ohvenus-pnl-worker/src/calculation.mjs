const MYR = "MYR";

function integer(value, field) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${field} must be an integer number of sen`);
  }
  return value;
}

function nonNegative(value, field) {
  value = integer(value, field);
  if (value < 0) throw new Error(`${field} cannot be negative`);
  return value;
}

function percent(amount, basisPoints) {
  return Math.round((amount * basisPoints) / 10_000);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function assertCurrency(snapshot) {
  if (snapshot.currency !== MYR) {
    throw new Error(`Expected MYR, received ${snapshot.currency || "no currency"}`);
  }
}

function paymentFees(payments) {
  const fees = { stripe: 0, billplz: 0 };
  for (const payment of payments) {
    if (payment.status !== "success") continue;
    const amount = nonNegative(payment.amountSen, "payment.amountSen");
    const gateway = String(payment.gateway || "").toLowerCase();
    if (gateway.includes("stripe")) fees.stripe += percent(amount, 300) + 100;
    if (gateway.includes("billplz")) fees.billplz += 125;
  }
  return fees;
}

function addLine(lines, accountKey, debitSen = 0, creditSen = 0) {
  debitSen = nonNegative(debitSen, `${accountKey}.debitSen`);
  creditSen = nonNegative(creditSen, `${accountKey}.creditSen`);
  if (!debitSen && !creditSen) return;
  const current = lines.get(accountKey) || { accountKey, debitSen: 0, creditSen: 0 };
  current.debitSen += debitSen;
  current.creditSen += creditSen;
  lines.set(accountKey, current);
}

export function calculateDailyPnl(snapshot) {
  assertCurrency(snapshot);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.localDate || "")) {
    throw new Error("localDate must use the ISO local-date format");
  }
  const revenue = snapshot.revenue || {};
  const productSalesSen = nonNegative(revenue.productSalesSen || 0, "productSalesSen");
  const shippingIncomeSen = nonNegative(revenue.shippingIncomeSen || 0, "shippingIncomeSen");
  const discountsSen = nonNegative(revenue.discountsSen || 0, "discountsSen");
  const refundsSen = nonNegative(revenue.refundsSen || 0, "refundsSen");
  const taxesSen = nonNegative(revenue.taxesSen || 0, "taxesSen");
  const cogsSen = nonNegative(snapshot.cogsSen || 0, "cogsSen");
  const courierSen = nonNegative(snapshot.courierSen || 0, "courierSen");
  const metaAdsSen = nonNegative(snapshot.metaAdsSen || 0, "metaAdsSen");
  const metaFeeSen = percent(metaAdsSen, 800);
  const packagingSen = percent(metaAdsSen, 200);
  const fees = paymentFees(snapshot.payments || []);

  const netRevenueSen = productSalesSen + shippingIncomeSen - discountsSen - refundsSen;
  if (netRevenueSen < 0) throw new Error("Net revenue cannot be negative");
  const grossProfitSen = netRevenueSen - cogsSen - packagingSen - courierSen;
  const operatingExpensesSen = fees.stripe + fees.billplz + metaAdsSen + metaFeeSen;
  const netProfitSen = grossProfitSen - operatingExpensesSen;

  return {
    currency: MYR,
    localDate: snapshot.localDate,
    reference: `OHV-PNL-${snapshot.localDate}`,
    revenue: { productSalesSen, shippingIncomeSen, discountsSen, refundsSen, netRevenueSen },
    directCosts: { cogsSen, packagingSen, courierSen },
    operatingExpenses: {
      stripeFeesSen: fees.stripe,
      billplzFeesSen: fees.billplz,
      metaAdsSen,
      metaPlatformFeesSen: metaFeeSen,
      totalSen: operatingExpensesSen
    },
    taxesSen,
    grossProfitSen,
    netProfitSen
  };
}

export function buildJournalPreview(snapshot, clearingByGatewaySen) {
  const pnl = calculateDailyPnl(snapshot);
  const lines = new Map();
  const clearing = clearingByGatewaySen || {};
  const clearingTotal = sum(Object.values(clearing).map((v) => nonNegative(v, "clearing")));
  const expectedClearing = pnl.revenue.netRevenueSen + pnl.taxesSen
    - pnl.operatingExpenses.stripeFeesSen - pnl.operatingExpenses.billplzFeesSen;
  if (clearingTotal !== expectedClearing) {
    throw new Error(`Processor clearing ${clearingTotal} does not equal expected settlement ${expectedClearing}`);
  }

  for (const [gateway, amount] of Object.entries(clearing)) {
    addLine(lines, `${gateway.toLowerCase()}_clearing`, amount, 0);
  }
  addLine(lines, "discount", pnl.revenue.discountsSen, 0);
  addLine(lines, "refunds", pnl.revenue.refundsSen, 0);
  addLine(lines, "stripe_fees", pnl.operatingExpenses.stripeFeesSen, 0);
  addLine(lines, "billplz_fees", pnl.operatingExpenses.billplzFeesSen, 0);
  addLine(lines, "sales", 0, pnl.revenue.productSalesSen);
  addLine(lines, "shipping_income", 0, pnl.revenue.shippingIncomeSen);
  addLine(lines, "tax_payable", 0, pnl.taxesSen);

  addLine(lines, "cogs", pnl.directCosts.cogsSen, 0);
  addLine(lines, "inventory_asset", 0, pnl.directCosts.cogsSen);
  addLine(lines, "meta_ads", pnl.operatingExpenses.metaAdsSen, 0);
  addLine(lines, "meta_platform_fees", pnl.operatingExpenses.metaPlatformFeesSen, 0);
  addLine(lines, "meta_payable", 0, pnl.operatingExpenses.metaAdsSen + pnl.operatingExpenses.metaPlatformFeesSen);
  addLine(lines, "packaging_cost", pnl.directCosts.packagingSen, 0);
  addLine(lines, "packaging_cost_accrual", 0, pnl.directCosts.packagingSen);
  addLine(lines, "courier_cost", pnl.directCosts.courierSen, 0);
  addLine(lines, "easyparcel_wallet", 0, pnl.directCosts.courierSen);

  const journalLines = [...lines.values()];
  const debitsSen = sum(journalLines.map((line) => line.debitSen));
  const creditsSen = sum(journalLines.map((line) => line.creditSen));
  if (debitsSen !== creditsSen) {
    throw new Error(`Journal is not balanced: debits ${debitsSen}, credits ${creditsSen}`);
  }
  return { ...pnl, status: "draft", debitsSen, creditsSen, journalLines };
}
