import React from 'react';

const inputClass = 'block w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400';
const labelClass = 'block min-w-0 text-xs font-semibold text-slate-600';

export default function ProjectionPositionFields({
  position,
  onChange,
  idPrefix,
  nameLabel = 'Nombre de posición',
  nameInputRef,
}) {
  const isFixed = position.logic === 'fixed';
  const isService = position.logic === 'service';
  const usesTicket = isService || position.logic === 'driver';
  const fieldId = (name) => `${idPrefix}-${name}`;

  return (
    <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <label htmlFor={fieldId('name')} className={`${labelClass} col-span-2 sm:col-span-2 lg:col-span-2`}>
        <span className="mb-1 block">{nameLabel}</span>
        <input ref={nameInputRef} id={fieldId('name')} type="text" required value={position.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="Ej. Drivethru o Modulo" className={`${inputClass} font-semibold`} />
      </label>
      <label htmlFor={fieldId('logic')} className={`${labelClass} col-span-2 sm:col-span-1 lg:col-span-2`}>
        <span className="mb-1 block">Lógica</span>
        <select id={fieldId('logic')} value={position.logic}
          onChange={(event) => onChange({ logic: event.target.value })} className={inputClass}>
          <option value="sales">VHL general × factor</option>
          <option value="service">Servicio / punto de venta</option>
          <option value="driver">Driver módulo</option>
          <option value="fixed">Fijo / no venta</option>
        </select>
      </label>
      <label htmlFor={fieldId('min')} className={labelClass}>
        <span className="mb-1 block">Mínimo</span>
        <input id={fieldId('min')} type="number" min="0" step="1" value={position.minStaff ?? ''}
          onChange={(event) => onChange({ minStaff: event.target.value })} disabled={isFixed}
          placeholder="0" title="Mínimo por hora operativa" className={inputClass} />
      </label>
      <label htmlFor={fieldId('max')} className={labelClass}>
        <span className="mb-1 block">{isFixed ? 'Personal fijo' : 'Tope de personal'}</span>
        <input id={fieldId('max')} type="number" min="0"
          value={isFixed ? position.fixedStaff ?? '' : position.maxStaff ?? ''}
          onChange={(event) => onChange(isFixed ? { fixedStaff: event.target.value } : { maxStaff: event.target.value })}
          className={inputClass} />
      </label>
      <label htmlFor={fieldId('ticket')} className={labelClass}>
        <span className="mb-1 block">Ticket</span>
        <input id={fieldId('ticket')} type="number" min="1" value={position.ticketAverage ?? ''}
          onChange={(event) => onChange({ ticketAverage: event.target.value })} disabled={!usesTicket}
          className={inputClass} />
      </label>
      <label htmlFor={fieldId('transactions')} className={labelClass}>
        <span className="mb-1 block">Trx/colaborador</span>
        <input id={fieldId('transactions')} type="number" min="1" value={position.transactionsPerCollaborator ?? ''}
          onChange={(event) => onChange({ transactionsPerCollaborator: event.target.value })} disabled={!isService}
          className={inputClass} />
      </label>
      <label htmlFor={fieldId('factor')} className={labelClass}>
        <span className="mb-1 block">Factor</span>
        <input id={fieldId('factor')} type="number" min="0" step="0.05" value={position.factor ?? ''}
          onChange={(event) => onChange({ factor: event.target.value })} disabled={isFixed}
          className={inputClass} />
      </label>
    </div>
  );
}
