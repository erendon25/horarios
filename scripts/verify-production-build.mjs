import { readFile, access } from 'node:fs/promises';
import { verifyProductionSource } from './production-state.mjs';

try {
  // Check again after tests/build: main or production may have changed meanwhile.
  const state = await verifyProductionSource();
  const release = JSON.parse(await readFile('build/release.json', 'utf8'));
  if (release.branch !== 'main' || release.commit !== state.commit || release.sourceModified !== false
    || release.sourceFingerprint !== state.sourceFingerprint) {
    throw Error('El build no coincide con el código limpio y actualizado de main. Vuelve a compilar antes de publicar.');
  }
  const html = await readFile('build/index.html', 'utf8');
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[a-zA-Z0-9_.-]+)"/g)].map(match => match[1]);
  if (!assets.some(path => path.endsWith('.js')) || !assets.some(path => path.endsWith('.css'))) throw Error('El build no contiene sus archivos JS y CSS de entrada.');
  await Promise.all(assets.map(path => access(`build${path}`)));
  console.log(`Build verificado: main ${state.commit.slice(0, 7)}, código y archivos de entrada coincidentes.`);
} catch (error) {
  console.error(`Publicación detenida: ${error.message}`);
  process.exitCode = 1;
}
