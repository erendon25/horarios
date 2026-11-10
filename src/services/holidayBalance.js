export function summarizeHolidayLedger(rows = []) {
  return rows.reduce((result, row) => {
    if (row.is_future) {
      result.scheduled += 1;
      if (row.balance_type !== 'compensado') return result;
    }
    result.balance += Number(row.balance_delta) || 0;
    if (row.balance_type === 'compensado') {
      if (row.is_future) result.scheduledCompensations += 1;
      else result.compensated += 1;
    }
    else if (row.payment_method === 'boleta') result.payroll += 1;
    else if (row.balance_type === 'ganado') result.earned += 1;
    return result;
  }, { balance: 0, earned: 0, compensated: 0, payroll: 0, scheduled: 0, scheduledCompensations: 0 });
}

export function holidayMovementLabel(row) {
  if (row.is_future && row.balance_type === 'compensado') return 'Compensación programada · ya descontada';
  if (row.is_future) return row.payment_method === 'boleta' ? 'Programado · boleta' : 'Programado';
  if (row.balance_type === 'compensado') return 'Descanso compensado';
  return row.payment_method === 'boleta' ? 'Destinado a boleta' : 'Acumulado para descanso';
}

export async function readHolidayLedger(client, { staffId, storeId }) {
  if (!staffId && !storeId) throw new Error('Falta identificar el colaborador o la tienda.');
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    let query = client.from('worked_holiday_ledger').select('*').order('id').range(offset, offset + 499);
    if (staffId) query = query.eq('staff_id', staffId);
    if (storeId) query = query.eq('store_id', storeId);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) return rows.sort((a, b) => b.holiday_date.localeCompare(a.holiday_date));
  }
}
