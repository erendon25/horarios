import { describe, expect, it } from "vitest";
import { formatMinutes, holidayBalance, hydrateOwnWeek } from "./staff-self-service";

describe("staff self-service helpers", () => {
  it("hydrates regular, split and extra-hour schedule metadata", () => {
    const week = hydrateOwnWeek("2026-07-13", [{ work_date: "2026-07-14", start_time: "08:00:00", end_time: "12:00:00", position: "Caja", is_day_off: false, is_holiday: false, notes: null, metadata: { splitShift: true, start2: "16:00", end2: "20:00", extraHoursPre: 0.5, extraHoursPost: "1" } }]);
    expect(week.tuesday).toMatchObject({ start: "08:00", end: "12:00", position: "Caja", splitShift: true, start2: "16:00", end2: "20:00", extraHoursPre: 0.5, extraHoursPost: 1 });
  });

  it("calculates holiday balance and formats durations", () => {
    expect(holidayBalance([{ balance_type: "ganado" }, { balance_type: "ganado" }, { balance_type: "compensado" }])).toBe(1);
    expect(formatMinutes(135)).toBe("2 h 15 min");
  });
});
