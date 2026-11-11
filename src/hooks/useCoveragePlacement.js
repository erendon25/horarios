import { useEffect, useRef, useState } from 'react';
import { planCoveragePlacement, placementFingerprint } from '../services/coveragePlacement';
import { applyBukSchedulePatch } from '../services/bukSchedule';
export function useCoveragePlacement({
  scope,
  getContext,
  refreshContext,
  onBegin,
  onChanged
}) {
  const [state, setState] = useState(null);
  const session = useRef(null),
    latest = useRef(null);
  latest.current = {
    scope,
    getContext,
    refreshContext,
    onBegin,
    onChanged
  };
  const cancel = () => {
    session.current = null;
    setState(null);
  };
  useEffect(() => {
    cancel();
  }, [scope]);
  useEffect(() => () => {
    session.current = null;
  }, []);
  const valid = (id, revision) => {
    if (!session.current || session.current.token !== id || session.current.scope !== latest.current.scope || revision !== undefined && session.current.revision !== revision) throw Error('La colocación fue cancelada o cambió la fecha.');
  };
  const start = (staffId, {
    drag = false
  } = {}) => {
    const context = latest.current.getContext();
    if (!context.ready || context.saving || !['admin', 'superadmin'].includes(context.role)) return '';
    const person = context.staff.find(item => item.id === staffId),
      shift = context.schedules[staffId]?.[context.day] || {};
    if (!person || shift.off || shift.feriado || shift.holiday) return '';
    const next = {
      token: crypto.randomUUID(),
      scope: latest.current.scope,
      staffId,
      name: [person.name, person.lastName].filter(Boolean).join(' '),
      sourceFingerprint: placementFingerprint(context.schedules, staffId),
      phase: drag ? 'drag' : 'choose'
    };
    session.current = next;
    setState(next);
    if (!drag) latest.current.onBegin?.();
    return next.token;
  };
  const target = async (position, start, token) => {
    const next = {
      ...session.current,
      optionId:position!==session.current?.position || start!==session.current?.start ? undefined : session.current?.optionId,
      position,
      start,
      phase: 'preview',
      busy: true,
      error: '',
      revision: (session.current?.revision || 0) + 1,
      plan: null
    };
    try {
      valid(token || next.token);
      session.current = next;
      setState(next);
      latest.current.onBegin?.();
      const fresh = await latest.current.refreshContext(next.staffId);
      valid(next.token, next.revision);
      const context = {
        ...latest.current.getContext(),
        ...fresh
      };
      if (!context.ready || context.saving) throw Error('Espera a que el horario esté listo.');
      const plan = planCoveragePlacement(context, next);
      valid(next.token, next.revision);
      session.current = {
        ...next,
        plan,
        optionId: plan.optionId || next.optionId,
        busy: false
      };
      setState(session.current);
    } catch (error) {
      if (session.current?.token === next.token && session.current?.revision === next.revision) {
        session.current = {
          ...next,
          busy: false,
          error: error.message
        };
        setState(session.current);
      }
    }
  };
  const chooseOption = optionId => {
    if (!session.current) return;
    session.current = {
      ...session.current,
      optionId
    };
    target(session.current.position, session.current.start, session.current.token);
  };
  const apply = async () => {
    const next = session.current;
    if (!next || next.busy || !next.plan) return;
    setState({
      ...next,
      busy: true,
      error: ''
    });
    session.current = {
      ...next,
      busy: true
    };
    try {
      const fresh = await latest.current.refreshContext(next.staffId);
      valid(next.token, next.revision);
      const context = {
        ...latest.current.getContext(),
        ...fresh
      };
      if (!context.ready || context.saving || !['admin', 'superadmin'].includes(context.role)) throw Error('La edición ya no está disponible.');
      context.controller.edit(previous => {
        valid(next.token, next.revision);
        const plan = planCoveragePlacement({
          ...context,
          schedules: previous
        }, next);
        return {
          ...previous,
          [next.staffId]: applyBukSchedulePatch(previous[next.staffId], context.day, plan.patch)
        };
      });
      latest.current.onChanged?.();
      cancel();
    } catch (error) {
      if (session.current?.token === next.token) {
        session.current = {
          ...next,
          busy: false,
          error: error.message
        };
        setState(session.current);
      }
    }
  };
  const endDrag = () => {
    if (session.current?.phase === 'drag') cancel();
  };
  return {
    state,
    start,
    target,
    chooseOption,
    apply,
    cancel,
    endDrag
  };
}
