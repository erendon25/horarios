import test from 'node:test';
import assert from 'node:assert/strict';
import { trainingRecognition } from './trainingRecognition.js';

test('a valid competition advance certifies only its station at 100, preserving training',()=>{
  const row={training_scores:{LANDING:72,VESTIDO:96},position_abilities:['VESTIDO'],competition_recognition:{certifications:{LANDING:100},championships:[]}};
  const result=trainingRecognition(row);
  assert.deepEqual(result.trainingScores,{LANDING:100,VESTIDO:96});
  assert.deepEqual(result.skills,['VESTIDO','LANDING']);
  assert.deepEqual(row.training_scores,{LANDING:72,VESTIDO:96});
  assert.deepEqual(row.position_abilities,['VESTIDO']);
  assert.deepEqual(trainingRecognition({...row,competition_recognition:null}).trainingScores,row.training_scores);
});

test('independent training certification survives invalidation of the competition',()=>{
  const result=trainingRecognition({training_scores:{SHEETOUT:98},position_abilities:['SHEETOUT'],competition_recognition:{certifications:{},championships:[]}});
  assert.equal(result.trainingScores.SHEETOUT,98);
  assert.deepEqual(result.skills,['SHEETOUT']);
});
