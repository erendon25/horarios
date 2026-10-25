import assert from 'node:assert/strict';
import test from 'node:test';
import { getProjectionPositionDemand, resolveVestidoPositionId } from './projectionDemand.js';
import { calculatePositionStaffByGeneralVhl } from './projectionVhl.js';

const vestido = { id: 'cocina', name: 'Vestido', logic: 'sales' };
const allocate = (changes = {}) => calculatePositionStaffByGeneralVhl({
  sale: 2000, generalVhl: 500, positions: [vestido], ...changes,
});

test('Vestido usa venta/VHL e ignora su lógica y factor antiguos', () => {
  for (const logic of ['sales', 'service', 'driver', 'fixed']) {
    const result = allocate({ positions: [{ ...vestido, logic, factor: 9, fixedStaff: 20 }] });
    assert.equal(result.generalRequiredStaff, 4);
    assert.equal(result.vestidoStaff, 4);
    assert.equal(result.vestidoPositionId, 'cocina');
    assert.deepEqual(result.requiredByPosition, { cocina: 4 });
    assert.equal(result.totalStaffAtHour, 4);
  }
});

test('otras áreas usan Vestido final limitado, no la proporción bruta de VHL', () => {
  const result = allocate({ sale: 4000, positions: [
    { id: 'sheetout', name: 'Sheetout', logic: 'sales', factor: 0.7 },
    { ...vestido, maxStaff: 5 },
  ] });
  assert.equal(result.generalRequiredStaff, 8);
  assert.equal(result.vestidoStaff, 5);
  assert.deepEqual(result.requiredByPosition, { cocina: 5, sheetout: 4 });
  assert.equal(result.totalStaffAtHour, 9);
});

test('Vestido se redondea antes de aplicar los factores de otras áreas', () => {
  const result = allocate({ sale: 1100, positions: [vestido,
    { id: 'fractional', name: 'Área', logic: 'sales', factor: 0.4 },
  ] });
  assert.equal(result.generalRequiredStaff, 2.2);
  assert.equal(result.vestidoStaff, 3);
  assert.equal(result.requiredByPosition.fractional, 2);
  const whole = allocate({ sale: 25000, positions: [vestido,
    { id: 'whole', logic: 'sales', factor: 0.14 },
  ] });
  assert.equal(whole.requiredByPosition.whole, 7);
});

test('el mínimo de Vestido también forma la base final y respeta horas operativas', () => {
  const positions = [{ ...vestido, minStaff: 3 }, { id: 'area', logic: 'sales', factor: 0.5 }];
  assert.deepEqual(allocate({ sale: 0, positions }).requiredByPosition, { cocina: 3, area: 2 });
  assert.deepEqual(allocate({ sale: 0, positions, isOperativeHour: false }).requiredByPosition, { cocina: 0, area: 0 });
});

test('ajustar Vestido manualmente propaga su cantidad y conserva otros ajustes', () => {
  const positions = [{ ...vestido, minStaff: 8, maxStaff: 2 },
    { id: 'area', logic: 'sales', factor: 2 }, { id: 'manual', logic: 'sales', factor: 10 }];
  const result = allocate({ positions, manualByPosition: { cocina: 3, manual: 1 } });
  assert.deepEqual(result.requiredByPosition, { cocina: 3, area: 6, manual: 1 });
  const noSales = allocate({ sale: 0, positions, manualByPosition: { cocina: 3, manual: 0 } });
  assert.deepEqual(noSales.requiredByPosition, { cocina: 3, area: 6, manual: 0 });
  const zeroCap = [{ ...vestido, maxStaff: 0 }, { id: 'area', logic: 'sales', factor: 2 }];
  assert.deepEqual(allocate({ positions: zeroCap }).requiredByPosition, { cocina: 0, area: 0 });
  assert.deepEqual(allocate({ positions: zeroCap, manualByPosition: { cocina: 3 } }).requiredByPosition,
    { cocina: 3, area: 6 });
  const serviceSource = [{ ...vestido, logic: 'service', maxStaff: '0' }, { id: 'area', logic: 'sales', factor: 2 }];
  assert.deepEqual(allocate({ positions: serviceSource }).requiredByPosition, { cocina: 0, area: 0 });
});

test('servicio, driver y puestos fijos mantienen sus fórmulas independientes', () => {
  const positions = [vestido,
    { id: 'service', logic: 'service', ticketAverage: 40, transactionsPerCollaborator: 10, factor: 0.5 },
    { id: 'driver', logic: 'driver', ticketAverage: 40, factor: 2 },
    { id: 'fixed', logic: 'fixed', fixedStaff: 2 },
  ];
  const result = allocate({ positions, manualByPosition: { cocina: 1 } });
  assert.deepEqual(result.requiredByPosition, { cocina: 1, service: 3, driver: 3, fixed: 2 });
  assert.equal(getProjectionPositionDemand(positions[1], { sale: 2000, vestidoStaff: 100 }), 2.5);
  assert.equal(getProjectionPositionDemand(positions[2], { sale: 1800, vestidoStaff: 100 }), 2);
  assert.equal(getProjectionPositionDemand(positions[3], { sale: 0, vestidoStaff: 0 }), 2);
});

test('sin Vestido las áreas dependientes tienen base cero; otras fórmulas y manuales siguen vigentes', () => {
  const positions = [
    { id: 'area', logic: 'sales', factor: 2 },
    { id: 'service', logic: 'service', ticketAverage: 40, transactionsPerCollaborator: 10, factor: 1 },
    { id: 'fixed', logic: 'fixed', fixedStaff: 2 },
  ];
  assert.deepEqual(allocate({ positions, vestidoPositionId: '' }).requiredByPosition, { area: 0, service: 5, fixed: 2 });
  assert.deepEqual(allocate({ positions, vestidoPositionId: '', manualByPosition: { area: 4 } }).requiredByPosition,
    { area: 4, service: 5, fixed: 2 });
});

