"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, MailPlus, Pencil, Plus, Search, ShieldCheck, UserRoundCheck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Enums, Tables } from "@/types/database";
import { StudyScheduleEditor } from "@/components/study-schedule-editor";

type Staff = Pick<Tables<"staff_profiles">,
  "id" | "user_id" | "store_id" | "first_name" | "last_name" | "email" | "dni" |
  "gender" | "birth_date" | "modality" | "position" | "status" | "join_date" |
  "sanitary_card_expiry" | "sanitary_card_unlock" | "is_trainee" | "training_end_date" |
  "modality_change_date" | "next_modality"
>;
type Store = Pick<Tables<"stores">, "id" | "name">;
type StaffRow = Staff & { storeName: string };

type FormState = {
  storeId: string; firstName: string; lastName: string; email: string; dni: string;
  gender: string; birthDate: string; modality: string; position: string;
  status: Enums<"record_status">; joinDate: string; sanitaryCardExpiry: string;
  sanitaryCardUnlock: boolean; isTrainee: boolean; trainingEndDate: string;
  modalityChangeDate: string; nextModality: string;
};

const emptyForm: FormState = {
  storeId: "", firstName: "", lastName: "", email: "", dni: "", gender: "",
  birthDate: "", modality: "Full-Time", position: "COLABORADOR", status: "pending",
  joinDate: "", sanitaryCardExpiry: "", sanitaryCardUnlock: false, isTrainee: false,
  trainingEndDate: "", modalityChangeDate: "", nextModality: "",
};

async function loadStaffManagement() {
  const supabase = createClient();
  const [staffResult, storesResult] = await Promise.all([
    supabase.from("staff_profiles").select("id,user_id,store_id,first_name,last_name,email,dni,gender,birth_date,modality,position,status,join_date,sanitary_card_expiry,sanitary_card_unlock,is_trainee,training_end_date,modality_change_date,next_modality").order("first_name"),
    supabase.from("stores").select("id,name").eq("is_active", true).order("name"),
  ]);
  if (staffResult.error) throw staffResult.error;
  if (storesResult.error) throw storesResult.error;
  const stores = storesResult.data as Store[];
  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  return {
    stores,
    staff: (staffResult.data as Staff[]).map((row) => ({ ...row, storeName: storeNames.get(row.store_id) ?? "Tienda sin nombre" })) as StaffRow[],
  };
}

const nullable = (value: string) => value || null;

