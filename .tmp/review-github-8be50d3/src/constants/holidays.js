export const HOLIDAYS_2024 = [
    { date: "2024-01-01", name: "Año Nuevo" },
    { date: "2024-03-28", name: "Jueves Santo" },
    { date: "2024-03-29", name: "Viernes Santo" },
    { date: "2024-05-01", name: "Día del Trabajo" },
    { date: "2024-06-07", name: "Batalla de Arica y Día de la Bandera" },
    { date: "2024-06-29", name: "San Pedro y San Pablo" },
    { date: "2024-07-23", name: "Día de la Fuerza Aérea del Perú" },
    { date: "2024-07-28", name: "Fiestas Patrias" },
    { date: "2024-07-29", name: "Fiestas Patrias" },
    { date: "2024-08-06", name: "Batalla de Junín" },
    { date: "2024-08-30", name: "Santa Rosa de Lima" },
    { date: "2024-10-08", name: "Combate de Angamos" },
    { date: "2024-11-01", name: "Día de Todos los Santos" },
    { date: "2024-12-08", name: "Inmaculada Concepción" },
    { date: "2024-12-09", name: "Batalla de Ayacucho" },
    { date: "2024-12-25", name: "Navidad" }
];

export const HOLIDAYS_2025 = [
    { date: "2025-01-01", name: "Año Nuevo" },
    { date: "2025-04-17", name: "Jueves Santo" },
    { date: "2025-04-18", name: "Viernes Santo" },
    { date: "2025-05-01", name: "Día del Trabajo" },
    { date: "2025-06-07", name: "Batalla de Arica y Día de la Bandera" },
    { date: "2025-06-29", name: "San Pedro y San Pablo" },
    { date: "2025-07-23", name: "Día de la Fuerza Aérea del Perú" },
    { date: "2025-07-28", name: "Fiestas Patrias" },
    { date: "2025-07-29", name: "Fiestas Patrias" },
    { date: "2025-08-06", name: "Batalla de Junín" },
    { date: "2025-08-30", name: "Santa Rosa de Lima" },
    { date: "2025-10-08", name: "Combate de Angamos" },
    { date: "2025-11-01", name: "Día de Todos los Santos" },
    { date: "2025-12-08", name: "Inmaculada Concepción" },
    { date: "2025-12-09", name: "Batalla de Ayacucho" },
    { date: "2025-12-25", name: "Navidad" }
];

export const HOLIDAYS_2026 = [
    { date: "2026-01-01", name: "Año Nuevo" },
    { date: "2026-04-02", name: "Jueves Santo" },
    { date: "2026-04-03", name: "Viernes Santo" },
    { date: "2026-05-01", name: "Día del Trabajo" },
    { date: "2026-06-07", name: "Batalla de Arica y Día de la Bandera" },
    { date: "2026-06-29", name: "Día de San Pedro y San Pablo" },
    { date: "2026-07-23", name: "Día de la Fuerza Aérea del Perú" },
    { date: "2026-07-28", name: "Fiestas Patrias" },
    { date: "2026-07-29", name: "Fiestas Patrias" },
    { date: "2026-08-06", name: "Batalla de Junín" },
    { date: "2026-08-30", name: "Santa Rosa de Lima" },
    { date: "2026-10-08", name: "Combate de Angamos" },
    { date: "2026-11-01", name: "Día de Todos los Santos" },
    { date: "2026-12-08", name: "Inmaculada Concepción" },
    { date: "2026-12-09", name: "Batalla de Ayacucho" },
    { date: "2026-12-25", name: "Navidad" }
];

export const ALL_HOLIDAYS = [
    ...HOLIDAYS_2024,
    ...HOLIDAYS_2025,
    ...HOLIDAYS_2026
];

export const isHoliday = (dateString) => {
    return ALL_HOLIDAYS.find(h => h.date === dateString);
};
