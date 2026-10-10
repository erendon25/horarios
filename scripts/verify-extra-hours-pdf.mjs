// Verifica el controlador real del botón PDF filtrado con datos ficticios.
// No usa sesiones ni modifica la base de datos.
import { build } from 'esbuild';
import { readFile, mkdtemp, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd();
const component = await readFile(path.join(root, 'src/components/AdminDashboard.jsx'), 'utf8');
const handler = component.slice(
  component.indexOf('    const handleExportGeoVictoriaExtraFilteredPDF ='),
  component.indexOf('    const handleGeoVictoriaLateUpload ='),
);
assert.ok(handler.includes('exportExtraHoursGroupedPDF'));
const fixture = `
import { exportExtraHoursGroupedPDF } from './src/services/exportExtraHoursPDF.js';
const geoVictoriaExtraDateFrom = '2026-09-14';
const geoVictoriaExtraDateTo = '2026-09-20';
const getGeoVictoriaExtraStaffProfile = () => ({});
const getGeoVictoriaDayLabel = (date) => date;
const getShiftWithGeoVictoriaExtras = () => '09:00 - 19:00';
const geoVictoriaExtraFilteredRecords = Array.from({length:145}, (_, i) => ({
  name: 'Colaborador', lastName: String(i), modality: i % 2 ? 'Part-Time' : 'Full-Time',
  dailyDetails: [
    {fecha:'2026-09-14', totalExtraMinutes:60},
    {fecha:'2026-09-20', totalExtraMinutes:90},
    {fecha:'2026-09-21', totalExtraMinutes:300},
  ],
}));
${handler}
document.querySelector('button').onclick = handleExportGeoVictoriaExtraFilteredPDF;
`;
const bundle = await build({ stdin: { contents: fixture, loader: 'js', resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser' });
const logo = await readFile(path.join(root, 'public/images/logo.png'));
const server = createServer((request, response) => {
  if (request.url === '/app.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text);
  } else if (request.url === '/images/logo.png') {
    response.setHeader('Content-Type', 'image/png'); response.end(logo);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="es"><body><button>PDF filtrado</button><script type="module" src="/app.js"></script></body></html>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { errors.push(dialog.message()); await dialog.dismiss(); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF filtrado' }).click();
  const download = await downloadPromise;
  assert.equal(await download.failure(), null);
  const output = await mkdtemp(path.join(tmpdir(), 'extra-hours-qa-'));
  const pdfPath = path.join(output, download.suggestedFilename());
  await download.saveAs(pdfPath);
  assert.match(download.suggestedFilename(), /Reporte_Extras_2026-09-14_to_2026-09-20/);
  assert.ok((await stat(pdfPath)).size > 1000);
  const pdf = await readFile(pdfPath);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.deepEqual(errors, []);
  console.log(`PDF descargado correctamente: ${pdfPath}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
