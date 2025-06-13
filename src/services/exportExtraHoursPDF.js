import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export async function exportExtraHoursPDF(colab) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'A4' });
  const now = new Date();
  const mesActual = now.toLocaleString("es-PE", { month: "long", year: "numeric" });
  const fechaHoy = now.toLocaleDateString('es-PE').replace(/\//g, '.');

  const {
    registros = [],
    name = '',
    lastName = '',
    dni = '',
    cargo = '',
    managerName = '',
    managerDni = '',
    storeName = ''
  } = colab;

  // Título
  doc.setFontSize(14);
  doc.setTextColor(40, 40, 40);
  doc.text('REPORTE DE HORAS EXTRAS', 105, 20, { align: 'center' });

  // Datos personales alineados como en Excel
  const info = [
    [`Nombre: ${name} ${lastName}`, `DNI: ${dni}`],
    [`Cargo: ${cargo}`, `Sucursal: ${storeName}`],
    [`Gerente: ${managerName}`, `DNI Gerente: ${managerDni}`],
    [`Periodo: ${mesActual}`, '']
  ];

  info.forEach((fila, i) => {
    doc.setFontSize(10);
    doc.text(fila[0], 14, 30 + i * 6);
    if (fila[1]) doc.text(fila[1], 120, 30 + i * 6);
  });

  // Tabla estilo Excel
  autoTable(doc, {
    startY: 60,
    head: [[
      { content: 'N°', styles: { halign: 'center' } },
      { content: 'FECHA', styles: { halign: 'center' } },
      { content: 'INICIO', styles: { halign: 'center' } },
      { content: 'FIN', styles: { halign: 'center' } },
      { content: 'DURACIÓN', styles: { halign: 'center' } },
      { content: 'ACTIVIDAD', styles: { halign: 'center' } }
    ]],
    body: registros.map((r, i) => [
      { content: i + 1, styles: { halign: 'center' } },
      { content: r.fecha || '', styles: { halign: 'center' } },
      { content: r.inicio || '', styles: { halign: 'center' } },
      { content: r.fin || '', styles: { halign: 'center' } },
      { content: r.duracion || '', styles: { halign: 'center' } },
      { content: r.actividad || '', styles: { halign: 'left' } }
    ]),
    theme: 'grid',
    styles: {
      fontSize: 9,
      cellPadding: 3,
      textColor: 20,
      lineColor: [200, 200, 200],
      lineWidth: 0.3
    },
    headStyles: {
      fillColor: [230, 230, 230],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      lineColor: [160, 160, 160],
      lineWidth: 0.5
    }
  });

  // Total
  const totalMinutos = registros.reduce((acc, r) => {
    let minutos = 0;
    if (typeof r.duracion === 'string') {
      if (r.duracion.includes('h')) {
        const [h, m] = r.duracion.replace('m', '').split('h').map(s => parseInt(s.trim()) || 0);
        minutos = h * 60 + m;
      } else if (r.duracion.includes(':')) {
        const [h, m] = r.duracion.split(':').map(Number);
        minutos = h * 60 + m;
      }
    }
    return acc + minutos;
  }, 0);

  const totalH = Math.floor(totalMinutos / 60);
  const totalM = totalMinutos % 60;
  const finalY = doc.lastAutoTable?.finalY || 100;

  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.setFont(undefined, 'bold');
  doc.text(`Total horas extras: ${totalH}h ${totalM}m`, 14, finalY + 10);

  // Guardar PDF
  doc.save(`${name}_${fechaHoy}.pdf`);
}
