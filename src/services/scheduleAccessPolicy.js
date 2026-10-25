const POLICY_KEYS = ['adminOnlyStudyEditing', 'requestsEnabled', 'blockedWeeks', 'blockedDates'];
const invalidPolicy = () => Object.assign(
  new Error('La configuración de acceso a horarios de esta tienda no es válida.'),
  { code: 'invalid_schedule_access_policy' },
);

const calendarDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
};

export const getScheduleWeekStart = (value) => {
  const date = calendarDate(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
};

export const normalizeScheduleAccessPolicy = (raw) => {
  // Only an absent document receives defaults. A present partial/corrupt
  // document must never silently enable requests or collaborator study edits.
  if (raw === undefined) return {
    adminOnlyStudyEditing: false, requestsEnabled: true, blockedWeeks: [], blockedDates: [],
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || POLICY_KEYS.some((key) => !Object.hasOwn(raw, key))
    || typeof raw.adminOnlyStudyEditing !== 'boolean' || typeof raw.requestsEnabled !== 'boolean'
    || !Array.isArray(raw.blockedWeeks) || !Array.isArray(raw.blockedDates)
    || Array.from(raw.blockedWeeks).some((week) => !calendarDate(week) || getScheduleWeekStart(week) !== week)
    || Array.from(raw.blockedDates).some((date) => !calendarDate(date))) {
    throw invalidPolicy();
  }
  return {
    adminOnlyStudyEditing: raw.adminOnlyStudyEditing,
    requestsEnabled: raw.requestsEnabled,
    blockedWeeks: [...new Set(raw.blockedWeeks)].sort(),
    blockedDates: [...new Set(raw.blockedDates)].sort(),
  };
};

const displayDate = (date) => date.split('-').reverse().join('/');

export const getRequestDateAccess = (policy, date) => {
  const week = getScheduleWeekStart(date);
  if (!week) return { allowed: false, reason: 'Selecciona una fecha válida para solicitar un horario.' };
  let normalized;
  try {
    // An unknown/loading policy is different from a verified missing document.
    if (policy === undefined || policy === null) throw invalidPolicy();
    normalized = normalizeScheduleAccessPolicy(policy);
  } catch {
    return { allowed: false, reason: 'No se pudo verificar la configuración de solicitudes de esta tienda.' };
  }
  if (!normalized.requestsEnabled) {
    return { allowed: false, reason: 'Las solicitudes de horario están deshabilitadas en esta tienda.' };
  }
  if (normalized.blockedDates.includes(date)) {
    return { allowed: false, reason: `Las solicitudes están bloqueadas para el ${displayDate(date)}.` };
  }
  if (normalized.blockedWeeks.includes(week)) {
    return { allowed: false, reason: `Las solicitudes están bloqueadas para la semana del ${displayDate(week)}.` };
  }
  return { allowed: true, reason: null };
};

export const getLimaToday = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};
