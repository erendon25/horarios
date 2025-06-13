// ConsultaNocturnidad.jsx - Botón Excel Completo
import React from 'react';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { FaFileExcel } from 'react-icons/fa';
import { exportExtraHoursExcelStyled } from '../services/exportExtraHoursExcelStyled';
import { toast } from 'react-toastify';

const ExcelExportButton = ({ r, detallesExtra, fetchDetalles }) => {
    const handleExport = async () => {
        try {
            // Mostrar mensaje de carga
            toast.info('Preparando exportación Excel...');

            // Asegurarse de tener los datos detallados primero
            if (!detallesExtra[r.uid]) {
                await fetchDetalles(r.uid);
            }

            // Verificar datos necesarios
            if (!r.name || !r.lastName) {
                toast.error('Datos de colaborador incompletos.');
                return;
            }

            // Obtener información de la tienda
            let storeName = '';
            if (r.storeId || r.sucursal) {
                const storeId = r.storeId || r.sucursal;
                try {
                    const db = getFirestore();
                    const storeRef = doc(db, 'stores', storeId);
                    const storeSnap = await getDoc(storeRef);
                    storeName = storeSnap.exists() ? storeSnap.data().name : '';
                } catch (storeErr) {
                    console.warn('Error al obtener datos de tienda:', storeErr);
                    // Continuamos aunque haya error en tienda
                }
            }

            // Preparar los registros correctamente con todos los campos necesarios
            const registrosCompletos = (detallesExtra[r.uid] || []).map(registro => ({
                fecha: registro.fecha || '',
                inicio: registro.inicio || '',
                fin: registro.fin || '',
                duracion: registro.duracion || '',
                actividad: registro.actividad || ''
            }));

            // Imprimir los registros para depuración
            console.log('Registros a exportar:', registrosCompletos);

            // Preparar datos del colaborador de forma completa
            const colaboradorData = {
                ...r,
                registros: registrosCompletos,
                storeName: storeName || r.storeName || r.sucursal || '',
                // Asegurarnos que todos los campos necesarios estén presentes
                name: r.name || '',
                lastName: r.lastName || '',
                dni: r.dni || '',
            };

            // Ejecutar la exportación
            toast.info('Generando Excel...');
            console.log('Datos enviados a Excel:', colaboradorData);
            const success = await exportExtraHoursExcelStyled(colaboradorData, toast);

            if (success) {
                toast.success(`Archivo Excel de ${r.name} generado correctamente`);
            }
        } catch (error) {
            console.error("Error en exportación Excel:", error);
            toast.error(`Error: ${error.message}`);
        }
    };

    return (
        <button
            onClick={handleExport}
            title="Exportar Excel"
            className="p-1 hover:bg-gray-100 rounded"
        >
            <FaFileExcel className="text-green-600" />
        </button>
    );
};

export default ExcelExportButton;