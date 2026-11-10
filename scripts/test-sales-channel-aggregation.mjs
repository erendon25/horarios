import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the actual component's aggregation, including the independent
// production hotfix, without contacting Supabase or duplicating the algorithm.
const path = process.env.SALES_ANALYSIS_SOURCE || 'src/components/SalesAnalysis.jsx';
const source = readFileSync(path, 'utf8');
const constants = [
  source.match(/const TURNOS = \[[\s\S]*?\n\];/)[0],
  source.match(/const CANALES_FIJOS = .*;/)[0],
  source.match(/const DIAS_SEMANA = .*;/)[0],
].join('\n');
const start = source.indexOf('const fetchRange = async (datesArr) => {');
const end = source.indexOf('const uniqueMonths =', start);
assert.ok(start >= 0 && end > start);
const aggregate = source.slice(start, end);
const dates = ['2026-10-23', '2026-10-24'];
const rows = new Map([
  [dates[0], {
    totalSales: 180, totalTxs: 6,
    hourlyData: { 20: null, 21: { 'SERV. AUTO': 90, RAPPI: 70, 'SALÓN': 20 } },
    hourlyTxs: { 21: { 'SERV. AUTO': 2, RAPPI: 1, 'SALÓN': 1 }, 22: { 'SOLO TXS': 2 } },
  }],
  [dates[1], {
    totalSales: 30, totalTxs: 1,
    hourlyData: { 21: { 'SERV. AUTO': '30' } }, hourlyTxs: { 21: { 'SERV. AUTO': '1' } },
  }],
]);
const context = {
  historyByDate: rows, dates, db: {}, storeId: 'qa-store',
  doc: (...parts) => ({ date: parts.at(-1) }),
  getDoc: async ({ date }) => ({ exists: () => rows.has(date), data: () => rows.get(date) }),
};
if (process.env.SALES_CHANNEL_EXPECT_FAILURE === '1') {
  // Reproduce the reported 21:00 failure before applying the production patch.
  delete rows.get(dates[0]).hourlyData[20];
  await assert.rejects(() => vm.runInNewContext(`(async()=>{${constants}\n${aggregate}\nreturn fetchRange(dates)})()`, context), /21/);
  console.log('PASS: original production component reproduces the missing-channel failure at 21:00');
} else {
  const result = await vm.runInNewContext(`(async()=>{${constants}\n${aggregate}\nreturn fetchRange(dates)})()`, context);
  assert.equal(result.total, 210);
  assert.equal(result.txs, 7);
  assert.equal(result.canalesHoras['SERV. AUTO'][21], 120);
  assert.equal(result.canalesHoras.RAPPI[21], 70);
  assert.equal(result.canalesHorasTxs['SERV. AUTO'][21], 3);
  assert.equal(result.canalesHorasTxs['SOLO TXS'][22], 2);
  assert.equal(result.canalesHoras['SOLO TXS'][22], 0);
  assert.equal(result.canalesDias['SERV. AUTO'][5], 90);
  assert.equal(result.canalesDias['SERV. AUTO'][6], 30);
  assert.equal(result.canalesHorasPorFecha['SERV. AUTO'][dates[0]][21], 90);
  assert.equal(result.canalesHorasTxsPorFecha['SOLO TXS'][dates[0]][22], 2);
  assert.equal(result.horasTxs[21], 5);
  assert.equal(result.horasTxs[22], 2);
  assert.equal(result.turnos['7pm a 10pm'], 210);
  assert.equal(result.turnosTxs['10pm al cierre'], 2);
  console.log('PASS: extra channels at 21:00, tx-only hours, missing data, numeric strings, daily/hourly/shift totals and repeated channels');
}
