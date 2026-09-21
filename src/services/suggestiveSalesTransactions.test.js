import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTransactionSuggestiveSalesPlan } from './suggestiveSalesGoals.js';

const date = '2026-09-07';
const goalsSum = (goals) => Object.values(goals).reduce((sum, value) => sum + value, 0);
const historicalDay = (overrides = {}) => ({
  date, totalTxs: 1000,
  hourlyTxs: { 9: { 'SALÓN': 60 }, 13: { 'SALÓN': 540 } },
  suggestiveProducts: {
    cheeseBorder: { 9: { 'SALÓN': 60, 'DRIVE THRU': 9000 } },
    hazloCanelitasV3: { 9: { 'SALÓN': 30 } },
    hazloCrazyV3: { 9: { 'SALÓN': 10 } },
  }, ...overrides,
});
const schedule = (id, start, end, position = 'Salón') => ({
  staffId: id, weekKey: '2026-09-07_to_2026-09-13', monday: { start, end, position },
});
const calculate = (data = {}) => buildTransactionSuggestiveSalesPlan({
  month: '2026-09', history: [historicalDay()], ...data,
});

test('el histórico de combos x4 no cuenta como ventas ni mezcla de HAZLO V3', () => {
  const plan = calculate({ history: [historicalDay({ suggestiveProducts: {
    cheeseBorder: { 9: { 'SALÓN': 10 } },
    canelitas4: { 9: { 'SALÓN': 900 } }, crazy4: { 9: { 'SALÓN': 900 } },
  } })] });
  const day = plan.daily.find((item) => item.date === date);
  assert.equal(day.mixSource, 'equal');
  assert.deepEqual(day.goals, { cheeseBorder: 60, hazloCanelitasV3: 60, hazloCrazyV3: 60 });
  assert.equal(plan.metrics.actualParticipation, null);
  assert.equal(plan.coveredDays, 0);
});

test('1000 TRX producen 180 unidades conjuntas; ni +30% ni 30% por SKU', () => {
  const plan = calculate();
  const day = plan.daily.find((item) => item.date === date);
  assert.equal(day.salonTransactions, 600);
  assert.equal(day.totalGoal, 180);
  assert.deepEqual(day.goals, { cheeseBorder: 108, hazloCanelitasV3: 54, hazloCrazyV3: 18 });
  assert.equal(plan.metrics.actualParticipation, 100 / 600);
  assert.ok(plan.rows.every((row) => row.channel === 'SALÓN'));
});

test('el porcentaje configurable recalcula el total, acepta decimales y respeta cero', () => {
  for (const [participation, expected] of [[0, 0], [0.25, 150], [0.255, 153], [0.35, 210], [1, 600]]) {
    const plan = calculate({ participation });
    const day = plan.daily.find((item) => item.date === date);
    assert.equal(day.totalGoal, expected);
    assert.equal(goalsSum(day.goals), expected);
    assert.equal(plan.rows.filter((row) => row.date === date).reduce((sum, row) => sum + goalsSum(row.goals), 0), expected);
  }
  for (const participation of [-0.01, 1.01, NaN]) {
    assert.throws(() => calculate({ participation }), /entre 0% y 100%/);
  }
});

test('las TRX por hora determinan la demanda del turno completo', () => {
  const plan = calculate({
    staff: [{ id: 'full', name: 'Full', status: 'active' }],
    schedules: [schedule('full', '09:00', '19:00')],
  });
  const row = plan.rows.find((item) => item.date === date && item.assigneeId === 'full');
  assert.equal(goalsSum(row.goals), 180);
  assert.equal(goalsSum(row.hourlyGoals[9]), 18);
  assert.equal(goalsSum(row.hourlyGoals[13]), 162);
});

test('una cobertura de 15 minutos recibe 1/4 de la hora y conserva el resto sin asignar', () => {
  const plan = calculate({
    history: [historicalDay({ hourlyTxs: { 9: { 'SALÓN': 600 } } })],
    staff: [{ id: 'partial', name: 'Partial', status: 'active' }],
    schedules: [schedule('partial', '09:00', '09:15')],
  });
  const rows = plan.rows.filter((item) => item.date === date);
  assert.equal(goalsSum(rows.find((item) => item.assigneeId === 'partial').goals), 45);
  assert.equal(rows.filter((item) => item.missingStaff).reduce((sum, row) => sum + goalsSum(row.goals), 0), 135);
});

test('dos turnos coincidentes comparten la franja, drive thru y módulo quedan excluidos', () => {
  const plan = calculate({
    staff: ['a', 'b', 'drive', 'module'].map((id) => ({ id, status: 'active' })),
    schedules: [schedule('a', '09:00', '19:00'), schedule('b', '09:00', '19:00'),
      schedule('drive', '09:00', '19:00', 'Drive Thru'), schedule('module', '09:00', '19:00', 'Módulo')],
  });
  const rows = plan.rows.filter((item) => item.date === date);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => goalsSum(row.goals)), [90, 90]);
});

test('la meta conserva la suma diaria y mensual incluso al redondear cantidades pequeñas', () => {
  const history = Array.from({ length: 30 }, (_, index) => historicalDay({
    date: `2026-09-${String(index + 1).padStart(2, '0')}`, totalTxs: index + 1,
  }));
  const plan = calculate({ history });
  for (const day of plan.daily) {
    const rows = plan.rows.filter((row) => row.date === day.date);
    assert.equal(day.totalGoal, Math.ceil(day.transactions * 0.18 - 1e-9));
    for (const product of Object.keys(day.goals)) {
      assert.equal(rows.reduce((sum, row) => sum + row.goals[product], 0), day.goals[product]);
    }
  }
  assert.equal(plan.rows.reduce((sum, row) => sum + goalsSum(row.goals), 0), plan.metrics.totalGoal);
});

test('distingue TRX registradas, configuradas, estimadas y días sin datos; respeta cero explícito', () => {
  const plan = calculate({ monthlyData: { 1: { txs: 0 }, 2: { txs: 200 }, 7: { txs: 9000 } } });
  assert.equal(plan.daily[0].transactionSource, 'configured');
  assert.equal(plan.daily[0].totalGoal, 0);
  assert.equal(plan.daily[1].totalGoal, 36);
  assert.equal(plan.daily[2].transactionSource, 'missing');
  assert.equal(plan.daily[6].transactionSource, 'recorded');
  assert.equal(plan.daily[6].totalGoal, 180);
  assert.equal(plan.daily[7].transactionSource, 'estimated');
});

test('sin TRX no inventa metas; sin detalle horario conserva meta sin asignarla a personas', () => {
  assert.equal(calculate({ history: [] }).metrics.totalGoal, 0);
  const plan = calculate({ history: [historicalDay({ hourlyTxs: {} })],
    staff: [{ id: 'a', status: 'active' }], schedules: [schedule('a', '09:00', '19:00')] });
  const rows = plan.rows.filter((row) => row.date === date);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].missingStaff, true);
  assert.equal(goalsSum(rows[0].goals), 180);
  assert.ok(plan.metrics.untimedDays > 0);
});

test('el indicador medido usa las mismas fechas con TRX y los tres SKU, sin mezclar otros canales', () => {
  const plan = calculate({ history: [historicalDay(), historicalDay({
    date: '2026-09-08', suggestiveProducts: {}, totalTxs: 10000,
  })] });
  assert.equal(plan.coveredDays, 1);
  assert.equal(plan.metrics.measuredSalonTrx, 600);
  assert.equal(plan.metrics.actualUnits, 100);
});
