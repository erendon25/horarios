import React, { useMemo, useState } from 'react';
import { buildWeeklySuggestiveSalesReport } from '../services/weeklySuggestiveSales';
import { suggestiveChannelLabel } from '../services/suggestiveChannels';

const dateLabel = value => value.split('-').reverse().join('/');
const money = value => value === null ? '—' : value.toLocaleString('es-PE', { style: 'currency', currency: 'PEN' });
const units = value => value === null ? '—' : value.toLocaleString('es-PE', { maximumFractionDigits: 2 });
const percentage = value => value === null ? '—' : `${value.toLocaleString('es-PE', { maximumFractionDigits: 2 })}%`;
const coverageLabel = week => week.coverage === 'none' ? 'Sin reportes' : week.coverage === 'partial' ? 'Parcial' : 'Completa';
const rowStatus = row => ({
    'no-reports': 'Sin reportes',
    'missing-product-names': 'Configura los nombres exactos',
    'missing-channel-detail': 'Falta venta por canal',
    'missing-product-revenue': 'Faltan importes por producto',
    'no-channel-sales': row.channelSales === 0 ? 'Sin venta en el canal' : 'Sin reportes del canal',
}[row.status] || (row.targetMet === null ? 'Calculado' : row.targetMet ? 'Meta alcanzada' : 'Debajo de la meta'));

