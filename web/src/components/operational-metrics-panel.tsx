"use client";

import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, ChevronDown, ChevronUp, Clock3, Coins, Moon, RefreshCw, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  calculateOperationalMetrics,
  extraMinutesInPeriod,
  periodBounds,
  type MetricsExtra,
  type MetricsHoliday,
  type MetricsSalesDay,
  type MetricsShift,
  type MetricsStaff,
  type PeriodType,
} from "@/lib/operational-metrics";
import { mondayOf } from "@/lib/weekly-schedule";

type Store = { id: string; name: string; is_active: boolean };
type Context = { stores: Store[]; defaultStoreId: string };
type Filter = "all" | "night" | "extras" | "holidays";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function limaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function hours(minutes: number) {
  return (minutes / 60).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadContext(): Promise<Context> {
  const supabase = createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) throw new Error("not_authenticated");
  const profile = await supabase.from("user_profiles").select("role,store_id").eq("id", user.data.user.id).single();
  if (profile.error) throw profile.error;
  const stores = await supabase.from("stores").select("id,name,is_active").order("name");
  if (stores.error) throw stores.error;
  const allowed = profile.data.role === "superadmin" ? stores.data : stores.data.filter((store) => store.id === profile.data.store_id);
  return { stores: allowed, defaultStoreId: profile.data.store_id ?? allowed[0]?.id ?? "" };
}

async function loadOperationalData(storeId: string, start: string, end: string, excludeTrainees: boolean) {
  const supabase = createClient();
  const [staffResult, weeksResult, extrasResult, holidaysResult, salesResult] = await Promise.all([
    supabase.from("staff_profiles").select("id,first_name,last_name,modality,modality_change_date,next_modality,is_trainee,cessation_date").eq("store_id", storeId),
    supabase.from("schedule_weeks").select("id,staff_id,schedule_shifts(id,work_date,start_time,end_time,is_day_off,is_holiday,metadata)").eq("store_id", storeId).gte("week_start", mondayOf(start)).lte("week_start", mondayOf(end)),
    supabase.from("extra_hours").select("id,staff_id,work_date,start_time,end_time,duration_minutes,pre_shift_minutes,post_shift_minutes,activity,source,daily_details").eq("store_id", storeId).order("work_date", { ascending: false }),
    supabase.from("worked_holidays").select("id,staff_id,holiday_date,name,balance_type").eq("store_id", storeId).order("holiday_date", { ascending: false }),
    supabase.from("sales_daily_history").select("sales_date,sales_amount,transactions").eq("store_id", storeId).gte("sales_date", start).lte("sales_date", end),
  ]);
  for (const result of [staffResult, weeksResult, extrasResult, holidaysResult, salesResult]) if (result.error) throw result.error;

  const shifts: MetricsShift[] = [];
  for (const rawWeek of (weeksResult.data ?? []) as unknown as Array<Record<string, unknown>>) {
    const staffId = String(rawWeek.staff_id ?? "");
    if (!staffId || !Array.isArray(rawWeek.schedule_shifts)) continue;
    for (const rawShift of rawWeek.schedule_shifts) {
      if (!isObject(rawShift) || typeof rawShift.work_date !== "string") continue;
      shifts.push({
        id: Number(rawShift.id),
        staff_id: staffId,
        work_date: rawShift.work_date,
        start_time: typeof rawShift.start_time === "string" ? rawShift.start_time : null,
        end_time: typeof rawShift.end_time === "string" ? rawShift.end_time : null,
        is_day_off: rawShift.is_day_off === true,
        is_holiday: rawShift.is_holiday === true,
        metadata: isObject(rawShift.metadata) ? rawShift.metadata : {},
      });
    }
  }
  const staff = (staffResult.data ?? []) as MetricsStaff[];
  const extras = (extrasResult.data ?? []) as MetricsExtra[];
  const holidays = (holidaysResult.data ?? []) as MetricsHoliday[];
  const salesDays = (salesResult.data ?? []) as MetricsSalesDay[];
  return { staff, shifts, extras, holidays, salesDays, metrics: calculateOperationalMetrics({ staff, shifts, extras, holidays, salesDays, start, end, excludeTrainees }) };
}

