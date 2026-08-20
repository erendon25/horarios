"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, MessageSquareText, RefreshCw, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  filterScheduleRequests,
  requestShiftLabel,
  requestStatusLabel,
  type RequestStatus,
  type ScheduleRequestListItem,
} from "@/lib/schedule-requests";
import type { Tables } from "@/types/database";

type RequestRow = Pick<Tables<"schedule_requests">, "id" | "staff_id" | "store_id" | "requested_date" | "shift_type" | "start_time" | "end_time" | "reason" | "status" | "admin_comment" | "created_at" | "reviewed_at">;
type StaffRow = Pick<Tables<"staff_profiles">, "id" | "first_name" | "last_name" | "dni">;
type StoreRow = Pick<Tables<"stores">, "id" | "name">;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

async function loadRequests(storeId: string): Promise<ScheduleRequestListItem[]> {
  const supabase = createClient();
  const [requestsResult, staffResult, storesResult] = await Promise.all([
    supabase.from("schedule_requests").select("id,staff_id,store_id,requested_date,shift_type,start_time,end_time,reason,status,admin_comment,created_at,reviewed_at").eq("store_id", storeId).order("created_at", { ascending: false }).limit(500),
    supabase.from("staff_profiles").select("id,first_name,last_name,dni").eq("store_id", storeId),
    supabase.from("stores").select("id,name").eq("id", storeId),
  ]);
  if (requestsResult.error) throw requestsResult.error;
  if (staffResult.error) throw staffResult.error;
  if (storesResult.error) throw storesResult.error;

  const staff = new Map((staffResult.data as StaffRow[]).map((row) => [row.id, row]));
  const stores = new Map((storesResult.data as StoreRow[]).map((row) => [row.id, row.name]));
  return (requestsResult.data as RequestRow[]).map((request) => {
    const person = staff.get(request.staff_id);
    return {
      id: request.id,
      requested_date: request.requested_date,
      shift_type: request.shift_type,
      start_time: request.start_time,
      end_time: request.end_time,
      reason: request.reason,
      status: request.status,
      admin_comment: request.admin_comment,
      created_at: request.created_at,
      reviewed_at: request.reviewed_at,
      staffName: person ? `${person.first_name} ${person.last_name}`.trim() : "Colaborador no disponible",
      staffDni: person?.dni ?? null,
      storeName: stores.get(request.store_id) ?? "Tienda no disponible",
    };
  });
}

export function ScheduleRequestsPanel({ storeId }: { storeId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["admin", "schedule-requests", "v1", storeId] as const;
  const query = useQuery({ queryKey, queryFn: () => loadRequests(storeId) });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<RequestStatus | "all">("pending");
  const [selected, setSelected] = useState<ScheduleRequestListItem | null>(null);
  const [comment, setComment] = useState("");

  const rows = useMemo(
    () => filterScheduleRequests(query.data ?? [], search, status),
    [query.data, search, status],
  );

  const review = useMutation({
    mutationFn: async (nextStatus: "approved" | "rejected") => {
      if (!selected) throw new Error("Selecciona una solicitud.");
      if (nextStatus === "rejected" && !comment.trim()) throw new Error("Escribe el motivo del rechazo.");
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw authError ?? new Error("Sesión no disponible.");
      const { data, error } = await supabase
        .from("schedule_requests")
        .update({
          status: nextStatus,
          admin_comment: comment.trim() || null,
          reviewed_by: authData.user.id,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", selected.id)
        .eq("store_id", storeId)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("La solicitud ya fue revisada o no tienes permiso para modificarla.");
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["staff-self-service"] }),
      ]);
      setSelected(null);
      setComment("");
    },
  });

  const openReview = (request: ScheduleRequestListItem) => {
    setSelected(request);
    setComment(request.admin_comment ?? "");
    review.reset();
  };

  return <section className="requests-panel">
    <header className="weekly-header"><div><p className="eyebrow">SOLICITUDES DEL EQUIPO</p><h2>Aprobación de preferencias de turno</h2><p className="muted">Revisa las solicitudes antes de generar el horario semanal.</p></div><MessageSquareText size={30}/></header>
    <div className="requests-toolbar">
      <label className="search-box"><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar colaborador, DNI, tienda o motivo"/></label>
      <label>Estado<select value={status} onChange={(event) => setStatus(event.target.value as RequestStatus | "all")}><option value="pending">Pendientes</option><option value="approved">Aprobadas</option><option value="rejected">Rechazadas</option><option value="cancelled">Canceladas</option><option value="all">Todas</option></select></label>
      <button className="plain-button" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw size={16}/>{query.isFetching ? "Actualizando…" : "Actualizar"}</button>
    </div>
    {query.error && <p className="form-alert error requests-alert">No se pudieron cargar las solicitudes.</p>}
    <div className="requests-summary"><span><strong>{rows.length}</strong> solicitudes visibles</span><span><Clock3 size={15}/>{(query.data ?? []).filter((request) => request.status === "pending").length} pendientes</span></div>
    <div className="table-scroll"><table className="requests-table"><thead><tr><th>Colaborador</th><th>Tienda</th><th>Fecha solicitada</th><th>Turno</th><th>Motivo</th><th>Estado</th><th>Comentario</th><th></th></tr></thead><tbody>
      {query.isPending ? <tr><td colSpan={8} className="empty-cell">Cargando solicitudes…</td></tr> : rows.length === 0 ? <tr><td colSpan={8} className="empty-cell">No hay solicitudes para este filtro.</td></tr> : rows.map((request) => <tr key={request.id}><td><strong>{request.staffName}</strong><small>{request.staffDni ? `DNI ${request.staffDni}` : "Sin DNI"}</small></td><td>{request.storeName}</td><td>{formatDate(request.requested_date)}</td><td>{requestShiftLabel(request)}</td><td>{request.reason || "—"}</td><td><span className={`request-status ${request.status}`}>{requestStatusLabel[request.status]}</span></td><td>{request.admin_comment || "—"}</td><td>{request.status === "pending" && <button className="icon-button" aria-label={`Revisar solicitud de ${request.staffName}`} onClick={() => openReview(request)}><MessageSquareText size={17}/></button>}</td></tr>)}
    </tbody></table></div>

    {selected && <div className="modal-backdrop" role="presentation"><section className="hr-modal requests-modal" role="dialog" aria-modal="true" aria-labelledby="request-review-title"><header><div><p className="eyebrow">REVISAR SOLICITUD</p><h2 id="request-review-title">{selected.staffName}</h2><p className="muted">{formatDate(selected.requested_date)} · {requestShiftLabel(selected)} · {selected.storeName}</p></div><button className="icon-button" aria-label="Cerrar" onClick={() => setSelected(null)}><X/></button></header><div className="request-review-body"><div><strong>Motivo del colaborador</strong><p>{selected.reason || "Sin motivo indicado."}</p></div><label>Comentario administrativo<textarea rows={4} maxLength={500} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Obligatorio para rechazar; opcional para aprobar"/></label></div>{review.error && <p className="form-alert error">{review.error.message}</p>}<footer><button className="review-button reject" disabled={review.isPending} onClick={() => review.mutate("rejected")}><X size={17}/> Rechazar</button><button className="review-button approve" disabled={review.isPending} onClick={() => review.mutate("approved")}><Check size={17}/> Aprobar</button></footer></section></div>}
  </section>;
}
