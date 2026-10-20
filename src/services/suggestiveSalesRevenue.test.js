import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRevenueSuggestiveSalesPlan, discoverSuggestiveChannels } from './suggestiveSalesGoals.js';
import { suggestiveChannelSettings } from './suggestiveChannels.js';
const date = '2026-10-18';
const product = { id: 'chosen', label: 'Producto elegido', price: 29.90 };
const sample = { date, totalSales: 10000, totalTxs: 999999, hourlyData: { 9: { MODULO: 1000, SALÓN: 9000 } } };
const calculate = values => buildRevenueSuggestiveSalesPlan({ month: '2026-10', history: [sample],
  monthlyData: { 18: { vta: 32399.83 } }, products: [product], channels: ['MODULO'], participation: 0.30, ...values });
const shift = (id, start = '09:00', end = '10:00', extra = {}) => ({ staffId: id, weekKey: '2026-10-12_to_2026-10-18', sunday: { start, end, position: 'Módulo', ...extra } });
const people = (...ids) => ids.map(id => ({ id, name: id, status: 'active' }));
const rowsOnDate = plan => plan.rows.filter(row => row.date === date);
const day = plan => plan.daily.find(row => row.date === date);

test('32399.83 × 10% × 30% ÷ 29.90 requiere 33 productos; las TRX no afectan el cálculo', () => {
  const plan = calculate();
  assert.equal(day(plan).channels[0].share, 0.1);
  assert.equal(day(plan).channels[0].channelSalesGoal, 3239.983);
  assert.ok(Math.abs(day(plan).channels[0].suggestiveRevenue - 971.9949) < 1e-8);
  assert.equal(day(plan).goals.chosen, 33);
  assert.equal(rowsOnDate(plan).reduce((sum, row) => sum + row.goals.chosen, 0), 33);
  assert.equal(plan.targets.chosen, 33);
  assert.equal(calculate({ history: [{ ...sample, totalTxs: 1 }] }).targets.chosen, 33);
});

test('sólo evalúa los cuatro canales autorizados y mantiene los demás en el denominador', () => {
  const history = [{ ...sample, hourlyData: { 9: { 'Canal nuevo': 1000, MODULO: 1000, SALÓN: 3000, DELIVERY: 5000 } } }];
  assert.deepEqual(discoverSuggestiveChannels(history), ['SALÓN', 'SERV. FILA']);
  const plan = calculate({ history, channels: ['MODULO', 'DELIVERY', 'CANAL NUEVO'] });
  assert.deepEqual(plan.channels.map(channel => channel.id), ['SERV. FILA']);
  assert.equal(day(plan).channels[0].share, 0.1);
  assert.equal(day(plan).goals.chosen, 33);
});

test('Salón y Módulo reciben metas independientes de 30% y sus propios colaboradores, usando la venta total de todos los canales', () => {
  const history = [{ ...sample, hourlyData: { 9: { SALÓN: 6000, MODULO: 1000, 'SERV. AUTO': 500,
    'DRIVE THRU': 500, DELIVERY: 2000 } } }];
  const plan = calculate({ history, monthlyData: { 18: { vta: 10000 } }, channels: suggestiveChannelSettings(),
    products: [{ ...product, price: 10, participation: 0.30 }, { id: 'second', label: 'Segundo', price: 20, participation: 0.30 }],
    staff: people('salon', 'module', 'drive', 'auto', 'driver'), schedules: [
      shift('salon', '09:00', '10:00', { position: 'Salón' }),
      shift('module', '09:00', '10:00', { position: ' mo\u0301dulo#2 ' }),
      shift('drive', '09:00', '10:00', { position: 'Drive Thru' }),
      shift('auto', '09:00', '10:00', { position: 'Servicio al auto' }),
      shift('driver', '09:00', '10:00', { position: 'Driver' }),
    ] });
  assert.deepEqual(plan.channels.map(channel => channel.id), ['SALÓN', 'SERV. FILA']);
  assert.deepEqual(day(plan).channels.map(channel => [channel.id, channel.share, channel.channelSalesGoal]),
    [['SALÓN', 0.6, 6000], ['SERV. FILA', 0.1, 1000]]);
  assert.deepEqual(day(plan).channels.map(channel => [channel.id, channel.suggestiveRevenueByProduct.chosen,
    channel.suggestiveRevenueByProduct.second]), [['SALÓN', 1800, 1800], ['SERV. FILA', 300, 300]]);
  assert.deepEqual(rowsOnDate(plan).map(row => [row.assigneeId, row.channel, row.goals.chosen, row.goals.second]),
    [['salon', 'SALÓN', 180, 90], ['module', 'SERV. FILA', 30, 15]]);
  assert.equal(plan.metrics.unassignedTotal, 0);
  assert.deepEqual(plan.metrics.productParticipation, { chosen: 0.30, second: 0.30 });
  assert.ok(rowsOnDate(plan).every(row => !['drive', 'auto', 'driver'].includes(row.assigneeId)));
});

