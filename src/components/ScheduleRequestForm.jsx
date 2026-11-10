import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getFirestore, collection, addDoc, doc, getDoc } from '../lib/supabase/firestoreCompat';
import { useAuth } from '../contexts/AuthContext';
import { Clock, Calendar, MessageSquare, Send, AlertCircle } from 'lucide-react';
import { approvedBukShiftLabel, getAvailableApprovedBukOptions, getBukRestDays } from '../services/bukSchedule';
import { effectiveModality, getWeekDates, isActiveOnDate, SCHEDULE_DAYS } from '../services/scheduleExportData';
import { filterShiftsByAvailability, getShiftAvailability } from '../services/shiftAvailability';
import { isBukScheduleExempt } from '../services/scheduleStaffOrder';
import { readScheduleAccessPolicy, useScheduleAccessPolicy } from '../hooks/useScheduleAccessPolicy';
import { getRequestDateAccess } from '../services/scheduleAccessPolicy';
import ScheduleRequestDatePicker from './ScheduleRequestDatePicker';

function requestWeek(date) {
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error('Selecciona una fecha válida.');
    }
    const offset = (parsed.getUTCDay() + 6) % 7;
    parsed.setUTCDate(parsed.getUTCDate() - offset);
    const weekStart = parsed.toISOString().slice(0, 10);
    const dates = getWeekDates(weekStart);
    return { weekKey: `${weekStart}_to_${dates[6]}`, day: SCHEDULE_DAYS[offset] };
}

async function readRequestAvailability(perfil, date) {
    const db = getFirestore();
    const { weekKey, day } = requestWeek(date);
    const readStudy = async () => {
        // The profile UUID is stable even after linking or replacing a login.
        let snapshot = await getDoc(doc(db, 'study_schedules', perfil.id));
        if (!snapshot.exists() && perfil.uid && perfil.uid !== perfil.id) {
            snapshot = await getDoc(doc(db, 'study_schedules', perfil.uid));
        }
        return snapshot.exists() ? snapshot.data() : {};
    };
    const [studySchedule, week] = await Promise.all([
        readStudy(),
        getDoc(doc(db, 'schedules', `${perfil.id}_${weekKey}`)),
    ]);
    return { studySchedule, weekSchedule: week.exists() ? week.data() : {}, day };
}

function requestOptions(perfil, date, availability) {
    const modality = effectiveModality(perfil, date);
    if (!['full-time', 'part-time'].includes(String(modality || '').toLowerCase()) || !isActiveOnDate(perfil, date)) return [];
    const rests = getBukRestDays(modality, availability.weekSchedule);
    return filterShiftsByAvailability(
        getAvailableApprovedBukOptions(modality, rests, availability.weekSchedule, availability.day),
        { date, studySchedule: availability.studySchedule },
    );
}

function hasManagementAvailability(perfil, date, studySchedule) {
    if (!isActiveOnDate(perfil, date)) return false;
    // Generic preferences do not invent an opening/closing range. At least one
    // quarter-hour must be available before offering a work request that day.
    const clock = minutes => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    for (let minute = 0; minute < 1440; minute += 15) {
        if (getShiftAvailability({ date, studySchedule, shift: { start: clock(minute), end: clock(minute + 15) } }).available) return true;
    }
    return false;
}

const isClock = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '');

