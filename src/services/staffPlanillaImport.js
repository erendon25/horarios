import * as XLSX from 'xlsx';

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const words = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const headerKey = value => words(value).replace(/[^A-Z0-9]/g, '');
const fields = {
  dni: ['Documento de Identidad', 'DNI', 'Número de Documento', 'Numero Documento'],
  name: ['Nombre', 'Nombres'],
  firstLastName: ['Primer Apellido', 'Apellido Paterno'],
  secondLastName: ['Segundo Apellido', 'Apellido Materno'],
  area: ['Área', 'Tienda'],
  specialty: ['Especialidad'],
  position: ['Cargo', 'Puesto'],
  modality: ['Modalidad'],
  contract: ['Contrato'],
};
const aliases = Object.fromEntries(Object.entries(fields).map(([field, names]) => [field, new Set(names.map(headerKey))]));
const requiredFields = ['dni', 'name', 'firstLastName', 'secondLastName', 'area'];
const MAX_DATA_ROWS = 500;

function findHeader(workbook) {
  for (const sheetName of workbook?.SheetNames ?? []) {
    const sheet = workbook.Sheets?.[sheetName];
    if (!sheet?.['!ref']) continue;
    let range;
    try { range = XLSX.utils.decode_range(sheet['!ref']); } catch { continue; }
    for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 99); row++) {
      const columns = {}, repeated = [];
      for (let column = range.s.c; column <= Math.min(range.e.c, range.s.c + 199); column++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (!cell || cell.f) continue;
        const key = headerKey(cell.v);
        if (!key) continue;
        for (const [field, values] of Object.entries(aliases)) {
          if (!values.has(key)) continue;
          if (Object.hasOwn(columns, field)) repeated.push(fields[field][0]);
          else columns[field] = column;
        }
      }
      if (requiredFields.every(field => Object.hasOwn(columns, field))) {
        return { sheetName, sheet, range, row, columns, repeated };
      }
    }
  }
  return null;
}

function normalizeDni(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 && value <= 99999999 ? String(value).padStart(8, '0') : '';
  }
  const raw = clean(value);
  if (/^\d{8}$/.test(raw)) return raw;
  // Accept an explicitly grouped document without confusing a decimal value
  // such as 1234567.0 with an eight-digit DNI.
  if (/^\d{2}([. -])\d{3}\1\d{3}$/.test(raw)) return raw.replace(/[. -]/g, '');
  return '';
}

function readClassification(value) {
  const normalized = words(value).replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return { modality: null, position: null, unknown: false };
  const part = /\b(?:PART(?: TIME)?|TIEMPO PARCIAL)\b/.test(normalized);
  const full = /\b(?:FULL(?: TIME)?|TIEMPO COMPLETO)\b/.test(normalized);
  const remainder = normalized.replace(/\b(?:PART(?: TIME)?|FULL(?: TIME)?|TIEMPO PARCIAL|TIEMPO COMPLETO)\b/g, '').replace(/\s+/g, ' ').trim();
  let position = null;
  if (/^(?:TEAM MEMBER|COLABORADOR)$/.test(remainder)) position = 'COLABORADOR';
  else if (/^(?:ENTRENADOR(?: DE TIENDA)?|TRAINER|ENTRENADOR TRAINER)$/.test(remainder)) position = 'ENTRENADOR';
  else if (/^ASISTENTE(?: DE)?(?: TIENDA)?$/.test(remainder)) position = 'ASISTENTE';
  else if (/^GERENTE(?: DE)?(?: TIENDA)?$/.test(remainder)) position = 'GERENTE';
  return { modality: part && !full ? 'Part-Time' : full && !part ? 'Full-Time' : null,
    position, unknown: Boolean(remainder && !position), contradictory: part && full };
}

