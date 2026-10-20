import test from 'node:test';
import assert from 'node:assert/strict';
import { SUGGESTIVE_EVALUATION_CHANNELS, normalizeReportChannel, suggestiveChannelSettings, suggestiveChannelForPosition } from './suggestiveChannels.js';

test('los cuatro canales siempre están disponibles aunque no haya reportes', () => {
  assert.deepEqual(SUGGESTIVE_EVALUATION_CHANNELS, ['SALÓN', 'DRIVE THRU', 'SERV. FILA', 'SERV. AUTO']);
  assert.deepEqual(suggestiveChannelSettings().map(channel => channel.id), SUGGESTIVE_EVALUATION_CHANNELS);
  assert.deepEqual(suggestiveChannelSettings().filter(channel => channel.enabled).map(channel => channel.id), ['SALÓN', 'SERV. FILA']);
  assert.deepEqual(suggestiveChannelSettings([]), suggestiveChannelSettings());
});

test('la nueva selección inicial de Salón y Módulo no reemplaza canales guardados explícitamente', () => {
  const salonOnly = suggestiveChannelSettings([{ id: 'SALÓN', enabled: true }]);
  assert.deepEqual(salonOnly.filter(channel => channel.enabled).map(channel => channel.id), ['SALÓN']);
  const driveOnly = suggestiveChannelSettings([{ id: 'DRIVE THRU', enabled: true }, { id: 'SALÓN', enabled: false }]);
  assert.deepEqual(driveOnly.filter(channel => channel.enabled).map(channel => channel.id), ['DRIVE THRU']);
  const none = suggestiveChannelSettings(SUGGESTIVE_EVALUATION_CHANNELS.map(id => ({ id, enabled: false })));
  assert.ok(none.every(channel => !channel.enabled));
});

test('separa servicio al auto y drive thru; conserva desconocidos y Delivery', () => {
  assert.equal(normalizeReportChannel('Servicio al auto'), 'SERV. AUTO');
  assert.equal(normalizeReportChannel(' SERV.AUTO '), 'SERV. AUTO');
  assert.equal(normalizeReportChannel('Drive Thru'), 'DRIVE THRU');
  assert.equal(normalizeReportChannel('Módulo'), 'SERV. FILA');
  assert.equal(normalizeReportChannel('SERV. FILA'), 'SERV. FILA');
  assert.equal(normalizeReportChannel('Delivery'), 'DELIVERY');
  assert.equal(normalizeReportChannel('Driver'), 'DRIVER');
  assert.equal(normalizeReportChannel('Canal nuevo'), 'CANAL NUEVO');
});

test('descarta selecciones no permitidas y conserva el módulo de configuraciones anteriores', () => {
  const channels = suggestiveChannelSettings([{ id: 'CANAL NUEVO', enabled: true }, { id: 'DELIVERY', enabled: true },
    { id: 'MÓDULO', enabled: true, positions: ['Módulo'] }]);
  assert.deepEqual(channels.map(channel => channel.id), SUGGESTIVE_EVALUATION_CHANNELS);
  assert.deepEqual(channels.filter(channel => channel.enabled), [{ id: 'SERV. FILA', enabled: true }]);
});

test('asigna automáticamente las variantes de cada posición a su propio canal', () => {
  const aliases = {
    'SALÓN': ['Salón', ' salo\u0301n #2 ', 'SERVICIO', 'Servicio al cliente', 'Punto de venta', 'Caja 2', 'Despachador', 'Promise'],
    'DRIVE THRU': ['Drive Thru', 'Drivethru', 'DRIVE-THRU', 'Drive # 3'],
    'SERV. FILA': ['Módulo', ' mo\u0301dulo#2 ', 'SERV.FILA', 'Servicio en fila'],
    'SERV. AUTO': ['Servicio al auto', 'SERV.AUTO', 'Serv. Auto #2', 'Auto'],
  };
  for (const [channel, positions] of Object.entries(aliases)) {
    for (const position of positions) assert.equal(suggestiveChannelForPosition(position), channel, position);
  }
  for (const position of ['Driver', 'Driver (repartidor)', 'Delivery', 'Cocina', 'Gerente', 'Asistente', 'CANAL NUEVO', 'Caja de cocina', '']) {
    assert.equal(suggestiveChannelForPosition(position), null, position);
  }
});

test('las configuraciones guardadas ya no conservan posiciones manuales ni sus duplicados', () => {
  const configured = [{ id: 'salon', enabled: true, positions: ['Cocina'] },
    { id: 'SALÓN', enabled: true, positions: ['SALÓN', 'salo\u0301n'] },
    { id: 'SERV. AUTO', enabled: true, positions: ['Drive Thru'] }];
  const channels = suggestiveChannelSettings(configured);
  assert.equal(channels.filter(channel => channel.id === 'SALÓN').length, 1);
  assert.ok(channels.every(channel => !Object.hasOwn(channel, 'positions')));
  assert.equal(channels.find(channel => channel.id === 'SERV. AUTO').enabled, true);
  assert.deepEqual(configured[0].positions, ['Cocina'], 'The original saved configuration is not mutated');
});