test('dos colaboradores simultáneos comparten 33 unidades exactas sin duplicarlas', () => {
  const plan = calculate({ staff: people('a', 'b'), schedules: [shift('a'), shift('b')] });
  assert.deepEqual(rowsOnDate(plan).map(row => row.goals.chosen), [17, 16]);
  assert.equal(plan.metrics.unassignedTotal, 0);
});

test('cada producto conserva su propia participación al calcular y serializar las metas enteras', () => {
  const plan = calculate({ participation: 0.05, products: [{ ...product, participation: 0.30 },
    { id: 'another', label: 'Otro producto', price: 29.90, participation: 0.20 }],
  staff: people('a', 'b'), schedules: [shift('a'), shift('b')] });
  assert.equal(day(plan).goals.chosen, 33);
  assert.equal(day(plan).goals.another, 22);
  assert.deepEqual(rowsOnDate(plan).map(row => [row.goals.chosen, row.goals.another]), [[17, 11], [16, 11]]);
  assert.equal(day(plan).channels[0].suggestiveRevenue, null, 'Different product targets have no shared monetary target');
  assert.ok(Math.abs(day(plan).channels[0].suggestiveRevenueByProduct.chosen - 971.9949) < 1e-8);
  assert.ok(Math.abs(day(plan).channels[0].suggestiveRevenueByProduct.another - 647.9966) < 1e-8);
  assert.deepEqual(plan.metrics.productParticipation, { chosen: 0.30, another: 0.20 });
  assert.deepEqual(JSON.parse(JSON.stringify(plan.products)).map(product => product.participation), [0.30, 0.20]);
});

test('la meta cero explícita se conserva y una meta vacía no se sustituye por el porcentaje global', () => {
  const zero = calculate({ products: [{ ...product, participation: 0 }] });
  assert.equal(zero.targets.chosen, 0);
  assert.equal(day(zero).channels[0].suggestiveRevenueByProduct.chosen, 0);
  assert.equal(calculate({ participation: 0.20 }).targets.chosen, 22, 'A missing product rate uses the global fallback');
  for (const participation of ['', null, NaN, -0.1, 1.1]) {
    assert.throws(() => calculate({ products: [{ ...product, participation }] }), /porcentaje/);
  }
});

test('el reparto automático ignora overrides antiguos y unifica variantes de la posición', () => {
  const plan = calculate({ channels: [{ id: 'SERV. FILA', enabled: true, positions: ['Cocina', 'Salón'] }],
    staff: people('a', 'b', 'cook', 'salon'), schedules: [
      shift('a', '09:00', '10:00', { position: ' mo\u0301dulo #2 ' }),
      shift('b', '09:00', '10:00', { position: 'SERV.FILA' }),
      shift('cook', '09:00', '10:00', { position: 'Cocina' }),
      shift('salon', '09:00', '10:00', { position: 'Salón' }),
    ] });
  assert.deepEqual(rowsOnDate(plan).map(row => [row.assigneeId, row.goals.chosen]), [['a', 17], ['b', 16]]);
  assert.equal(plan.metrics.unassignedTotal, 0);
  assert.ok(plan.channels.every(channel => !Object.hasOwn(channel, 'positions')));
});

test('cada uno de los cuatro canales usa sólo su posición correspondiente aunque existan overrides cruzados', () => {
  const channelNames = ['SALÓN', 'DRIVE THRU', 'SERV. FILA', 'SERV. AUTO'];
  const history = [{ ...sample, hourlyData: { 9: { SALÓN: 1000, 'DRIVE THRU': 1000, 'SERV. FILA': 1000, 'SERV. AUTO': 1000, DELIVERY: 6000 } } }];
  const plan = calculate({ history, channels: channelNames.map(id => ({ id, enabled: true, positions: ['Cocina'] })),
    staff: people('salon', 'drive', 'fila', 'auto', 'cook'), schedules: [
      shift('salon', '09:00', '10:00', { position: 'Servicio' }),
      shift('drive', '09:00', '10:00', { position: 'Drivethru#2' }),
      shift('fila', '09:00', '10:00', { position: 'Módulo' }),
      shift('auto', '09:00', '10:00', { position: 'Servicio al auto #3' }),
      shift('cook', '09:00', '10:00', { position: 'Cocina' }),
    ] });
  assert.deepEqual(rowsOnDate(plan).map(row => [row.assigneeId, row.channel, row.goals.chosen]), [
    ['drive', 'DRIVE THRU', 33], ['salon', 'SALÓN', 33], ['auto', 'SERV. AUTO', 33], ['fila', 'SERV. FILA', 33],
  ]);
  assert.equal(plan.targets.chosen, 132);
  assert.equal(plan.metrics.unassignedTotal, 0);
});

