import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionState } from './production-state.mjs';

const sha = letter => letter.repeat(40);
const state = () => ({ branch: 'main', head: sha('a'), remoteHead: sha('a'), dirty: '', liveCommit: sha('b'), includesLive: true, project: 'lc-scheduler' });

test('permite main sincronizado que incluye la versión publicada', () => {
  assert.doesNotThrow(() => assertProductionState(state()));
});
test('bloquea ramas de trabajo y checkout separado de main', () => {
  for (const branch of ['codex/feature', 'main-anterior', '']) assert.throws(() => assertProductionState({ ...state(), branch }), /solo se publica desde main/);
});
test('bloquea código modificado o nuevo sin confirmar', () => {
  for (const dirty of [' M src/App.jsx\n', '?? src/Nuevo.jsx\n']) assert.throws(() => assertProductionState({ ...state(), dirty }), /sin confirmar/);
});
test('bloquea main atrasado y commits locales que no se subieron', () => {
  assert.throws(() => assertProductionState({ ...state(), remoteHead: sha('c') }), /no coincide/);
  assert.throws(() => assertProductionState({ ...state(), head: sha('c') }), /no coincide/);
});
test('bloquea reemplazar producción con otra línea de historia', () => {
  assert.throws(() => assertProductionState({ ...state(), includesLive: false }), /no contiene el commit publicado/);
});
test('exige una versión publicada identificable y el proyecto correcto', () => {
  for (const liveCommit of ['', '../otra-rama', null]) assert.throws(() => assertProductionState({ ...state(), liveCommit }), /commit verificable/);
  assert.throws(() => assertProductionState({ ...state(), project: 'otra-aplicacion' }), /proyecto autorizado/);
});
