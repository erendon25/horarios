import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { parseStaffPlanilla, buildStaffImportPreview } from './staffPlanillaImport.js';

const header = ['Contrato', 'Especialidad', 'Cargo', 'Documento de Identidad', 'Nombre', 'Primer Apellido', 'Segundo Apellido', 'Área'];
const person = (overrides = {}) => ({ contract: 'TIEMPO PARCIAL', specialty: 'TEAM MEMBER PART TIME', position: '', dni: '01234567', name: 'ANA MARÍA', first: 'PÉREZ', second: 'GARCÍA', area: 'PORONGOCHE', ...overrides });
function workbook(people, headers = header) {
  const rows = [[], ['INGRESO MASIVO'], [], headers, ...people.map(p => [p.contract, p.specialty, p.position, p.dni, p.name, p.first, p.second, p.area])];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Trabajador');
  return book;
}
const preview = (parsed, staff = [], more = {}) => buildStaffImportPreview(parsed, { staff, storeId: 'store-a', storeName: 'Porongoche', now: '2026-10-24', ...more });

test('localiza la cabecera bajo títulos, une nombres y apellidos y conserva el DNI con cero inicial', () => {
  const parsed = parseStaffPlanilla(workbook([person()]));
  assert.equal(parsed.sheetName, 'Trabajador');
  assert.equal(parsed.totalRows, 1);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.rows[0], { rowNumber: 5, dni: '01234567', name: 'ANA MARÍA', lastName: 'PÉREZ GARCÍA', fullName: 'ANA MARÍA PÉREZ GARCÍA', modality: 'Part-Time', position: 'COLABORADOR', area: 'PORONGOCHE' });
  assert.equal(preview(parsed).creatable.length, 1);
});

test('lee las cinco categorías sin confundir entrenador con personal en entrenamiento', () => {
  const parsed = parseStaffPlanilla(workbook([
    person({ dni: '00000001', contract: 'INICIO O INCREMENTO DE NUEVA ACTIVIDAD', specialty: 'TEAM MEMBER FULL TIME' }),
    person({ dni: '00000002' }),
    person({ dni: '00000003', contract: '', specialty: 'ENTRENADOR' }),
    person({ dni: '00000004', contract: '', specialty: 'ASISTENTE DE TIENDA' }),
    person({ dni: '00000005', contract: '', specialty: 'GERENTE DE TIENDA' }),
    person({ dni: '00000006', specialty: 'ENTRENADOR' }),
  ]));
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.rows.map(row => [row.modality, row.position]), [
    ['Full-Time', 'COLABORADOR'], ['Part-Time', 'COLABORADOR'], ['Full-Time', 'ENTRENADOR'],
    ['Full-Time', 'ASISTENTE'], ['Full-Time', 'GERENTE'], ['Part-Time', 'ENTRENADOR'],
  ]);
  assert.equal(parsed.warnings.length, 3);
  assert.ok(parsed.rows.every(row => row.isTrainee !== true));
});

test('normaliza cabeceras, espacios y área; un segundo apellido vacío es válido', () => {
  const changed = [' CONTRATO ', 'especialidad', 'cargo', ' documento de identidad ', ' NOMBRES ', 'APELLIDO PATERNO', 'APELLIDO MATERNO', ' aReA '];
  const parsed = parseStaffPlanilla(workbook([person({ name: '  Ana   María\n', first: ' Pérez ', second: '', area: ' Porongoche  ' })], changed));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows[0].fullName, 'Ana María Pérez');
  assert.equal(preview(parsed).counts.create, 1);
});

test('reconstruye ceros en celdas numéricas, pero rechaza DNI de texto corto, decimal o inválido', () => {
  const parsed = parseStaffPlanilla(workbook([
    person({ dni: 1234567 }), person({ dni: '1234567' }), person({ dni: '1234567.0' }),
    person({ dni: 1234567.5 }), person({ dni: '123456789' }), person({ dni: '12.345.678' }),
  ]));
  assert.equal(parsed.rows[0].dni, '01234567');
  assert.equal(parsed.rows[5].dni, '12345678');
  const result = preview(parsed);
  assert.equal(result.counts.create, 2);
  assert.equal(result.counts.invalid, 4);
});

