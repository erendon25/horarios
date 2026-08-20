import { describe, expect, it } from "vitest";
import { filterScheduleRequests, requestShiftLabel, type ScheduleRequestListItem } from "./schedule-requests";

const requests: ScheduleRequestListItem[] = [
  { id: 1, requested_date: "2026-07-15", shift_type: "apertura", start_time: null, end_time: null, reason: "Estudios", status: "pending", admin_comment: null, created_at: "2026-07-14T10:00:00Z", reviewed_at: null, staffName: "Ana Pérez", staffDni: "123", storeName: "Centro" },
  { id: 2, requested_date: "2026-07-16", shift_type: "rango", start_time: "10:00:00", end_time: "18:00:00", reason: "Cita", status: "approved", admin_comment: "Conforme", created_at: "2026-07-14T11:00:00Z", reviewed_at: "2026-07-14T12:00:00Z", staffName: "Luis Soto", staffDni: "456", storeName: "Norte" },
];

describe("schedule requests", () => {
  it("filtra por estado y por datos visibles", () => {
    expect(filterScheduleRequests(requests, "", "pending")).toEqual([requests[0]]);
    expect(filterScheduleRequests(requests, "norte", "all")).toEqual([requests[1]]);
    expect(filterScheduleRequests(requests, "estudios", "all")).toEqual([requests[0]]);
  });

  it("presenta los turnos predefinidos y rangos", () => {
    expect(requestShiftLabel(requests[0])).toBe("Apertura");
    expect(requestShiftLabel(requests[1])).toBe("10:00–18:00");
  });
});