function classification(values) {
  const errors = [], warnings = [];
  const labels = ['specialty', 'position', 'modality'].filter(field => clean(values[field]));
  const parsed = labels.map(field => ({ field, ...readClassification(values[field]) }));
  for (const item of parsed) {
    if (item.unknown) errors.push(`No se reconoce ${fields[item.field][0].toLowerCase()}: ${clean(values[item.field])}.`);
    if (item.contradictory) errors.push('La modalidad indica Full-Time y Part-Time al mismo tiempo.');
  }
  const contract = readClassification(values.contract);
  if (contract.contradictory) errors.push('El contrato indica modalidades contradictorias.');
  const modalities = new Set([...parsed.map(item => item.modality), contract.modality].filter(Boolean));
  const positions = new Set(parsed.map(item => item.position).filter(Boolean));
  if (modalities.size > 1) errors.push('La modalidad de la especialidad o cargo no coincide con el contrato.');
  if (positions.size > 1) errors.push('La especialidad y el cargo indican puestos diferentes.');
  const position = positions.size === 1 ? [...positions][0] : positions.size ? '' : 'COLABORADOR';
  let modality = modalities.size === 1 ? [...modalities][0] : '';
  if (!modality && !modalities.size && ['ENTRENADOR', 'ASISTENTE', 'GERENTE'].includes(position)) {
    modality = 'Full-Time';
    warnings.push(`Se propone Full-Time para ${position}; verifica la modalidad antes de importar.`);
  }
  if (!modality && !modalities.size) errors.push('No se pudo identificar si la modalidad es Full-Time o Part-Time.');
  return { modality, position, errors, warnings };
}

/** Read only the document, names, classification and store columns. */
export function parseStaffPlanilla(workbook) {
  const header = findHeader(workbook);
  const result = { rows: [], errors: [], warnings: [], sheetName: header?.sheetName ?? null, totalRows: 0 };
  if (!header) {
    throw new Error('No se encontró la cabecera de la planilla. Debe incluir Documento de Identidad, Nombre, Primer Apellido, Segundo Apellido y Área.');
  }
  if (header.repeated.length) {
    throw new Error(`La cabecera repite columnas: ${[...new Set(header.repeated)].join(', ')}.`);
  }
  if (header.range.e.r - header.row > MAX_DATA_ROWS) {
    throw new Error(`La planilla admite hasta ${MAX_DATA_ROWS} filas de datos.`);
  }
  if (!['specialty', 'position', 'modality', 'contract'].some(field => Object.hasOwn(header.columns, field))) {
    throw new Error('Falta una columna de Especialidad, Cargo, Modalidad o Contrato para identificar el puesto y la modalidad.');
  }
  for (let row = header.row + 1; row <= header.range.e.r; row++) {
    const cells = Object.fromEntries(Object.entries(header.columns).map(([field, column]) => [field, header.sheet[XLSX.utils.encode_cell({ r: row, c: column })]]));
    if (!Object.values(cells).some(cell => cell?.f || clean(cell?.v))) continue;
    const rowNumber = row + 1;
    const values = Object.fromEntries(Object.entries(cells).map(([field, cell]) => [field, cell?.f ? '' : cell?.v]));
    const problems = [];
    if (Object.values(cells).some(cell => cell?.f)) problems.push('Los campos de importación deben contener valores, no fórmulas.');
    const dni = normalizeDni(values.dni), name = clean(values.name), firstLastName = clean(values.firstLastName), secondLastName = clean(values.secondLastName), area = clean(values.area);
    if (!dni) problems.push('El DNI debe contener exactamente 8 dígitos.');
    if (!name || !firstLastName) problems.push('Nombre y primer apellido son obligatorios.');
    if (!area) problems.push('El área o tienda es obligatoria.');
    const mapped = classification(values);
    problems.push(...mapped.errors);
    const lastName = [firstLastName, secondLastName].filter(Boolean).join(' ');
    result.rows.push({ rowNumber, dni, name, lastName, fullName: [name, lastName].filter(Boolean).join(' '), modality: mapped.modality, position: mapped.position, area });
    result.errors.push(...problems.map(message => ({ rowNumber, message })));
    result.warnings.push(...mapped.warnings.map(message => ({ rowNumber, message })));
  }
  result.totalRows = result.rows.length;
  if (!result.totalRows) throw new Error('La planilla no contiene colaboradores para importar.');
  return result;
}

