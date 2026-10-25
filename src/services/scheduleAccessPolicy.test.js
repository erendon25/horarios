import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeScheduleAccessPolicy as normalize,
  getScheduleWeekStart as monday,
  getRequestDateAccess as access,
  getLimaToday,
} from './scheduleAccessPolicy.js';

const defaults = () => ({ adminOnlyStudyEditing: false, requestsEnabled: true, blockedWeeks: [], blockedDates: [] });
const rejected = (value) => assert.throws(() => normalize(value), { code: 'invalid_schedule_access_policy' });

test('un documento ausente conserva el comportamiento actual y produce arrays independientes', () => {
  const first = normalize(undefined);
  assert.deepEqual(first, defaults());
  first.blockedDates.push('2026-10-26');
  assert.deepEqual(normalize(undefined), defaults());
  assert.notEqual(first.blockedWeeks, normalize(undefined).blockedWeeks);
});

test('normaliza listas sin mutar el origen y no incorpora metadatos en las reglas', () => {
  const raw = { ...defaults(), adminOnlyStudyEditing: true,
    blockedWeeks: ['2026-11-02', '2026-10-26', '2026-11-02'],
    blockedDates: ['2026-10-29', '2026-10-28', '2026-10-29'], updatedAt: 'metadata' };
  const original = structuredClone(raw);
  assert.deepEqual(normalize(raw), { adminOnlyStudyEditing: true, requestsEnabled: true,
    blockedWeeks: ['2026-10-26', '2026-11-02'], blockedDates: ['2026-10-28', '2026-10-29'] });
  assert.deepEqual(raw, original);
});

test('un documento presente vacío, parcial o de otro tipo nunca habilita permisos por defecto', () => {
  for (const raw of [null, {}, [], '', 'configuration', true, 0]) rejected(raw);
  for (const key of Object.keys(defaults())) {
    const partial = defaults();
    delete partial[key];
    rejected(partial);
  }
});

test('ambas opciones requieren booleanos reales, incluidos los valores false', () => {
  for (const key of ['adminOnlyStudyEditing', 'requestsEnabled']) {
    for (const value of [0, 1, 'false', 'true', null, undefined, {}]) rejected({ ...defaults(), [key]: value });
    for (const value of [true, false]) assert.equal(normalize({ ...defaults(), [key]: value })[key], value);
  }
});

test('las listas de bloqueo requieren arrays con todas sus fechas ISO válidas', () => {
  for (const key of ['blockedWeeks', 'blockedDates']) {
    for (const value of [null, '', {}, new Set(), [null], [undefined], [1], ['2026-02-30'], new Array(1)]) {
      rejected({ ...defaults(), [key]: value });
    }
  }
  for (const invalid of ['2026-2-01', '2026-13-01', '0000-01-01', '2026-10-26T00:00:00Z', '2026-10-26 ']) {
    rejected({ ...defaults(), blockedDates: [invalid] });
  }
});

test('las semanas bloqueadas identifican lunes reales y no otros días válidos', () => {
  for (const invalid of ['2026-10-27', '2026-11-01']) rejected({ ...defaults(), blockedWeeks: [invalid] });
  assert.deepEqual(normalize({ ...defaults(), blockedWeeks: ['2026-10-26', '2026-12-28'] }).blockedWeeks,
    ['2026-10-26', '2026-12-28']);
});

test('identifica el lunes de una semana completa y de fechas que cruzan meses o años', () => {
  for (const day of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']) {
    assert.equal(monday(day), '2026-10-26');
  }
  assert.equal(monday('2026-11-02'), '2026-11-02');
  assert.equal(monday('2027-01-01'), '2026-12-28');
  assert.equal(monday('2028-02-29'), '2028-02-28');
});

test('las fechas inválidas devuelven null y no se corrigen automáticamente', () => {
  for (const value of [undefined, null, '', '2026-02-30', '2026-2-1', 'invalid', {}, new Date(), '0000-01-01']) {
    assert.equal(monday(value), null);
  }
});

test('el interruptor global bloquea solicitudes incluso sin semanas ni fechas bloqueadas', () => {
  const result = access({ ...defaults(), requestsEnabled: false }, '2026-10-26');
  assert.equal(result.allowed, false);
  assert.match(result.reason, /deshabilitadas/);
});

test('bloquear una semana afecta todos sus días y permite las semanas contiguas', () => {
  const policy = { ...defaults(), blockedWeeks: ['2026-10-26'] };
  for (const date of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']) {
    const result = access(policy, date);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /semana del 26\/10\/2026/);
  }
  assert.deepEqual(access(policy, '2026-10-25'), { allowed: true, reason: null });
  assert.deepEqual(access(policy, '2026-11-02'), { allowed: true, reason: null });
});

test('bloquear una fecha no bloquea los demás días de su semana', () => {
  const policy = { ...defaults(), blockedDates: ['2026-10-28'] };
  assert.equal(access(policy, '2026-10-28').allowed, false);
  assert.match(access(policy, '2026-10-28').reason, /28\/10\/2026/);
  for (const date of ['2026-10-27', '2026-10-29']) assert.equal(access(policy, date).allowed, true);
});

test('la edición de estudios es independiente de las solicitudes y no se inventan restricciones históricas', () => {
  const policy = { ...defaults(), adminOnlyStudyEditing: true };
  assert.deepEqual(access(policy, '2026-10-26'), { allowed: true, reason: null });
  assert.deepEqual(access(policy, '2020-01-01'), { allowed: true, reason: null });
});

test('una regla desconocida o corrupta deniega la solicitud sin lanzar errores en el formulario', () => {
  for (const policy of [undefined, null, {}, { ...defaults(), requestsEnabled: 'true' }]) {
    const result = access(policy, '2026-10-26');
    assert.equal(result.allowed, false);
    assert.match(result.reason, /No se pudo verificar/);
  }
});

test('no se permite una fecha inválida aunque las solicitudes estén habilitadas', () => {
  for (const date of ['', null, '2026-02-30', '2026-10-26T00:00:00Z']) {
    const result = access(defaults(), date);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /fecha válida/);
  }
});

test('hoy en Lima cambia a las 05:00 UTC, sin depender de la zona del dispositivo', () => {
  assert.equal(getLimaToday(new Date('2026-10-26T04:59:59Z')), '2026-10-25');
  assert.equal(getLimaToday(new Date('2026-10-26T05:00:00Z')), '2026-10-26');
  assert.equal(getLimaToday(new Date('2027-01-01T00:00:00Z')), '2026-12-31');
});

test('la semana calendario se mantiene estable en Lima y zonas horarias opuestas', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['America/Lima', 'Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']) {
      process.env.TZ = zone;
      assert.equal(monday('2026-11-01'), '2026-10-26', zone);
      assert.equal(monday('2026-10-26'), '2026-10-26', zone);
      assert.equal(getLimaToday(new Date('2026-10-26T04:59:59Z')), '2026-10-25', zone);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