export function StaffManagementPanel() {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: ["staff-management"], queryFn: loadStaffManagement });
  const staff = useMemo(() => data?.staff ?? [], [data]);
  const stores = useMemo(() => data?.stores ?? [], [data]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<StaffRow | "new" | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<StaffRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useMemo(() => staff.filter((row) => {
    const haystack = `${row.first_name} ${row.last_name} ${row.dni ?? ""} ${row.email ?? ""} ${row.storeName}`.toLocaleLowerCase("es");
    return haystack.includes(search.trim().toLocaleLowerCase("es"));
  }), [search, staff]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      if (!form.firstName.trim() || !form.lastName.trim() || !form.storeId) throw new Error("required_fields");
      if (Boolean(form.modalityChangeDate) !== Boolean(form.nextModality)) throw new Error("modality_pair");
      const { error: saveError } = await createClient().rpc("save_staff_profile", {
        p_staff_id: editing === "new" ? null : editing.id,
        p_store_id: form.storeId,
        p_first_name: form.firstName,
        p_last_name: form.lastName,
        p_email: nullable(form.email),
        p_dni: nullable(form.dni),
        p_gender: nullable(form.gender),
        p_birth_date: nullable(form.birthDate),
        p_modality: form.modality,
        p_position: form.position,
        p_status: form.status,
        p_join_date: nullable(form.joinDate),
        p_sanitary_card_expiry: nullable(form.sanitaryCardExpiry),
        p_sanitary_card_unlock: form.sanitaryCardUnlock,
        p_is_trainee: form.isTrainee,
        p_training_end_date: form.isTrainee ? nullable(form.trainingEndDate) : null,
        p_modality_change_date: nullable(form.modalityChangeDate),
        p_next_modality: nullable(form.nextModality),
      });
      if (saveError) throw saveError;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["staff-management"] }),
        queryClient.invalidateQueries({ queryKey: ["hr", "cessations"] }),
      ]);
      setEditing(null);
      setNotice("Colaborador guardado correctamente.");
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (row: StaffRow) => {
      const { data: result, error: inviteError } = await createClient().functions.invoke("staff-account-admin", {
        body: { operation: "invite_staff", staffId: row.id },
      });
      if (inviteError) {
        const context = (inviteError as { context?: Response }).context;
        const payload = context ? await context.json().catch(() => null) as { error?: string } | null : null;
        throw new Error(payload?.error ?? "invite_failed");
      }
      if (!result?.invited) throw new Error(result?.error ?? "invite_failed");
      return row.email;
    },
    onSuccess: async (email) => {
      await queryClient.invalidateQueries({ queryKey: ["staff-management"] });
      setNotice(`Invitación enviada a ${email}.`);
    },
  });

  function openNew() {
    setNotice(null);
    setForm({ ...emptyForm, storeId: stores.length === 1 ? stores[0].id : "" });
    setEditing("new");
  }

  function openEdit(row: StaffRow) {
    setNotice(null);
    setForm({
      storeId: row.store_id, firstName: row.first_name, lastName: row.last_name,
      email: row.email ?? "", dni: row.dni ?? "", gender: row.gender ?? "",
      birthDate: row.birth_date ?? "", modality: row.modality ?? "", position: row.position,
      status: row.status, joinDate: row.join_date ?? "", sanitaryCardExpiry: row.sanitary_card_expiry ?? "",
      sanitaryCardUnlock: row.sanitary_card_unlock, isTrainee: row.is_trainee,
      trainingEndDate: row.training_end_date ?? "", modalityChangeDate: row.modality_change_date ?? "",
      nextModality: row.next_modality ?? "",
    });
    setEditing(row);
  }

  return <>
    <section className="hr-toolbar">
      <label className="search-box"><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, DNI, correo o tienda"/></label>
      <button className="secondary-button" onClick={openNew}><Plus size={17}/> Nuevo colaborador</button>
    </section>
    {notice && <p className="form-alert success">{notice}</p>}
    {(error || inviteMutation.error) && <p className="form-alert error">{inviteMutation.error ? (inviteMutation.error.message === "app_url_not_configured" ? "Las invitaciones se habilitarán al publicar Next.js y configurar su URL pública." : "No se pudo enviar la invitación. Verifica que el correo no esté registrado y que tengas permisos sobre la tienda.") : "No se pudo cargar la lista de colaboradores."}</p>}
    <section className="data-card">
      <div className="data-card-heading"><div><strong>{isPending ? "Cargando…" : `${rows.length} colaboradores`}</strong><span>{staff.filter((row) => row.user_id).length} cuentas vinculadas · {staff.filter((row) => !row.user_id).length} pendientes</span></div></div>
      <div className="table-scroll"><table className="hr-table staff-table"><thead><tr><th>Colaborador</th><th>Tienda</th><th>Estado</th><th>Cuenta</th><th>Modalidad</th><th/></tr></thead><tbody>
        {rows.map((row) => <tr key={row.id}>
          <td><strong>{row.first_name} {row.last_name}</strong><span>{row.dni || "Sin DNI"} · {row.position}</span></td>
          <td>{row.storeName}</td>
          <td><span className={`status-pill ${row.status === "active" ? "active" : row.status === "inactive" ? "ceased" : "pending"}`}>{row.status}</span></td>
          <td>{row.user_id ? <span className="account-state linked"><ShieldCheck size={14}/> Vinculada<small>{row.email}</small></span> : <span className="account-state"><UserRoundCheck size={14}/> Sin cuenta<small>{row.email || "Falta correo"}</small></span>}</td>
          <td>{row.is_trainee ? "Entrenamiento" : row.modality || "—"}</td>
          <td><div className="row-actions"><button className="icon-button" onClick={() => openEdit(row)} title="Editar colaborador"><Pencil size={16}/></button><button className="icon-button schedule" onClick={() => setScheduleTarget(row)} title="Editar disponibilidad"><CalendarClock size={16}/></button><button className="icon-button invite" disabled={Boolean(row.user_id) || !row.email || row.status === "inactive" || inviteMutation.isPending} onClick={() => inviteMutation.mutate(row)} title={row.user_id ? "Cuenta ya vinculada" : !row.email ? "Registra un correo primero" : "Enviar invitación"}><MailPlus size={16}/></button></div></td>
        </tr>)}
      </tbody></table></div>
    </section>

    {editing && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditing(null)}><section className="hr-modal" role="dialog" aria-modal="true" aria-labelledby="staff-title">
      <header><div><p className="eyebrow">ADMINISTRACIÓN</p><h2 id="staff-title">{editing === "new" ? "Nuevo colaborador" : `Editar a ${editing.first_name} ${editing.last_name}`}</h2><p className="muted">Los cambios de tienda, estado y cargo se sincronizan con la cuenta vinculada.</p></div><button className="icon-button" onClick={() => setEditing(null)}><X size={20}/></button></header>
      <div className="hr-form-grid">
        <label>Nombres *<input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })}/></label>
        <label>Apellidos *<input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })}/></label>
        <label>Tienda *<select value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}><option value="">Seleccionar tienda</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        <label>Estado<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FormState["status"] })}><option value="pending">Pendiente</option><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>
        <label>Correo<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nombre@empresa.com"/></label>
        <label>DNI<input value={form.dni} onChange={(e) => setForm({ ...form, dni: e.target.value })} maxLength={15}/></label>
        <label>Sexo<select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="">Sin especificar</option><option value="MASCULINO">MASCULINO</option><option value="FEMENINO">FEMENINO</option></select></label>
        <label>Fecha de nacimiento<input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })}/></label>
        <label>Modalidad<select value={form.modality} onChange={(e) => setForm({ ...form, modality: e.target.value })}><option value="Full-Time">Full-Time</option><option value="Part-Time">Part-Time</option></select></label>
        <label>Cargo<select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>{["COLABORADOR", "ENTRENADOR", "LIDER", "ASISTENTE", "GERENTE"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Fecha de ingreso<input type="date" value={form.joinDate} onChange={(e) => setForm({ ...form, joinDate: e.target.value })}/></label>
        <label>Vencimiento carnet sanitario<input type="date" value={form.sanitaryCardExpiry} onChange={(e) => setForm({ ...form, sanitaryCardExpiry: e.target.value })}/></label>
        <label className="check-field"><input type="checkbox" checked={form.sanitaryCardUnlock} onChange={(e) => setForm({ ...form, sanitaryCardUnlock: e.target.checked })}/> Desbloquear disponibilidad con carnet vencido</label>
        <label className="check-field"><input type="checkbox" checked={form.isTrainee} onChange={(e) => setForm({ ...form, isTrainee: e.target.checked, trainingEndDate: e.target.checked ? form.trainingEndDate : "" })}/> Colaborador en entrenamiento</label>
        {form.isTrainee && <label className="span-2">Fin de entrenamiento<input type="date" value={form.trainingEndDate} onChange={(e) => setForm({ ...form, trainingEndDate: e.target.value })}/></label>}
        <label>Nueva modalidad<select value={form.nextModality} onChange={(e) => setForm({ ...form, nextModality: e.target.value, modalityChangeDate: e.target.value ? form.modalityChangeDate : "" })}><option value="">Sin cambio programado</option><option value="Full-Time">Full-Time</option><option value="Part-Time">Part-Time</option></select></label>
        <label>Fecha del cambio<input type="date" disabled={!form.nextModality} value={form.modalityChangeDate} onChange={(e) => setForm({ ...form, modalityChangeDate: e.target.value })}/></label>
      </div>
      {saveMutation.error && <p className="form-alert error">{saveMutation.error.message === "modality_pair" ? "Completa la nueva modalidad y su fecha." : "No se pudo guardar. Revisa los campos y los permisos de la tienda."}</p>}
      <footer><button className="plain-button" onClick={() => setEditing(null)}>Cancelar</button><button className="primary-button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>{saveMutation.isPending ? "Guardando…" : "Guardar colaborador"}</button></footer>
    </section></div>}
    {scheduleTarget && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setScheduleTarget(null)}><div className="study-modal"><StudyScheduleEditor staffId={scheduleTarget.id} adminMode onClose={() => setScheduleTarget(null)}/></div></div>}
  </>;
}