export function OperationalMetricsPanel() {
  const context = useQuery({ queryKey: ["operational-metrics", "context"], queryFn: loadContext });
  if (context.isPending) return <div className="study-loading">Cargando contexto operativo…</div>;
  if (context.error || !context.data) return <p className="form-alert error">No se pudo cargar el contexto de tiendas.</p>;
  return <OperationalMetricsWorkspace context={context.data}/>;
}

function OperationalMetricsWorkspace({ context }: { context: Context }) {
  const queryClient = useQueryClient();
  const [storeId, setStoreId] = useState(context.defaultStoreId);
  const [periodType, setPeriodType] = useState<PeriodType>("week");
  const [selectedDate, setSelectedDate] = useState(() => limaToday());
  const [excludeTrainees, setExcludeTrainees] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [salesOverride, setSalesOverride] = useState<string | null>(null);
  const [transactionsOverride, setTransactionsOverride] = useState<string | null>(null);
  const bounds = periodBounds(periodType, selectedDate);
  const queryKey = ["operational-metrics", storeId, bounds.start, bounds.end, excludeTrainees] as const;
  const query = useQuery({ queryKey, queryFn: () => loadOperationalData(storeId, bounds.start, bounds.end, excludeTrainees), enabled: Boolean(storeId) });
  const removeExtra = useMutation({
    mutationFn: async (id: number) => {
      const result = await createClient().from("extra_hours").delete().eq("id", id);
      if (result.error) throw result.error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["operational-metrics", storeId] }),
  });
  const metrics = query.data?.metrics;
  const salesValue = salesOverride ?? String(metrics?.sales ?? 0);
  const transactionsValue = transactionsOverride ?? String(metrics?.transactions ?? 0);
  const sales = Number(salesValue) || 0;
  const transactions = Number(transactionsValue) || 0;
  const standardHours = (metrics?.standardMinutes ?? 0) / 60;
  const hoursWithRegisteredExtras = standardHours + (metrics?.registeredExtraMinutes ?? 0) / 60;
  const vhl = standardHours ? sales / standardHours : 0;
  const thl = standardHours ? transactions / standardHours : 0;
  const vhlWithExtras = hoursWithRegisteredExtras ? sales / hoursWithRegisteredExtras : 0;
  const thlWithExtras = hoursWithRegisteredExtras ? transactions / hoursWithRegisteredExtras : 0;

  const rows = useMemo(() => (metrics?.rows ?? []).filter((row) => {
    if (search && !row.name.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))) return false;
    if (filter === "night") return row.nightMinutes > 0;
    if (filter === "extras") return row.registeredExtraMinutes > 0 || row.plannedExtraMinutes > 0;
    if (filter === "holidays") return row.holidaysEarned > 0 || row.holidaysCompensated > 0 || row.holidayBalance !== 0;
    return true;
  }), [filter, metrics?.rows, search]);
  const extrasByStaff = useMemo(() => Map.groupBy((query.data?.extras ?? []).filter((item) => extraMinutesInPeriod(item, bounds.start, bounds.end) > 0), (item) => item.staff_id ?? "orphan"), [bounds.end, bounds.start, query.data?.extras]);
  const holidaysByStaff = useMemo(() => Map.groupBy(query.data?.holidays ?? [], (item) => item.staff_id), [query.data?.holidays]);
  const changePeriod = (type: PeriodType) => { setPeriodType(type); setSalesOverride(null); setTransactionsOverride(null); setExpanded(null); };
  const changeDate = (date: string) => { setSelectedDate(date); setSalesOverride(null); setTransactionsOverride(null); setExpanded(null); };

  return <section className="operations-panel">
    <header className="weekly-header"><div><p className="eyebrow">CONTROL OPERATIVO</p><h2>Nocturnidad, extras, feriados y VHL/THL</h2><p className="muted">Consulta consolidada desde PostgreSQL; ventas y transacciones pueden reemplazarse para simular un cierre.</p></div><Calculator size={30}/></header>
    <div className="operations-toolbar">
      {context.stores.length > 1 && <label>Tienda<select value={storeId} onChange={(event) => { setStoreId(event.target.value); setSalesOverride(null); setTransactionsOverride(null); }}><option value="">Selecciona…</option>{context.stores.map((store) => <option key={store.id} value={store.id}>{store.name}{store.is_active ? "" : " (inactiva)"}</option>)}</select></label>}
      <label>Periodo<select value={periodType} onChange={(event) => changePeriod(event.target.value as PeriodType)}><option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option></select></label>
      <label>Fecha<input type={periodType === "month" ? "month" : "date"} value={periodType === "month" ? selectedDate.slice(0, 7) : selectedDate} onChange={(event) => changeDate(periodType === "month" ? `${event.target.value}-01` : event.target.value)}/></label>
      <label className="check-label"><input type="checkbox" checked={excludeTrainees} onChange={(event) => setExcludeTrainees(event.target.checked)}/> Excluir entrenamiento</label>
      <button className="plain-button" onClick={() => query.refetch()} disabled={query.isFetching}><RefreshCw size={16}/>{query.isFetching ? "Actualizando…" : "Actualizar"}</button>
    </div>
    <p className="period-caption">Periodo consultado: <strong>{bounds.start}</strong> al <strong>{bounds.end}</strong></p>
    {query.error && <p className="form-alert error">No se pudieron consultar los indicadores operativos.</p>}
    {query.isPending || !metrics ? <div className="study-loading">Calculando indicadores…</div> : <>
      <div className="operations-inputs"><label>Venta del periodo (S/)<input type="number" min="0" step="0.01" value={salesValue} onChange={(event) => setSalesOverride(event.target.value)}/><small>Supabase: S/ {metrics.sales.toLocaleString("es-PE", { minimumFractionDigits: 2 })}</small></label><label>Transacciones<input type="number" min="0" step="1" value={transactionsValue} onChange={(event) => setTransactionsOverride(event.target.value)}/><small>Supabase: {metrics.transactions.toLocaleString("es-PE")}</small></label><button className="plain-button" onClick={() => { setSalesOverride(null); setTransactionsOverride(null); }}>Restaurar datos</button></div>
      <div className="operations-metrics">
        <article className="operation-card green"><Coins/><span>VHL</span><strong>S/ {vhl.toFixed(2)}</strong><small>Con extras registradas: S/ {vhlWithExtras.toFixed(2)}</small></article>
        <article className="operation-card blue"><Calculator/><span>THL</span><strong>{thl.toFixed(2)}</strong><small>Con extras registradas: {thlWithExtras.toFixed(2)}</small></article>
        <article className="operation-card"><Clock3/><span>Horas logradas</span><strong>{hours(metrics.standardMinutes)} h</strong><small>Horario real: {hours(metrics.scheduledMinutes)} h</small></article>
        <article className="operation-card violet"><Moon/><span>Horas nocturnas</span><strong>{hours(metrics.nightMinutes)} h</strong><small>Franja 22:00–06:00</small></article>
        <article className="operation-card orange"><Clock3/><span>Horas extra</span><strong>{hours(metrics.registeredExtraMinutes)} h</strong><small>Planificadas: {hours(metrics.plannedExtraMinutes)} h</small></article>
        <article className="operation-card"><span>Saldo feriados</span><strong>{metrics.holidayBalance > 0 ? `+${metrics.holidayBalance}` : metrics.holidayBalance}</strong><small>Periodo: +{metrics.holidaysEarned} / −{metrics.holidaysCompensated}</small></article>
      </div>
      <div className="operations-filters"><input placeholder="Buscar colaborador…" value={search} onChange={(event) => setSearch(event.target.value)}/><select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}><option value="all">Todos</option><option value="night">Con nocturnidad</option><option value="extras">Con horas extra</option><option value="holidays">Con feriados</option></select><span>{rows.length} colaboradores</span></div>
      <div className="table-scroll"><table className="operations-table"><thead><tr><th>Colaborador</th><th>Turnos</th><th>FT / PT</th><th>Horas logradas</th><th>Nocturnas</th><th>Extras registradas</th><th>Extras planificadas</th><th>Feriados + / −</th><th>Saldo</th><th>Detalle</th></tr></thead><tbody>{rows.map((row) => {
        const isOpen = expanded === row.staffId;
        const staffExtras = extrasByStaff.get(row.staffId) ?? [];
        const staffHolidays = holidaysByStaff.get(row.staffId) ?? [];
        return <Fragment key={row.staffId}><tr><td><strong>{row.name}</strong></td><td>{row.shifts}</td><td>{row.fullTimeShifts} / {row.partTimeShifts}</td><td>{hours(row.standardMinutes)}</td><td>{hours(row.nightMinutes)}</td><td>{hours(row.registeredExtraMinutes)}</td><td>{hours(row.plannedExtraMinutes)}</td><td>+{row.holidaysEarned} / −{row.holidaysCompensated}</td><td className={row.holidayBalance < 0 ? "negative" : row.holidayBalance > 0 ? "positive" : ""}>{row.holidayBalance > 0 ? `+${row.holidayBalance}` : row.holidayBalance}</td><td><button className="icon-button" aria-label={`Ver detalle de ${row.name}`} onClick={() => setExpanded(isOpen ? null : row.staffId)}>{isOpen ? <ChevronUp/> : <ChevronDown/>}</button></td></tr>
          {isOpen && <tr className="operation-detail-row"><td colSpan={10}><div className="operation-details"><section><h4>Horas extra del periodo</h4>{staffExtras.length ? <table><thead><tr><th>Fecha base</th><th>Horario</th><th>Duración periodo</th><th>Origen</th><th></th></tr></thead><tbody>{staffExtras.map((extra) => <tr key={extra.id}><td>{extra.work_date}</td><td>{extra.start_time?.slice(0, 5) ?? "—"}–{extra.end_time?.slice(0, 5) ?? "—"}</td><td>{hours(extraMinutesInPeriod(extra, bounds.start, bounds.end))}</td><td>{extra.source}</td><td><button className="icon-button danger" disabled={removeExtra.isPending} aria-label="Eliminar hora extra" onClick={() => { if (window.confirm("¿Eliminar este registro de horas extra?")) removeExtra.mutate(extra.id); }}><Trash2/></button></td></tr>)}</tbody></table> : <p className="muted">Sin registros en este periodo.</p>}</section><section><h4>Historial de feriados</h4>{staffHolidays.length ? <table><thead><tr><th>Fecha</th><th>Concepto</th><th>Movimiento</th></tr></thead><tbody>{staffHolidays.map((holiday) => <tr key={holiday.id}><td>{holiday.holiday_date}</td><td>{holiday.name}</td><td className={holiday.balance_type === "ganado" ? "positive" : "negative"}>{holiday.balance_type === "ganado" ? "+1 ganado" : "−1 compensado"}</td></tr>)}</tbody></table> : <p className="muted">Sin movimientos.</p>}</section></div></td></tr>}
        </Fragment>;
      })}{!rows.length && <tr><td colSpan={10} className="empty-cell">No hay colaboradores que coincidan con el filtro.</td></tr>}</tbody></table></div>
      {removeExtra.error && <p className="form-alert error">No se pudo eliminar el registro; verifica permisos o vuelve a intentarlo.</p>}
    </>}
  </section>;
}
