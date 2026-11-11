import { useEffect, useRef, useState } from 'react';
import { planHeatmapMove } from '../services/heatmapMove';
import { placementFingerprint, placementPlanFingerprint, compatiblePlacementPositions } from '../services/coveragePlacement';
import { applyBukSchedulePatch } from '../services/bukSchedule';

export function useHeatmapMove({ scope, getContext, refreshContext, onChanged }) {
  const [state, setState] = useState(null);
  const session = useRef(null), cached = useRef(null), latest = useRef(null);
  latest.current = { scope, getContext, refreshContext, onChanged };
  const show = value => { session.current = value; setState(value); };
  const cancel = () => { cached.current = null; show(null); };
  const current = token => session.current?.token === token && session.current.scope === latest.current.scope;
  useEffect(() => { cancel(); }, [scope]);
  useEffect(() => () => { session.current = null; }, []);

  const preview = (changes = {}) => {
    const request = session.current;
    if (!request || !current(request.token) || request.applying) return;
    const context = { ...latest.current.getContext(), ...cached.current?.value };
    const next = { ...request, ...changes, plan: null, error: '', revision: request.revision + 1,
      compatiblePositions: compatiblePlacementPositions(context, request.staffId) };
    if (!cached.current?.value) { show({ ...next, busy: !cached.current?.error, error: cached.current?.error || '' }); return; }
    try {
      if (!context.ready || context.saving || !['admin', 'superadmin'].includes(context.role)) throw Error('La edición no está disponible.');
      const plan = planHeatmapMove(context, next, { preview: true });
      show({ ...next, plan, busy: false, error: plan.error });
    } catch (error) { show({ ...next, busy: false, error: error.message }); }
  };
  const select = (staffId, anchor) => {
    const context = latest.current.getContext();
    if (!context.ready || context.saving || !['admin', 'superadmin'].includes(context.role)) return '';
    const person = context.staff.find(item => item.id === staffId);
    if (!person) return '';
    const next = { ...anchor, staffId, date: context.date, position: anchor.sourcePosition, deltaMinutes: 0,
      token: crypto.randomUUID(), scope: latest.current.scope, revision: 0, busy: true,
      name: [person.name, person.lastName].filter(Boolean).join(' '),
      sourceFingerprint: placementFingerprint(context.schedules, staffId), planFingerprint: placementPlanFingerprint(context, staffId) };
    next.compatiblePositions = compatiblePlacementPositions(context, staffId);
    cached.current = { token: next.token }; show(next);
    Promise.resolve().then(() => { if (!current(next.token)) return; return latest.current.refreshContext(staffId); }).then(value => {
      if (!current(next.token)) return;
      cached.current = { token: next.token, value }; preview();
    }).catch(error => { if (current(next.token)) { cached.current = { token: next.token, error: error.message }; show({ ...session.current, busy: false, error: error.message }); } });
    return next.token;
  };
  const apply = async (changes = {}) => {
    const selected = session.current;
    if (!selected || !current(selected.token) || selected.applying) return false;
    const request = { ...selected, ...changes, revision: selected.revision + 1, applying: true, busy: true };
    let compatiblePositions = request.compatiblePositions;
    show(request);
    try {
      const fresh = await latest.current.refreshContext(request.staffId);
      if (!current(request.token)) return false;
      const context = { ...latest.current.getContext(), ...fresh };
      compatiblePositions = compatiblePlacementPositions(context, request.staffId);
      if (!context.ready || context.saving || !['admin', 'superadmin'].includes(context.role)) throw Error('La edición ya no está disponible.');
      context.controller.finishHistoryGroup();
      context.controller.edit(previous => {
        if (!current(request.token)) throw Error('El movimiento fue cancelado.');
        const plan = planHeatmapMove({ ...context, schedules: previous }, request);
        return plan.noChange ? previous : { ...previous, [request.staffId]: applyBukSchedulePatch(previous[request.staffId], context.day, plan.patch) };
      });
      latest.current.onChanged?.(); cancel(); return true;
    } catch (error) {
      if (current(request.token)) show({ ...request, compatiblePositions, applying: false, busy: false, error: error.message, plan: null });
      return false;
    }
  };
  return { state, select, preview, apply, cancel };
}
