import test from 'node:test';
import assert from 'node:assert/strict';
import {
    evaluationResponseKeys,
    evaluationScoreForKeys,
    missingEvaluationResponses,
} from './trainingEvaluationValidation.js';

test('exige cada criterio general, de estación y de conocimiento', () => {
    const keys = evaluationResponseKeys({
        generalPoints: [{ id: 'general', points: [{ id: 1 }, { id: 2 }] }],
        stationCode: 'SHEETOUT',
        stationPoints: [{ id: 1 }, { id: 2 }],
        knowledgePoints: [{ id: 18 }],
    });

    assert.deepEqual(keys, ['general_1', 'general_2', 'SHEETOUT_1', 'SHEETOUT_2', 'knowledge_18']);
    assert.deepEqual(missingEvaluationResponses({ general_1: true, general_2: false }, keys), [
        'SHEETOUT_1',
        'SHEETOUT_2',
        'knowledge_18',
    ]);
});

test('calcula el puntaje contra el catálogo completo y no sólo las respuestas presentes', () => {
    const keys = ['point_1', 'point_2', 'point_3', 'point_4'];
    assert.equal(evaluationScoreForKeys({ point_1: true }, keys), 25);
    assert.equal(evaluationScoreForKeys({ point_1: true, point_2: false, point_3: true, point_4: true }, keys), 75);
});
