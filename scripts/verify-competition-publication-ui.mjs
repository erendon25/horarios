// Start serve-competition-qa.mjs first. Only isolated test data is used.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const url = `http://127.0.0.1:${process.env.COMPETITION_QA_PORT || 4178}/concurso`;
  const admin = await browser.newPage();
  const collaborator = await browser.newPage();
  const errors = [];
  for (const page of [admin, collaborator]) page.on('pageerror', e => errors.push(e.message));
  admin.on('dialog', dialog => dialog.accept());
  await admin.goto(url);
  await admin.getByRole('button', { name: 'Configuración', exact: true }).click();
  const id = await admin.locator('.toolbar select').inputValue();
  assert.ok(id);
  await admin.getByRole('button', { name: 'Ocultar al equipo', exact: true }).click();
  await admin.getByRole('button', { name: 'Publicar al equipo', exact: true }).waitFor();
  await collaborator.goto(`${url}?role=collaborator&id=${id}`);
  await collaborator.getByRole('heading', { name: 'No hay concursos disponibles' }).waitFor();
  assert.equal(await collaborator.getByRole('navigation', { name: 'Secciones del concurso' }).count(), 0);
  assert.equal(await collaborator.getByText('Equipo 1', { exact: true }).count(), 0);
  await admin.getByRole('button', { name: 'Publicar al equipo', exact: true }).click();
  await admin.getByRole('button', { name: 'Ocultar al equipo', exact: true }).waitFor();
  await collaborator.reload();
  await collaborator.getByRole('button', { name: 'Inscripción', exact: true }).waitFor();
  assert.equal(await collaborator.getByRole('button', { name: 'Configuración', exact: true }).count(), 0);
  await collaborator.getByRole('button', { name: 'Fixture', exact: true }).click();
  await collaborator.getByRole('heading', { name: /Fixture/ }).waitFor();
  await admin.getByRole('button', { name: 'Ocultar al equipo', exact: true }).click();
  await admin.getByRole('button', { name: 'Publicar al equipo', exact: true }).waitFor();
  await collaborator.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await collaborator.getByRole('heading', { name: 'No hay concursos disponibles' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: publicar/ocultar desde Configuración, acceso directo oculto, apertura publicada, controles administrativos y retirada de detalle visible.');
} finally {
  await browser.close();
}
