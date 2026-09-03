export const ZOHO_ACCOUNT_IDS = Object.freeze({
  sales: "907512000000000388",
  shipping_income: "907512000000014001",
  discount: "907512000000000406",
  refunds: "907512000000114002",
  cogs: "907512000000034003",
  inventory_asset: "907512000000034001",
  stripe_fees: "907512000000115002",
  billplz_fees: "907512000000116002",
  packaging_cost: "907512000000117002",
  courier_cost: "907512000000118002",
  meta_ads: "907512000000119002",
  meta_platform_fees: "907512000000119006",
  stripe_clearing: "907512000000120002",
  billplz_clearing: "907512000000121002",
  other_payment_clearing: "907512000000122002",
  meta_payable: "907512000000110003",
  easyparcel_wallet: "907512000000123002",
  packaging_cost_accrual: "907512000000124002",
  tax_payable: "907512000000000376"
});

export function resolveAccountIds(preview) {
  return {
    ...preview,
    journalLines: preview.journalLines.map((line) => {
      const accountId = ZOHO_ACCOUNT_IDS[line.accountKey];
      if (!accountId) throw new Error(`No approved Zoho account for ${line.accountKey}`);
      return { ...line, accountId };
    })
  };
}
