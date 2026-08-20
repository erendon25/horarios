"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarRange, CircleDollarSign, Goal, ReceiptText, TrendingDown, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  SALES_CHANNELS,
  SALES_SHIFTS,
  WEEKDAYS,
  addIsoDays,
  aggregateSales,
  businessHourEntries,
  previousPeriod,
  previousYearPeriod,
  salesGoal,
  variation,
  type SalesHistoryInput,
  type SalesMonthConfigInput,
} from "@/lib/sales-analysis";

type Store = { id: string; name: string; is_active: boolean };
type Context = { stores: Store[]; defaultStoreId: string };
type AnalysisData = { rows: SalesHistoryInput[]; configs: SalesMonthConfigInput[] };

async function loadContext(forcedStoreId?: string): Promise<Context> {
  const supabase = createClient();
  if (forcedStoreId) {
    const stores = await supabase.from("stores").select("id,name,is_active").eq("id", forcedStoreId);
    if (stores.error) throw stores.error;
    return { stores: stores.data, defaultStoreId: forcedStoreId };
  }
  const auth = await supabase.auth.getUser();
  if (!auth.data.user) throw new Error("not_authenticated");
  const profile = await supabase.from("user_profiles").select("role,store_id").eq("id", auth.data.user.id).single();
  if (profile.error) throw profile.error;
  let query = supabase.from("stores").select("id,name,is_active").eq("is_active", true).order("name");
  if (profile.data.role !== "superadmin" && profile.data.store_id) query = query.eq("id", profile.data.store_id);
  const stores = await query;
  if (stores.error) throw stores.error;
  return { stores: stores.data, defaultStoreId: profile.data.store_id ?? stores.data.find((store) => store.is_active)?.id ?? "" };
}

async function loadAnalysis(storeId: string): Promise<AnalysisData> {
  const supabase = createClient();
  const [history, configs] = await Promise.all([
    supabase.from("sales_daily_history").select("sales_date,sales_amount,transactions,hourly_data,source_data").eq("store_id", storeId).order("sales_date", { ascending: false }).limit(500),
    supabase.from("sales_month_configs").select("month_start,monthly_data").eq("store_id", storeId).order("month_start"),
  ]);
  if (history.error) throw history.error;
  if (configs.error) throw configs.error;
  return { rows: history.data, configs: configs.data };
}

