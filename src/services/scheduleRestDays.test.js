import test from 'node:test';
import assert from 'node:assert/strict';
import { countAssignedRestDays as count } from './scheduleRestDays.js';

const input = () => ({ day:'monday',date:'2026-11-09',staff:[{id:'a'},{id:'b'},{id:'c'},{id:'d'},{id:'e'},{id:'f'}],schedules:{
  a:{monday:{off:true}},b:{monday:{off:false,feriado:true}},c:{monday:{}},
  d:{monday:{start:'08:00',end:'16:45'}},e:{monday:{off:true,feriado:true}},
} });

test('cuenta solo días libres asignados, no feriados, turnos vacíos ni preferencias',()=>{
  const data=input();data.staff[2].study_schedule={monday:{free:true}};
  assert.equal(count(data),1);
  assert.equal(count({...data,schedules:{}}),0);
});

test('considera el día seleccionado y actualiza el conteo al cambiar el borrador',()=>{
  const data=input();data.schedules.a.tuesday={off:true};data.schedules.c.tuesday={off:true};
  assert.equal(count({...data,day:'tuesday',date:'2026-11-10'}),2);
  data.schedules.c.monday={off:true};assert.equal(count(data),2);
  data.schedules.a.monday={off:false};assert.equal(count(data),1);
});

test('excluye inactivos e históricos, y aplica ceses y fin de entrenamiento a la fecha elegida',()=>{
  const staff=[{id:'active'},{id:'inactive',status:'inactive'},{id:'history',reconstructed_from_history:true},
    {id:'ceased',cessationDate:'2026-11-08'},{id:'last-day',terminationDate:'2026-11-09'},
    {id:'trainee',isTrainee:true,trainingEndDate:'2026-11-08'}];
  const data={...input(),staff,schedules:Object.fromEntries(staff.map(person=>[person.id,{monday:{off:true}}]))};
  assert.equal(count(data),2);
});

test('no duplica perfiles ni cambia el resultado por filtros de la vista',()=>{
  const data=input();data.staff.push({id:'a'});
  assert.equal(count({...data,modalityFilter:'Part-Time',search:'otro nombre'}),1);
});

test('tolera banderas históricas explícitas y respeta el alias feriado más reciente',()=>{
  const data=input();data.schedules.a.monday={off:1};data.schedules.c.monday={off:'true'};
  data.schedules.d.monday={off:'false'};data.schedules.e.monday={off:true,feriado:false,holiday:true};
  data.schedules.f={monday:{off:true,holiday:true}};
  assert.equal(count(data),3);
});

test('fechas y días inválidos son desconocidos, no un cero engañoso',()=>{
  for(const value of [{date:''},{date:'2026-02-30'},{date:'2026-13-01'},{day:'inventado'}])assert.equal(count({...input(),...value}),null);
});
