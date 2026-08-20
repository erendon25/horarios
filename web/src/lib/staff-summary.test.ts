import { describe, expect, it } from "vitest";
import { isCurrentStaff, summarizeCurrentStaff, type StaffSummaryRow } from "./staff-summary";

describe("staff summary", () => {
  const row = (overrides: Partial<StaffSummaryRow> = {}): StaffSummaryRow => ({
    status: "pending",
    cessation_date: null,
    modality: "Full-Time",
    position: "COLABORADOR",
    ...overrides,
  });

  it("keeps future cessations active until their effective date", () => {
    expect(isCurrentStaff(row({ status: "inactive", cessation_date: "2026-08-15" }), "2026-07-14")).toBe(true);
    expect(isCurrentStaff(row({ cessation_date: "2026-07-13" }), "2026-07-14")).toBe(false);
    expect(isCurrentStaff(row({ cessation_date: "2026-07-14" }), "2026-07-14")).toBe(false);
  });

  it("reports trainers separately from Full-Time and Part-Time collaborators", () => {
    const staff = [
      ...Array.from({ length: 10 }, () => row()),
      ...Array.from({ length: 21 }, () => row({ modality: "Part-Time" })),
      ...Array.from({ length: 2 }, () => row({ position: "ENTRENADOR" })),
      row({ status: "inactive" }),
      row({ cessation_date: "2026-07-01" }),
    ];

    expect(summarizeCurrentStaff(staff, "2026-07-14")).toEqual({
      active: 33,
      fullTime: 10,
      partTime: 21,
      trainers: 2,
    });
  });
});
