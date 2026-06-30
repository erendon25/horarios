import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const parseDurationToMinutes = (registro) => {
  if (registro?.totalExtraMinutes !== undefined) return Number(registro.totalExtraMinutes) || 0;
  if (registro?.durationMinutes !== undefined) return Number(registro.durationMinutes) || 0;
  if (registro?.totalExtraHours !== undefined) return Math.round((Number(registro.totalExtraHours) || 0) * 60);

  const value = registro?.duracion;
  let minutos = 0;
  if (typeof value === 'string') {
    if (value.includes('h')) {
      const [h, m] = value.replace('m', '').split('h').map(s => parseInt(s.trim()) || 0);
      minutos = h * 60 + m;
    } else if (value.includes(':')) {
      const [h, m] = value.split(':').map(Number);
      minutos = (h || 0) * 60 + (m || 0);
    }
  } else if (typeof value === 'number') {
    minutos = Math.round(value * 60);
  }
  return minutos;
};

const formatMinutesLabel = (minutes) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(total / 60)}h ${total % 60}m`;
};

const safeFilePart = (value) =>
  String(value || 'reporte')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90) || 'reporte';

const renderExtraHoursReport = (doc, colab) => {
  const now = new Date();
  const mesActual = now.toLocaleString('es-PE', { month: 'long', year: 'numeric' });

  const {
    registros = [],
    name = '',
    lastName = '',
    dni = '',
    cargo = '',
    managerName = '',
    managerDni = '',
    storeName = '',
    periodLabel = mesActual,
  } = colab;

  doc.setFontSize(14);
  doc.setTextColor(40, 40, 40);
  doc.setFont(undefined, 'bold');
  doc.text('REPORTE DE HORAS EXTRAS', 105, 20, { align: 'center' });
  doc.setFont(undefined, 'normal');

  const info = [
    [`Nombre: ${name} ${lastName}`.trim(), `DNI: ${dni}`],
    [`Cargo: ${cargo}`, `Sucursal: ${storeName}`],
    [`Gerente: ${managerName}`, `DNI Gerente: ${managerDni}`],
    [`Periodo: ${periodLabel}`, ''],
  ];

  info.forEach((fila, i) => {
    doc.setFontSize(10);
    doc.text(fila[0], 14, 30 + i * 6);
    if (fila[1]) doc.text(fila[1], 120, 30 + i * 6);
  });

  autoTable(doc, {
    startY: 60,
    head: [[
      { content: 'Nro.', styles: { halign: 'center' } },
      { content: 'FECHA', styles: { halign: 'center' } },
      { content: 'INICIO', styles: { halign: 'center' } },
      { content: 'FIN', styles: { halign: 'center' } },
      { content: 'DURACION', styles: { halign: 'center' } },
      { content: 'ACTIVIDAD', styles: { halign: 'center' } },
    ]],
    body: registros.map((r, i) => {
      const minutes = parseDurationToMinutes(r);
      return [
        { content: i + 1, styles: { halign: 'center' } },
        { content: r.fechaLabel || r.fecha || '', styles: { halign: 'center' } },
        { content: r.inicio || '', styles: { halign: 'center' } },
        { content: r.fin || '', styles: { halign: 'center' } },
        { content: r.duracion || formatMinutesLabel(minutes), styles: { halign: 'center' } },
        { content: r.actividad || '', styles: { halign: 'left' } },
      ];
    }),
    theme: 'grid',
    styles: {
      fontSize: 9,
      cellPadding: 3,
      textColor: 20,
      lineColor: [200, 200, 200],
      lineWidth: 0.3,
    },
    headStyles: {
      fillColor: [230, 230, 230],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      lineColor: [160, 160, 160],
      lineWidth: 0.5,
    },
  });

  const totalMinutos = registros.reduce((acc, r) => acc + parseDurationToMinutes(r), 0);
  const finalY = doc.lastAutoTable?.finalY || 100;

  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.setFont(undefined, 'bold');
  doc.text(`Total horas extras: ${formatMinutesLabel(totalMinutos)}`, 14, finalY + 10);
  doc.setFont(undefined, 'normal');
};

export async function exportExtraHoursPDF(colab) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'A4' });
  const fechaHoy = new Date().toLocaleDateString('es-PE').replace(/\//g, '.');

  renderExtraHoursReport(doc, colab);

  const fileName = colab.fileName || `${safeFilePart(`${colab.name}_${colab.lastName}`)}_${fechaHoy}.pdf`;
  doc.save(fileName);
  return true;
}

export async function exportExtraHoursPDFBatch(colaboradores, options = {}) {
  const reports = (colaboradores || []).filter((colab) => Array.isArray(colab.registros) && colab.registros.length > 0);
  if (reports.length === 0) return false;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'A4' });
  reports.forEach((colab, index) => {
    if (index > 0) doc.addPage();
    renderExtraHoursReport(doc, colab);
  });

  const fechaHoy = new Date().toLocaleDateString('es-PE').replace(/\//g, '.');
  doc.save(options.fileName || `Reporte_Horas_Extras_${fechaHoy}.pdf`);
  return true;
}

const loadImageAsBase64 = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

const formatHoursValue = (value) => {
  const totalMinutes = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m`;
};