test('factores omitidos conservan referencias conocidas y valores inválidos no crean demanda', () => {
  for (const [id, expected] of [['sheetout', 7], ['masa', 5.5], ['landing', 5], ['custom', 10]]) {
    for (const factor of [undefined, null, '', '   ']) {
      assert.equal(getProjectionPositionDemand({ id, logic: 'sales', factor }, { vestidoStaff: 10 }), expected);
    }
  }
  for (const factor of [-2, 'invalid', Infinity, NaN, 'Infinity', false, {}]) {
    assert.equal(getProjectionPositionDemand({ logic: 'sales', factor }, { vestidoStaff: 10 }), 0);
    assert.equal(getProjectionPositionDemand({ logic: 'service', ticketAverage: 40, transactionsPerCollaborator: 10, factor }, { sale: 2000 }), 0);
  }
});

test('valores inválidos, VHL cero y resultados desbordados permanecen finitos', () => {
  const positions = [vestido, { id: 'area', logic: 'sales', factor: 2 }];
  for (const value of [0, -100, Infinity, NaN, 'invalid']) {
    const result = allocate({ generalVhl: value, positions });
    assert.equal(result.vestidoStaff, 0);
    assert.equal(result.totalStaffAtHour, 0);
  }
  for (const value of [-100, Infinity, NaN, 'invalid']) {
    assert.equal(allocate({ sale: value }).vestidoStaff, 0);
    assert.equal(allocate({ manualByPosition: { cocina: value } }).vestidoStaff, 0);
  }
  assert.equal(allocate({ sale: Number.MAX_VALUE, generalVhl: Number.MIN_VALUE }).generalRequiredStaff, 0);
  assert.equal(getProjectionPositionDemand({ logic: 'sales', factor: Number.MAX_VALUE }, { vestidoStaff: 10 }), 0);
  assert.equal(getProjectionPositionDemand({ logic: 'service', ticketAverage: -1, transactionsPerCollaborator: 10, factor: 1 }, { sale: 2000 }), 0);
});

test('mínimos, topes y ajustes de cada área siguen aplicándose después del factor', () => {
  const result = allocate({ positions: [vestido,
    { id: 'min', logic: 'sales', factor: 0, minStaff: 2 },
    { id: 'max', logic: 'sales', factor: 2, maxStaff: 3 },
    { id: 'zero-cap', logic: 'sales', factor: 2, maxStaff: 0 },
    { id: 'zero-cap-min', logic: 'sales', factor: 2, maxStaff: '0', minStaff: 2 },
    { id: 'zero-service', logic: 'service', ticketAverage: 40, transactionsPerCollaborator: 10, factor: 1, maxStaff: 0 },
    { id: 'zero-driver', logic: 'driver', ticketAverage: 40, factor: 1, maxStaff: 0 },
    { id: 'zero-fixed', logic: 'fixed', fixedStaff: 2, maxStaff: 0 },
  ] });
  assert.deepEqual(result.requiredByPosition, { cocina: 4, min: 2, max: 3, 'zero-cap': 0,
    'zero-cap-min': 2, 'zero-service': 5, 'zero-driver': 2, 'zero-fixed': 2 });
  for (const maxStaff of ['', null, undefined]) {
    assert.equal(allocate({ positions: [{ ...vestido, maxStaff }] }).vestidoStaff, 4);
  }
});

test('la identidad explícita sobrevive al renombrado y gana a nombres y alias', () => {
  const positions = [vestido, { id: 'custom', name: 'Masa', logic: 'fixed' }];
  assert.equal(resolveVestidoPositionId(positions, 'custom'), 'custom');
  assert.equal(resolveVestidoPositionId([{ id: 'custom', name: 'Nuevo nombre' }], 'custom'), 'custom');
  assert.equal(allocate({ positions, vestidoPositionId: 'custom' }).requiredByPosition.custom, 4);
});

test('una fuente explícitamente quitada o eliminada no se reasigna por nombre', () => {
  const positions = [vestido, { id: 'custom', name: 'Vestido' }];
  for (const id of ['', null, 'removed']) assert.equal(resolveVestidoPositionId(positions, id), '');
  assert.equal(allocate({ positions, vestidoPositionId: 'removed' }).vestidoStaff, 0);
});

test('datos antiguos descubren un alias o Vestido único y dejan casos ambiguos pendientes', () => {
  assert.equal(resolveVestidoPositionId([{ ...vestido, name: 'Cocina' }]), 'cocina');
  assert.equal(resolveVestidoPositionId([{ id: 'custom', name: '  VÉSTIDO  ' }]), 'custom');
  assert.equal(resolveVestidoPositionId([{ id: 'one', name: 'Vestido' }, { id: 'two', name: 'vestido' }]), '');
  assert.equal(resolveVestidoPositionId([{ ...vestido, name: 'Cocina' }, { id: 'custom', name: 'Vestido' }]), '');
  assert.equal(resolveVestidoPositionId([{ id: 'other', name: 'Landing' }]), '');
});

test('un callback opcional recibe el Vestido final y no anula ajustes manuales', () => {
  const observed = [];
  const result = allocate({ positions: [vestido, { id: 'area', logic: 'sales' }, { id: 'manual', logic: 'sales' }],
    manualByPosition: { cocina: 3, manual: 1 },
    getPositionDemand: (position, context) => { observed.push([position.id, context]); return context.vestidoStaff * 2; },
  });
  assert.deepEqual(observed, [['area', { sale: 2000, vestidoStaff: 3 }]]);
  assert.deepEqual(result.requiredByPosition, { cocina: 3, area: 6, manual: 1 });
});
