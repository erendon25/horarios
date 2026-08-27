import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isCurrentGeoVictoriaEpisode,
    isImportableGeoVictoriaState,
} from './geoVictoriaCompat.js';

test('inactive sin cese ni fin de entrenamiento sigue siendo un episodio vigente', () => {
    assert.equal(isCurrentGeoVictoriaEpisode({
        status: 'inactive',
        cessationDate: null,
        isTrainee: false,
        trainingEndDate: null,
    }, '2026-08-26'), true);
});

test('sólo un cese o fin de entrenamiento efectivo permite el reingreso', () => {
    assert.equal(isCurrentGeoVictoriaEpisode({
        status: 'active',
        cessationDate: '2026-08-25',
        isTrainee: false,
        trainingEndDate: null,
    }, '2026-08-26'), false);
    assert.equal(isCurrentGeoVictoriaEpisode({
        status: 'inactive',
        cessationDate: null,
        isTrainee: true,
        trainingEndDate: '2026-08-25',
    }, '2026-08-26'), false);
    assert.equal(isCurrentGeoVictoriaEpisode({
        status: 'inactive',
        cessationDate: '2026-08-26',
        isTrainee: false,
        trainingEndDate: null,
    }, '2026-08-26'), true);
});

test('no confunde estados inactivos del archivo con estados activos', () => {
    assert.equal(isImportableGeoVictoriaState('Activo'), true);
    assert.equal(isImportableGeoVictoriaState('Active'), true);
    assert.equal(isImportableGeoVictoriaState(''), true);
    assert.equal(isImportableGeoVictoriaState('Inactivo'), false);
    assert.equal(isImportableGeoVictoriaState('Desactivado'), false);
});
