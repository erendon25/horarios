import { useEffect, useRef, useState } from 'react';
import { planCoveragePlacement, placementFingerprint, placementPlanFingerprint, placementPreviewAssignments } from '../services/coveragePlacement';
import { applyBukSchedulePatch } from '../services/bukSchedule';

export function useCoveragePlacement({ scope, getContext, refreshContext, onChanged }) {
  const [state, setState] = useState(null);
  const session = useRef(null), latest = useRef(null), freshCache = useRef(null);
  latest.current = { scope, getContext, refreshContext, onChanged };
  const show = next => { session.current = next; setState(next); };
  const cancel = () => { freshCache.current = null; show(null); };
  const valid = (token, revision) => {
    if (!session.current || session.current.token !== token || session.current.scope !== latest.current.scope
      || revision !== undefined && session.current.revision !== revision) throw Error('La colocación fue cancelada o cambió la fecha.');
  };
  useEffect(() => { cancel(); }, [scope]);
  useEffect(() => () => { session.current = null; }, []);
  useEffect(() => {
    const escape = event => {
      if (event.key === 'Escape' && session.current?.interaction === 'drag') { event.preventDefault(); cancel(); }
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, []);

  const previewDrag = (position, start, force = false) => {
    const current = session.current;
    if (!current || current.interaction !== 'drag' || current.phase === 'dropping') return;
    try { valid(current.token); } catch { cancel(); return; }
    if (!force && current.position === position && current.start === start) return;
    const next = { ...current, position, start, plan: null, proposedAssignments: undefined,
      options: [], error: '', busy: false,
      optionId: position === current.position && start === current.start ? current.optionId : undefined };
    if (!position || start === null) { show(next); return; }
    const cached = freshCache.current;
    if (cached?.token !== current.token || !cached.value) {
      show({ ...next, busy: !cached?.error, error: cached?.error || '' }); return;
    }
    try {
      const context = { ...latest.current.getContext(), ...cached.value };
      if (!context.ready || context.saving || !['admin', 'superadmin'].includes(context.role)) throw Error('La edición no está disponible.');
      const plan = planCoveragePlacement(context, next, {preview:true});
      show({ ...next, plan, optionId: plan.optionId, error:plan.error,
        proposedAssignments: placementPreviewAssignments(context, next, plan) });
    } catch (error) { show({ ...next, error: error.message, options: error.options || [] }); }
  };

  const start = (staffId, { drag = false } = {}) => {
    const context = latest.current.getContext();
    if (!context.ready || context.saving || !['admin', 'superadmin'].includes(context.role)) return '';
    const person = context.staff.find(item => item.id === staffId), shift = context.schedules[staffId]?.[context.day] || {};
    if (!person || shift.off || shift.feriado || shift.holiday) return '';
    const next = { token: crypto.randomUUID(), scope: latest.current.scope, staffId,
      name: [person.name, person.lastName].filter(Boolean).join(' '),
      sourceFingerprint: placementFingerprint(context.schedules, staffId),
      planFingerprint: placementPlanFingerprint(context, staffId),
      interaction: drag ? 'drag' : 'keyboard', phase: drag ? 'drag' : 'choose' };
    freshCache.current = { token: next.token };
    show(next);
    if (drag) {
      // One fresh read per drag, not a request per mouse movement. Applying always reads again.
      Promise.resolve().then(() => { valid(next.token); return latest.current.refreshContext(staffId); }).then(value => {
        valid(next.token); freshCache.current = { token: next.token, value };
        const current = session.current;
        if (current.phase === 'drag') previewDrag(current.position, current.start, true);
      }).catch(error => {
        if (session.current?.token !== next.token || session.current.scope !== latest.current.scope) return;
        freshCache.current = { token: next.token, error: error.message };
        if (session.current.phase === 'drag') previewDrag(session.current.position, session.current.start, true);
      });
    }
    return next.token;
  };

  const target = async (position, start, token) => {
    const current = session.current;
    const next = { ...current, position, start, phase: 'preview', busy: true, error: '', plan: null,
      optionId: position !== current?.position || start !== current?.start ? undefined : current?.optionId,
      revision: (current?.revision || 0) + 1 };
    try {
      valid(token || next.token); show(next);
      const fresh = await latest.current.refreshContext(next.staffId); valid(next.token, next.revision);
      const context = { ...latest.current.getContext(), ...fresh };
      if (!context.ready || context.saving) throw Error('Espera a que el horario esté listo.');
      const plan = planCoveragePlacement(context, next); valid(next.token, next.revision);
      show({ ...next, plan, optionId: plan.optionId, busy: false });
    } catch (error) {
      if (session.current?.token === next.token && session.current.revision === next.revision) show({ ...next, busy: false, error: error.message, options: error.options || [] });
    }
  };

  const commit = async next => {
    show({ ...next, phase: next.interaction === 'drag' ? 'dropping' : 'preview', busy: true, error: '' });
    try {
      const fresh = await latest.current.refreshContext(next.staffId); valid(next.token, next.revision);
      const context = { ...latest.current.getContext(), ...fresh };
      if (!context.ready || context.saving || !['admin', 'superadmin'].includes(context.role)) throw Error('La edición ya no está disponible.');
      context.controller.finishHistoryGroup();
      context.controller.edit(previous => {
        valid(next.token, next.revision);
        const plan = planCoveragePlacement({ ...context, schedules: previous }, next);
        return { ...previous, [next.staffId]: applyBukSchedulePatch(previous[next.staffId], context.day, plan.patch) };
      });
      latest.current.onChanged?.(); cancel();
    } catch (error) {
      if (session.current?.token === next.token && session.current.scope === latest.current.scope) {
        show({ ...next, phase: next.interaction === 'drag' ? 'review' : 'preview', busy: false,
          plan: null, proposedAssignments: undefined, error: error.message, options: error.options || [] });
      }
    }
  };
  const drop = (position, start, token) => {
    try { valid(token); } catch { return; }
    const current = session.current;
    if (current.interaction !== 'drag' || current.phase === 'dropping') return;
    const same = current.position === position && current.start === start;
    return commit({ ...current, position, start,
      optionId: same ? current.optionId : undefined,
      plan: same ? current.plan : null, proposedAssignments: same ? current.proposedAssignments : undefined });
  };
  const apply = () => {
    const current = session.current;
    if (current?.plan && current.plan.valid!==false && !current.busy) return commit(current);
  };
  const chooseOption = optionId => {
    if (!session.current || session.current.busy) return;
    session.current = { ...session.current, optionId };
    if (session.current.interaction === 'drag') previewDrag(session.current.position, session.current.start, true);
    else target(session.current.position, session.current.start, session.current.token);
  };
  const endDrag = token => { if (session.current?.token === token && session.current.phase === 'drag') cancel(); };
  return { state, start, target, previewDrag, drop, chooseOption, apply, cancel, endDrag };
}
