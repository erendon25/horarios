// Run with serve-competition-qa.mjs in collaborator mode: real files and UI,
// PostgreSQL RPC/RLS, isolated Auth and Storage transport; no production users.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = `http://127.0.0.1:${process.env.COMPETITION_QA_PORT || 4193}`;
const output = resolve(process.env.COMPETITION_QA_OUTPUT || 'output/profile-photo-qa');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(15000);
const errors = [], passed = [];
let uploads = 0, rejectUpload = false, ambiguousSave = false;
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
const pass = name => { passed.push(name); console.log(`PASS: ${name}`); };
await page.route('**/api', async route => {
  const body = route.request().postDataJSON();
  if (body.storage === 'upload') {
    uploads++;
    if (rejectUpload) return route.fulfill({ json: { data: null, error: { message: 'Subida interrumpida de prueba' } } });
  }
  if (ambiguousSave && body.rpc === 'set_own_profile_photo') {
    const response = await route.fetch(); // The server commits before the response is lost.
    assert.equal((await response.json()).error, null);
    return route.fulfill({ json: { data: null, error: { message: 'Respuesta de guardado no confirmada' } } });
  }
  await route.continue();
});
const photos = async () => {
  const response = await page.request.post(`${base}/api`, { data: {
    role: 'collaborator', table: 'staff_profile_photos', filters: {}, orders: [], start: 0, end: 999, columns: '*',
  } });
  const result = await response.json(); assert.equal(result.error, null); return result.data;
};
try {
  await page.goto(`${base}/staff?role=collaborator`);
  const editor = page.getByRole('region', { name: 'Foto de perfil', exact: true });
  const input = editor.getByLabel('Elegir foto de perfil');
  const portrait = () => editor.getByRole('img', { name: 'Foto de Colaboradora Demo', exact: true });
  const fallback = () => editor.getByRole('img', { name: 'Imagen predeterminada de Colaboradora Demo', exact: true });
  await fallback().waitFor();

  for (const [file, message] of [
    [{ name: 'invalid.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') }, 'Elige una imagen JPG, PNG o WebP.'],
    [{ name: 'document.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-') }, 'Elige una imagen JPG, PNG o WebP.'],
    [{ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) }, 'La foto debe pesar como máximo 10 MB.'],
    [{ name: 'large.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }, 'La foto debe pesar como máximo 10 MB.'],
    [{ name: 'corrupt.png', mimeType: 'image/png', buffer: Buffer.from('not an image') }, 'No se pudo abrir la imagen. Elige otra foto.'],
  ]) {
    await input.setInputFiles(file);
    await editor.getByRole('alert').getByText(message, { exact: true }).waitFor();
    assert.equal(await editor.getByRole('button', { name: 'Guardar foto', exact: true }).count(), 0);
  }
  assert.equal(uploads, 0);
  assert.deepEqual(await photos(), []);
  pass('SVG, PDF, archivo vacío, más de 10 MB y PNG corrupto rechazados antes de subir');

  const image = async (type, color) => Buffer.from(await page.evaluate(({ type, color }) => {
    const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 360;
    const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 720, 360);
    context.fillStyle = '#fff'; context.font = 'bold 64px sans-serif'; context.fillText('FOTO QA', 170, 210);
    return canvas.toDataURL(type, 0.95).split(',')[1];
  }, { type, color }), 'base64');
  const choose = async (type = 'image/png', color = '#c74808') => {
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[type];
    await input.setInputFiles({ name: `perfil.${extension}`, mimeType: type, buffer: await image(type, color) });
    await editor.getByRole('button', { name: 'Guardar foto', exact: true }).waitFor();
  };
  const loaded = async () => {
    await portrait().waitFor();
    await page.waitForFunction(() => {
      const img = document.querySelector('section[aria-label="Foto de perfil"] img');
      return img && img.complete && img.naturalWidth === 512 && img.naturalHeight === 512;
    });
  };
  await choose();
  await loaded();
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await fallback().waitFor(); assert.equal(uploads, 0);
  pass('Cancelar la vista previa conserva el perfil sin subir un archivo');

  let objectPath;
  for (const [type, color] of [['image/png', '#c74808'], ['image/jpeg', '#1962b8'], ['image/webp', '#217342']]) {
    await choose(type, color);
    await editor.getByRole('button', { name: 'Guardar foto', exact: true }).click();
    await editor.getByText('Foto de perfil guardada.', { exact: true }).waitFor();
    await loaded();
    const records = await photos(); assert.equal(records.length, 1);
    assert.ok(records[0].object_path.endsWith('/profile.jpg'));
    if (objectPath) assert.equal(records[0].object_path, objectPath);
    objectPath = records[0].object_path;
    const src = await portrait().getAttribute('src');
    const response = await page.request.get(new URL(src, base).href);
    assert.equal(response.headers()['content-type'], 'image/jpeg');
    assert.deepEqual((await response.body()).subarray(0, 2), Buffer.from([0xff, 0xd8]));
    await page.reload(); await loaded();
    pass(`${type}: recorte a 512×512, JPEG real, un único archivo propio y persistencia tras recargar`);
  }
  await page.screenshot({ path: `${output}/foto-guardada-movil.png`, fullPage: true });

  const beforeFailure = await photos();
  rejectUpload = true;
  await choose('image/png', '#9f21a8');
  await editor.getByRole('button', { name: 'Guardar foto', exact: true }).click();
  await editor.getByRole('alert').getByText('Subida interrumpida de prueba', { exact: true }).waitFor();
  assert.deepEqual(await photos(), beforeFailure);
  await page.waitForFunction(() => [...document.querySelectorAll('section[aria-label="Foto de perfil"] button')]
    .some(button => button.textContent.trim() === 'Guardar foto' && !button.disabled));
  await page.screenshot({ path: `${output}/subida-interrumpida.png`, fullPage: true });
  rejectUpload = false;
  await editor.getByRole('button', { name: 'Guardar foto', exact: true }).click();
  await editor.getByText('Foto de perfil guardada.', { exact: true }).waitFor();
  pass('Fallo de subida conserva los datos anteriores y permite reintentar');

  ambiguousSave = true;
  await choose('image/png', '#925b17');
  await editor.getByRole('button', { name: 'Guardar foto', exact: true }).click();
  await editor.getByRole('alert').getByText('Respuesta de guardado no confirmada', { exact: true }).waitFor();
  assert.equal((await photos())[0].object_path, objectPath);
  ambiguousSave = false;
  await page.reload(); await loaded();
  pass('Respuesta perdida después de guardar: el archivo confirmado por el servidor se conserva');

  await editor.getByRole('button', { name: 'Eliminar foto', exact: true }).click();
  await editor.getByText('Foto eliminada.', { exact: true }).waitFor();
  await fallback().waitFor(); assert.deepEqual(await photos(), []);
  await page.reload(); await fallback().waitFor();
  pass('Eliminar restaura la imagen predeterminada y persiste después de recargar');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/resultado.json`, JSON.stringify({ passed, errors, scope: 'UI y archivos reales; Auth/Storage aislados y PostgreSQL real en memoria' }, null, 2));
} finally {
  await browser.close();
}