export async function exportExtraHoursGroupedPDF(rows, options = {}) {
  const reportTitle = options.reportTitle || 'REPORTE DE HORAS EXTRAS';
  const periodCaption = options.periodCaption || 'Semana';
  const shiftHeader = options.shiftHeader || 'Turno (+HE)';
  const durationHeader = options.durationHeader || 'Horas Extras';
  const collaboratorTotalHeader = options.collaboratorTotalHeader || 'Total colaborador';
  const generalTotalLabel = options.generalTotalLabel || 'TOTAL GENERAL HORAS EXTRAS';
  const summaryOnly = options.summaryOnly === true;
  const reportData = (rows || [])
    .map((row) => ({
      name: String(row.name || '').toUpperCase(),
      modality: row.modality || '',
      day: row.day || row.periodLabel || row.fecha || '',
      shift: row.shift || '',
      extraMinutes: row.extraMinutes !== undefined
        ? Number(row.extraMinutes) || 0
        : Math.round((Number(row.extraHours ?? row.totalExtraHours ?? 0) || 0) * 60),
      weekKey: row.weekKey || options.weekKey || options.periodLabel || '',
      sortKey: row.sortKey || '',
    }))
    .filter((row) => row.name && row.extraMinutes > 0);

  const pdf = new jsPDF('p', 'pt', 'a4');
  const logoB64 = await loadImageAsBase64('/images/logo.png');
  const margin = 30;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  let activeWeekKey = options.weekKey || options.periodLabel || '';

  const addHeader = () => {
    pdf.setFillColor(250, 250, 250);
    pdf.rect(0, 0, pageWidth, 80, 'F');
    if (logoB64) pdf.addImage(logoB64, 'PNG', margin, 15, 100, 50, undefined, 'FAST');

    pdf.setFontSize(16);
    pdf.setTextColor(41, 128, 185);
    pdf.setFont('helvetica', 'bold');
    pdf.text(reportTitle, pageWidth - margin, 40, { align: 'right' });

    pdf.setFontSize(10);
    pdf.setTextColor(100);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`${periodCaption}: ${activeWeekKey}`, pageWidth - margin, 55, { align: 'right' });

    pdf.setDrawColor(41, 128, 185);
    pdf.setLineWidth(1);
    pdf.line(margin, 80, pageWidth - margin, 80);
  };

  if (reportData.length === 0) {
    addHeader();
    pdf.setFontSize(12);
    pdf.setTextColor(0);
    pdf.text('No se encontraron horas extras registradas.', margin, 100);
    pdf.save(options.fileName || `Horas_Extras_${safeFilePart(activeWeekKey)}.pdf`);
    return false;
  }

  const weekKeys = [...new Set(reportData.map((row) => row.weekKey || activeWeekKey))]
    .filter(Boolean)
    .sort();
  let currentY = 100;

  const drawTable = (title, data) => {
    if (data.length === 0) return;

    if (currentY + 50 > pageHeight) {
      pdf.addPage();
      currentY = 100;
      addHeader();
    }

    pdf.setFontSize(14);
    pdf.setTextColor(41, 128, 185);
    pdf.setFont('helvetica', 'bold');
    pdf.text(title, margin, currentY);
    currentY += 15;

    autoTable(pdf, {
      startY: currentY,
      margin: { top: 95, left: margin, right: margin },
      head: [summaryOnly
        ? ['Colaborador', collaboratorTotalHeader]
        : ['Colaborador', 'Dia', shiftHeader, durationHeader, collaboratorTotalHeader]],
      body: Object.values(data.reduce((groups, row) => {
        (groups[row.name] ||= []).push(row);
        return groups;
      }, {}))
        .sort((a, b) => {
          if (!summaryOnly) return 0;
          const totalA = a.reduce((sum, row) => sum + row.extraMinutes, 0);
          const totalB = b.reduce((sum, row) => sum + row.extraMinutes, 0);
          return totalB - totalA || a[0].name.localeCompare(b[0].name);
        })
        .flatMap((personRows) => {
        const personTotal = personRows.reduce((sum, row) => sum + row.extraMinutes, 0);
        if (summaryOnly) {
          return [[
            personRows[0].name,
            { content: formatHoursValue(personTotal), styles: { halign: 'center', fontStyle: 'bold' } },
          ]];
        }
        return personRows.map((row, index) => [
          row.name,
          row.day,
          row.shift,
          formatHoursValue(row.extraMinutes),
          index === 0
            ? { content: formatHoursValue(personTotal), rowSpan: personRows.length, styles: { valign: 'middle', halign: 'center', fontStyle: 'bold' } }
            : null,
        ]);
      }),
      theme: 'grid',
      styles: { fontSize: 10, cellPadding: 5 },
      headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold' },
      columnStyles: summaryOnly
        ? {
            0: { cellWidth: 350 },
            1: { cellWidth: 156, halign: 'center', fillColor: [235, 245, 251] },
          }
        : {
            0: { cellWidth: 145 },
            1: { cellWidth: 72 },
            2: { cellWidth: 105 },
            3: { cellWidth: 70, halign: 'center' },
            4: { cellWidth: 82, halign: 'center', fillColor: [235, 245, 251] },
          },
      didDrawPage: () => addHeader(),
    });

    const totalSection = data.reduce((acc, row) => acc + row.extraMinutes, 0);
    currentY = pdf.lastAutoTable.finalY + 20;

    if (currentY + 20 > pageHeight) {
      pdf.addPage();
      currentY = 100;
      addHeader();
    }

    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(0);
    pdf.text(`TOTAL ${title}: ${formatHoursValue(totalSection)}`, margin, currentY);
    currentY += 30;
  };

  weekKeys.forEach((weekKey, index) => {
    activeWeekKey = weekKey;
    if (index > 0) {
      pdf.addPage();
      currentY = 100;
      addHeader();
    }

    const weekData = reportData
      .filter((row) => (row.weekKey || activeWeekKey) === weekKey)
      .sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
    const fullTimeData = weekData.filter((row) => row.modality === 'Full-Time');
    const partTimeData = weekData.filter((row) => row.modality !== 'Full-Time');

    if (fullTimeData.length > 0) drawTable('FULL TIME', fullTimeData);
    if (partTimeData.length > 0) drawTable('PART TIME', partTimeData);

    const totalExtras = weekData.reduce((acc, row) => acc + row.extraMinutes, 0);
    if (currentY + 20 > pageHeight) {
      pdf.addPage();
      currentY = 100;
      addHeader();
    }

    pdf.setDrawColor(200);
    pdf.setLineWidth(1);
    pdf.line(margin, currentY - 10, pageWidth - margin, currentY - 10);

    pdf.setFontSize(14);
    pdf.setTextColor(41, 128, 185);
    pdf.setFont('helvetica', 'bold');
    pdf.text(`${generalTotalLabel}: ${formatHoursValue(totalExtras)}`, margin, currentY + 10);
    currentY += 40;
  });

  const fechaHoy = new Date().toLocaleDateString('es-PE').replace(/\//g, '.');
  pdf.save(options.fileName || `Reporte_Extras_${safeFilePart(activeWeekKey)}_${fechaHoy}.pdf`);
  return true;
}
