import React, { useState, useRef, useEffect } from 'react';
import {
    ChevronLeft,
    ChevronRight,
    Save,
    X,
    Check,
    CheckCircle2,
    User,
    MapPin,
    ClipboardList,
    MessageSquare,
    AlertCircle,
    Loader2
} from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { useAuth } from '../../contexts/AuthContext';
import {
    collection,
    query,
    where,
    getDocs,
    addDoc,
    updateDoc,
    doc,
    serverTimestamp,
    arrayUnion
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
    SERVICE_GENERAL_POINTS,
    SERVICE_STATIONS,
    KNOWLEDGE_POINTS,
    PRODUCTION_GENERAL_POINTS,
    PRODUCTION_STATIONS
} from '../../constants/trainingPoints';

const EvaluationForm = ({ onCancel, onSave, area = 'service', initialData = null }) => {
    const { userData, currentUser } = useAuth();
    const [step, setStep] = useState(1);
    const [selectedCollab, setSelectedCollab] = useState(initialData?.collaboratorId || null);
    const [selectedStation, setSelectedStation] = useState(initialData?.station || '');
    const [responses, setResponses] = useState(initialData?.responses || {});
    const [feedback, setFeedback] = useState(initialData?.feedback || {});
    const [generalFindings, setGeneralFindings] = useState(initialData?.generalFindings || '');
    const [collaborators, setCollaborators] = useState([]);
    const [loadingStaff, setLoadingStaff] = useState(true);
    const [saving, setSaving] = useState(false);

    const sigPadCollab = useRef(null);
    const sigPadTrainer = useRef(null);

    const isService = area === 'service';
    const generalPoints = isService ? SERVICE_GENERAL_POINTS : PRODUCTION_GENERAL_POINTS;
    const stations = isService ? SERVICE_STATIONS : PRODUCTION_STATIONS;

    useEffect(() => {
        const fetchStaff = async () => {
            if (!userData?.storeId) return;
            setLoadingStaff(true);
            try {
                const q = query(
                    collection(db, 'staff_profiles'),
                    where('storeId', '==', userData.storeId)
                );
                const querySnapshot = await getDocs(q);
                const staffData = querySnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                // Sort by name
                staffData.sort((a, b) => a.name.localeCompare(b.name));
                setCollaborators(staffData);
            } catch (error) {
                console.error("Error fetching staff:", error);
            } finally {
                setLoadingStaff(false);
            }
        };

        fetchStaff();
    }, [userData]);

    useEffect(() => {
        if (initialData && step === 5) {
            // Wait for sigPad refs to be available
            setTimeout(() => {
                if (initialData.collabSignature && sigPadCollab.current) {
                    sigPadCollab.current.fromDataURL(initialData.collabSignature);
                }
                if (initialData.trainerSignature && sigPadTrainer.current) {
                    sigPadTrainer.current.fromDataURL(initialData.trainerSignature);
                }
            }, 100);
        }
    }, [initialData, step]);

    const steps = [
        { title: 'Selección', icon: User },
        { title: 'General', icon: ClipboardList },
        { title: 'Estación', icon: MapPin },
        { title: isService ? 'Conocimientos' : 'Procedimientos', icon: MessageSquare },
        { title: 'Finalizar', icon: Check }
    ];

    const handleSubmit = async () => {
        setSaving(true);
        try {
            // Calculate score
            const totalPoints = Object.keys(responses).length;
            const completedPoints = Object.values(responses).filter(v => v === true).length;
            const score = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;

            const selectedCollabData = collaborators.find(c => c.id === selectedCollab);

            // 1. Prepare evaluation details
            const evaluationData = {
                collaboratorId: selectedCollab,
                collaboratorName: initialData?.collaboratorName || `${selectedCollabData.name} ${selectedCollabData.lastName || ''}`.trim(),
                trainerId: currentUser.uid,
                trainerName: `${userData.name || 'Trainer'} ${userData.lastName || ''}`.trim(),
                storeId: userData.storeId,
                area,
                station: selectedStation,
                stationName: stations[selectedStation].title,
                score,
                responses,
                feedback,
                generalFindings,
                timestamp: serverTimestamp(),
                date: initialData?.date || new Date().toISOString().split('T')[0],
                // Simple representation of signatures
                collabSignature: sigPadCollab.current?.isEmpty() ? (initialData?.collabSignature || null) : sigPadCollab.current.toDataURL(),
                trainerSignature: sigPadTrainer.current?.isEmpty() ? (initialData?.trainerSignature || null) : sigPadTrainer.current.toDataURL(),
                isEdited: !!initialData?.id
            };

            let evalId;
            if (initialData?.id) {
                // Update existing
                await updateDoc(doc(db, 'training_evaluations', initialData.id), evaluationData);
                evalId = initialData.id;
            } else {
                // Create new
                const evalRef = await addDoc(collection(db, 'training_evaluations'), evaluationData);
                evalId = evalRef.id;
            }

            // 2. Update staff profile
            const updates = {
                lastEvaluationDate: new Date().toISOString().split('T')[0],
                lastEvaluationScore: score,
                lastStationEvaluated: selectedStation
            };

            // If score >= 90, update skills
            if (score >= 90) {
                updates.skills = arrayUnion(selectedStation.toUpperCase());
            }

            await updateDoc(doc(db, 'staff_profiles', selectedCollab), updates);

            // 3. Callback
            onSave({ ...evaluationData, id: evalId });
        } catch (error) {
            console.error("Error saving evaluation:", error);
            alert("Error al guardar la evaluación. Por favor intenta de nuevo.");
        } finally {
            setSaving(false);
        }
    };

    const handleToggle = (pointId, value) => {
        setResponses(prev => ({ ...prev, [pointId]: value }));
    };

    const handleFeedbackChange = (pointId, text) => {
        setFeedback(prev => ({ ...prev, [pointId]: text }));
    };

    const renderPoint = (point) => {
        const isCompliant = responses[point.id] === true;
        const isNotCompliant = responses[point.id] === false;

        return (
            <div key={point.id} className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-xl shadow-gray-200/40 mb-6 transition-all hover:shadow-orange-500/10">
                <p className="text-sm font-bold text-slate-800 mb-6 leading-relaxed uppercase tracking-tight">{point.text}</p>

                <div className="flex gap-4 mb-4">
                    <button
                        onClick={() => handleToggle(point.id, true)}
                        className={`flex-1 py-3.5 rounded-[20px] flex items-center justify-center gap-3 font-black text-[10px] uppercase tracking-widest transition-all border-2 ${isCompliant
                            ? 'bg-green-500 border-green-500 text-white shadow-xl shadow-green-500/30 active:scale-95'
                            : 'bg-white border-gray-50 text-gray-400 hover:border-gray-200'
                            }`}
                    >
                        <Check size={16} strokeWidth={4} />
                        CUMPLE
                    </button>
                    <button
                        onClick={() => handleToggle(point.id, false)}
                        className={`flex-1 py-3.5 rounded-[20px] flex items-center justify-center gap-3 font-black text-[10px] uppercase tracking-widest transition-all border-2 ${isNotCompliant
                            ? 'bg-rose-500 border-rose-500 text-white shadow-xl shadow-rose-500/30 active:scale-95'
                            : 'bg-white border-gray-50 text-gray-400 hover:border-gray-200'
                            }`}
                    >
                        <X size={16} strokeWidth={4} />
                        NO CUMPLE
                    </button>
                </div>

                {(isNotCompliant || feedback[point.id]) && (
                    <div className="mt-4 animate-in slide-in-from-top duration-300">
                        <textarea
                            placeholder="Anota observaciones o hallazgos aquí..."
                            className="w-full p-4 text-[11px] bg-slate-50 border border-gray-100 rounded-2xl outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all font-bold text-slate-700 shadow-inner"
                            rows="2"
                            value={feedback[point.id] || ''}
                            onChange={(e) => handleFeedbackChange(point.id, e.target.value)}
                        />
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col h-screen bg-slate-50 relative overflow-hidden">
            {/* Top Bar */}
            <div className="bg-white px-6 py-6 flex items-center gap-6 shadow-sm z-10 border-b border-gray-100">
                <button onClick={onCancel} className="p-3 text-gray-400 hover:bg-gray-50 rounded-2xl transition-all active:scale-95">
                    <X size={24} />
                </button>
                <div className="flex-1">
                    <h2 className="text-xl font-black text-slate-900 tracking-tight">Evaluación en progreso</h2>
                    <div className="flex items-center gap-3 text-[10px] text-gray-400 font-black uppercase tracking-[0.2em]">
                        <span className="text-orange-500">Paso {step} de {steps.length}</span>
                        <span className="w-1 h-1 bg-gray-200 rounded-full"></span>
                        <span>{steps[step - 1].title}</span>
                    </div>
                </div>
            </div>

            {/* Progress Indicator */}
            <div className="flex px-8 py-3 bg-white gap-2 shadow-sm relative z-0">
                {steps.map((s, i) => (
                    <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full transition-all duration-700 ${i + 1 <= step ? 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.3)]' : 'bg-gray-100'}`}
                    />
                ))}
            </div>

            {/* Form Content */}
            <div className="flex-1 overflow-y-auto px-6 md:px-12 py-10 pb-40 max-w-5xl mx-auto w-full custom-scrollbar">
                {step === 1 && (
                    <div className="animate-in slide-in-from-right duration-500 max-w-2xl mx-auto">
                        <div className="mb-10 text-center">
                            <div className="w-20 h-20 bg-orange-500 rounded-[32px] flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-orange-500/20 text-white">
                                <User size={32} strokeWidth={3} />
                            </div>
                            <h3 className="text-3xl font-black text-slate-900 tracking-tight">Identificación</h3>
                            <p className="text-gray-400 font-medium text-sm mt-2">Selecciona al colaborador y la estación a evaluar</p>
                        </div>

                        <div className="space-y-10">
                            <div>
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-4">Colaborador</label>
                                <select
                                    className="w-full p-5 bg-white border border-gray-100 rounded-[28px] outline-none focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all font-bold text-slate-900 shadow-xl shadow-gray-200/40 appearance-none cursor-pointer"
                                    value={selectedCollab || ''}
                                    onChange={(e) => setSelectedCollab(e.target.value)}
                                >
                                    <option value="">-- Seleccionar miembro del equipo --</option>
                                    {collaborators.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-4">Estación de {isService ? 'Servicio' : 'Producción'}</label>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                    {Object.keys(stations).map(key => {
                                        const collab = collaborators.find(c => c.id === selectedCollab);
                                        const isCertified = collab?.skills?.some(s => s.toUpperCase() === key.toUpperCase());
                                        const isSelected = selectedStation === key;

                                        return (
                                            <button
                                                key={key}
                                                onClick={() => setSelectedStation(key)}
                                                className={`p-6 rounded-[32px] border-2 flex flex-col items-center gap-4 transition-all duration-500 relative overflow-hidden group ${isSelected
                                                    ? 'bg-orange-500 border-orange-500 text-white shadow-2xl shadow-orange-500/30 scale-105'
                                                    : isCertified
                                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-lg shadow-emerald-500/10'
                                                        : 'bg-white border-gray-50 text-gray-400 hover:border-gray-200 shadow-md'
                                                    }`}
                                            >
                                                {isCertified && !isSelected && (
                                                    <div className="absolute top-3 right-3 text-emerald-500 animate-in zoom-in duration-500">
                                                        <CheckCircle2 size={16} strokeWidth={3} />
                                                    </div>
                                                )}
                                                <div className={`p-4 rounded-2xl transition-colors ${isSelected
                                                    ? 'bg-white/20 text-white'
                                                    : isCertified
                                                        ? 'bg-white text-emerald-500 shadow-sm'
                                                        : 'bg-gray-50 text-gray-300'
                                                    }`}>
                                                    <MapPin size={28} strokeWidth={3} />
                                                </div>
                                                <span className={`text-[11px] font-black text-center leading-tight uppercase tracking-widest ${isCertified && !isSelected ? 'text-emerald-700' : ''}`}>
                                                    {stations[key].title}
                                                </span>
                                                {isCertified && !isSelected && (
                                                    <span className="text-[7px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full">
                                                        Certificado
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="animate-in slide-in-from-right duration-500 max-w-3xl mx-auto">
                        <div className="mb-10">
                            <h3 className="text-2xl font-black text-slate-900 tracking-tight">Criterios Generales</h3>
                            <p className="text-gray-400 font-medium text-sm mt-1 uppercase tracking-widest text-[10px]">Puntos clave de desempeño</p>
                        </div>
                        <div className="space-y-12">
                            {generalPoints.map(section => (
                                <div key={section.id} className="space-y-4">
                                    <div className="flex items-center gap-4 mb-6">
                                        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-gray-100"></div>
                                        <h4 className="text-[10px] font-black text-orange-500 uppercase tracking-[0.3em] bg-orange-50 px-4 py-2 rounded-full">{section.title}</h4>
                                        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-gray-100"></div>
                                    </div>
                                    {section.points.map(renderPoint)}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="animate-in slide-in-from-right duration-500 max-w-3xl mx-auto">
                        <div className="mb-10">
                            <h3 className="text-2xl font-black text-slate-900 tracking-tight">Procedimientos Operativos</h3>
                            <p className="text-orange-500 font-black text-[10px] uppercase tracking-[0.2em] mb-2">{stations[selectedStation].title}</p>
                        </div>
                        <div className="space-y-6">
                            {stations[selectedStation].points.length > 0 ? (
                                stations[selectedStation].points.map(renderPoint)
                            ) : (
                                <div className="p-12 text-center bg-white rounded-[40px] border-2 border-dashed border-gray-100 italic text-gray-300 font-bold">
                                    Contenido en proceso de digitalización...
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {step === 4 && (
                    <div className="animate-in slide-in-from-right duration-500 max-w-3xl mx-auto">
                        <div className="mb-10">
                            <h3 className="text-2xl font-black text-slate-900 tracking-tight">{isService ? 'Manejo de Situaciones' : 'Resumen de Evaluación'}</h3>
                            <p className="text-gray-400 font-medium text-[10px] uppercase tracking-widest mt-1">Últimos detalles antes de finalizar</p>
                        </div>
                        <div className="space-y-6">
                            {isService ? (
                                KNOWLEDGE_POINTS?.map(renderPoint) || <p className="text-center text-gray-400">No hay puntos registrados</p>
                            ) : (
                                <div className="p-12 text-center bg-white rounded-[48px] border-2 shadow-inner border-gray-50 overflow-hidden relative">
                                    <div className="relative z-10">
                                        <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6 text-blue-500">
                                            <AlertCircle size={32} />
                                        </div>
                                        <p className="text-slate-900 font-black uppercase text-sm tracking-widest mb-2">Todo listo</p>
                                        <p className="text-gray-400 text-xs font-bold px-10">Haz completado satisfactoriamente los puntos de {stations[selectedStation].title}.</p>
                                    </div>
                                    <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-blue-50/50 rounded-full blur-3xl"></div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {step === 5 && (
                    <div className="animate-in slide-in-from-right duration-500 max-w-3xl mx-auto">
                        <div className="mb-12">
                            <h3 className="text-3xl font-black text-slate-900 tracking-tight">Cierre y Firmas</h3>
                            <p className="text-gray-400 font-bold text-[10px] uppercase tracking-[0.3em] mt-2">Validez legal de la sesión</p>
                        </div>

                        <div className="space-y-10">
                            <div className="bg-white p-8 rounded-[40px] shadow-2xl shadow-gray-200/50 border border-gray-50 transition-all hover:shadow-orange-500/10">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-6 block">Hallazgos Generales</label>
                                <textarea
                                    className="w-full p-6 bg-slate-50 border border-transparent rounded-[24px] outline-none focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all font-medium text-slate-800 shadow-inner min-h-[150px]"
                                    placeholder="Describe las oportunidades detectadas y el compromiso del colaborador..."
                                    value={generalFindings}
                                    onChange={(e) => setGeneralFindings(e.target.value)}
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] ml-4">Firma Colaborador</label>
                                    <div className="bg-white border-2 border-gray-50 rounded-[40px] overflow-hidden h-48 shadow-xl shadow-gray-200/50 relative">
                                        <SignatureCanvas
                                            ref={sigPadCollab}
                                            penColor="#0F172A"
                                            canvasProps={{ className: 'w-full h-full' }}
                                        />
                                        <button onClick={() => sigPadCollab.current.clear()} className="absolute bottom-4 right-6 text-[9px] font-black text-gray-300 hover:text-red-500 uppercase tracking-widest underline decoration-2">Limpiar</button>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] ml-4">Firma Entrenador</label>
                                    <div className="bg-white border-2 border-gray-50 rounded-[40px] overflow-hidden h-48 shadow-xl shadow-gray-200/50 relative">
                                        <SignatureCanvas
                                            ref={sigPadTrainer}
                                            penColor="#0F172A"
                                            canvasProps={{ className: 'w-full h-full' }}
                                        />
                                        <button onClick={() => sigPadTrainer.current.clear()} className="absolute bottom-4 right-6 text-[9px] font-black text-gray-300 hover:text-red-500 uppercase tracking-widest underline decoration-2">Limpiar</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Saving Overlay */}
            {saving && (
                <div className="fixed inset-0 bg-white/90 backdrop-blur-md flex flex-col items-center justify-center z-[100]">
                    <div className="relative">
                        <Loader2 size={64} className="animate-spin text-orange-500" strokeWidth={3} />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-ping"></div>
                        </div>
                    </div>
                    <p className="font-black text-slate-900 uppercase tracking-[0.3em] text-[10px] mt-8">Procesando Certificación</p>
                    <p className="text-gray-400 text-xs font-bold mt-2">Sincronizando con base de datos real...</p>
                </div>
            )}

            {/* Sticky footer navigation */}
            <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-slate-50 via-slate-50/90 to-transparent flex gap-4 pointer-events-none items-center justify-center">
                <div className="max-w-4xl w-full flex gap-4 pointer-events-auto">
                    <button
                        onClick={() => step > 1 && setStep(step - 1)}
                        className={`flex-1 py-5 px-8 rounded-[24px] font-black uppercase tracking-[0.2em] text-[10px] flex items-center justify-center gap-3 border-2 border-gray-100 bg-white text-gray-400 transition-all hover:bg-gray-50 shadow-xl shadow-gray-200/40 active:scale-95 ${step === 1 ? 'opacity-0 invisible pointer-events-none' : ''}`}
                    >
                        <ChevronLeft size={18} strokeWidth={3} />
                        Anterior
                    </button>
                    <button
                        onClick={() => {
                            if (step < 5) setStep(step + 1);
                            else handleSubmit();
                        }}
                        disabled={step === 1 && (!selectedCollab || !selectedStation)}
                        className="flex-[2] py-5 px-8 bg-slate-900 disabled:opacity-30 disabled:grayscale hover:bg-black text-white rounded-[24px] font-black uppercase tracking-[0.25em] text-[10px] flex items-center justify-center gap-4 transition-all shadow-2xl shadow-slate-900/40 active:scale-95 border-b-4 border-slate-700"
                    >
                        {step === 5 ? (
                            <>
                                {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} strokeWidth={3} />}
                                {saving ? 'Sincronizando' : 'Finalizar y Certificar'}
                            </>
                        ) : (
                            <>
                                Continuar
                                <ChevronRight size={18} strokeWidth={3} />
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EvaluationForm;