test('una cobertura parcial conserva sin asignar las unidades del tiempo descubierto', () => {
  const plan = calculate({ staff: people('a'), schedules: [shift('a', '09:00', '09:15')] });
  assert.equal(rowsOnDate(plan).find(row => row.assigneeId === 'a').goals.chosen, 8);
  assert.equal(plan.unassignedGoals.chosen, 25);
  assert.equal(rowsOnDate(plan).reduce((sum, row) => sum + row.goals.chosen, 0), 33);
});

test('usa posiciones temporales del horario y reparte cada minuto una sola vez', () => {
  const plan = calculate({ staff: people('a', 'b'), schedules: [shift('a'), shift('b', '09:00', '10:00', {
    position: 'Salón', positionAssignments: [{ start: 570, end: 600, position: 'Módulo' }],
  })] });
  assert.deepEqual(rowsOnDate(plan).map(row => row.goals.chosen), [25, 8]);
});

test('excluye el refrigerio y conserva sus cantidades como cobertura pendiente', () => {
  const plan = calculate({ staff: [{ ...people('a')[0], modality: 'Full-Time' }], schedules: [shift('a', '06:15', '15:00', { breakStart: '09:15' })] });
  assert.equal(rowsOnDate(plan).find(row => row.assigneeId === 'a').goals.chosen, 8);
  assert.equal(plan.unassignedGoals.chosen, 25);
});

test('madrugada pertenece al mismo día comercial del turno nocturno', () => {
  const plan = calculate({ history: [{ ...sample, hourlyData: { 0: { MODULO: 1000, SALÓN: 9000 } } }],
    staff: people('a'), schedules: [shift('a', '23:00', '01:00')] });
  assert.equal(rowsOnDate(plan).find(row => row.assigneeId === 'a').goals.chosen, 33);
  assert.deepEqual(rowsOnDate(plan)[0].coveredHours, [0]);
  assert.equal(plan.metrics.unassignedTotal, 0);
});

test('sin reporte del día usa el histórico del mismo día de semana sin anticipar reportes futuros', () => {
  const plan = calculate({ history: [{ ...sample, date: '2026-10-11' }, { ...sample, date: '2026-10-19', hourlyData: { 9: { MODULO: 10000 } } }] });
  assert.equal(day(plan).shareSource, 'same-weekday');
  assert.deepEqual(day(plan).sampleDates, ['2026-10-11']);
  assert.equal(day(plan).channels[0].share, 0.1);
});

test('sin meta monetaria o histórico no inventa porcentajes ni sustituye venta por tickets', () => {
  assert.equal(calculate({ monthlyData: { 18: { txs: 9000 } } }).targets.chosen, 0);
  assert.equal(day(calculate({ history: [] })).channels[0].share, null);
  assert.ok(calculate({ history: [] }).metrics.missingHistoryDates.includes(date));
  const zero = calculate({ monthlyData: { 18: { vta: 0 } } });
  assert.equal(day(zero).salesGoal, 0); assert.equal(zero.targets.chosen, 0);
});

test('varios productos y canales conservan cada suma diaria, mensual y horaria en enteros', () => {
  const plan = calculate({ products: [product, { id: 'another', label: 'Otro producto', price: 7.5 }], channels: ['MODULO', 'SALÓN'],
    staff: people('a', 'b'), schedules: [shift('a'), shift('b', '09:00', '10:00', { position: 'Servicio' })] });
  for (const id of ['chosen', 'another']) {
    assert.equal(plan.rows.reduce((sum, row) => sum + row.goals[id], 0), plan.targets[id]);
    for (const row of plan.rows) {
      assert.ok(Number.isSafeInteger(row.goals[id]));
      assert.equal(Object.values(row.hourlyGoals).reduce((sum, goals) => sum + goals[id], 0), row.goals[id]);
    }
  }
});

test('valida precios, productos duplicados y participación antes de calcular', () => {
  for (const price of [0, -1, '', NaN]) assert.throws(() => calculate({ products: [{ ...product, price }] }), /precio/);
  assert.throws(() => calculate({ products: [product, product] }), /producto/);
  for (const participation of [-0.1, 1.1, NaN]) assert.throws(() => calculate({ participation }), /porcentaje/);
});

test('el panel del colaborador toma los nombres y precios de los productos publicados', async () => {
  const { publishedSuggestiveProducts, channelDisplayName } = await import('./suggestiveSalesGoals.js');
  const configured = { id: 'custom', label: 'Producto elegido', price: 29.9 };
  const assignment = { goals: { custom: 33 }, monthly_targets: { calculation: { basis: 'channel_sales_revenue', products: [configured] } } };
  assert.deepEqual(publishedSuggestiveProducts([assignment]), [configured]);
  assert.equal(channelDisplayName('MÓDULO'), 'Módulo');
  assert.equal(channelDisplayName('CANAL NUEVO'), 'CANAL NUEVO');
});


