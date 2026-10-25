import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeProjectionHours as summarize } from './projectionHours.js';

const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const day = (matrix, positions = ['Vestido']) => ({ positions, matrix });

test('suma cantidades por cada hora del día y las siete proyecciones completas', () => {
  const source = day([[2, 3, 1], [1, 0, 2]], ['Vestido', 'Masa']);
  const requirements = Object.fromEntries(days.map((key) => [key, source]));
  assert.deepEqual(summarize(requirements, [], 'monday'), {
    dayHours: 9, weekHours: 63, availableDays: 7, completeWeek: true,
  });
});

test('las celdas horarias no se multiplican por 15 minutos ni se cortan al rango visual', () => {
  for (const columns of [15, 17, 21, 25]) {
    const source = day([Array(columns).fill(2)]);
    assert.equal(summarize({ monday: source }, [], 'monday').dayHours, columns * 2);
  }
});

test('un día ausente no se convierte en cero y el total parcial indica cuántos días existen', () => {
  const requirements = { monday: day([[24]]), tuesday: { positions: ['Vestido'] }, wednesday: { matrix: null } };
  assert.deepEqual(summarize(requirements, ['Vestido'], 'tuesday'), {
    dayHours: null, weekHours: 24, availableDays: 1, completeWeek: false,
  });
});

test('cero explícito y una matriz vacía son proyecciones válidas', () => {
  const requirements = { monday: day([[0, '0']]), tuesday: day({}), wednesday: day([], []) };
  assert.deepEqual(summarize(requirements, [], 'tuesday'), {
    dayHours: 0, weekHours: 0, availableDays: 3, completeWeek: false,
  });
  const completeZero = Object.fromEntries(days.map((key) => [key, day({})]));
  assert.deepEqual(summarize(completeZero, [], 'sunday'), {
    dayHours: 0, weekHours: 0, availableDays: 7, completeWeek: true,
  });
});

test('sin matrices guardadas los totales quedan ausentes', () => {
  for (const requirements of [undefined, null, {}, { monday: {} }, { monday: { matrix: 0 } }]) {
    assert.deepEqual(summarize(requirements, ['Vestido'], 'monday'), {
      dayHours: null, weekHours: null, availableDays: 0, completeWeek: false,
    });
  }
});

test('objetos compactos dispersos conservan sus índices y no desplazan filas huérfanas', () => {
  const matrix = {
    2: { 20: 3, 0: 2 },
    0: { 1: 1 },
    9: { 0: 50 },
    total: { 0: 100 },
  };
  const requirements = { monday: day(matrix, ['Vestido', 'Masa', 'Landing']) };
  assert.equal(summarize(requirements, [], 'monday').dayHours, 6);
  assert.equal(summarize({ monday: day({ 2: { 0: 50 } }) }, [], 'monday').dayHours, 0);
});

test('usa posiciones del día y recurre al listado global cuando faltan, sin sumar filas sobrantes', () => {
  const requirements = { monday: day([[4], [50], [60]], ['Área única']) };
  const global = [{ name: 'Otra' }, { name: 'Segunda' }, { name: 'Tercera' }];
  assert.equal(summarize(requirements, global, 'monday').dayHours, 4);
  assert.equal(summarize({ monday: { matrix: [[4], [50], [60]] } }, [{ name: 'Solo una' }], 'monday').dayHours, 4);
  assert.equal(summarize({ monday: day([[2], [3]], []) }, ['Vestido', 'Masa'], 'monday').dayHours, 5);
});

test('nombres repetidos y sufijos de carriles no duplican ni borran cantidades de la proyección', () => {
  const source = day([[2, 2], [3, 0], [1, 1]], ['Masa', 'Masa', 'Masa#2']);
  assert.equal(summarize({ monday: source }, [], 'monday').dayHours, 9);
});

test('acepta cantidades decimales guardadas como texto e ignora negativos y valores inválidos', () => {
  const source = day([[2.5, '0', '4', -2, '-3', NaN, Infinity, 'Infinity', null, true, {}, 'incorrecto']]);
  assert.equal(summarize({ monday: source }, [], 'monday').dayHours, 6.5);
});

test('arrays dispersos y metadatos no aportan horas adicionales', () => {
  const row = [];
  row[0] = 2;
  row[3] = 4;
  row.total = 999;
  const matrix = [];
  matrix[2] = row;
  matrix.total = [999];
  assert.equal(summarize({ monday: day(matrix, ['A', 'B', 'C']) }, [], 'monday').dayHours, 6);
  assert.equal(summarize({ monday: day({ 0: { 0: 1, '01': 999, '-1': 999, total: 999 } }) }, [], 'monday').dayHours, 1);
});

test('un día seleccionado desconocido no altera los siete totales reconocidos', () => {
  const requirements = Object.fromEntries(days.map((key) => [key, day([[1]])]));
  requirements.extra = day([[999]]);
  assert.deepEqual(summarize(requirements, [], 'extra'), {
    dayHours: null, weekHours: 7, availableDays: 7, completeWeek: true,
  });
});

test('un total desbordado no devuelve Infinity como cantidad de horas', () => {
  assert.deepEqual(summarize({ monday: day([[Number.MAX_VALUE, Number.MAX_VALUE]]) }, [], 'monday'), {
    dayHours: null, weekHours: null, availableDays: 0, completeWeek: false,
  });
});
