import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as scheduleHours from './scheduleHours.js';

// Componentes reales con datos aislados: sin sesión ni escrituras de producción.
const schedule = {
  monday: { start: '10:30', end: '14:30' },
  tuesday: { start: '13:00', end: '21:45', extraHoursPost: 2 },
};
const person = { id: 'test', name: 'PRUEBA', modality: 'Full-Time', position: 'COLABORADOR' };

async function loadComponent(filename, imports) {
  const context = vm.createContext({ console });
  const source = await readFile(new URL(`../components/${filename}`, import.meta.url), 'utf8');
  const compiled = transformSync(source, { loader: 'jsx', format: 'esm' }).code;
  const module = new vm.SourceTextModule(compiled, { context });
  await module.link(specifier => {
    const exports = imports[specifier];
    if (!exports) throw new Error(`Import no preparado: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}

test('el exportador real escribe 14:00, no decimales, y mantiene el domingo corto sin break', async () => {
  let table, filename;
  class Pdf {
    setFontSize() {}
    text() {}
    save(name) { filename = name; }
  }
  const module = await loadComponent('PDFExport.jsx', {
    jspdf: { default: Pdf },
    'jspdf-autotable': { default: (_pdf, options) => { table = options; } },
    '../services/scheduleHours': scheduleHours,
  });
  module.exportSchedulePDF([person], { test: schedule }, '2026-09-14_to_2026-09-20');
  const row = table.body.find(row => typeof row[0] === 'string' && row[0].startsWith('PRUEBA'));
  assert.equal(row.at(-1), '14:00');
  assert.equal(row[2], '10:30-14:30');
  assert.equal(row[3], '13:00-23:45');
  assert.equal(table.head[0].at(-1), 'Total\n(h:mm)');
  assert.equal(filename, 'horarios_2026-09-14_2026-09-20.pdf');
});

test('el panel real presenta 12:00 base, 2:00 extras, 14:00 total y 0:45 descontados', async () => {
  const states = ['2026-09-14', schedule];
  let index = 0;
  const icon = () => null;
  const module = await loadComponent('WeeklyView.jsx', {
    react: { default: React, useEffect: () => {}, useState: initial => [index < states.length ? states[index++] : (index++, initial), () => {}] },
    '../lib/supabase/firestoreCompat': Object.fromEntries(['getFirestore', 'doc', 'onSnapshot', 'query', 'collection', 'where'].map(key => [key, () => ({})])),
    '../lib/supabase/client': { supabase: {} },
    'lucide-react': Object.fromEntries(['Calendar', 'Clock', 'MapPin', 'Coffee', 'AlertCircle', 'ChevronLeft', 'ChevronRight', 'ClipboardList', 'X', 'Download'].map(key => [key, icon])),
    './PDFExport': { exportGroupedPositionsPDF: () => {} },
    '../services/scheduleHours': scheduleHours,
  });
  const markup = renderToStaticMarkup(module.default({ perfilId: person.id, staffProfile: person, storeId: 'test' }));
  assert.match(markup, /Base neta:/);
  assert.match(markup, />12:00</);
  assert.match(markup, /\+2:00/);
  assert.match(markup, /Total: 14:00/);
  assert.match(markup, /Refrigerio descontado: 0:45/);
});
