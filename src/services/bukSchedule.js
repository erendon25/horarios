import { orderScheduleStaff, isBukScheduleExempt } from './scheduleStaffOrder.js';
import * as XLSX from 'xlsx';
import approved from '../data/bukApprovedShifts.js';
import defaultCatalog from '../data/bukShiftCatalog.js';
import { SCHEDULE_DAYS, SCHEDULE_DAY_LABELS, getWeekDates, effectiveModality, isActiveOnDate, getExportShiftSegments } from './scheduleExportData.js';
import { calculateScheduleTotals, formatScheduleMinutes, requiresScheduleBreak, getScheduleBreak } from './scheduleHours.js';

export const BUK_HEADERS = ['Nombre del Colaborador', 'RUT', 'Área', 'Supervisor'];
export const approvedBukShifts = approved;
export const defaultBukCatalog = defaultCatalog;
const normalize = value => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const dni = value => String(value ?? '').trim().replace(/[.\s-]/g, '');
const clock = value => {
  if (typeof value === 'number') {
    const minutes = Math.round(value * 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? '').trim());
  return m && +m[1] <= 24 && +m[2] < 60 ? `${String(+m[1] % 24).padStart(2, '0')}:${m[2]}` : '';
};
export const bukGroup = (modality, restDays) => normalize(modality).startsWith('FULL') ? 'FT1' : `PT${restDays}`;
export const getApprovedBukOptions = (modality, restDays) => approved.filter(shift => shift.group === bukGroup(modality, restDays));
const validRestDays = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 4;
const weeklyRestPlan = schedule => {
  const values = SCHEDULE_DAYS.map(day => schedule[day]?.bukRestDays);
  return values.every(validRestDays) && new Set(values.map(Number)).size === 1 ? Number(values[0]) : null;
};
const countRestDays = schedule => SCHEDULE_DAYS.filter(day => schedule[day]?.off).length;
const clampRestDays = value => Math.min(4, Math.max(1, value));

// New selections are stored on all seven days so the existing draft and server
// metadata round-trip the weekly plan. Older, mixed daily selections use the
// week's actual rest count before falling back to a deterministic saved choice.
export function getBukRestDays(modality, schedule = {}) {
  if (normalize(modality).startsWith('FULL')) return 1;
  const weekly = weeklyRestPlan(schedule);
  if (weekly !== null) return weekly;
  const actual = countRestDays(schedule);
  if (actual) return clampRestDays(actual);
  const saved = SCHEDULE_DAYS.map(day => schedule[day]?.bukRestDays).find(validRestDays);
  if (saved !== undefined) return Number(saved);
  const fromShift = SCHEDULE_DAYS.map(day => Number(schedule[day]?.bukApprovedShiftId?.match(/^PT([1-4])-/)?.[1])).find(validRestDays);
  return fromShift ?? 1;
}

export function applyBukSchedulePatch(schedule = {}, day, patch) {
  const next = { ...schedule, [day]: { ...schedule[day], ...patch } };
  let rests = validRestDays(patch.bukRestDays) ? Number(patch.bukRestDays) : null;
  if (rests === null && Object.hasOwn(patch, 'off') && Boolean(patch.off) !== Boolean(schedule[day]?.off)) {
    // Follow checkbox changes when the current plan matches the completed week;
    // keep an explicitly chosen target while its rest days are still being set.
    if (weeklyRestPlan(schedule) === null || getBukRestDays('Part-Time', schedule) === countRestDays(schedule)) {
      rests = clampRestDays(countRestDays(next));
    }
  }
  if (rests !== null) for (const key of SCHEDULE_DAYS) next[key] = { ...next[key], bukRestDays: rests };
  return next;
}

// Counts and gross durations from HORARIOS APROBADOS (D2, G2, J2, M2).
// Extras and break metadata do not change which daily slot a base shift uses.
const partTimePlanSlots = {
  1: [[240, 5], [225, 1]],
  2: [[285, 5]],
  3: [[405, 3], [345, 1]],
  4: [[525, 2], [510, 1]],
};
const baseShiftDuration = shift => {
  if (!shift || shift.off || shift.splitShift) return 0;
  const start = clock(shift.start), end = clock(shift.end);
  if (!start || !end) return 0;
  const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return (minutes(end) - minutes(start) + 1440) % 1440;
};

