// Render the actual AdminDashboard with the real parsed planilla cohort.
// Only loaded state and transport boundaries are injected; no database access.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import * as XLSX from 'xlsx';
import { parseStaffPlanilla } from '../src/services/staffPlanillaImport.js';
import { summarizeStaffDashboard, sortStaffBySanitaryCard } from '../src/components/staffDashboardSummary.js';
import { isStaffActive } from '../src/components/Training/staffStatus.js';

const sourcePath = process.env.STAFF_PLANILLA_SOURCE || '/workspace/attachments/2343c055-485a-495e-b348-4f8176d138a9/Planilla_24-10-2026.xls';
const workbook = XLSX.read(await fs.readFile(sourcePath), { type: 'buffer', cellDates: false, cellFormula: true });
const parsed = parseStaffPlanilla(workbook);
assert.equal(parsed.rows.length, 32);
assert.deepEqual(parsed.errors, []);
const cohort = parsed.rows.map((row, index) => ({
  ...row, id: `qa-planilla-${index + 1}`, storeId: 'qa-store', status: 'pending', needsCompletion: true,
  isTrainee: false, uid: null, email: '', joinDate: '', sanitaryCardDate: '', sanitaryCardExpiry: null, skills: [],
}));
const original = structuredClone(cohort);
const passed = [];
function pass(name) { passed.push(name); console.log(`PASS: ${name}`); }

assert.ok(cohort.every(person => isStaffActive(person, new Date('2026-10-24T12:00:00Z'))));
assert.deepEqual(summarizeStaffDashboard(cohort), {
  total: 32, manager: 0, assistant: 2, fullTime: 10, partTime: 20,
  training: 0, trainingFullTime: 0, trainingPartTime: 0, unassigned: 0,
});
pass('Las 32 altas pending cuentan en plantilla: 10 FT, 20 PT y 2 asistentes; entrenadores no son trainees');

for (const direction of ['asc', 'desc']) {
  const dated = { ...cohort[0], id: 'dated', sanitaryCardDate: '2027-10-24', needsCompletion: false };
  const sorted = sortStaffBySanitaryCard([...cohort, dated], direction);
  assert.equal(sorted.length, 33);
  assert.equal(sorted[0].id, 'dated');
  assert.deepEqual(new Set(sorted.slice(1).map(person => person.id)), new Set(cohort.map(person => person.id)));
}
assert.deepEqual(cohort, original);
pass('Ordenar carnet conserva las 32 altas sin fecha y las sitúa después de las fechas registradas');

const output = path.resolve('output/staff-planilla-dashboard');
await fs.mkdir(output, { recursive: true });
const compiled = path.join(output, 'admin-render.cjs');
const source = await fs.readFile('src/components/AdminDashboard.jsx', 'utf8');
const replacements = [
  ['const [staff, setStaff] = useState([]);', 'const [staff, setStaff] = useState(globalThis.__planillaDashboardQA.staff);'],
  ['const [loading, setLoading] = useState(true);', 'const [loading, setLoading] = useState(false);'],
  ['const [storeName, setStoreName] = useState("");', 'const [storeName, setStoreName] = useState("Porongoche");'],
  ['const [searchTerm, setSearchTerm] = useState("");', 'const [searchTerm, setSearchTerm] = useState(globalThis.__planillaDashboardQA.search);'],
  ["const [carnetSort, setCarnetSort] = useState('default');", 'const [carnetSort, setCarnetSort] = useState(globalThis.__planillaDashboardQA.sort);'],
];
let injected = source;
for (const [before, after] of replacements) {
  assert.equal(injected.split(before).length, 2, `Loaded-state injection no longer matches: ${before}`);
  injected = injected.replace(before, after);
}

