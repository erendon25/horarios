import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSuggestiveSalesPlan,
  channelForPosition,
  classifySuggestiveProduct,
  normalizeDirectSalesChannel,
} from './suggestiveSalesGoals.js';

test('clasifica únicamente los tres SKU de venta sugestiva solicitados', () => {
  assert.equal(classifySuggestiveProduct(' VS   Borde de queso '), 'cheeseBorder');
  assert.equal(classifySuggestiveProduct('VS HAZLO CMB V3 CANELITAS'), 'hazloCanelitasV3');
  assert.equal(classifySuggestiveProduct(' vs hazlo cmb v3 crazy '), 'hazloCrazyV3');
  assert.equal(classifySuggestiveProduct('VS Canelitas combo x4'), null);
  assert.equal(classifySuggestiveProduct('VS Crazy combo x4'), null);
  assert.equal(classifySuggestiveProduct('Crazy Pops - Pepperoni'), null);
});

test('normaliza los tres canales directos y las posiciones del horario', () => {
  assert.equal(normalizeDirectSalesChannel('EN LOCAL'), 'SALÓN');
  assert.equal(normalizeDirectSalesChannel('Servicio al auto'), 'DRIVE THRU');
  assert.equal(normalizeDirectSalesChannel('SERV. FILA'), 'SERV. FILA');
  assert.equal(channelForPosition('Servicio'), 'SALÓN');
  assert.equal(channelForPosition('Salón'), 'SALÓN');
  assert.equal(channelForPosition('Drive Thru'), 'DRIVE THRU');
  assert.equal(channelForPosition('Drivethru'), 'DRIVE THRU');
  assert.equal(channelForPosition('Módulo'), 'SERV. FILA');
  assert.equal(channelForPosition('Driver'), null);
  assert.equal(channelForPosition('Driver (repartidor)'), null);
  assert.equal(channelForPosition('Repartidor'), null);
  assert.equal(channelForPosition('Delivery'), null);
});

test('reparte metas enteras exactas únicamente al colaborador programado en salón', () => {
  const history = [{
    date: '2026-08-03',
    suggestiveProducts: {
      cheeseBorder: { 8: { 'SALÓN': 4 } },
      hazloCanelitasV3: { 8: { 'SALÓN': 2 } },
      hazloCrazyV3: { 8: { 'SALÓN': 1 } },
    },
    hourlyTxs: { 8: { 'SALÓN': 10 } },
  }];
  const staff = [{ id: 'ana', name: 'Ana', lastName: 'Pérez', status: 'active' }];
  const schedules = [{
    staffId: 'ana',
    weekKey: '2026-09-07_to_2026-09-13',
    monday: { start: '08:00', end: '15:00', position: 'Servicio' },
  }];
  const plan = buildSuggestiveSalesPlan({
    history,
    schedules,
    staff,
    month: '2026-09',
    targets: { cheeseBorder: 13, hazloCanelitasV3: 7, hazloCrazyV3: 5 },
  });

  assert.deepEqual(plan.totals, { cheeseBorder: 13, hazloCanelitasV3: 7, hazloCrazyV3: 5 });
  const assigned = plan.rows.find((row) => row.assignee === 'Ana Pérez');
  assert.equal(assigned?.channel, 'SALÓN');
  assert.equal(assigned?.schedule, '08:00–15:00');
  assert.ok(plan.rows.every((row) => row.channel === 'SALÓN'));
});

test('conserva la meta de salón y agrupa horas sin colaborador', () => {
  const history = [{
    date: '2026-08-03',
    suggestiveProducts: { cheeseBorder: { 8: { 'DRIVE THRU': 2 }, 9: { 'DRIVE THRU': 2 } } },
    hourlyTxs: { 8: { 'DRIVE THRU': 4 }, 9: { 'DRIVE THRU': 4 } },
  }];
  const plan = buildSuggestiveSalesPlan({
    history,
    month: '2026-09',
    targets: { cheeseBorder: 20, hazloCanelitasV3: 0, hazloCrazyV3: 0 },
    channelRules: { serviceWeightUplift: 0.30, moduleShare: 0 },
  });

  assert.equal(plan.totals.cheeseBorder, 20);
  assert.ok(plan.rows.some((row) => row.missingStaff && row.schedule === '08:00–10:00'));
  assert.equal(plan.unassignedGoals.cheeseBorder, 20);
});