test('rechaza fórmulas en los campos importables aunque tengan valores almacenados', () => {
  const book = workbook([person(), person({ dni: '11234567' })]);
  book.Sheets.Trabajador.D5 = { t: 's', v: '01234567', f: 'TEXT(1234567,"00000000")' };
  book.Sheets.Trabajador.E6 = { t: 's', v: 'Ana', f: '"Ana"' };
  const result = preview(parseStaffPlanilla(book));
  assert.equal(result.creatable.length, 0);
  assert.equal(result.counts.invalid, 2);
  assert.ok(result.errors.some(error => error.message.includes('no fórmulas')));
});

test('señala categorías desconocidas y contradicciones, sin impedir importar otras filas válidas', () => {
  const parsed = parseStaffPlanilla(workbook([
    person(),
    person({ dni: '11234567', specialty: 'SUPERVISOR REGIONAL' }),
    person({ dni: '21234567', specialty: 'TEAM MEMBER FULL TIME' }),
    person({ dni: '31234567', specialty: 'ENTRENADOR', position: 'GERENTE' }),
    person({ dni: '41234567', specialty: 'TEAM MEMBER', contract: 'CONTRATO ESPECIAL' }),
  ]));
  const result = preview(parsed);
  assert.equal(result.counts.create, 1);
  assert.equal(result.counts.invalid, 4);
  assert.ok(result.errors.some(error => error.message.includes('no coincide')));
  assert.ok(result.errors.some(error => error.message.includes('puestos diferentes')));
});

test('el área es obligatoria y no se confunde la tienda destino con otra del archivo', () => {
  const parsed = parseStaffPlanilla(workbook([person(), person({ dni: '11234567', area: 'La Salle' }), person({ dni: '21234567', area: '' })]));
  const result = preview(parsed);
  assert.equal(result.counts.create, 1);
  assert.equal(result.counts.other_store, 1);
  assert.equal(result.counts.invalid, 1);
  assert.equal(preview(parsed, [], { storeId: '' }).counts.create, 0);
  const missingHeader = workbook([person()], header.map(value => value === 'Área' ? 'Dirección' : value));
  assert.throws(() => parseStaffPlanilla(missingHeader), /No se encontró la cabecera/);
});

test('un archivo sin cabecera, vacío o demasiado grande produce un error legible', () => {
  assert.throws(() => parseStaffPlanilla(XLSX.utils.book_new()), /cabecera/);
  assert.throws(() => parseStaffPlanilla(workbook([])), /no contiene colaboradores/);
  const huge = workbook([person()]); huge.Sheets.Trabajador['!ref'] = 'A1:H999999';
  assert.throws(() => parseStaffPlanilla(huge), /hasta 500/);
});

test('las copias idénticas solo consideran la primera; los duplicados contradictorios se omiten todos', () => {
  const repeated = parseStaffPlanilla(workbook([person(), person({ name: 'Ana María' })]));
  assert.equal(preview(repeated).counts.create, 1);
  assert.equal(preview(repeated).counts.duplicate, 1);
  const contradictory = parseStaffPlanilla(workbook([person(), person({ first: 'OTRO' })]));
  assert.equal(preview(contradictory).counts.create, 0);
  assert.equal(preview(contradictory).counts.duplicate, 2);
});

test('reimportar no modifica perfiles existentes, cuentas ni datos de carnet o disponibilidad', () => {
  const staff = [{ id: 'existing', dni: '01234567', name: 'Nombre anterior', lastName: 'Apellido anterior', modality: 'Full-Time', position: 'ENTRENADOR', storeId: 'store-a', status: 'active', uid: 'account', sanitaryCardExpiry: '2028-10-24', availability: { monday: true } }];
  const before = structuredClone(staff);
  const result = preview(parseStaffPlanilla(workbook([person()])), staff);
  assert.equal(result.counts.existing, 1);
  assert.equal(result.rows[0].existingId, 'existing');
  assert.equal(result.creatable.length, 0);
  assert.deepEqual(staff, before);
});