const auth = `export function useAuth(){return {logout:()=>{},currentUser:{uid:'qa-admin',email:'qa@example.test'},userRole:'admin',userData:{storeId:'qa-store'}}}`;
const transport = `export const getFirestore=()=>({});export const doc=()=>({});export const collection=doc;export const query=doc;export const where=doc;
export const getDoc=async()=>{throw Error('Unexpected QA transport call')};export const getDocs=getDoc;export const updateDoc=getDoc;export const setDoc=getDoc;export const deleteDoc=getDoc;export const addDoc=getDoc;export const onSnapshot=getDoc;`;
await build({
  stdin: {
    contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {StaticRouter} from 'react-router-dom/server.js';import AdminDashboard from './src/components/AdminDashboard.jsx';export function renderDashboard(){return renderToStaticMarkup(<StaticRouter location="/admin"><AdminDashboard/></StaticRouter>)}`,
    loader: 'jsx', resolveDir: process.cwd(),
  },
  outfile: compiled, platform: 'node', format: 'cjs', bundle: true, packages: 'external',
  loader: { '.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl' }, logLevel: 'silent',
  plugins: [{ name: 'qa-dashboard-boundaries', setup(b) {
    b.onLoad({ filter: /components\/AdminDashboard\.jsx$/ }, () => ({ contents: injected, loader: 'jsx' }));
    b.onLoad({ filter: /contexts\/AuthContext\.jsx$/ }, () => ({ contents: auth, loader: 'js' }));
    b.onLoad({ filter: /lib\/supabase\/client\.js$/ }, () => ({ contents: 'export const supabase={};', loader: 'js' }));
    b.onLoad({ filter: /lib\/supabase\/firestoreCompat\.js$/ }, () => ({ contents: transport, loader: 'js' }));
    b.onLoad({ filter: /src\/supabase\.js$/ }, () => ({ contents: 'export const db={};', loader: 'js' }));
    b.onLoad({ filter: /components\/(StudyScheduleEditor|ModalSelectorDePosiciones|StaffModal|SanitaryCardQuickEdit|ArchivedStaffHistory|VHLConsultation|ScheduleRequestsManager|HolidayBalancePanel|HolidayPaymentSettings)\.jsx$/ }, () => ({ contents: 'export default function UnopenedPanel(){return null}', loader: 'js' }));
  } }],
});
const { renderDashboard } = await import(pathToFileURL(compiled));
const decode = value => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");
function render(search = '', sort = 'default') {
  globalThis.__planillaDashboardQA = { staff: cohort, search, sort };
  return renderDashboard();
}
function tableRows(html) {
  const table = html.match(/<table\b[^>]*class="[^"]*admin-staff-table[^"]*"[^>]*>([\s\S]*?)<\/table>/)?.[1];
  assert.ok(table, 'The real dashboard staff table must render');
  const body = table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
  assert.ok(body);
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(match => decode(match[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim());
}
try {
  const html = render();
  const controls = html.match(/<div class="admin-controls\b[\s\S]*?<\/div>/)?.[0];
  assert.ok(controls?.includes('Importar planilla BUK'));
  assert.ok(controls?.includes('Agregar Personal'));
  const rows = tableRows(html);
  assert.equal(rows.length, 32);
  for (const person of cohort) {
    assert.ok(rows.some(row => row.includes(person.fullName)));
    assert.ok(rows.some(row => row.includes(person.dni)));
  }
  pass('AdminDashboard real muestra el botón Importar junto a Agregar y las 32 altas con nombre completo y DNI');

  for (const direction of ['asc', 'desc']) assert.equal(tableRows(render('', direction)).length, 32);
  pass('El filtro real de la tabla y sus dos órdenes de carnet mantienen visibles las altas incompletas');

  const selected = cohort[0];
  const byDocument = tableRows(render(selected.dni));
  assert.equal(byDocument.length, 1);
  assert.ok(byDocument[0].includes(selected.fullName));
  const byName = tableRows(render(selected.fullName.toLowerCase()));
  assert.equal(byName.length, 1);
  assert.ok(byName[0].includes(selected.dni));
  pass('La búsqueda real por DNI y nombre completo encuentra el perfil importado sin duplicados');

  assert.deepEqual(cohort, original);
  await fs.writeFile(path.join(output, 'resultado.json'), JSON.stringify({ status: 'PASS', passed, sourceRows: cohort.length, scope: 'Actual AdminDashboard JSX rendered with injected loaded state and isolated transports; actual parser, grouping, sort and row filtering; no production access' }, null, 2));
} finally {
  delete globalThis.__planillaDashboardQA;
  await fs.rm(compiled, { force: true });
}
