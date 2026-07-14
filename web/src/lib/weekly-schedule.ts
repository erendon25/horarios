export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export const WEEKDAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] as const;
export type Weekday = typeof WEEKDAYS[number];

export type StudyBlock = { start: string; end: string };
export type StudyDay = { free: boolean; blocks: StudyBlock[] };
export type Shift = {
  date: string;
  start: string;
  end: string;
  position: string;
  off: boolean;
  holiday: boolean;
  notes: string;
  splitShift: boolean;
  start2: string;
  end2: string;
  extraHoursPre: number;
  extraHoursPost: number;
};
export type StaffWeek = Record<Weekday, Shift>;

export function addIsoDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mondayOf(isoDate: string) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  const distance = (date.getUTCDay() + 6) % 7;
  return addIsoDays(isoDate, -distance);
}

export function emptyShift(date: string): Shift {
  return { date, start: "", end: "", position: "", off: false, holiday: false, notes: "", splitShift: false, start2: "", end2: "", extraHoursPre: 0, extraHoursPost: 0 };
}

export function emptyStaffWeek(weekStart: string): StaffWeek {
  return Object.fromEntries(WEEKDAYS.map((day, index) => [day, emptyShift(addIsoDays(weekStart, index))])) as StaffWeek;
}

export function timeMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

export function segmentMinutes(start: string, end: string) {
  if (!start || !end) return 0;
  const from = timeMinutes(start);
  let to = timeMinutes(end);
  if (to <= from) to += 24 * 60;
  return to - from;
}

export function shiftMinutes(shift: Shift, isFullTime: boolean) {
  if (shift.off || !shift.start || !shift.end) return 0;
  let total = segmentMinutes(shift.start, shift.end);
  if (shift.splitShift && shift.start2 && shift.end2) total += segmentMinutes(shift.start2, shift.end2);
  if (isFullTime && !shift.splitShift) total = Math.max(0, total - 45);
  return total;
}

export function effectiveModality(staff: { modality: string | null; modality_change_date: string | null; next_modality: string | null }, date: string) {
  return staff.modality_change_date && staff.next_modality && date >= staff.modality_change_date ? staff.next_modality : staff.modality ?? "";
}

export function normalizePosition(value: string) {
  return value.trim().replace(/#\d+$/g, "").replace(/\s+/g, " ").toLocaleLowerCase("es");
}

function intervalsOverlap(start: string, end: string, blockStart: string, blockEnd: string) {
  const from = timeMinutes(start);
  let to = timeMinutes(end);
  if (to <= from) to += 1440;
  const studyFrom = timeMinutes(blockStart);
  let studyTo = timeMinutes(blockEnd);
  if (studyTo <= studyFrom) studyTo += 1440;
  return from < studyTo && to > studyFrom;
}

export function shiftConflicts(shift: Shift, study: StudyDay | undefined, skills: string[]) {
  if (!shift.start || !shift.end || !shift.position || shift.holiday) return [] as string[];
  const conflicts: string[] = [];
  if (study?.free) conflicts.push("Solicitó día libre por estudios");
  const normalizedSkills = new Set(skills.map(normalizePosition));
  if (!normalizedSkills.has(normalizePosition(shift.position))) conflicts.push("No posee la habilidad requerida");
  const segments = [[shift.start, shift.end], ...(shift.splitShift && shift.start2 && shift.end2 ? [[shift.start2, shift.end2]] : [])];
  if (study?.blocks.some((block) => segments.some(([start, end]) => intervalsOverlap(start, end, block.start, block.end)))) {
    conflicts.push("Conflicto con horario de estudio");
  }
  return conflicts;
}

export function serializeShift(shift: Shift) {
  return {
    date: shift.date,
    start: shift.off ? "" : shift.start,
    end: shift.off ? "" : shift.end,
    position: shift.off ? "" : shift.position,
    off: shift.off,
    holiday: shift.holiday,
    notes: shift.notes,
    metadata: {
      splitShift: shift.splitShift,
      start2: shift.splitShift ? shift.start2 : "",
      end2: shift.splitShift ? shift.end2 : "",
      extraHoursPre: shift.extraHoursPre,
      extraHoursPost: shift.extraHoursPost,
    },
  };
}