function todayInLima(now) {
  if (typeof now === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(now)) return now;
  const date = now instanceof Date ? now : new Date(now ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw new Error('La fecha de revisión no es válida.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function inactive(person, today) {
  if (words(person.status) === 'INACTIVE' || person.reconstructedFromHistory || person.reconstructed_from_history || words(`${person.name || ''} ${person.lastName || ''}`).startsWith('HISTORICO ')) return true;
  const trainee = person.isTrainee ?? person.is_trainee;
  const end = trainee ? (person.trainingEndDate ?? person.training_end_date) : (person.cessationDate || person.cessation_date || person.terminationDate);
  return Boolean(end && /^\d{4}-\d{2}-\d{2}/.test(end) && end.slice(0, 10) < today);
}

/** Build a non-mutating, create-only preview. Existing profiles are never patched. */
export function buildStaffImportPreview(parsed, { staff = [], storeId, storeName, now } = {}) {
  const errors = [...(parsed?.errors ?? [])];
  const invalidByRow = new Map();
  for (const problem of errors) invalidByRow.set(problem.rowNumber, [...(invalidByRow.get(problem.rowNumber) ?? []), problem.message]);
  let globalProblem = '';
  if (!storeId || !clean(storeName)) {
    globalProblem = 'No se pudo identificar la tienda actual. Vuelve a abrir el panel.';
    errors.push({ rowNumber: 0, message: globalProblem });
  }
  const today = todayInLima(now);
  const rows = parsed?.rows ?? [];
  const fileGroups = new Map();
  for (const row of rows) if (row.dni) fileGroups.set(row.dni, [...(fileGroups.get(row.dni) ?? []), row]);
  const currentByDni = new Map();
  for (const person of staff) {
    const dni = normalizeDni(person.dni);
    if (dni) currentByDni.set(dni, [...(currentByDni.get(dni) ?? []), person]);
  }
  const signature = row => [words(row.name), words(row.lastName), row.modality, row.position, headerKey(row.area)].join('|');
  const preview = rows.map(row => {
    let action = 'create', reason = 'Nuevo colaborador; los demás datos pueden completarse después.', existingId;
    const problems = invalidByRow.get(row.rowNumber) ?? [];
    const group = fileGroups.get(row.dni) ?? [];
    const conflict = group.length > 1 && new Set(group.map(signature)).size > 1;
    if (globalProblem || problems.length || invalidByRow.has(0)) {
      action = 'invalid'; reason = globalProblem || problems.join(' ') || invalidByRow.get(0).join(' ');
    } else if (conflict) {
      action = 'duplicate'; reason = 'El DNI aparece en varias filas con datos distintos. Corrige la planilla antes de importar ese colaborador.';
    } else if (headerKey(row.area) !== headerKey(storeName)) {
      action = 'other_store'; reason = `El área ${row.area} no corresponde a la tienda ${clean(storeName)}.`;
    } else if (group.length > 1 && row !== group[0]) {
      action = 'duplicate'; reason = 'Fila repetida por DNI; solo se considera la primera copia idéntica.';
    } else {
      const matches = currentByDni.get(row.dni) ?? [];
      const local = matches.filter(person => (person.storeId ?? person.store_id ?? storeId) === storeId);
      if (local.length) {
        const active = local.find(person => !inactive(person, today));
        existingId = (active ?? local[0]).id;
        action = active ? 'existing' : 'inactive';
        reason = active ? 'Ya existe un perfil con este DNI en la tienda; se conserva sin cambios.' : 'El DNI pertenece a un perfil inactivo, cesado o con entrenamiento finalizado; no se reactiva.';
      } else if (matches.length) {
        action = 'other_store'; reason = 'El DNI ya está registrado en otra tienda; no se traslada ni duplica.';
      }
    }
    return { ...row, action, reason, ...(existingId ? { existingId } : {}) };
  });
  const counts = { create: 0, existing: 0, inactive: 0, other_store: 0, duplicate: 0, invalid: 0 };
  for (const row of preview) counts[row.action]++;
  return { rows: preview, creatable: preview.filter(row => row.action === 'create'), counts, errors };
}
