// Fictional staff and schedules used only by the isolated Focus preview.
// This module is never imported by the application bundle.
export function makeScheduleFocusQaFixture(base) {
 const fixture=structuredClone(base);
 const positions=['VESTIDO','MASA','LANDING','DO SHEET','SHEETOUT','HORNO','DRIVE THRU','SALÓN','LIMPIEZA'];
 const people=[
  ['G01','Martina','GERENTE','FT1'],['A01','Diego','ASISTENTE','FT1'],
  ['T01','Lucía','ENTRENADOR','FT1'],['T02','Bruno','ENTRENADOR','FT1'],
  ['F01','Camila','COLABORADOR','FT1'],['F02','Mateo','COLABORADOR','FT1'],
  ['F03','Elena','COLABORADOR','FT1'],['F04','Nicolás','COLABORADOR','FT1'],['F05','Daniela','COLABORADOR','FT1'],
  ['P01','Sofía','COLABORADOR','PT1'],['P02','Andrés','COLABORADOR','PT1'],['P03','Paula','COLABORADOR','PT1'],
  ['P04','Samuel','COLABORADOR','PT2'],['P05','Natalia','COLABORADOR','PT2'],['P06','Tomás','COLABORADOR','PT2'],
  ['P07','Renata','COLABORADOR','PT3'],['P08','Joaquín','COLABORADOR','PT3'],['P09','Abril','COLABORADOR','PT3'],
  ['P10','Gabriel','COLABORADOR','PT4'],['P11','Emilia','COLABORADOR','PT4'],['P12','Hugo','COLABORADOR','PT4'],
 ];
 fixture.staff=people.map(([id,name,position,plan],index)=>({
  id,name:`${name} Prueba`,lastName:'Ficticio',dni:String(99000101+index),
  modality:plan==='FT1'?'Full-Time':'Part-Time',position,status:'active',storeId:'qa-store',
  isTrainer:position==='ENTRENADOR',skills:positions,
 }));
 fixture.schedules=Object.fromEntries(people.map(([id,,,plan],index)=>{
  const schedule=structuredClone(base.schedules[plan]);
  for(const day of Object.keys(schedule))if(!schedule[day].off)schedule[day].position=positions[index%positions.length];
  return [id,schedule];
 }));
 fixture.schedules.G01.monday={...fixture.schedules.G01.monday,start:'10:15',end:'19:30',breakStart:'14:15',bukApprovedShiftId:''};
 fixture.schedules.A01.monday={...fixture.schedules.A01.monday,start:'11:10',end:'20:25',breakStart:'15:10',bukApprovedShiftId:''};
 fixture.schedules.T01.monday={...fixture.schedules.T01.monday,start:'12:15',end:'21:00',breakStart:'16:15',bukApprovedShiftId:'FT1-17'};
 fixture.schedules.T02.monday={...fixture.schedules.T02.monday,position:'LANDING',start:'14:15',end:'23:00',breakStart:'18:15',bukApprovedShiftId:'FT1-21'};
 fixture.schedules.F04.monday={position:'SALÓN',off:false,feriado:true,bukRestDays:1};
 fixture.schedules.P10.monday={off:true,bukRestDays:4};
 fixture.schedules.P12.monday={};
 // An existing split shift demonstrates that the classic data is retained.
 fixture.schedules.F05.monday={...fixture.schedules.F05.monday,start:'06:00',end:'10:00',start2:'18:00',end2:'22:00',splitShift:true,breakStart:'',bukApprovedShiftId:''};
 fixture.identities=fixture.staff.map(person=>({name:`${person.name} ${person.lastName}`,dni:person.dni,area:'TIENDA FICTICIA',supervisor:'GERENCIA DE PRUEBA'}));
 const studies={
  P01:{monday:{free:false,blocks:[{start:'10:00',end:'12:00'}]},tuesday:{free:false,blocks:[{start:'00:00',end:'02:00'}]}},
  P02:{monday:{free:false,blocks:[{start:'14:00',end:'17:00'}]},friday:{free:true,blocks:[]}},
  F03:{monday:{free:false,blocks:[{start:'06:00',end:'08:00'}]}},
 };
 const weekdays=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
 const requirements=Object.fromEntries(weekdays.map((day,dayIndex)=>[day,{positions,matrix:Object.fromEntries(positions.map((_,positionIndex)=>[String(positionIndex),Object.fromEntries(Array.from({length:18},(_,hour)=>[
  String(hour),hour===17?0:hour<2?positionIndex<3?1:0:hour<7?1:hour<13?(positionIndex+dayIndex)%3===0?3:2:1,
 ]))]))}]));
 // One continuous uncovered lane makes the two-endpoint coverage demo repeatable.
 for(const hour of [4,5,6,7])requirements.monday.matrix['0'][hour]=2;
 return {fixture,studies,projection:{positions,requirements}};
}
