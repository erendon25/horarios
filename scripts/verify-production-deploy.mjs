import { verifyProductionSource } from './production-state.mjs';

try {
  const state = await verifyProductionSource();
  console.log(`Producción verificada: main ${state.commit.slice(0, 7)} incluye la versión publicada ${state.liveCommit.slice(0, 7)}.`);
} catch (error) {
  console.error(`Publicación detenida: ${error.message}`);
  process.exitCode = 1;
}
