import React, { useState } from 'react';
import { collection, query, where, orderBy, limit, getDocs, getDoc, doc } from '../../lib/supabase/firestoreCompat';
import { Loader2 } from 'lucide-react';
import { db } from '../../supabase';
import { useAuth } from '../../contexts/AuthContext';
import TrainingDashboard from './TrainingDashboard';
import EvaluationForm from './EvaluationForm';
import EvaluationResult from './EvaluationResult';
import TrainingStats from './TrainingStats';
import { isStaffActive } from './staffStatus';
import { verifiedTrainingCompletionFromSnapshot } from '../../lib/supabase/trainingEvidenceCompat';

const TrainingApp = () => {
    const { userData } = useAuth();
    const [view, setView] = useState('dashboard'); // 'dashboard', 'form', 'result', 'stats'
    const [activeArea, setActiveArea] = useState('service'); // 'service', 'production'
    const [lastEvaluationData, setLastEvaluationData] = useState(null);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [indexErrorUrl, setIndexErrorUrl] = useState(null);
    const [drafts, setDrafts] = useState([]);
    const [loadingDrafts, setLoadingDrafts] = useState(false);

    const canEdit = userData?.role === 'admin' || userData?.role === 'trainer' || userData?.role === 'superadmin';

    const fetchDrafts = React.useCallback(async () => {
        if (!userData?.storeId) return;
        setLoadingDrafts(true);
        try {
            const draftsQuery = query(
                collection(db, 'training_evaluations'),
                where('storeId', '==', userData.storeId),
                where('status', '==', 'draft')
            );
            const staffQuery = query(
                collection(db, 'staff_profiles'),
                where('storeId', '==', userData.storeId)
            );
            const [draftsSnapshot, staffSnapshot] = await Promise.all([
                getDocs(draftsQuery),
                getDocs(staffQuery)
            ]);
            const activeStaffIds = new Set(
                staffSnapshot.docs
                    .filter(snapshot => isStaffActive(snapshot.data()))
                    .map(snapshot => snapshot.id)
            );
            const draftsData = draftsSnapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(draft => activeStaffIds.has(draft.collaboratorId));
            setDrafts(draftsData);
        } catch (error) {
            console.error("Error fetching drafts:", error);
        } finally {
            setLoadingDrafts(false);
        }
    }, [userData?.storeId]);

    React.useEffect(() => {
        if (view === 'dashboard') {
            fetchDrafts();
        }
    }, [view, fetchDrafts]);

    const handleStartEvaluation = () => {
        setLastEvaluationData(null);
        setView('form');
    };

    const handleSelectDraft = (draft) => {
        setLastEvaluationData(draft);
        setView('form');
    };

    const handleSaveEvaluation = async (evaluationId) => {
        setLoadingHistory(true);
        try {
            const snapshot = await getDoc(doc(db, 'training_evaluations', evaluationId));
            const persistedEvaluation = verifiedTrainingCompletionFromSnapshot(snapshot);
            setLastEvaluationData(persistedEvaluation);
            setView('result');
            fetchDrafts(); // Refresh drafts list
        } finally {
            setLoadingHistory(false);
        }
    };

    const handleBackToDashboard = () => {
        setView('dashboard');
        setLastEvaluationData(null);
        fetchDrafts();
    };

    const handleSelectCollaborator = async (collaborator) => {
        if (!userData?.storeId) return;

        setLoadingHistory(true);
        try {
            console.log('Fetching evaluation for:', collaborator.id, 'at store:', userData.storeId);
            const q = query(
                collection(db, 'training_evaluations'),
                where('storeId', '==', userData.storeId),
                where('collaboratorId', '==', collaborator.id),
                where('area', '==', activeArea),
                where('status', '==', 'completed'),
                orderBy('timestamp', 'desc'),
                limit(1)
            );

            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                const evalData = querySnapshot.docs[0].data();
                setLastEvaluationData({ ...evalData, id: querySnapshot.docs[0].id });
                setView('result');
            } else {
                alert(`No hay evaluaciones registradas para ${collaborator.name} en la sección de ${activeArea === 'service' ? 'Servicio' : 'Producción'}.`);
            }
        } catch (error) {
            console.error("Error al obtener la evaluación:", error);
            if (error.code === 'permission-denied') {
                alert("No tienes permisos suficientes para ver esta evaluación.");
            } else if (error.message.includes('index')) {
                // Extract URL from error message if available
                const urlMatch = error.message.match(/https:\/\/console\.firebase\.google\.com[^\s]+/);
                if (urlMatch) {
                    setIndexErrorUrl(urlMatch[0]);
                } else {
                    alert("Configurando base de datos. Intenta de nuevo en 2-3 minutos.");
                }
            } else {
                alert("Hubo un error al cargar la información de la evaluación.");
            }
        } finally {
            setLoadingHistory(false);
        }
    };

    const handleEditEvaluation = () => {
        if (canEdit && lastEvaluationData?.status !== 'completed') {
            setView('form');
        } else {
            alert("Las evaluaciones completadas y firmadas son históricas. Registra una nueva evaluación para corregirlas.");
        }
    };

    return (
        <div className="min-h-[100dvh] w-full max-w-none md:max-w-4xl lg:max-w-6xl mx-auto bg-white md:border-x border-gray-100 md:shadow-2xl relative overflow-x-hidden flex flex-col">
            {/* Loading Overlay */}
            {loadingHistory && (
                <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center">
                    <Loader2 className="w-12 h-12 text-orange-500 animate-spin mb-4" />
                    <p className="text-slate-600 font-bold uppercase tracking-widest text-xs">Cargando Historia...</p>
                </div>
            )}

            {/* Index Error Overlay */}
            {indexErrorUrl && (
                <div className="absolute inset-0 z-[60] bg-white p-4 sm:p-8 flex flex-col items-center justify-center text-center">
                    <div className="w-20 h-20 bg-orange-50 rounded-full flex items-center justify-center mb-6">
                        <Loader2 className="w-10 h-10 text-orange-500" />
                    </div>
                    <h2 className="text-2xl font-black text-slate-900 mb-4 tracking-tighter">Activación Requerida</h2>
                    <p className="text-slate-500 mb-8 max-w-md">No se pudo cargar el historial de evaluaciones desde Supabase. Cierra este aviso e inténtalo nuevamente.</p>
                    <div className="flex flex-col gap-4 w-full max-w-xs">
                        <button
                            onClick={() => setIndexErrorUrl(null)}
                            className="text-slate-400 py-3 font-bold uppercase tracking-widest text-[10px]"
                        >
                            Cerrar
                        </button>
                    </div>
                </div>
            )}

            {view === 'dashboard' && (
                <TrainingDashboard
                    onStartEvaluation={handleStartEvaluation}
                    activeArea={activeArea}
                    onAreaChange={setActiveArea}
                    onSelectCollaborator={handleSelectCollaborator}
                    onShowStats={() => setView('stats')}
                    drafts={drafts}
                    loadingDrafts={loadingDrafts}
                    onSelectDraft={handleSelectDraft}
                />
            )}

            {view === 'stats' && (
                <TrainingStats
                    onBack={() => setView('dashboard')}
                    activeArea={activeArea}
                />
            )}

            {view === 'form' && (
                <EvaluationForm
                    onCancel={handleBackToDashboard}
                    onSave={handleSaveEvaluation}
                    area={activeArea}
                    initialData={lastEvaluationData}
                />
            )}

            {view === 'result' && (
                <EvaluationResult
                    data={lastEvaluationData}
                    onBackToDashboard={handleBackToDashboard}
                    onEdit={handleEditEvaluation}
                    canEdit={canEdit && lastEvaluationData?.status !== 'completed'}
                />
            )}
        </div>
    );
};

export default TrainingApp;
