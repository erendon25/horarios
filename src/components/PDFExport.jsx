// PDFExport.jsx
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ═════════════  A) HORARIOS SEMANALES  ═════════════ */
const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const DAY_LABELS = {
  monday:'Lunes', tuesday:'Martes', wednesday:'Miércoles',
  thursday:'Jueves', friday:'Viernes', saturday:'Sábado', sunday:'Domingo'
};
const fmt = d => { const x = new Date(d); return isNaN(x)?'':x.toISOString().split('T')[0]; };
const turnoTxt = e => e?.off ? 'DESCANSO' :
                      e?.feriado ? 'FERIADO' :
                      (e?.start && e?.end) ? `${e.start}-${e.end}` : 'S/A';
const hrs = (s,e)=>{ if(!s||!e) return 0;
  const [sh,sm]=s.split(':').map(Number), [eh,em]=e.split(':').map(Number);
  let t=(eh+em/60)-(sh+sm/60); if(t<0) t+=24; return Math.round(t*100)/100;};

export const exportSchedulePDF = (_, staff, schedules, startDate) => {
  const start = new Date(`${startDate}T00:00:00`);
  if (isNaN(start)) return alert('Fecha inválida');

  const weekDates = DAYS.map((_,i)=>new Date(start.getTime()+i*864e5)
                         .toLocaleDateString('es-PE',{day:'2-digit',month:'short'}));

  const pdf  = new jsPDF('landscape','pt','a4');
  const head = ['Nombre','Modalidad', ...DAYS.map((d,i)=>`${DAY_LABELS[d]}\n${weekDates[i]}`),'Total Hrs'];

  const ordered=[...staff.filter(p=>p.modality==='Full-Time'),
                 ...staff.filter(p=>p.modality==='Part-Time'),
                 ...staff.filter(p=>!['Full-Time','Part-Time'].includes(p.modality))];

  const body = ordered.map(p=>{
    let tot=0;
    const row=[p.name.toUpperCase(),p.modality];
    DAYS.forEach(d=>{
      const e=schedules[p.id]?.[d];
      row.push(turnoTxt(e));
      if(e?.start&&e?.end&&!e.off&&!e.feriado) tot+=hrs(e.start,e.end);
    });
    if(p.modality==='Full-Time') tot-=4.5;
    row.push(tot.toFixed(2));
    return row;
  });

  autoTable(pdf,{
    head:[head],
    body,
    margin:{top:30},
    styles:{fontSize:6.5,cellPadding:1.5},
    headStyles:{fillColor:[44,62,80],textColor:255},
    didDrawPage:()=>{pdf.setFontSize(9);pdf.text('HORARIOS SEMANALES',40,22);}
  });

  const end=new Date(start.getTime()+6*864e5);
  pdf.save(`horarios_${fmt(start)}_${fmt(end)}.pdf`);
};

/* ═════════════  B) POSICIONAMIENTO POR TURNO  ═════════════ */
export const exportGroupedPositionsPDF = (
  staff,
  schedules,
  selectedDay,
  turno   = 'ambos',
  logoB64 = null,
  siteName= ''
) => {

  /* ---------- CONFIGURACIÓN ---------- */
  const pdf       = new jsPDF('p','pt','a4');
  const corte     = 14*60;   // 14:00
  const minTarde  = 12*60;   // 12:00
  const pageW     = pdf.internal.pageSize.getWidth();        // ≈ 595 pt
  const colW      = (pageW - 60) / 2;                        // 20 pt margen izq + 20 der + 20 separador
  const maxY      = pdf.internal.pageSize.getHeight() - 40;  // margen inf

  /* ---------- AGRUPACIÓN ---------- */
  const grupos = { mañana:{}, tarde:{} };

  staff.forEach(({ id, name, modality }) => {
    const info = schedules[id]?.[selectedDay];
    if (!info?.position || !info.start || !info.end) return;

    const [sh, sm] = info.start.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const [eh, em] = info.end.split(':').map(Number);
    let endMin = eh * 60 + em;
    if (endMin <= startMin) endMin += 1440;
    if (info.end === '00:00') endMin = startMin + 1440;

    if ((turno === 'mañana' || turno === 'ambos') && startMin < corte) {
      (grupos.mañana[info.position] = grupos.mañana[info.position] || [])
        .push({ n: name.toUpperCase(), mod: modality, h: `${info.start}-${info.end}` });
    }
    const enTarde = startMin >= minTarde || startMin >= corte || endMin > corte;
    if (enTarde && (turno === 'tarde' || turno === 'ambos')) {
      (grupos.tarde[info.position] = grupos.tarde[info.position] || [])
        .push({ n: name.toUpperCase(), mod: modality, h: `${info.start}-${info.end}` });
    }
  });

  /* ---------- HELPERS PÁGINA ---------- */
  const addHeaderFooter = () => {
    if (logoB64) pdf.addImage(logoB64, 'PNG', 20, 12, 60, 25);
    if (siteName) {
      pdf.setFontSize(9);
      pdf.text(siteName, 20, pdf.internal.pageSize.getHeight() - 15);
    }
  };
  const drawTitle = t => {
    const str = `Posicionamiento de turno (${t})`;
    pdf.setFontSize(15);
    pdf.text(str,
      (pdf.internal.pageSize.getWidth() - pdf.getTextWidth(str)) / 2,
      40
    );
  };

  const addTable = (x, y, pos, rows, width) => {
    autoTable(pdf, {
      startY: y,
      margin: { left: x, right: 20 },
      tableWidth: width,
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 1.4 },
      headStyles: { fillColor: [44, 130, 201], textColor: 255, fontStyle: 'bold' },
      head: [[pos]],
      body: rows.map(r => [`• ${r.n} (${r.mod}): ${r.h}`])
    });
    return pdf.lastAutoTable.finalY + 10;
  };

  /* ---------- DIBUJO POR GRUPO (mañana / tarde) ---------- */
  ['mañana','tarde']
    .filter(t => turno === 'ambos' || turno === t)
    .forEach((t, idx) => {
      const posiciones = Object.entries(grupos[t]);
      if (!posiciones.length) return;

      if (idx) pdf.addPage();
      addHeaderFooter();
      drawTitle(t);

      /* --- distribución balanceada --- */
      let yL = 70, yR = 70;
      posiciones.forEach(([pos, rows], i) => {
        const isLeft = i % 2 === 0;
        const x      = isLeft ? 20 : 20 + colW + 20;
        const newY   = addTable(x, isLeft ? yL : yR, pos, rows, colW);

        if (isLeft) yL = newY; else yR = newY;

        // si alguna columna supera el límite, creamos nueva página
        if ((isLeft ? yL : yR) > maxY) {
          pdf.addPage();
          addHeaderFooter();
          drawTitle(t);
          yL = yR = 70;  // reiniciar
        }
      });

      /* Caso especial: solo una posición ⇒ ancho completo */
      if (posiciones.length === 1) {
        pdf.deletePage(pdf.getNumberOfPages()); // quitamos la página actual
        pdf.addPage();
        addHeaderFooter();
        drawTitle(t);
        addTable(20, 70, posiciones[0][0], posiciones[0][1], pageW - 40);
      }
    });

  pdf.save(`posicionamiento_${selectedDay}_${turno}.pdf`);
};
