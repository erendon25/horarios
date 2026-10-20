const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

export function mapSalesHistoryRow(row) {
  const canonicalTransactions = object(row?.hourly_transactions);
  const source = object(row?.source_data);
  return {
    ...(object(row?.legacy_data)),
    totalSales: row?.sales_amount ?? null,
    totalTxs: row?.transactions ?? null,
    hourlyData: object(row?.hourly_data),
    hourlyTxs: Object.keys(canonicalTransactions).length
      ? canonicalTransactions
      : object(object(row?.source_data).hourlyTxs),
    suggestiveProducts: object(row?.suggestive_products),
    ...(Array.isArray(source.productSales) ? {
      productSales: source.productSales,
      productSalesRecorded: source.productSalesRecorded === true,
      productRevenueRecorded: source.productRevenueRecorded === true,
    } : {}),
    date: row?.sales_date,
    updatedAt: row?.updated_at,
    ...(source.businessDateVersion === 1 && source.salesDayBasis === 'business-06:00'
      ? { businessDateVersion: 1, salesDayBasis: 'business-06:00' } : {}),
  };
}

export function salesHistoryDayPayload(date, data = {}) {
  return {
    date,
    totalSales: Number(data.totalSales ?? 0),
    totalTxs: Number(data.totalTxs ?? 0),
    hourlyData: object(data.hourlyData),
    hourlyTxs: object(data.hourlyTxs),
    suggestiveProducts: object(data.suggestiveProducts),
    ...(Array.isArray(data.productSales) ? {
      productSales: data.productSales,
      productSalesRecorded: data.productSalesRecorded === true,
      productRevenueRecorded: data.productRevenueRecorded === true,
    } : {}),
    ...(data.businessDateVersion === 1 && data.salesDayBasis === 'business-06:00'
      ? { businessDateVersion: 1, salesDayBasis: 'business-06:00' } : {}),
  };
}
