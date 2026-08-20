import type { Database } from "@/types/database";

export type RequestStatus = Database["public"]["Enums"]["request_status"];

export type ScheduleRequestListItem = {
  id: number;
  requested_date: string;
  shift_type: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  status: RequestStatus;
  admin_comment: string | null;
  created_at: string;
  reviewed_at: string | null;
  staffName: string;
  staffDni: string | null;
  storeName: string;
};

export const requestStatusLabel: Record<RequestStatus, string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
};

export function requestShiftLabel(request: Pick<ScheduleRequestListItem, "shift_type" | "start_time" | "end_time">) {
  if (request.shift_type === "rango") {
    return request.start_time && request.end_time
      ? `${request.start_time.slice(0, 5)}–${request.end_time.slice(0, 5)}`
      : "Rango incompleto";
  }
  return request.shift_type.charAt(0).toLocaleUpperCase("es") + request.shift_type.slice(1);
}

export function filterScheduleRequests(
  requests: ScheduleRequestListItem[],
  search: string,
  status: RequestStatus | "all",
) {
  const term = search.trim().toLocaleLowerCase("es");
  return requests.filter((request) => {
    if (status !== "all" && request.status !== status) return false;
    if (!term) return true;
    return `${request.staffName} ${request.staffDni ?? ""} ${request.storeName} ${request.reason ?? ""}`
      .toLocaleLowerCase("es")
      .includes(term);
  });
}
