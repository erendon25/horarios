// Read business data only; never execute workbook macros or evaluate cell code.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import XLSX from 'xlsx';
import {approvedBukShifts} from '../src/services/bukSchedule.js';

const input=process.argv[2];
if(!input) throw Error('Indica la ruta del Excel de planificación para verificar sus horarios aprobados.');
const bytes=await readFile(input);
const book=XLSX.read(bytes,{type:'buffer',cellFormula:true});
const sheet=book.Sheets['HORARIOS APROBADOS'];
assert.ok(sheet,'Falta la pestaña HORARIOS APROBADOS');
const clock=value=>{
  assert.equal(typeof value,'number');
  const minutes=Math.round(value*1440)%1440;
  return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
};
const minutes=value=>value.split(':').reduce((hours,minute)=>hours*60+Number(minute),0);
const plans=[],checked=[];
for(const [group,column] of [['FT1',0],['PT1',3],['PT2',6],['PT3',9],['PT4',12]]) {
  const ruleCell=XLSX.utils.encode_cell({r:1,c:column});
  const text=String(sheet[ruleCell]?.v || '');
  const rules=[...text.matchAll(/(\d+)\s+d[ií]as?\s*=\s*(\d{2}):(\d{2})(?:\s+horas)?(?:\s*\(REFR?IGERIO\s*(\d+)['’]?\))?/gi)]
    .map(match=>({days:Number(match[1]),duration:Number(match[2])*60+Number(match[3]),breakMinutes:Number(match[4] || 0)}));
  assert.ok(rules.length,`No se reconocieron reglas en ${ruleCell}`);
  const restDays=Number(text.match(/(\d+)\s+D[IÍ]AS?\s+DE\s+DESCANSO/i)?.[1]);
  assert.equal(rules.reduce((sum,rule)=>sum+rule.days,0)+restDays,7,`${group}: días semanales`);
  const total=String(sheet[XLSX.utils.encode_cell({r:2,c:column})]?.v || '').match(/(\d+):(\d+)/);
  assert.ok(total,`${group}: falta total semanal`);
  const weeklyMinutes=Number(total[1])*60+Number(total[2]);
  assert.equal(rules.reduce((sum,rule)=>sum+rule.days*(rule.duration-rule.breakMinutes),0),weeklyMinutes,`${group}: total según el Excel`);
  let ranges=0;
  for(let row=4;row<=XLSX.utils.decode_range(sheet['!ref']).e.r;row++) {
    const a=sheet[XLSX.utils.encode_cell({r:row,c:column})],b=sheet[XLSX.utils.encode_cell({r:row,c:column+1})];
    if(a?.t!=='n' || b?.t!=='n') continue;
    const start=clock(a.v),end=clock(b.v),duration=(minutes(end)-minutes(start)+1440)%1440;
    const rule=rules.find(rule=>rule.duration===duration);
    assert.ok(rule,`${group} fila ${row+1}: duración fuera de la regla del Excel`);
    const id=`${group}-${row+1}`;
    const actual=approvedBukShifts.find(shift=>shift.id===id);
    assert.ok(actual,`${id}: falta el turno en el programa`);
    assert.deepEqual([actual.group,actual.start,actual.end,actual.duration,actual.breakMinutes],[group,start,end,duration,rule.breakMinutes],id);
    assert.equal(Boolean(actual.breakIncludedInHours),false,`${id}: el archivo descuenta los refrigerios indicados`);
    checked.push(id);ranges++;
  }
  plans.push({group,ruleCell,restDays,weeklyMinutes,rules,ranges});
}
assert.equal(new Set(checked).size,approvedBukShifts.length,'Hay turnos adicionales o duplicados en el programa');
const report={status:'PASS',sheet:'HORARIOS APROBADOS',sourceSha256:createHash('sha256').update(bytes).digest('hex'),ranges:checked.length,plans};
const output=process.argv[3] || 'output/buk-workbook/approved-audit.json';
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