const ScheduleRequestForm = ({ perfil, onSuccess, locked = false }) => {
    const { currentUser } = useAuth();
    const [loading, setLoading] = useState(false);
    const [reload, setReload] = useState(0);
    const [error, setError] = useState('');
    const [dateError, setDateError] = useState('');
    const access = useScheduleAccessPolicy(perfil?.storeId);
    const accessRef = useRef(access);
    accessRef.current = access;
    const [availability, setAvailability] = useState({ key: '', status: 'idle' });
    const [formData, setFormData] = useState({ date: '', shiftType: 'apertura', bukApprovedShiftId: '', startTime: '', endTime: '', reason: '' });
    const saving = useRef(false);
    const mounted = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const contextKey = JSON.stringify([
        currentUser?.uid, perfil?.id, perfil?.uid, perfil?.storeId, formData.date,
        perfil?.position, perfil?.modality, perfil?.modalityChangeDate, perfil?.nextModality,
        perfil?.cessationDate, perfil?.terminationDate, perfil?.isTrainee, perfil?.trainingEndDate,
    ]);
    const contextRef = useRef(contextKey);
    contextRef.current = contextKey;
    const lockedRef = useRef(locked);
    lockedRef.current = locked;
    const dateAccess = access.status === 'ready' && formData.date ? getRequestDateAccess(access.policy, formData.date) : null;
    const ready = availability.key === contextKey && availability.status === 'ready' && dateAccess?.allowed;

    const changeDate = date => {
        const check = !date ? null : access.status === 'ready' ? getRequestDateAccess(access.policy, date)
            : { allowed: false, reason: 'Espera a que se verifique la configuración de solicitudes.' };
        setDateError(check && !check.allowed ? check.reason : '');
        setError('');
        setFormData(previous => ({ ...previous, date: check?.allowed ? date : '', bukApprovedShiftId: '', startTime: '', endTime: '' }));
    };

    useEffect(() => {
        if (access.status !== 'ready' || !formData.date || dateAccess?.allowed) return;
        setDateError(dateAccess.reason);
        setFormData(previous => ({ ...previous, date: '', bukApprovedShiftId: '', startTime: '', endTime: '' }));
    }, [access.status, formData.date, dateAccess?.allowed, dateAccess?.reason]);

    useEffect(() => {
        let cancelled = false;
        setError('');
        if (!formData.date || !perfil?.id || !perfil?.storeId || !dateAccess?.allowed) {
            setAvailability({ key: contextKey, status: 'idle' });
            return;
        }
        setAvailability({ key: contextKey, status: 'loading' });
        readRequestAvailability(perfil, formData.date).then(data => {
            if (!cancelled) setAvailability({ ...data, key: contextKey, status: 'ready' });
        }).catch(cause => {
            if (cancelled) return;
            console.error('Error al cargar horarios disponibles:', cause);
            setAvailability({ key: contextKey, status: 'error' });
            setError('No se pudo cargar la disponibilidad y el plan semanal. Reintenta antes de enviar la solicitud.');
        });
        return () => { cancelled = true; };
    }, [contextKey, reload, dateAccess?.allowed]);

    const exempt = isBukScheduleExempt(perfil);
    const options = useMemo(() => ready && !exempt ? requestOptions(perfil, formData.date, availability) : [],
        [ready, exempt, perfil, formData.date, availability]);
    const hasWorkAvailability = useMemo(() => ready && (exempt
        ? hasManagementAvailability(perfil, formData.date, availability.studySchedule)
        : options.length > 0), [ready, exempt, perfil, formData.date, availability, options]);
    const selected = options.find(option => option.id === formData.bukApprovedShiftId);
    const manualComplete = isClock(formData.startTime) && isClock(formData.endTime) && formData.startTime !== formData.endTime;
    const manualAvailability = ready && exempt && manualComplete ? getShiftAvailability({
        date: formData.date, studySchedule: availability.studySchedule,
        shift: { start: formData.startTime, end: formData.endTime },
    }) : null;
    const canSubmit = Boolean(currentUser?.uid && perfil?.id && perfil?.storeId && ready
        && hasWorkAvailability && (formData.shiftType !== 'rango' || (exempt ? manualAvailability?.available : selected)));

    const handleChange = (event) => {
        const { name, value } = event.target;
        if (name === 'date') { changeDate(value); return; }
        // A failed read still needs its retry action when another field changes.
        if (availability.status !== 'error' || name === 'date') setError('');
        setFormData(prev => ({ ...prev, [name]: value,
            ...(name === 'date' || name === 'shiftType' ? { bukApprovedShiftId: '', startTime: '', endTime: '' } : {}),
        }));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (saving.current) return;
        if (locked) { setError('La administración bloqueó temporalmente las solicitudes de horario.'); return; }
        if (access.status !== 'ready') { setError('No se pudo verificar la configuración de solicitudes. Reintenta antes de enviar.'); return; }
        const permittedDate = getRequestDateAccess(access.policy, formData.date);
        if (!permittedDate.allowed) { setDateError(permittedDate.reason); return; }
        if (!formData.date || !formData.reason.trim()) { setError('Completa la fecha y el motivo de la solicitud.'); return; }
        if (!['apertura', 'medio', 'cierre', 'rango'].includes(formData.shiftType)) { setError('Selecciona un tipo de solicitud válido.'); return; }
        if (!canSubmit) { setError('Selecciona un horario disponible y espera que termine la carga de disponibilidad.'); return; }

        const submittedKey = contextKey;
        saving.current = true;
        setLoading(true);
        setError('');
        try {
            let latestPolicy;
            try {
                latestPolicy = await readScheduleAccessPolicy(perfil.storeId);
            } catch {
                if (mounted.current && contextRef.current === submittedKey) access.retry();
                throw new Error('No se pudo verificar la configuración actual de solicitudes. Reintenta antes de enviar.');
            }
            if (!mounted.current || contextRef.current !== submittedKey) throw new Error('El colaborador o la fecha cambió. Revisa la solicitud.');
            const latestDateAccess = getRequestDateAccess(latestPolicy, formData.date);
            if (!latestDateAccess.allowed) {
                setDateError(latestDateAccess.reason);
                setFormData(previous => ({ ...previous, date: '', bukApprovedShiftId: '', startTime: '', endTime: '' }));
                throw new Error(latestDateAccess.reason);
            }
            // Re-read studies and the weekly plan immediately before submitting:
            // the administrator may have changed either since the selector loaded.
            let latest;
            try {
                latest = await readRequestAvailability(perfil, formData.date);
            } catch {
                if (contextRef.current === submittedKey) setAvailability({ key: submittedKey, status: 'error' });
                throw new Error('No se pudo verificar la disponibilidad actual. Reintenta antes de enviar la solicitud.');
            }
            if (!mounted.current || contextRef.current !== submittedKey) throw new Error('La fecha o el colaborador cambió. Revisa la solicitud antes de enviarla.');
            if (lockedRef.current) throw new Error('La administración bloqueó temporalmente las solicitudes de horario.');
            if (accessRef.current.status !== 'ready' || !getRequestDateAccess(accessRef.current.policy, formData.date).allowed) {
                throw new Error('La administración cambió la disponibilidad de solicitudes. Elige una fecha habilitada.');
            }
            setAvailability({ ...latest, key: submittedKey, status: 'ready' });
            let chosen;
            if (isBukScheduleExempt(perfil)) {
                if (!hasManagementAvailability(perfil, formData.date, latest.studySchedule)) {
                    throw new Error('No hay disponibilidad para trabajar en esta fecha. Revisa tu horario de estudios.');
                }
                if (formData.shiftType === 'rango') {
                    if (!manualComplete) throw new Error('Completa un rango de ingreso y salida válido.');
                    chosen = { start: formData.startTime, end: formData.endTime };
                    const check = getShiftAvailability({ date: formData.date, studySchedule: latest.studySchedule, shift: chosen });
                    if (!check.available) throw new Error(check.reasons[0]?.message || 'Este rango no es compatible con tu disponibilidad.');
                }
            } else {
                const available = requestOptions(perfil, formData.date, latest);
                chosen = available.find(option => option.id === formData.bukApprovedShiftId);
                if (!available.length || (formData.shiftType === 'rango' && !chosen)) {
                    throw new Error('La disponibilidad o el plan semanal cambió. Selecciona uno de los horarios disponibles.');
                }
            }
            await addDoc(collection(getFirestore(), 'schedule_requests'), {
                uid: currentUser.uid, staffId: perfil.id, storeId: perfil.storeId,
                date: formData.date, shiftType: formData.shiftType,
                startTime: formData.shiftType === 'rango' ? chosen.start : null,
                endTime: formData.shiftType === 'rango' ? chosen.end : null,
                reason: formData.reason.trim(), status: 'pending',
            });
            alert('Solicitud enviada correctamente.');
            onSuccess?.();
        } catch (cause) {
            console.error('Error al enviar solicitud:', cause);
            setError(cause?.message || 'No se pudo enviar la solicitud. Inténtalo de nuevo.');
        } finally {
            saving.current = false;
            setLoading(false);
        }
    };

    const fieldClass = 'w-full min-w-0 max-w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none bg-white disabled:opacity-50';
    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <fieldset disabled={loading || locked || access.status !== 'ready' || !access.policy?.requestsEnabled} className="min-w-0 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="block text-sm font-semibold text-gray-700">
                        <span className="mb-2 flex items-center gap-2"><Calendar className="w-4 h-4 text-blue-600" />Fecha de la solicitud *</span>
                        <ScheduleRequestDatePicker value={formData.date} onChange={changeDate} policy={access.policy} status={access.status} disabled={loading || locked} />
                        {dateError && <p role="alert" className="mt-2 text-sm font-normal text-red-700">{dateError}</p>}
                    </div>
                    <label className="block text-sm font-semibold text-gray-700">
                        <span className="mb-2 flex items-center gap-2"><Clock className="w-4 h-4 text-blue-600" />Turno solicitado</span>
                        <select name="shiftType" aria-label="Turno solicitado" value={formData.shiftType} onChange={handleChange} className={fieldClass}>
                            <option value="apertura">Apertura</option><option value="medio">Medio</option><option value="cierre">Cierre</option>
                            <option value="rango">Horario específico</option>
                        </select>
                    </label>
                </div>

                {formData.date && dateAccess?.allowed && !ready && availability.status !== 'error' && <p role="status" className="text-sm text-gray-600">Cargando horarios disponibles...</p>}
                {ready && !hasWorkAvailability && (
                    <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                        {exempt ? 'No hay disponibilidad para trabajar en esta fecha. Revisa tu horario de estudios o elige otra fecha.'
                            : 'No hay turnos aprobados compatibles con tu disponibilidad y el plan semanal para esta fecha. Revisa tu horario de estudios o elige otra fecha.'}
                    </p>
                )}
                {formData.shiftType === 'rango' && !exempt && (
                    <label className="block text-sm font-semibold text-gray-700">
                        <span className="mb-2 block">Ingreso / salida aprobados</span>
                        <select name="bukApprovedShiftId" aria-label="Horario aprobado solicitado" value={selected?.id || ''}
                            onChange={handleChange} disabled={!ready || !options.length} required className={fieldClass}>
                            <option value="">{!formData.date ? 'Selecciona una fecha' : !ready ? 'Cargando horarios...' : !options.length ? 'Sin turnos compatibles' : 'Selecciona un horario aprobado'}</option>
                            {options.map(option => <option key={option.id} value={option.id}>{approvedBukShiftLabel(option)}</option>)}
                        </select>
                    </label>
                )}
                {formData.shiftType === 'rango' && exempt && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="block text-sm font-semibold text-gray-700">
                            <span className="mb-2 block">Hora Inicio</span>
                            <input type="time" name="startTime" aria-label="Hora Inicio" value={formData.startTime} onChange={handleChange} disabled={!ready} required className={fieldClass} />
                        </label>
                        <label className="block text-sm font-semibold text-gray-700">
                            <span className="mb-2 block">Hora Fin</span>
                            <input type="time" name="endTime" aria-label="Hora Fin" value={formData.endTime} onChange={handleChange} disabled={!ready} required className={fieldClass} />
                        </label>
                        {manualAvailability && !manualAvailability.available && <p role="alert" className="text-sm text-red-700 md:col-span-2">{manualAvailability.reasons[0]?.message}</p>}
                        <p className="text-xs text-gray-600 md:col-span-2">Gerentes y asistentes pueden solicitar un rango propio compatible con su disponibilidad.</p>
                    </div>
                )}
                {ready && hasWorkAvailability && formData.shiftType !== 'rango' && (
                    <p className="text-xs text-blue-800">Gerencia elegirá un turno compatible con tu disponibilidad{!exempt && ' y el plan semanal'}. Puedes elegir uno concreto en Horario específico.</p>
                )}

                <label className="block text-sm font-semibold text-gray-700">
                    <span className="mb-2 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-blue-600" />Motivo de la solicitud *</span>
                    <textarea name="reason" aria-label="Motivo de la solicitud" value={formData.reason} onChange={handleChange} required
                        placeholder="Explica brevemente por qué necesitas este horario..." rows="4" className={`${fieldClass} resize-none`} />
                </label>
            </fieldset>

            {access.status !== 'ready' && <div role={access.status === 'error' ? 'alert' : 'status'} className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                <p>{access.status === 'error' ? 'No se pudo verificar la configuración de solicitudes de tu tienda.' : 'Cargando configuración de solicitudes…'}</p>
                {access.status === 'error' && <button type="button" onClick={access.retry} disabled={loading} className="mt-2 rounded-lg border border-blue-300 px-3 py-2 font-bold">Reintentar configuración</button>}
            </div>}
            {access.status === 'ready' && !access.policy.requestsEnabled && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">La administración ha deshabilitado las solicitudes de horario en esta tienda.</p>}

            {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <p>{error}</p>
                {availability.status === 'error' && <button type="button" onClick={() => setReload(value => value + 1)} disabled={loading} className="mt-2 rounded-lg border border-red-300 px-3 py-2 font-bold">Reintentar disponibilidad</button>}
            </div>}
            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-800 leading-relaxed">Tu solicitud será revisada por gerencia. Solicitar un turno no modifica el horario publicado.</p>
            </div>
            <button type="submit" disabled={loading || locked || !canSubmit}
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-4 rounded-xl font-bold shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2">
                <Send className="w-5 h-5" />{loading ? 'Enviando...' : locked ? 'Cambios bloqueados' : 'Enviar Solicitud'}
            </button>
        </form>
    );
};

export default ScheduleRequestForm;
