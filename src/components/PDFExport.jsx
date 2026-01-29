// PDFExport.jsx - Corregido para evitar errores con nombres indefinidos
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = {
    monday: 'Lunes', tuesday: 'Martes', wednesday: 'Miércoles',
    thursday: 'Jueves', friday: 'Viernes', saturday: 'Sábado', sunday: 'Domingo'
};
const fmt = d => { const x = new Date(d); return isNaN(x) ? '' : x.toISOString().split('T')[0]; };
const turnoTxt = e => e?.off ? 'DESCANSO' :
    e?.feriado ? 'FERIADO' :
        (e?.start && e?.end) ? `${e.start}-${e.end}` : 'S/A';
const hrs = (s, e) => {
    if (!s || !e) return 0;
    const [sh, sm] = s.split(':').map(Number), [eh, em] = e.split(':').map(Number);
    let t = (eh + em / 60) - (sh + sm / 60); if (t < 0) t += 24; return Math.round(t * 100) / 100;
};

export const exportSchedulePDF = (staff, schedules, weekKey) => {
    // Extraer la fecha de inicio del weekKey (formato: "2024-01-15_to_2024-01-21")
    const dateStr = weekKey.split('_to_')[0];

    if (!dateStr) {
        alert('Formato de semana inválido');
        return;
    }

    const start = new Date(`${dateStr}T00:00:00`);
    if (isNaN(start)) {
        alert('Fecha inválida');
        return;
    }

    const weekDates = DAYS.map((_, i) => new Date(start.getTime() + i * 864e5)
        .toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }));

    const pdf = new jsPDF('landscape', 'pt', 'a4');
    const head = ['Nombre', 'Modalidad', ...DAYS.map((d, i) => `${DAY_LABELS[d]}\n${weekDates[i]}`), 'Total Hrs'];

    const ordered = [...staff.filter(p => p.modality === 'Full-Time'),
    ...staff.filter(p => p.modality === 'Part-Time'),
    ...staff.filter(p => !['Full-Time', 'Part-Time'].includes(p.modality))];

    const body = ordered.map(p => {
        let tot = 0;
        const nombre = p.name ? p.name.toUpperCase() : 'SIN NOMBRE';
        const row = [nombre, p.modality || '--'];
        DAYS.forEach(d => {
            const e = schedules[p.id]?.[d];

            // Lógica para mostrar horario extendido si hay horas extras
            let displayTxt = 'S/A';
            if (e?.off) displayTxt = 'DESCANSO';
            else if (e?.feriado) displayTxt = 'FERIADO';
            else if (e?.start && e?.end) {
                let finalEnd = e.end;
                let extraToAdd = 0;

                if (e.extraHours && !isNaN(e.extraHours) && Number(e.extraHours) > 0) {
                    extraToAdd = Number(e.extraHours);
                    const [eh, em] = e.end.split(':').map(Number);
                    const totalMins = eh * 60 + em + (extraToAdd * 60);
                    const newH = Math.floor(totalMins / 60) % 24;
                    const newM = totalMins % 60;
                    finalEnd = `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
                }

                displayTxt = `${e.start}-${finalEnd}`;

                // Sumar al total
                tot += hrs(e.start, e.end) + extraToAdd;
            }

            row.push(displayTxt);
        });
        if (p.modality === 'Full-Time') tot -= 4.5; // Ajuste FT (si aplica)
        row.push(tot.toFixed(2));
        return row;
    });

    autoTable(pdf, {
        head: [head],
        body,
        margin: { top: 30 },
        styles: { fontSize: 6.5, cellPadding: 1.5 },
        headStyles: { fillColor: [44, 62, 80], textColor: 255 },
        didDrawPage: () => { pdf.setFontSize(9); pdf.text('HORARIOS SEMANALES', 40, 22); }
    });

    const end = new Date(start.getTime() + 6 * 864e5);
    pdf.save(`horarios_${fmt(start)}_${fmt(end)}.pdf`);
};

const getBase64ImageFromURL = (url) => {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = url;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(null);
    });
};

export const exportGroupedPositionsPDF = async (
    staff,
    schedules,
    selectedDay,
    dateText = '',
    turno = 'ambos',
    orderedPositions = []
) => {
    const pdf = new jsPDF('p', 'pt', 'a4');
    const logoB64 = await getBase64ImageFromURL('/images/logo.png');

    // Configuración general
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 30;
    const colWidth = (pageWidth - (margin * 3)) / 2; // Dos columnas con margen central

    // Colores corporativos (ajusta según la marca)
    const primaryColor = [41, 128, 185]; // Azul
    const secondaryColor = [52, 73, 94]; // Gris oscuro
    const accentColor = [236, 240, 241]; // Gris muy claro

    const corte = 14 * 60; // 14:00
    const minTarde = 12 * 60; // 12:00

    // Agrupar datos
    const grupos = { mañana: {}, tarde: {} };

    staff.forEach(({ id, name, modality }) => {
        if (!id || !name) return;
        const info = schedules[id]?.[selectedDay];
        if (!info?.position || !info.start || !info.end) return;

        let [sh, sm] = info.start.split(':').map(Number);
        const startMin = sh * 60 + sm;
        let [eh, em] = info.end.split(':').map(Number);

        // --- LOGICA DE SUMA DE HORAS EXTRAS (VISUAL) ---
        let finalEndH = eh;
        let finalEndM = em;

        let extraVal = 0;
        if (info.extraHours) {
            // Asegurar que convertimos a número correctamente
            extraVal = parseFloat(String(info.extraHours));
        }

        if (!isNaN(extraVal) && extraVal > 0) {
            const extraMins = extraVal * 60;
            const originalEndMins = eh * 60 + em;
            const newEndMins = originalEndMins + extraMins;

            finalEndH = Math.floor(newEndMins / 60) % 24;
            finalEndM = newMins % 60;
        }
        // -----------------------------------------------

        let endMin = finalEndH * 60 + finalEndM;
        if (endMin <= startMin) endMin += 1440;

        // Formatear nueva salida
        const finalEndStr = `${String(finalEndH).padStart(2, '0')}:${String(finalEndM).padStart(2, '0')}`;

        const displayName = name ? name.toUpperCase() : 'SIN NOMBRE';

        // DEBUG: Agregar marca si hay horas extras
        let label = displayName;
        if (extraVal > 0) {
            label += ` (+${extraVal}h)`;
            // console.log(`DEBUG ACTIVE: ${label}`); 
        }

        // Usar finalEndStr para el horario mostrado
        const entry = { n: label, mod: modality, h: `${info.start} - ${finalEndStr}` };

        // Lógica de turno (usando la hora base para categorizar, o la extendida? 
        // Usualmente mañna/tarde se define por el INICIO o bloqe principal.
        // Mantendremos lógica actual basada en startMin)
        if ((turno === 'mañana' || turno === 'ambos') && startMin < corte) {
            if (!grupos.mañana[info.position]) grupos.mañana[info.position] = [];
            grupos.mañana[info.position].push(entry);
        }

        const enTarde = startMin >= minTarde || startMin >= corte || endMin > corte;
        if (enTarde && (turno === 'tarde' || turno === 'ambos')) {
            if (!grupos.tarde[info.position]) grupos.tarde[info.position] = [];
            grupos.tarde[info.position].push(entry);
        }
    });

    // Función Header
    const addHeader = (titleSuffix) => {
        // Fondo del header
        pdf.setFillColor(250, 250, 250);
        pdf.rect(0, 0, pageWidth, 80, 'F');

        // Logo
        if (logoB64) {
            pdf.addImage(logoB64, 'PNG', margin, 15, 100, 50, undefined, 'FAST');
        }

        // Título
        pdf.setFontSize(18);
        pdf.setTextColor(...secondaryColor);
        pdf.setFont('helvetica', 'bold');
        const title = `POSICIONAMIENTO DIARIO`;
        const titleW = pdf.getTextWidth(title);
        pdf.text(title, pageWidth - margin - titleW, 35);

        // Subtítulo (Fecha y turno)
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(100);
        const subtitle = `${dateText || selectedDay.toUpperCase()} | ${titleSuffix.toUpperCase()}`;
        const subW = pdf.getTextWidth(subtitle);
        pdf.text(subtitle, pageWidth - margin - subW, 55);

        // Línea separadora
        pdf.setDrawColor(...primaryColor);
        pdf.setLineWidth(1.5);
        pdf.line(margin, 80, pageWidth - margin, 80);
    };

    // Función Footer
    const addFooter = (pageNumber) => {
        pdf.setFontSize(8);
        pdf.setTextColor(150);
        const text = `Página ${pageNumber} - Generado el ${new Date().toLocaleDateString()}`;
        pdf.text(text, pageWidth / 2, pageHeight - 15, { align: 'center' });
    };

    // Renderizar tablas
    const turnosToRender = ['mañana', 'tarde'].filter(t => turno === 'ambos' || turno === t);

    for (let i = 0; i < turnosToRender.length; i++) {
        const t = turnosToRender[i];

        // Obtener entradas
        let entradas = Object.entries(grupos[t]);

        // Ordenar según orderedPositions si existe
        if (orderedPositions && orderedPositions.length > 0) {
            entradas.sort((a, b) => {
                const idxA = orderedPositions.indexOf(a[0]);
                const idxB = orderedPositions.indexOf(b[0]);
                // Si ambos están en la lista, comparar índices
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                // Si uno está y el otro no, el que está va primero
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                // Si ninguno está, alfabético
                return a[0].localeCompare(b[0]);
            });
        }

        if (entradas.length === 0 && turnosToRender.length === 1) {
            // Caso borde vacío
            addHeader(t);
            pdf.setFontSize(12);
            pdf.text("No hay asignaciones para este turno.", margin, 100);
            continue;
        }
        if (entradas.length === 0) continue;

        if (i > 0) pdf.addPage();
        addHeader(t);

        let yLeft = 100;
        let yRight = 100;

        // Distribuir en dos columnas
        entradas.forEach(([pos, rows], idx) => {
            const isLeft = idx % 2 === 0;
            const currentY = isLeft ? yLeft : yRight;
            const xPos = isLeft ? margin : margin + colWidth + margin;

            // Verificar espacio
            if (currentY > pageHeight - 60) {
                pdf.addPage();
                addHeader(t);
                yLeft = 100;
                yRight = 100;
                // Recalcular Y
            }

            // Título de la posición
            /*
            pdf.setFontSize(11);
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(...primaryColor);
            pdf.text(pos.toUpperCase(), xPos, (isLeft ? yLeft : yRight) - 5);
            */

            autoTable(pdf, {
                startY: currentY,
                margin: { left: xPos },
                tableWidth: colWidth,
                theme: 'grid',
                head: [[pos.toUpperCase()]],
                body: rows.map(r => [`${r.n}\n${r.mod} • ${r.h}`]),
                styles: {
                    fontSize: 9,
                    cellPadding: 4,
                    overflow: 'linebreak',
                    valign: 'middle'
                },
                headStyles: {
                    fillColor: primaryColor,
                    textColor: 255,
                    fontStyle: 'bold',
                    fontSize: 10,
                    halign: 'center'
                },
                columnStyles: {
                    0: { cellWidth: 'auto' }
                },
                alternateRowStyles: {
                    fillColor: accentColor
                },
                didDrawPage: (data) => {
                    // Solo dibujar header/footer en la primera llamada de página automática si no es la inicial nuestra
                    // Pero como manejamos addPage manual, mejor desactivar el header hook estándar y usar el nuestro
                }
            });

            const finalY = pdf.lastAutoTable.finalY + 15;
            if (isLeft) yLeft = finalY;
            else yRight = finalY;
        });

        addFooter(pdf.internal.getNumberOfPages());
    }

    pdf.save(`posicionamiento_${selectedDay}_${turno}_v${Date.now()}.pdf`);
};

export const exportExtraHoursReport = async (staff, schedules, weekKey) => {
    const pdf = new jsPDF('p', 'pt', 'a4');
    const logoB64 = await getBase64ImageFromURL('/images/logo.png');

    const margin = 30;
    const pageWidth = pdf.internal.pageSize.getWidth();

    // Header
    const addHeader = (page) => {
        pdf.setFillColor(250, 250, 250);
        pdf.rect(0, 0, pageWidth, 80, 'F');
        if (logoB64) pdf.addImage(logoB64, 'PNG', margin, 15, 100, 50, undefined, 'FAST');

        pdf.setFontSize(16);
        pdf.setTextColor(41, 128, 185);
        pdf.setFont('helvetica', 'bold');
        pdf.text("REPORTE DE HORAS EXTRAS", pageWidth - margin, 40, { align: 'right' });

        pdf.setFontSize(10);
        pdf.setTextColor(100);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`Semana: ${weekKey}`, pageWidth - margin, 55, { align: 'right' });

        pdf.setDrawColor(41, 128, 185);
        pdf.setLineWidth(1);
        pdf.line(margin, 80, pageWidth - margin, 80);
    };

    // Recopilar datos
    const reportData = [];
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const dayNames = { monday: 'Lunes', tuesday: 'Martes', wednesday: 'Miércoles', thursday: 'Jueves', friday: 'Viernes', saturday: 'Sábado', sunday: 'Domingo' };

    staff.forEach(p => {
        const schedule = schedules[p.id] || {};
        days.forEach(day => {
            const info = schedule[day];
            if (info && info.extraHours && !isNaN(info.extraHours) && Number(info.extraHours) > 0) {
                // Calcular turno extendido para mostrar
                let endStr = info.end;
                const extraVal = Number(info.extraHours);
                if (info.end && info.start) {
                    const [eh, em] = info.end.split(':').map(Number);
                    const totalMins = eh * 60 + em + (extraVal * 60);
                    const finalH = Math.floor(totalMins / 60) % 24;
                    const finalM = totalMins % 60;
                    endStr = `${String(finalH).padStart(2, '0')}:${String(finalM).padStart(2, '0')}`;
                }

                reportData.push({
                    name: `${p.name} ${p.lastName}`,
                    modality: p.modality,
                    day: dayNames[day], // O la fecha exacta si la tuviéramos calculada fácil
                    shift: `${info.start} - ${endStr}`,
                    extra: extraVal
                });
            }
        });
    });

    if (reportData.length === 0) {
        addHeader(1);
        pdf.setFontSize(12);
        pdf.setTextColor(0);
        pdf.text("No se encontraron horas extras registradas esta semana.", margin, 100);
        pdf.save(`Horas_Extras_${weekKey}.pdf`);
        return;
    }

    autoTable(pdf, {
        startY: 100,
        head: [['Colaborador', 'Modalidad', 'Día', 'Turno (+HE)', 'Horas Extras']],
        body: reportData.map(d => [
            d.name.toUpperCase(),
            d.modality,
            d.day,
            d.shift,
            d.extra + ' hrs'
        ]),
        theme: 'grid',
        styles: { fontSize: 10, cellPadding: 5 },
        headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold' },
        didDrawPage: (data) => {
            addHeader(data.pageNumber);
        }
    });

    // Total General
    const totalExtras = reportData.reduce((acc, curr) => acc + curr.extra, 0);
    const finalY = pdf.lastAutoTable.finalY + 20;

    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(0);
    pdf.text(`TOTAL HORAS EXTRAS SEMANA: ${totalExtras} hrs`, margin, finalY);

    pdf.save(`Reporte_Extras_${weekKey}_v${Date.now()}.pdf`);
};