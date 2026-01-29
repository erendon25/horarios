// GeoVictoriaExport.js – Versión corregida
import * as XLSX from "xlsx";
import { parseISO, addDays, format } from "date-fns";

export const exportGeoVictoriaExcel = (staff, schedules, weekKey, turnoMap) => {
  if (!weekKey || !weekKey.includes('_to_')) {
    alert("Error: semana no válida");
    return;
  }

  const startDateStr = weekKey.split('_to_')[0];
  const startDate = parseISO(startDateStr);

  const wsData = [];
  const header = ["Nombre", "DNI", ...Array.from({ length: 31 }, (_, i) => i + 1)];
  wsData.push(header);

  const normalizeTime = (timeStr) => {
    if (!timeStr) return '';
    const [hh, mm] = timeStr.split(":").map(s => s.padStart(2, '0'));
    return `${hh}:${mm}`;
  };

  staff.forEach(person => {
    const dni = person.dni || person.DNI || "";
    if (!dni) return;

    const fullName = `${person.name || ""} ${person.lastName || ""}`.trim();
    const row = Array(33).fill("");
    row[0] = fullName;
    row[1] = dni;

    const personSchedule = schedules[person.id] || {};

    Object.entries(personSchedule).forEach(([weekday, data]) => {
      const dayOffset = {
        monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
        friday: 4, saturday: 5, sunday: 6
      }[weekday];

      if (dayOffset === undefined) return;

      const date = addDays(startDate, dayOffset);
      const dayOfMonth = parseInt(format(date, "d"), 10);

      // Día libre
      if (data?.off) {
        row[dayOfMonth + 1] = -1;
        return;
      }

      // Sin horario definido
      if (!data?.start || !data?.end) return;

      // CORRECCIÓN: Usar directamente start y end (Turno Base)
      // La lógica ahora es: start/end son el turno contractual (ej 9-13)
      // Las horas extras son ADICIONALES. Por tanto, para GeoVictoria enviamos el turno base tal cual.
      let start = normalizeTime(data.start);
      let end = normalizeTime(data.end);

      // Luego crear el turnoKey para el mapeo
      const turnoKey = `${start}-${end}`;
      const turnoNumber = turnoMap[turnoKey];

      let displayValue = turnoNumber;

      // Solo para visualización, si no se encontró el turno y termina a las 00:00
      if (turnoNumber === undefined) {
        const displayEnd = end === "00:00" ? "24:00" : end;
        displayValue = {
          v: `${start}-${displayEnd}`,
          s: { fill: { fgColor: { rgb: "FFCCCC" } } }
        };
      }

      if (turnoNumber !== undefined) {
        row[dayOfMonth + 1] = turnoNumber;
      } else {
        row[dayOfMonth + 1] = displayValue;
      }
    });

    wsData.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  Object.keys(ws).forEach(addr => {
    if (ws[addr] && ws[addr].v && typeof ws[addr].v === 'object') {
      const temp = ws[addr].v;
      ws[addr].v = temp.v;
      ws[addr].s = temp.s;
    }
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Planificacion");
  XLSX.writeFile(wb, "Planificacion_Mensual_GeoVictoria.xlsx");
};