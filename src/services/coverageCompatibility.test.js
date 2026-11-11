import test from 'node:test';
import assert from 'node:assert/strict';
import { compatiblePlacementPositions } from './coveragePlacement.js';

const context = person => ({ staff:[{id:'a',...person}],requirements:{positions:['Masa','Salón','Sin área','Área antigua']},
  positionDefinitions:[{name:'MASA',department:'production'},{name:'Salón',department:'service'},
    {name:'Sin área'},{name:'Área antigua',department:'other'}] });

test('el arrastre habilita solo las áreas de la categoría y Multifuncional habilita ambas',()=>{
  assert.deepEqual(compatiblePlacementPositions(context({workCategory:'production'}),'a'),['Masa']);
  assert.deepEqual(compatiblePlacementPositions(context({workCategory:'Servicio'}),'a'),['Salón']);
  assert.deepEqual(compatiblePlacementPositions(context({workCategory:'Multifuncional'}),'a'),['Masa','Salón']);
});
test('categoría ausente y áreas sin configurar permanecen desactivadas',()=>{
  assert.deepEqual(compatiblePlacementPositions(context({}),'a'),[]);
  assert.deepEqual(compatiblePlacementPositions(context({workCategory:'desconocida'}),'a'),[]);
  assert.deepEqual(compatiblePlacementPositions(context({workCategory:'multifunctional'}),'no-existe'),[]);
  assert.deepEqual(compatiblePlacementPositions(context({legacy_data:{workCategory:'Producción'}}),'a'),['Masa']);
});
test('la lectura actualizada cambia las áreas disponibles sin modificar la proyección ni el perfil',()=>{
  const ctx=context({workCategory:'production'}),before=structuredClone(ctx);
  compatiblePlacementPositions(ctx,'a');assert.deepEqual(ctx,before);
  const fresh={...ctx,staff:[{id:'a',workCategory:'service'}]};
  assert.deepEqual(compatiblePlacementPositions(fresh,'a'),['Salón']);assert.deepEqual(ctx,before);
});