export function getBukWeeklyShiftQuota(modality, restDays, schedule = {}, editingDay) {
  if (normalize(modality) !== 'PART-TIME') return [];
  return (partTimePlanSlots[restDays] ?? []).map(([duration, total]) => {
    // Excluding the edited day allows changing an assigned shift without using
    // its slot twice. Compensated holidays retain their credited base range.
    const used = SCHEDULE_DAYS.filter(day => day !== editingDay && baseShiftDuration(schedule?.[day]) === duration).length;
    return { duration, total, used, remaining: Math.max(0, total - used) };
  });
}

export function getAvailableApprovedBukOptions(modality, restDays, schedule = {}, editingDay) {
  const options = getApprovedBukOptions(modality, restDays);
  if (normalize(modality) !== 'PART-TIME') return options;
  const remaining = new Set(getBukWeeklyShiftQuota(modality, restDays, schedule, editingDay)
    .filter(slot => slot.remaining > 0).map(slot => slot.duration));
  return options.filter(option => remaining.has(option.duration));
}

const bukDurationLabel = minutes => `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
export function approvedBukShiftLabel(shift) {
  const net = shift.breakMinutes ? ` (${bukDurationLabel(shift.duration - shift.breakMinutes)} netas; break de ${shift.breakMinutes} min)` : ' (sin break)';
  return `${shift.start} → ${shift.end} · ${bukDurationLabel(shift.duration)}${net}`;
}
export function findApprovedBukShiftByStart(modality, restDays, start, schedule, editingDay) {
  const options = schedule === undefined ? getApprovedBukOptions(modality, restDays)
    : getAvailableApprovedBukOptions(modality, restDays, schedule, editingDay);
  const matches = options.filter(item => item.start === clock(start));
  return matches.length && new Set(matches.map(item => item.end)).size === 1 ? matches[0] : null;
}
export function makeApprovedBukPatch(option, current = {}, day = 'monday', catalog = defaultCatalog) {
  const shift = approved.find(item => item.id === option);
  if (!shift) throw new Error('Selecciona un horario aprobado.');
  const match = catalog.find(item => normalize(item.day) === normalize(SCHEDULE_DAY_LABELS[SCHEDULE_DAYS.indexOf(day)]) && clock(item.start) === shift.start && clock(item.end) === shift.end);
  return { start: shift.start, end: shift.end, off: false,
    splitShift: false, start2: '', end2: '',
    bukRestDays: Number(shift.group.slice(2)), bukApprovedShiftId: shift.id, bukBreakMinutes: shift.breakMinutes,
    bukBreakIncludedInHours: false,
    breakStart: shift.breakMinutes ? clock(match?.breakStart) : '' };
}

export function getBukCatalogShift(shift, day, catalog = defaultCatalog) {
  if (!shift || shift.off || (shift.feriado ?? shift.holiday) || shift.splitShift || !clock(shift.start) || !clock(shift.end)) return null;
  const label = SCHEDULE_DAY_LABELS[SCHEDULE_DAYS.indexOf(day)];
  const matches = catalog.filter(item => normalize(item.day) === normalize(label)
    && clock(item.start) === clock(shift.start) && clock(item.end) === clock(shift.end));
  const definitions = new Set(matches.map(item => [item.code, clock(item.breakStart), clock(item.breakEnd)].join('|')));
  if (definitions.size !== 1) return null;
  const match = matches[0];
  return { code: match.code, start: clock(match.start), end: clock(match.end), breakStart: clock(match.breakStart), breakEnd: clock(match.breakEnd) };
}

export function bukRefrigerioRows({ staff, schedules, weekStart, catalog = defaultCatalog }) {
  const dates = getWeekDates(weekStart);
  return orderScheduleStaff(staff.filter(person => person.status !== 'inactive'), weekStart).flatMap(person =>
    SCHEDULE_DAYS.map((day, index) => {
      const shift = schedules[person.id]?.[day];
      const modality = effectiveModality(person, dates[index]);
      const buk = getBukCatalogShift(shift, day, catalog);
      const rest = getScheduleBreak(shift, modality);
      let state = 'Coincide';
      if (!isActiveOnDate(person, dates[index])) state = 'Cese';
      else if (isBukScheduleExempt(person)) state = 'No se envía a BUK';
      else if (shift?.off) state = 'Descanso';
      else if (shift?.feriado ?? shift?.holiday) state = 'Feriado compensado';
      else if (!shift?.start && !shift?.end) state = 'Sin turno';
      else if (!buk) state = 'Revisar turno BUK';
      else if (requiresScheduleBreak(shift, modality) && !rest) state = 'Break de cobertura pendiente';
      else if ((rest?.start || '') !== buk.breakStart || (rest?.end || '') !== buk.breakEnd) state = 'Diferencia de refrigerio';
      else if (!buk.breakStart) state = 'Sin refrigerio';
      const applies = ['Coincide', 'Break de cobertura pendiente', 'Diferencia de refrigerio', 'Sin refrigerio'].includes(state);
      return [`${person.name || ''} ${person.lastName || ''}`.trim(), modality, dates[index], SCHEDULE_DAY_LABELS[index],
        shift?.start || '', shift?.end || '', applies ? buk.code : '',
        applies ? (buk.breakStart ? `${buk.breakStart}–${buk.breakEnd}` : 'Sin refrigerio') : '',
        applies ? (rest ? `${rest.start}–${rest.end}` : requiresScheduleBreak(shift, modality) ? 'Pendiente' : 'Sin break') : '', state];
    }));
}

export function parseBukTemplate(workbook) {
  const sheet = workbook.Sheets.turnosColaboradores;
  if (!sheet) throw new Error('El archivo debe contener la hoja turnosColaboradores de BUK.');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (BUK_HEADERS.some((header, index) => normalize(rows[0]?.[index]) !== normalize(header))) throw new Error('Las cuatro primeras columnas no corresponden a la plantilla BUK.');
  const identities = rows.slice(1).filter(row => row[0] || row[1]).map(row => ({ name: String(row[0]), dni: dni(row[1]), area: String(row[2]), supervisor: String(row[3]) }));
  if (identities.some(row => !row.dni) || new Set(identities.map(row => row.dni)).size !== identities.length) throw new Error('La plantilla contiene DNI vacíos o duplicados.');
  const catalogSheet = workbook.Sheets.turnosSemanales;
  if (!catalogSheet) throw new Error('Falta la hoja de turnos activos turnosSemanales.');
  const catalog = XLSX.utils.sheet_to_json(catalogSheet, { header: 1, defval: '' }).slice(1).map(row => ({ code: String(row[1]), day: String(row[2]), start: clock(row[3]), end: clock(row[4]), breakStart: clock(row[5]), breakEnd: clock(row[6]) }));
  const auxiliarySheets = Object.fromEntries(['turnosSemanales', 'turnosFlexibles', 'turnosTransitorios'].filter(name => workbook.Sheets[name]).map(name => [name, XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' })]));
  return { identities, catalog, auxiliarySheets };
}

export function systemBukIdentities(staff, weekStart, storeName, supervisorName) {
  if (!storeName?.trim()) throw new Error('La tienda no tiene un nombre registrado.');
  if (!supervisorName?.trim()) throw new Error('No se encontró el nombre del gerente de la tienda.');
  const dates = getWeekDates(weekStart);
  return staff.filter(person => person.status !== 'inactive' && dates.some(date => isActiveOnDate(person, date)))
    .map(person => ({ name: `${person.name || ''} ${person.lastName || ''}`.trim(), dni: dni(person.dni ?? person.DNI), area: storeName, supervisor: supervisorName }));
}

export function buildBukRows({ staff, schedules, weekStart, identities, storeName, supervisorName, catalog = defaultCatalog }) {
  const dates = getWeekDates(weekStart);
  if (new Date(`${weekStart}T12:00:00Z`).getUTCDay() !== 1) throw new Error('La semana debe comenzar un lunes.');
  identities ??= systemBukIdentities(staff, weekStart, storeName, supervisorName);
  if (!identities.length) throw new Error('La tienda no tiene personal vigente para esta semana.');
  const byDni = new Map();
  const errors = [];
  for (const person of staff) {
    if (person.status === 'inactive' || !dates.some(date => isActiveOnDate(person, date))) continue;
    const key = dni(person.dni ?? person.DNI);
    if (!key) { errors.push(`${person.name}: falta DNI.`); continue; }
    if (byDni.has(key)) errors.push(`DNI duplicado en el personal: ${key}.`);
    byDni.set(key, person);
    if (!identities.some(row => row.dni === key)) errors.push(`${person.name}: no aparece en la plantilla BUK.`);
  }
  const identityByDni = new Map(identities.map(identity => [identity.dni, identity]));
  const orderedIdentities = orderScheduleStaff([...byDni.values()], weekStart)
    .map(person => identityByDni.get(dni(person.dni ?? person.DNI))).filter(Boolean);
  orderedIdentities.push(...identities.filter(identity => !byDni.has(identity.dni)));
  const rows = orderedIdentities.map(identity => {
    const person = byDni.get(identity.dni);
    const values = SCHEDULE_DAYS.map((day, index) => {
      // BUK treats empty cells as no change: managerial shifts are informational only.
      if (!person || isBukScheduleExempt(person) || !isActiveOnDate(person, dates[index])) return '';
      const shift = schedules[person.id]?.[day];
      if (!shift) return '';
      if (shift.off) return 'D';
      if (shift.feriado || shift.holiday) return 'F';
      if (!shift.start && !shift.end) return '';
      const prefix = `${identity.name}, ${dates[index]}`;
      if (shift.splitShift) { errors.push(`${prefix}: turno partido; requiere un turno equivalente en BUK.`); return ''; }
      const matches = catalog.filter(item => normalize(item.day) === normalize(SCHEDULE_DAY_LABELS[index]) && clock(item.start) === clock(shift.start) && clock(item.end) === clock(shift.end) && item.start && item.end);
      const codes = [...new Set(matches.map(item => item.code))];
      if (codes.length !== 1) { errors.push(`${prefix}: turno ${shift.start || '?'} A ${shift.end || '?'} ${codes.length ? 'ambiguo' : 'no disponible'} en BUK.`); return ''; }
      // Breaks chosen in the editor organize store coverage. BUK keeps the
      // collation already defined by this active shift code; neither is moved.
      return codes[0];
    });
    return [identity.name, identity.dni, identity.area, identity.supervisor, ...values];
  });
  if (errors.length) throw new Error(errors.join('\n'));
  return [[...BUK_HEADERS, ...dates.map(date => date.split('-').reverse().join('-'))], ...rows];
}

export function createBukWorkbook(data) {
  const rows = buildBukRows(data);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 46 }, { wch: 13 }, { wch: 24 }, { wch: 46 }, ...Array(7).fill({ wch: 20 })];
  XLSX.utils.book_append_sheet(workbook, sheet, 'turnosColaboradores');
  const catalog = data.catalog ?? defaultCatalog;
  const weeklyCatalog = XLSX.utils.aoa_to_sheet([['Nombre del turno', 'Siglas', 'Nombre del día', 'Entrada del turno', 'Salida del turno', 'Entrada de colación', 'Salida de colación'], ...catalog.map(item => [item.code, item.code, item.day, item.start || '-', item.end || '-', item.breakStart || '-', item.breakEnd || '-'])]);
  weeklyCatalog['!cols'] = [24, 24, 16, 20, 20, 24, 24].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, weeklyCatalog, 'turnosSemanales');
  for (const name of ['turnosFlexibles', 'turnosTransitorios']) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Nombre del turno', 'Sigla']]), name);
  for (const [name, values] of Object.entries(data.auxiliarySheets || {})) workbook.Sheets[name] = XLSX.utils.aoa_to_sheet(values);
  return workbook;
}

export function planningBukRows(staff, schedules, weekStart) {
  const dates = getWeekDates(weekStart);
  return orderScheduleStaff(staff.filter(person => person.status !== 'inactive'), weekStart).map((person, index) => {
    const schedule = schedules[person.id] ?? {};
    const rests = SCHEDULE_DAYS.filter((day, i) => isActiveOnDate(person, dates[i]) && schedule[day]?.off).length;
    const valid = {};
    const cells = SCHEDULE_DAYS.map((day, i) => {
      const shift = schedule[day];
      if (!isActiveOnDate(person, dates[i])) return ['CESE', '', ''];
      valid[day] = shift;
      if (shift?.off) return ['DESCANSO', '', ''];
      if (shift?.feriado || shift?.holiday) return ['FERIADO', '', ''];
      const segment = getExportShiftSegments(shift)[0];
      const displayed = minute => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      return [segment ? displayed(segment.start) : shift?.start || '', segment ? displayed(segment.end) : shift?.end || '', shift?.position || ''];
    }).flat();
    const total = calculateScheduleTotals(valid, person, weekStart);
    const modality = effectiveModality(person, weekStart);
    const full = normalize(modality).startsWith('FULL');
    const expected = full ? 2880 : 1425;
    const complete = SCHEDULE_DAYS.every((day, i) => !isActiveOnDate(person, dates[i]) || schedule[day]?.off || (schedule[day]?.start && schedule[day]?.end));
    const state = isBukScheduleExempt(person) ? 'HORARIO LIBRE' : !complete ? 'INCOMPLETO' : total.baseMinutes === expected && (full ? rests === 1 : rests >= 1 && rests <= 4) ? 'CORRECTO' : 'REVISAR';
    return [index + 1, `${person.name || ''} ${person.lastName || ''}`.trim(), modality, `${rests} día${rests === 1 ? '' : 's'}`, ...cells, formatScheduleMinutes(total.totalMinutes), state];
  });
}

export function createBukPlanningWorkbook({ staff, schedules, weekStart, identities, catalog, storeName, supervisorName }) {
  const workbook = XLSX.utils.book_new();
  if (identities?.length || (storeName && supervisorName)) {
    try {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(buildBukRows({ staff, schedules, weekStart, identities, catalog, storeName, supervisorName })), 'BUK');
    } catch (cause) {
      // Compartir la planificación sigue siendo posible; nunca generar una
      // hoja de importación aparentemente válida con turnos no disponibles.
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ['NO IMPORTAR EN BUK: turnos pendientes de validar'],
        ...String(cause.message).split('\n').map(message => [message]),
      ]), 'BUK PENDIENTE');
    }
  }
  const dates = getWeekDates(weekStart);
  const rows = [['N°', 'NOMBRE DEL COLABORADOR', 'MODALIDAD', 'DESCANSO', ...dates.flatMap((date, i) => [`${SCHEDULE_DAY_LABELS[i]} ${date} · INGRESO`, 'SALIDA', 'POSICIÓN']), 'HORAS NETAS', 'CONTROL'], ...planningBukRows(staff, schedules, weekStart)];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'PLANIFICACIÓN');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Plan', 'Ingreso', 'Salida', 'Refrigerio (min)'], ...approved.map(item => [item.group, item.start, item.end, item.breakMinutes])]), 'HORARIOS APROBADOS');
  const refrigerios = XLSX.utils.aoa_to_sheet([
    ['Colaborador', 'Modalidad', 'Fecha', 'Día', 'Ingreso base', 'Salida base', 'Turno BUK', 'Refrigerio BUK', 'Break de cobertura', 'Revisión'],
    ...bukRefrigerioRows({ staff, schedules, weekStart, catalog }),
  ]);
  refrigerios['!cols'] = [46, 14, 14, 16, 16, 16, 24, 24, 24, 32].map(wch => ({ wch }));
  refrigerios['!autofilter'] = { ref: refrigerios['!ref'] };
  XLSX.utils.book_append_sheet(workbook, refrigerios, 'REFRIGERIOS');
  return workbook;
}
