import * as XLSX from "xlsx";
import { parseISO, addDays, format } from "date-fns";

export const exportGeoVictoriaExcel = (staff, schedules, turnoMap, weekStartDate) => {
  const wsData = [];
  const header = ["Nombre", "DNI", ...Array.from({ length: 31 }, (_, i) => i + 1)];
  wsData.push(header);

  const startDate = parseISO(weekStartDate); // Lunes

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

    const schedule = schedules[person.id];
    if (!schedule) {
      wsData.push(row);
      return;
    }

    Object.entries(schedule).forEach(([weekday, data]) => {
      const dayOffset = {
        monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
        friday: 4, saturday: 5, sunday: 6
      }[weekday];

      if (dayOffset === undefined) return;

      const date = addDays(startDate, dayOffset);
      const dayOfMonth = parseInt(format(date, "d")); // 1–31

      if (data?.off) {
        row[dayOfMonth + 1] = -1;
        return;
      }

      if (!data?.start || !data?.end) return;

      const start = normalizeTime(data.start);
      const end = normalizeTime(data.end === "00:00" ? "00:00" : data.end);
      const turnoKey = `${start}-${end}`;
      const turnoNumber = turnoMap[turnoKey];

      if (turnoNumber !== undefined) {
        row[dayOfMonth + 1] = turnoNumber;
      } else {
        // ⛔ Turno no encontrado → celda con fondo rojo claro
        row[dayOfMonth + 1] = {
          v: turnoKey,
          s: {
            fill: { fgColor: { rgb: "FFCCCC" } }
          }
        };
      }
    });

    wsData.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Corrige formato para celdas con objetos tipo {v, s}
  Object.keys(ws).forEach((addr) => {
    const cell = ws[addr];
    if (cell && typeof cell.v === 'object' && 'v' in cell.v && 's' in cell.v) {
      ws[addr].v = cell.v.v;
      ws[addr].s = cell.v.s;
    }
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Planificacion");
  XLSX.writeFile(wb, "PlanificacionMensualMasiva.xlsx");
};

