import { describe, expect, it } from "vitest";
import { calculateOperationalMetrics, nightMinutes, periodBounds, type MetricsStaff } from "./operational-metrics";

const staff: MetricsStaff[] = [{ id: "one", first_name: "Ana", last_name: "Pérez", modality: "Full-Time", modality_change_date: "2026-07-15", next_modality: "Part-Time", is_trainee: false, cessation_date: null }];

describe("operational metrics", () => {
  it("calcula la franja nocturna 22:00-06:00 incluso cruzando medianoche", () => {
    expect(nightMinutes("21:00", "06:30")).toBe(480);
    expect(nightMinutes("05:30", "07:00")).toBe(30);
    expect(nightMinutes("08:00", "17:00")).toBe(0);
  });

  it("resuelve periodos sin depender de la zona horaria local", () => {
    expect(periodBounds("week", "2026-07-16")).toEqual({ start: "2026-07-13", end: "2026-07-19" });
    expect(periodBounds("month", "2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
  });

  it("preserva FT=8h, PT=4h, extras y saldo de feriados", () => {
    const result = calculateOperationalMetrics({
      staff,
      start: "2026-07-13",
      end: "2026-07-19",
      excludeTrainees: true,
      shifts: [
        { id: 1, staff_id: "one", work_date: "2026-07-14", start_time: "22:00", end_time: "06:00", is_day_off: false, is_holiday: false, metadata: { extraHoursPre: 0.5 } },
        { id: 2, staff_id: "one", work_date: "2026-07-16", start_time: "08:00", end_time: "12:00", is_day_off: false, is_holiday: false, metadata: {} },
      ],
      extras: [{ id: 1, staff_id: "one", work_date: "2026-07-14", start_time: null, end_time: null, duration_minutes: 75, pre_shift_minutes: 0, post_shift_minutes: 0, activity: null, source: "manual", daily_details: [] }],
      holidays: [
        { id: 1, staff_id: "one", holiday_date: "2026-07-10", name: "Feriado", balance_type: "ganado" },
        { id: 2, staff_id: "one", holiday_date: "2026-07-17", name: "Compensación", balance_type: "compensado" },
      ],
      salesDays: [{ sales_date: "2026-07-14", sales_amount: 1200, transactions: 80 }],
    });
    expect(result.standardMinutes).toBe(720);
    expect(result.nightMinutes).toBe(480);
    expect(result.plannedExtraMinutes).toBe(30);
    expect(result.registeredExtraMinutes).toBe(75);
    expect(result.holidaysCompensated).toBe(1);
    expect(result.holidayBalance).toBe(0);
    expect(result.sales).toBe(1200);
  });

  it("distribuye los totales GeoVictoria por día detallado", () => {
    const result = calculateOperationalMetrics({
      staff,
      start: "2026-07-14",
      end: "2026-07-14",
      excludeTrainees: false,
      shifts: [],
      holidays: [],
      salesDays: [],
      extras: [{ id: 2, staff_id: "one", work_date: "2026-07-13", start_time: null, end_time: null, duration_minutes: 180, pre_shift_minutes: 0, post_shift_minutes: 0, activity: null, source: "geovictoria_extra_hours", daily_details: [{ fecha: "2026-07-13", totalExtraMinutes: 60 }, { fecha: "2026-07-14", extraMinutesPre: 30, extraMinutesPost: 15 }] }],
    });
    expect(result.registeredExtraMinutes).toBe(45);
  });
});
