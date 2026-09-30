const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

export function mapSalesHistoryRow(row) {
  const canonicalTransactions = object(row?.hourly_transactions);
  return {
    ...(object(row?.legacy_data)),
    totalSales: row?.sales_amount ?? null,
    totalTxs: row?.transactions ?? null,
    hourlyData: object(row?.hourly_data),
    hourlyTxs: Object.keys(canonicalTransactions).length
      ? canonicalTransactions
      : object(object(row?.source_data).hourlyTxs),
    suggestiveProducts: object(row?.suggestive_products),
    date: row?.sales_date,
    updatedAt: row?.updated_at,
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
  };
}
