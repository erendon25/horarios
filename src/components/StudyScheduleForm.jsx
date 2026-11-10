import React, { useEffect, useRef, useState } from 'react';
import { getFirestore, doc, setDoc, getDoc } from '../lib/supabase/firestoreCompat';
import { useAuth } from '../contexts/AuthContext';
import { Clock, Plus, Trash2, Save, CheckCircle, X } from 'lucide-react';
import { readScheduleAccessPolicy, useScheduleAccessPolicy } from '../hooks/useScheduleAccessPolicy';

const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const labels = {
  monday: 'Lunes',
  tuesday: 'Martes',
  wednesday: 'Miércoles',
  thursday: 'Jueves',
  friday: 'Viernes',
  saturday: 'Sábado',
  sunday: 'Domingo'
};

export default function StudyScheduleForm({ onSuccess, locked = false, storeId }) {
  const { currentUser, userData } = useAuth();
  const activeStoreId = storeId || userData?.storeId;
  const access = useScheduleAccessPolicy(activeStoreId);
  const db = getFirestore();
  const [schedule, setSchedule] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const context = `${currentUser?.uid || ''}:${activeStoreId || ''}`;
  const liveContext = useRef(context);
  liveContext.current = context;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!currentUser?.uid || !activeStoreId) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'study_schedules', currentUser.uid));
        if (!active) return;
        if (snap.exists()) {
          const raw = snap.data();
          const formatted = Object.fromEntries(
            days.map(day => {
              const val = raw[day];
              return [
                day,
                {
                  free: val?.free || false,
                  blocks: Array.isArray(val?.blocks) ? val.blocks : []
                }
              ];
            })
          );
          setSchedule(formatted);
        } else {
          setSchedule(Object.fromEntries(days.map(d => [d, { free: false, blocks: [] }])));
        }
      } catch (err) {
        if (!active) return;
        console.error('Error al cargar horario de estudio:', err);
        setLoadError('No se pudo cargar tu horario de estudios. Reintenta antes de editar o guardar.');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [currentUser?.uid, activeStoreId, db, reload]);

  const handleChange = (day, index, field, value) => {
    const blocks = [...(schedule[day]?.blocks || [])];
    blocks[index] = { ...blocks[index], [field]: value };
    setSchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        blocks
      }
    }));
  };

  const addBlock = (day) => {
    setSchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        blocks: [...(prev[day]?.blocks || []), { start: '', end: '' }]
      }
    }));
  };

  const removeBlock = (day, index) => {
    const blocks = [...(schedule[day]?.blocks || [])];
    blocks.splice(index, 1);
    setSchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        blocks
      }
    }));
  };

  const handleToggleFree = (day, checked) => {
    setSchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        free: checked,
        blocks: checked ? [] : (prev[day]?.blocks || [])
      }
    }));
  };

  const handleSave = async () => {
    if (lockedRef.current) {
      throw new Error('La administración bloqueó temporalmente los cambios de horario.');
    }
    try {
      if (loadError || loading || access.status !== 'ready' || access.policy.adminOnlyStudyEditing || !currentUser?.uid || !activeStoreId) {
        throw new Error('No tienes acceso para editar los horarios de estudio en este momento.');
      }
      const submittedContext = context;
      let latestPolicy;
      try {
        latestPolicy = await readScheduleAccessPolicy(activeStoreId);
      } catch {
        access.retry();
        throw new Error('No se pudo verificar el permiso actual de edición. Reintenta antes de guardar.');
      }
      if (!mounted.current || liveContext.current !== submittedContext) throw new Error('La cuenta o la tienda cambió. Vuelve a abrir tu horario de estudios.');
      if (lockedRef.current || latestPolicy.adminOnlyStudyEditing) throw new Error('La administración gestiona los horarios de estudio de esta tienda.');
      const payload = Object.fromEntries(
        days.map(day => [
          day,
          {
            free: schedule[day]?.free || false,
            blocks: schedule[day]?.blocks || []
          }
        ])
      );
      await setDoc(doc(db, 'study_schedules', currentUser.uid), payload);
      alert('Horarios guardados correctamente.');
    } catch (err) {
      console.error('Error al guardar:', err);
      alert(`Error al guardar horario: ${err?.message || 'Inténtalo de nuevo.'}`);
      throw err;
    }
  };

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSaveWithFeedback = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    const submittedContext = context;
    try {
      await handleSave();
      if (!mounted.current || liveContext.current !== submittedContext) return;
      setSaved(true);
      setTimeout(() => {
        if (!mounted.current || liveContext.current !== submittedContext) return;
        setSaved(false);
        if (onSuccess) onSuccess();
      }, 1500);
    } catch (err) {
      console.error('Error al guardar:', err);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (access.status !== 'ready') return <div role={access.status === 'error' ? 'alert' : 'status'} className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
    <p>{access.status === 'error' ? 'No se pudo verificar la configuración de estudios de tu tienda.' : 'Cargando permisos de edición…'}</p>
    {access.status === 'error' && <button type="button" onClick={access.retry} className="mt-2 rounded-lg border border-blue-300 px-3 py-2 font-bold">Reintentar configuración</button>}
  </div>;

  if (access.policy.adminOnlyStudyEditing) return <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">La administración gestiona tus horarios de estudio. Tus horarios guardados se conservan.</p>;

  if (loadError) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
    <p>{loadError}</p>
    <button type="button" onClick={() => setReload(value => value + 1)} className="mt-2 rounded-lg border border-red-300 px-3 py-2 font-bold">Reintentar horarios de estudio</button>
  </div>;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600 mb-4"></div>
          <p className="text-gray-600">Cargando horarios...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 border border-blue-200">
        <p className="text-sm text-gray-700">
          <strong>Instrucciones:</strong> Agrega los bloques de horarios de estudio para cada día. Si necesitas el día libre, marca la casilla correspondiente.
        </p>
      </div>

      <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
        {days.map(day => (
          <div key={day} className="bg-white border-2 border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-all">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-600" />
                {labels[day]}
              </h2>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={schedule[day]?.free || false}
                  onChange={(e) => handleToggleFree(day, e.target.checked)}
                  className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-sm font-medium text-gray-700 group-hover:text-blue-600 transition-colors">
                  Solicitar día libre
                </span>
              </label>
            </div>

            {schedule[day]?.free ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
                <p className="text-green-700 font-semibold">Día libre solicitado</p>
              </div>
            ) : (
              <>
                <div className="space-y-3 mb-3">
                  {schedule[day]?.blocks?.map((block, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex-1 flex items-center gap-3">
                        <div className="flex-1">
                          <label className="block text-xs text-gray-600 mb-1">Inicio</label>
                          <input
                            type="time"
                            value={block.start || ''}
                            onChange={(e) => handleChange(day, idx, 'start', e.target.value)}
                            className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs text-gray-600 mb-1">Fin</label>
                          <input
                            type="time"
                            value={block.end || ''}
                            onChange={(e) => handleChange(day, idx, 'end', e.target.value)}
                            className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => removeBlock(day, idx)}
                        className="p-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg transition-colors"
                        title="Eliminar bloque"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => addBlock(day)}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white px-4 py-2.5 rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-all shadow-md hover:shadow-lg transform hover:scale-105"
                >
                  <Plus className="w-4 h-4" />
                  Agregar bloque de horario
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
        <button
          onClick={handleSaveWithFeedback}
          disabled={saving || locked}
          className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 ${
            saved 
              ? 'bg-green-500 text-white' 
              : 'bg-gradient-to-r from-green-500 to-green-600 text-white'
          } disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none`}
        >
          {saving ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              Guardando...
            </>
          ) : saved ? (
            <>
              <CheckCircle className="w-5 h-5" />
              ¡Guardado!
            </>
          ) : (
            <>
              <Save className="w-5 h-5" />
              {locked ? 'Cambios bloqueados' : 'Guardar Horarios'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