test('cesados, inactivos y entrenamientos finalizados no se reactivan; un entrenador vigente sí se conserva', () => {
  const staff = [
    { id: 'a', dni: '00000001', status: 'inactive' },
    { id: 'b', dni: '00000002', status: 'active', cessationDate: '2026-10-23' },
    { id: 'c', dni: '00000003', status: 'active', isTrainee: true, trainingEndDate: '2026-10-23' },
    { id: 'd', dni: '00000004', status: 'active', position: 'ENTRENADOR', isTrainee: false, trainingEndDate: '2026-10-23' },
    { id: 'e', dni: '00000005', status: 'active', cessationDate: '2026-10-24' },
  ];
  const result = preview(parseStaffPlanilla(workbook(staff.map(p => person({ dni: p.dni })))), staff);
  assert.equal(result.counts.inactive, 3);
  assert.equal(result.counts.existing, 2);
  assert.equal(result.creatable.length, 0);
});

test('los DNI conocidos de otra tienda no se duplican ni trasladan', () => {
  const result = preview(parseStaffPlanilla(workbook([person()])), [{ id: 'foreign', dni: '01234567', store_id: 'store-b', status: 'active' }]);
  assert.equal(result.counts.other_store, 1);
  assert.equal(result.creatable.length, 0);
});

test('valida fecha de cese según Lima y permite el último día registrado', () => {
  const staff = [{ id: 'a', dni: '01234567', status: 'active', cessationDate: '2026-10-24' }];
  const parsed = parseStaffPlanilla(workbook([person()]));
  assert.equal(preview(parsed, staff, { now: new Date('2026-10-25T02:00:00Z') }).counts.existing, 1);
  assert.equal(preview(parsed, staff, { now: new Date('2026-10-25T05:01:00Z') }).counts.inactive, 1);
});

test('no muta el análisis ni importa datos adicionales sensibles', () => {
  const book = workbook([person()]);
  book.Sheets.Trabajador.I4 = { t: 's', v: 'Sueldo/Total Ingresos' };
  book.Sheets.Trabajador.I5 = { t: 'n', v: 999999 };
  book.Sheets.Trabajador['!ref'] = 'A1:I5';
  const parsed = parseStaffPlanilla(book), before = structuredClone(parsed);
  const result = preview(parsed);
  assert.deepEqual(parsed, before);
  assert.ok(!JSON.stringify(result).includes('999999'));
  assert.ok(!JSON.stringify(result).includes('Sueldo'));
});

const realPath = '/workspace/attachments/2343c055-485a-495e-b348-4f8176d138a9/Planilla_24-10-2026.xls';
test('planilla aportada: 32 personas, 20 Part-Time, 12 Full-Time, 2 entrenadores y 2 asistentes', { skip: !fs.existsSync(realPath) }, () => {
  const parsed = parseStaffPlanilla(XLSX.read(fs.readFileSync(realPath), { type: 'buffer', cellDates: false }));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.totalRows, 32);
  assert.equal(parsed.rows.filter(row => row.modality === 'Part-Time').length, 20);
  assert.equal(parsed.rows.filter(row => row.modality === 'Full-Time').length, 12);
  assert.equal(parsed.rows.filter(row => row.position === 'ENTRENADOR').length, 2);
  assert.equal(parsed.rows.filter(row => row.position === 'ASISTENTE').length, 2);
  assert.equal(parsed.rows.filter(row => row.position === 'COLABORADOR').length, 28);
  assert.ok(parsed.rows.every(row => row.fullName === `${row.name} ${row.lastName}`));
  assert.equal(preview(parsed).creatable.length, 32);
});