test('SERV. AUTO conserva participación y colaboradores separados de DRIVE THRU', () => {
  const history = [{ ...sample, hourlyData: { 9: { 'Servicio al auto': 2000, 'DRIVE THRU': 1000, SALÓN: 7000 } } }];
  const plan = calculate({ history, channels: ['SERV. AUTO', 'DRIVE THRU'], staff: people('auto', 'drive'),
    schedules: [shift('auto', '09:00', '10:00', { position: 'Servicio al auto' }), shift('drive', '09:00', '10:00', { position: 'Drive Thru' })] });
  assert.deepEqual(day(plan).channels.map(channel => [channel.id, channel.share, channel.goals.chosen]), [['SERV. AUTO', 0.2, 66], ['DRIVE THRU', 0.1, 33]]);
  assert.deepEqual(rowsOnDate(plan).map(row => [row.assigneeId, row.channel, row.goals.chosen]), [['drive', 'DRIVE THRU', 33], ['auto', 'SERV. AUTO', 66]]);
});

test('un canal sin reportes se señala sin asignarle una participación cero inventada', () => {
  const plan = calculate({ channels: ['SERV. AUTO'] });
  assert.equal(day(plan).channels[0].share, null);
  assert.equal(day(plan).channels[0].channelSalesGoal, null);
  assert.equal(plan.targets.chosen, 0);
  assert.ok(plan.metrics.missingChannelDates.some(item => item.date === date && item.channel === 'SERV. AUTO'));
});

test('verifica el nombre exacto de Producto por fecha y canal sin recurrir al SKU antiguo', () => {
  const reportName = 'VS Producto exacto';
  const recorded = { ...sample, productSalesRecorded: true, productSales: [
    { name: reportName, hour: 9, channel: 'MODULO', quantity: 7 },
    { name: reportName, hour: 10, channel: 'SERV. FILA', quantity: 3 },
    { name: reportName, hour: 9, channel: 'SALÓN', quantity: 90 },
    { name: reportName.toLowerCase(), hour: 9, channel: 'SERV. FILA', quantity: 500 },
  ], suggestiveProducts: { chosen: { 9: { MODULO: 999 } } } };
  const plan = calculate({ products: [{ ...product, label: reportName, reportName }], history: [recorded] });
  assert.equal(day(plan).actual.chosen, 10);
  assert.equal(day(plan).hasProductHistory.chosen, true);
  assert.equal(day(plan).channels[0].actual.chosen, 10);
  assert.equal(day(plan).channels[0].pending.chosen, 23);
  assert.equal(plan.summaries[0].actual, 10);
  assert.equal(plan.summaries[0].hasHistory, true);
});

test('distingue cero vendido verificado de un reporte antiguo sin detalle exacto', () => {
  const named = { ...product, reportName: 'Nombre sin ventas' };
  const missing = calculate({ products: [named], history: [{ ...sample, suggestiveProducts: { chosen: { 9: { MODULO: 999 } } } }] });
  assert.equal(day(missing).hasProductHistory.chosen, false);
  assert.equal(day(missing).channels[0].actual.chosen, null);
  assert.equal(missing.summaries[0].hasHistory, false);
  const zero = calculate({ products: [named], history: [{ ...sample, productSalesRecorded: true, productSales: [] }] });
  assert.equal(day(zero).hasProductHistory.chosen, true);
  assert.equal(day(zero).actual.chosen, 0);
  assert.equal(day(zero).channels[0].pending.chosen, 33);
});

test('mantiene cantidades de SKU sólo para configuraciones históricas sin reportName', () => {
  const plan = calculate({ history: [{ ...sample, suggestiveProducts: { chosen: { 9: { MODULO: 5 } } } }] });
  assert.equal(plan.summaries[0].actual, 5);
  assert.equal(day(plan).actual.chosen, 5);
});

test('los nombres exactos son editables y no permiten duplicados NFC ni vacíos', () => {
  assert.throws(() => calculate({ products: [{ ...product, reportName: '' }] }), /nombre exacto/);
  assert.throws(() => calculate({ products: [{ ...product, reportName: 'Café' }, { id: 'other', label: 'Otra', price: 29.90, reportName: 'Cafe\u0301 ' }] }), /nombre exacto/);
  const plan = calculate({ products: [{ ...product, reportName: 'Producto' }, { id: 'other', label: 'Otra', price: 29.90, reportName: 'producto' }] });
  assert.equal(plan.products.length, 2, 'Different case remains a different literal report name');
});