export default function WeeklySuggestiveSalesReport({ history = [], products = [], channels, participation = 0.30, today }) {
    const [selection, setSelection] = useState('current');
    const report = useMemo(() => buildWeeklySuggestiveSalesReport({ history, products, channels, participation, today }),
        [history, products, channels, participation, today]);
    const effectiveSelection = selection === 'current' ? report.currentWeekId : selection;
    const selectedWeek = report.weeks.find(week => week.id === effectiveSelection)
        || report.weeks.find(week => week.id === report.currentWeekId);
    const visibleWeeks = selection === 'all' ? report.weeks : selectedWeek ? [selectedWeek] : [];
    const hasReports = visibleWeeks.some(week => week.reportDays > 0);
    const missingRevenue = visibleWeeks.some(week => week.channels.some(channel => channel.status === 'missing-product-revenue'));
    const rows = visibleWeeks.flatMap(week => week.channels.flatMap(channel =>
        channel.products.map(product => ({ week, channel, product }))));
    const buttonClass = active => `rounded-lg px-3 py-2 text-xs font-bold ${active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`;

    return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Reporte semanal de venta sugestiva">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div>
                <h2 className="font-black text-slate-900">2. Participación por producto, semana y canal</h2>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
                    Venta de cada producto ÷ venta real del mismo canal × 100. Cada fila se calcula de manera independiente con los importes acumulados de la semana.
                </p>
            </div>
            <label className="text-xs font-bold text-slate-600">Semana
                <select aria-label="Semana del reporte de venta sugestiva" value={selection} onChange={event => setSelection(event.target.value)} className="mt-1 block max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
                    <option value="current">Semana actual · {report.currentWeekId}</option>
                    <option value="all">Todas las semanas</option>
                    {report.weeks.filter(week => !week.isCurrent).map(week => <option key={week.id} value={week.id}>
                        Semana {week.number} · {dateLabel(week.start)} al {dateLabel(week.end)}
                    </option>)}
                </select>
            </label>
        </div>
        <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setSelection('current')} className={buttonClass(selection === 'current')}>Semana actual</button>
                    <button type="button" onClick={() => setSelection('all')} className={buttonClass(selection === 'all')}>Todas las semanas</button>
                </div>
                {selection !== 'all' && selectedWeek && <p className="text-xs text-slate-600">
                    Semana {selectedWeek.number} de {selectedWeek.year} · {dateLabel(selectedWeek.start)} al {dateLabel(selectedWeek.end)}
                    <span className={`ml-2 inline-block rounded px-2 py-1 font-semibold ${selectedWeek.coverage === 'complete' ? 'bg-green-50 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                        {coverageLabel(selectedWeek)} · {selectedWeek.reportDays}/7 días
                    </span>
                </p>}
            </div>
            {!report.hasProducts && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Agrega los productos que quieres evaluar para calcular su participación semanal.</p>}
            {report.missingProductNames.length > 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Completa el nombre exacto del reporte de: {report.missingProductNames.join(', ')}.</p>}
            {report.duplicateProductNames.length > 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Estos nombres aparecen en más de un producto: {report.duplicateProductNames.join(', ')}. Corrige la selección para evitar duplicar importes.</p>}
            {!hasReports && <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No hay reportes para esta semana. Carga sus ventas o selecciona una semana del histórico; el porcentaje permanece sin datos.</p>}
            {missingRevenue && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Hay reportes sin importes completos por producto. Vuelve a cargar los archivos originales para calcular el porcentaje; las cantidades no se convierten en soles usando el precio configurado.</p>}
            {!report.channels.length && <p className="text-sm text-slate-500">Selecciona al menos un canal para revisar su participación.</p>}
            <div className="overflow-x-auto">
                <table aria-label="Participación semanal por producto y canal" className="w-full min-w-[1040px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr>
                        <th className="p-3">Semana</th><th className="p-3">Canal</th><th className="p-3">Producto</th><th className="p-3 text-right">Días con reporte</th>
                        <th className="p-3 text-right">Venta del canal</th><th className="p-3 text-right">Venta del producto</th>
                        <th className="p-3 text-right">Participación</th><th className="p-3 text-right">Meta</th><th className="p-3">Estado</th>
                    </tr></thead>
                    <tbody>{rows.map(({ week, channel, product }) => <tr key={`${week.id}-${channel.id}-${product.id}`} data-week-id={week.id} data-channel={channel.id} data-product-id={product.id} data-report-name={product.reportNames[0] || ''} className="border-t border-slate-100">
                        <td className="p-3 font-semibold text-slate-700">{week.year} · {week.number}<span className="mt-1 block whitespace-nowrap text-[10px] font-normal text-slate-500">{dateLabel(week.start)}–{dateLabel(week.end)}</span></td>
                        <td className="p-3 font-bold text-slate-800">{suggestiveChannelLabel(channel.id)}</td>
                        <td className="p-3 font-semibold text-slate-800">{product.label}</td>
                        <td className="p-3 text-right text-slate-600">{channel.reportDays}/7<span className="block text-[10px]">{coverageLabel(week)}</span></td>
                        <td className="p-3 text-right tabular-nums">{money(channel.channelSales)}</td>
                        <td className="p-3 text-right tabular-nums">{money(product.revenue)}</td>
                        <td className="p-3 text-right text-lg font-black tabular-nums text-orange-700">{percentage(product.percentage)}</td>
                        <td className="p-3 text-right tabular-nums text-slate-600">{percentage(product.targetPercentage)}</td>
                        <td className="p-3 text-xs text-slate-600">{rowStatus({ ...product, channelSales: channel.channelSales })}</td>
                    </tr>)}</tbody>
                </table>
            </div>
            <details className="rounded-xl border border-slate-200">
                <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-700">Detalle de productos por semana</summary>
                <div className="overflow-x-auto border-t border-slate-200">
                    <table aria-label="Productos vendidos por semana y canal" className="w-full min-w-[740px] text-sm">
                        <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">Semana</th><th className="p-3">Canal</th><th className="p-3">Producto</th><th className="p-3 text-right">Unidades</th><th className="p-3 text-right">Importe registrado</th></tr></thead>
                        <tbody>{rows.map(({ week, channel, product }) => <tr key={`${week.id}-${channel.id}-${product.id}`} className="border-t border-slate-100">
                            <td className="p-3 text-xs text-slate-600">{week.id}</td><td className="p-3 text-xs text-slate-600">{suggestiveChannelLabel(channel.id)}</td>
                            <td className="p-3 font-semibold text-slate-700">{product.label}<span className="mt-1 block text-[10px] font-normal text-slate-500">{product.reportNames.join(' · ') || 'Nombre exacto pendiente'}</span></td>
                            <td className="p-3 text-right tabular-nums">{units(product.units)}</td><td className="p-3 text-right tabular-nums">{money(product.revenue)}</td>
                        </tr>)}</tbody>
                    </table>
                </div>
            </details>
            <p className="text-[11px] leading-relaxed text-slate-500">Semanas de lunes a domingo, por jornada comercial de 06:00 a 05:59. “Parcial” indica que sólo hay reportes para algunos días de la semana. Los nombres de los productos se comparan de forma exacta.</p>
        </div>
    </section>;
}
