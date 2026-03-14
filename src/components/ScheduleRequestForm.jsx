import React, { useState } from 'react';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { Clock, Calendar, MessageSquare, Send, X, AlertCircle } from 'lucide-react';

const ScheduleRequestForm = ({ perfil, onSuccess }) => {
    const { currentUser } = useAuth();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        date: '',
        shiftType: 'apertura',
        startTime: '',
        endTime: '',
        reason: ''
    });

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.date || !formData.reason) {
            alert('Por favor completa los campos obligatorios (fecha y motivo).');
            return;
        }

        setLoading(true);
        const db = getFirestore();

        try {
            await addDoc(collection(db, 'schedule_requests'), {
                uid: currentUser.uid,
                staffId: perfil.id,
                storeId: perfil.storeId,
                date: formData.date,
                shiftType: formData.shiftType,
                startTime: formData.shiftType === 'rango' ? formData.startTime : '',
                endTime: formData.shiftType === 'rango' ? formData.endTime : '',
                reason: formData.reason,
                status: 'pending',
                createdAt: serverTimestamp()
            });

            alert('Solicitud enviada correctamente.');
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error('Error al enviar solicitud:', error);
            alert('Error al enviar la solicitud. Inténtalo de nuevo.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Fecha */}
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-blue-600" />
                        Fecha de la solicitud *
                    </label>
                    <input
                        type="date"
                        name="date"
                        value={formData.date}
                        onChange={handleChange}
                        required
                        className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                    />
                </div>

                {/* Tipo de Turno */}
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-blue-600" />
                        Turno solicitado
                    </label>
                    <select
                        name="shiftType"
                        value={formData.shiftType}
                        onChange={handleChange}
                        className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none bg-white"
                    >
                        <option value="apertura">Apertura</option>
                        <option value="medio">Medio</option>
                        <option value="cierre">Cierre</option>
                        <option value="rango">Rango Específico</option>
                    </select>
                </div>
            </div>

            {/* Rango de Horas (Solo si shiftType === 'rango') */}
            {formData.shiftType === 'rango' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fadeIn">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Hora Inicio</label>
                        <input
                            type="time"
                            name="startTime"
                            value={formData.startTime}
                            onChange={handleChange}
                            required={formData.shiftType === 'rango'}
                            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Hora Fin</label>
                        <input
                            type="time"
                            name="endTime"
                            value={formData.endTime}
                            onChange={handleChange}
                            required={formData.shiftType === 'rango'}
                            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                        />
                    </div>
                </div>
            )}

            {/* Motivo */}
            <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-blue-600" />
                    Motivo de la solicitud *
                </label>
                <textarea
                    name="reason"
                    value={formData.reason}
                    onChange={handleChange}
                    required
                    placeholder="Explica brevemente por qué necesitas este horario..."
                    rows="4"
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none resize-none"
                ></textarea>
            </div>

            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
                <p className="text-xs text-blue-800 leading-relaxed">
                    <b>Nota:</b> Tu solicitud será revisada por la gerencia. Podrás ver el estado de tu solicitud directamente en el calendario una vez sea aprobada.
                </p>
            </div>

            <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-4 rounded-xl font-bold shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:transform-none flex items-center justify-center gap-2"
            >
                {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                    <>
                        <Send className="w-5 h-5" />
                        Enviar Solicitud
                    </>
                )}
            </button>
        </form>
    );
};

export default ScheduleRequestForm;
