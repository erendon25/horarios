import test from 'node:test';
import assert from 'node:assert/strict';
import { canDownloadSchedulePdf } from './schedulePdfAuthorization.js';

test('deniega el PDF a colaboradores operativos aunque el botón pudiera manipularse', () => {
  assert.equal(canDownloadSchedulePdf({ userRole: 'collaborator', staffPosition: 'COLABORADOR' }), false);
  assert.equal(canDownloadSchedulePdf({ userRole: 'collaborator', staffPosition: 'SALÓN' }), false);
  assert.equal(canDownloadSchedulePdf({ userRole: 'collaborator', staffPosition: 'DRIVER' }), false);
  assert.equal(canDownloadSchedulePdf(), false);
});

test('autoriza únicamente los cargos solicitados, no roles técnicos sin un cargo válido', () => {
  assert.equal(canDownloadSchedulePdf({ userRole: 'trainer', staffPosition: 'COLABORADOR' }), false);
  assert.equal(canDownloadSchedulePdf({ userRole: 'admin' }), false);
  assert.equal(canDownloadSchedulePdf({ userRole: 'superadmin' }), false);
  assert.equal(canDownloadSchedulePdf({ userRole: 'collaborator', staffPosition: 'ENTRENADOR' }), true);
  assert.equal(canDownloadSchedulePdf({ userRole: 'collaborator', staffPosition: 'ASISTENTE' }), true);
  assert.equal(canDownloadSchedulePdf({ userRole: 'collaborator', staffPosition: 'gerente' }), true);
});

test('normaliza espacios y mayúsculas sin reinterpretar cargos desconocidos', () => {
  assert.equal(canDownloadSchedulePdf({ userRole: 'collaborator', staffPosition: '  asistente  ' }), true);
  assert.equal(canDownloadSchedulePdf({ userRole: 'collaborator', staffPosition: 'ENTRENÁDOR' }), false);
  assert.equal(canDownloadSchedulePdf({ userRole: 'collaborator', staffPosition: 'LIDER' }), false);
});