function money(value: number) {
  return `S/ ${value.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function percent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function SalesAnalysisPanel({ storeId }: { storeId?: string } = {}) {
  const context = useQuery({ queryKey: ["sales-analysis", "context", storeId ?? "role"], queryFn: () => loadContext(storeId) });
  if (context.isPending) return <div className="study-loading">Cargando análisis de ventas…</div>;
  if (context.error || !context.data?.defaultStoreId) return <p className="form-alert error">No hay una tienda disponible para analizar.</p>;
  return <SalesAnalysisStore context={context.data}/>;
}

function SalesAnalysisStore({ context }: { context: Context }) {
  const [storeId, setStoreId] = useState(context.defaultStoreId);
  const query = useQuery({ queryKey: ["sales-analysis", storeId], queryFn: () => loadAnalysis(storeId), enabled: Boolean(storeId) });
  return <>
    {context.stores.length > 1 && <div className="sales-config-selector"><label>Tienda<select value={storeId} onChange={(event) => setStoreId(event.target.value)}>{context.stores.map((store) => <option key={store.id} value={store.id}>{store.name}{store.is_active ? "" : " (inactiva)"}</option>)}</select></label></div>}
    {query.isPending ? <div className="study-loading">Consultando historial…</div> : query.error || !query.data ? <p className="form-alert error">No se pudo cargar el historial de ventas.</p> : <SalesAnalysisView key={`${storeId}-${query.data.rows[0]?.sales_date ?? "empty"}`} data={query.data}/>} 
  </>;
}

function SalesAnalysisView({ data }: { data: AnalysisData }) {
  const latestDate = data.rows[0]?.sales_date ?? new Date().toISOString().slice(0, 10);
  const earliestDate = data.rows[data.rows.length - 1]?.sales_date ?? latestDate;
  const [start, setStart] = useState(() => addIsoDays(latestDate, -6));
  const [end, setEnd] = useState(latestDate);
  const [mode, setMode] = useState<"sales" | "transactions">("sales");
  const analysis = useMemo(() => {
    const previous = previousPeriod(start, end);
    const previousYear = previousYearPeriod(start, end);
    return {
      current: aggregateSales(data.rows, start, end),
      previous: aggregateSales(data.rows, previous.start, previous.end),
      previousDates: previous,
      year: aggregateSales(data.rows, previousYear.start, previousYear.end),
      yearDates: previousYear,
      goal: salesGoal(data.configs, start, end),
    };
  }, [data, end, start]);
  const metric = mode === "sales" ? analysis.current.sales : analysis.current.transactions;
  const previousMetric = mode === "sales" ? analysis.previous.sales : analysis.previous.transactions;
  const yearMetric = mode === "sales" ? analysis.year.sales : analysis.year.transactions;
  const valueFor = (sales: Record<string, number>, transactions: Record<string, number>) => mode === "sales" ? sales : transactions;

  if (!data.rows.length) return <div className="sales-empty large"><Activity size={40}/><h3>Sin historial de ventas</h3><p>Carga ventas desde Configuración para habilitar el comparativo.</p></div>;

  return <section className="sales-analysis-panel">
    <header className="weekly-header"><div><p className="eyebrow">COMPARATIVO DE VENTAS</p><h2>Análisis por periodo</h2><p className="muted">Historial disponible del {earliestDate} al {latestDate}.</p></div><TrendingUp size={30}/></header>
    <div className="sales-analysis-toolbar">
      <label>Desde<input type="date" min={earliestDate} max={latestDate} value={start} onChange={(event) => setStart(event.target.value)}/></label>
      <label>Hasta<input type="date" min={earliestDate} max={latestDate} value={end} onChange={(event) => setEnd(event.target.value)}/></label>
      <div className="sales-mode-switch" role="group" aria-label="Métrica analizada"><button className={mode === "sales" ? "active" : ""} onClick={() => setMode("sales")}>VTA</button><button className={mode === "transactions" ? "active" : ""} onClick={() => setMode("transactions")}>TXS</button></div>
    </div>
    {start > end && <p className="form-alert error sales-message">La fecha inicial no puede ser posterior a la fecha final.</p>}
    <div className="sales-analysis-metrics">
      <Metric icon={CircleDollarSign} label={mode === "sales" ? "Venta del periodo" : "Transacciones"} value={mode === "sales" ? money(metric) : metric.toLocaleString("es-PE")} detail={`${analysis.current.daysWithData} días con datos`}/>
      <Metric icon={Goal} label="Cumplimiento de meta" value={analysis.goal ? `${((analysis.current.sales / analysis.goal) * 100).toFixed(1)}%` : "Sin meta"} detail={analysis.goal ? `${money(analysis.current.sales)} / ${money(analysis.goal)}` : "Configura las metas del periodo"}/>
      <Metric icon={ReceiptText} label="Ticket promedio" value={money(analysis.current.transactions ? analysis.current.sales / analysis.current.transactions : 0)} detail={`${analysis.current.transactions.toLocaleString("es-PE")} transacciones`}/>
      <Metric icon={variation(metric, previousMetric) >= 0 ? TrendingUp : TrendingDown} label="Vs. periodo anterior" value={percent(variation(metric, previousMetric))} detail={`${analysis.previousDates.start} al ${analysis.previousDates.end}`} tone={variation(metric, previousMetric) >= 0 ? "positive" : "negative"}/>
    </div>
    <div className="sales-period-comparison" aria-label="Comparativo con periodos anteriores">
      <article><CalendarRange size={18}/><span>Periodo actual</span><strong>{mode === "sales" ? money(metric) : metric.toLocaleString("es-PE")}</strong><small>{start} al {end}</small></article>
      <article><TrendingUp size={18}/><span>Semana/periodo anterior</span><strong>{mode === "sales" ? money(previousMetric) : previousMetric.toLocaleString("es-PE")}</strong><small>{analysis.previousDates.start} al {analysis.previousDates.end} · {percent(variation(metric, previousMetric))}</small></article>
      <article><CalendarRange size={18}/><span>Mismo periodo del año pasado</span><strong>{mode === "sales" ? money(yearMetric) : yearMetric.toLocaleString("es-PE")}</strong><small>{analysis.yearDates.start} al {analysis.yearDates.end} · {percent(variation(metric, yearMetric))}</small></article>
    </div>
    <div className="sales-analysis-grid">
      <Breakdown title={mode === "sales" ? "Ventas por canal" : "Transacciones por canal"} values={valueFor(analysis.current.channelsSales, analysis.current.channelsTransactions)} labels={SALES_CHANNELS} moneyMode={mode === "sales"}/>
      <Breakdown title={mode === "sales" ? "Ventas por turno" : "Transacciones por turno"} values={valueFor(analysis.current.shiftsSales, analysis.current.shiftsTransactions)} labels={SALES_SHIFTS} moneyMode={mode === "sales"}/>
      <Breakdown title={mode === "sales" ? "Ventas por día" : "Transacciones por día"} values={valueFor(analysis.current.weekdaysSales, analysis.current.weekdaysTransactions)} labels={WEEKDAYS} moneyMode={mode === "sales"}/>
      <HourlyTrend values={businessHourEntries(analysis.current.hourlyTransactions)}/>
    </div>
  </section>;
}

function Metric({ icon: Icon, label, value, detail, tone = "" }: { icon: typeof Activity; label: string; value: string; detail: string; tone?: string }) {
  return <article className={`sales-analysis-metric ${tone}`}><Icon size={20}/><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function Breakdown({ title, values, labels, moneyMode }: { title: string; values: Record<string, number>; labels: readonly string[]; moneyMode: boolean }) {
  const max = Math.max(...labels.map((label) => values[label] || 0), 1);
  return <section className="data-card sales-breakdown"><div className="data-card-heading"><strong>{title}</strong></div><div>{labels.map((label) => <article key={label}><span>{label}</span><div><i style={{ width: `${((values[label] || 0) / max) * 100}%` }}/></div><strong>{moneyMode ? money(values[label] || 0) : Math.round(values[label] || 0).toLocaleString("es-PE")}</strong></article>)}</div></section>;
}

function HourlyTrend({ values }: { values: Array<{ label: string; value: number }> }) {
  const max = Math.max(...values.map((entry) => entry.value), 1);
  return <section className="data-card sales-hour-trend"><div className="data-card-heading"><div><strong>Transacciones por hora</strong><span>Jornada comercial completa.</span></div></div><div className="sales-hour-bars">{values.map((entry) => <article key={entry.label}><span>{Math.round(entry.value)}</span><div><i style={{ height: `${Math.max(3, (entry.value / max) * 100)}%` }}/></div><small>{entry.label}</small></article>)}</div></section>;
}
