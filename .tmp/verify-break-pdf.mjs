import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as hours from '../src/services/scheduleHours.js';
const context = vm.createContext({ console });
let pdf;
function PreviewPDF(...args) { pdf = new jsPDF(...args); pdf.save = () => {}; return pdf; }
const imports = { jspdf: { default: PreviewPDF }, 'jspdf-autotable': { default: autoTable }, '../services/scheduleHours': hours };
const source = await readFile('src/components/PDFExport.jsx', 'utf8');
const module = new vm.SourceTextModule(transformSync(source, { loader: 'jsx', format: 'esm' }).code, { context });
await module.link(specifier => new vm.SyntheticModule(Object.keys(imports[specifier]), function () {
  for (const [key, value] of Object.entries(imports[specifier])) this.setExport(key, value);
}, { context }));
await module.evaluate();
const staff = [{ id: 'demo', name: 'Colaborador de prueba', modality: 'Full-Time', position: 'CAJA' }];
const schedules = { demo: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, { start: '09:00', end: '17:45', breakStart: '13:00', position: 'Caja' }])) };
module.namespace.exportSchedulePDF(staff, schedules, '2026-09-28_to_2026-10-04', false, true);
await writeFile('.tmp/break-preview.pdf', Buffer.from(pdf.output('arraybuffer')));
console.log('PDF de prueba generado');