test('asigna el total mensual a salón sin disgregarlo en drive thru ni módulo', () => {
  const history = [{
    date: '2026-08-03',
    suggestiveProducts: {
      cheeseBorder: {
        8: { 'SALÓN': 100, 'DRIVE THRU': 50, 'SERV. FILA': 10 },
      },
    },
    hourlyTxs: { 8: { 'SALÓN': 100, 'DRIVE THRU': 50, 'SERV. FILA': 10 } },
  }];
  const plan = buildSuggestiveSalesPlan({
    history,
    month: '2026-09',
    targets: { cheeseBorder: 100, hazloCanelitasV3: 0, hazloCrazyV3: 0 },
  });

  assert.deepEqual(plan.channelTargets.cheeseBorder, {
    'SALÓN': 100,
  });
  assert.deepEqual(plan.totals, { cheeseBorder: 100, hazloCanelitasV3: 0, hazloCrazyV3: 0 });
  assert.ok(plan.rows.every((row) => row.channel === 'SALÓN'));
});

test('un turno full time acumula las horas altas y bajas de toda su jornada', () => {
  const history = [{
    date: '2026-08-03',
    suggestiveProducts: {
      cheeseBorder: {
        9: { 'SALÓN': 1 },
        10: { 'SALÓN': 1 },
        13: { 'SALÓN': 10 },
        14: { 'SALÓN': 10 },
        18: { 'SALÓN': 1 },
      },
    },
    hourlyTxs: {
      9: { 'SALÓN': 1 },
      10: { 'SALÓN': 1 },
      13: { 'SALÓN': 10 },
      14: { 'SALÓN': 10 },
      18: { 'SALÓN': 1 },
    },
  }];
  const staff = [{ id: 'full-time', name: 'Turno', lastName: 'Completo', modality: 'Full-Time', status: 'active' }];
  const schedules = [{
    staffId: 'full-time',
    weekKey: '2026-09-07_to_2026-09-13',
    monday: { start: '09:00', end: '19:00', position: 'Servicio' },
  }];
  const plan = buildSuggestiveSalesPlan({
    history,
    schedules,
    staff,
    month: '2026-09',
    targets: { cheeseBorder: 92, hazloCanelitasV3: 0, hazloCrazyV3: 0 },
    channelRules: { serviceWeightUplift: 0.30, moduleShare: 0 },
  });

  const fullShift = plan.rows.find((row) => row.assignee === 'Turno Completo');
  assert.equal(fullShift?.schedule, '09:00–19:00');
  assert.deepEqual(fullShift?.coveredHours, [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.equal(fullShift?.goals.cheeseBorder, 23);
  assert.equal(fullShift?.hourlyGoals[9].cheeseBorder, 1);
  assert.equal(fullShift?.hourlyGoals[13].cheeseBorder, 10);
  assert.ok(fullShift.hourlyGoals[13].cheeseBorder > fullShift.hourlyGoals[9].cheeseBorder);
});

test('un Driver repartidor no recibe la meta de Drive Thru', () => {
  const history = [{
    date: '2026-08-07',
    suggestiveProducts: { cheeseBorder: { 17: { 'DRIVE THRU': 10 } } },
    hourlyTxs: { 17: { 'DRIVE THRU': 10 } },
  }];
  const staff = [{ id: 'jeremy', name: 'Jeremy', status: 'active' }];
  const schedules = [{
    staffId: 'jeremy',
    weekKey: '2026-09-07_to_2026-09-13',
    friday: { start: '16:15', end: '01:00', position: 'Driver' },
  }];
  const plan = buildSuggestiveSalesPlan({
    history,
    schedules,
    staff,
    month: '2026-09',
    targets: { cheeseBorder: 40, hazloCanelitasV3: 0, hazloCrazyV3: 0 },
    channelRules: { serviceWeightUplift: 0.30, moduleShare: 0 },
  });

  assert.equal(plan.rows.some((row) => row.assignee === 'Jeremy'), false);
  assert.equal(plan.unassignedGoals.cheeseBorder, 40);
  assert.ok(plan.rows.every((row) => row.missingStaff));
});

test('no confunde el json vacío legado con un día cubierto por histórico de SKU', () => {
  const plan = buildSuggestiveSalesPlan({
    history: [
      { date: '2026-08-03', suggestiveProducts: {}, hourlyTxs: { 8: { 'SALÓN': 10 } } },
      { date: '2026-08-04', suggestiveProducts: { cheeseBorder: {}, hazloCanelitasV3: {}, hazloCrazyV3: {} }, hourlyTxs: { 8: { 'SALÓN': 10 } } },
    ],
    month: '2026-09',
    targets: { cheeseBorder: 0, hazloCanelitasV3: 0, hazloCrazyV3: 0 },
  });

  assert.equal(plan.coveredDays, 1);
});
