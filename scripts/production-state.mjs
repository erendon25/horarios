import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const PRODUCTION_URL = 'https://lc-scheduler.web.app';
export const PRODUCTION_PROJECT = 'lc-scheduler';
export const PRODUCTION_PATHS = [
  'src', 'public', 'scripts/*.mjs', 'scripts/*.js', 'scripts/*.cjs',
  'package.json', 'package-lock.json', 'index.html', 'vite.config.js',
  'tailwind.config.js', 'postcss.config.js', 'firebase.json', '.firebaserc', '.github',
];
export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export async function fingerprintProductionSources(cwd = process.cwd()) {
  const paths = git(cwd, 'ls-files', '-z', '--', ...PRODUCTION_PATHS).split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    hash.update(path); hash.update('\0');
    hash.update(await readFile(resolve(cwd, path))); hash.update('\0');
  }
  return hash.digest('hex');
}

export function assertProductionState({ branch, head, remoteHead, dirty, liveCommit, includesLive, project }) {
  if (project && project !== PRODUCTION_PROJECT) throw Error(`El proyecto autorizado es ${PRODUCTION_PROJECT}.`);
  if (branch !== 'main') throw Error('Producción solo se publica desde main. Integra primero tus cambios y cambia a main.');
  if (dirty.trim()) throw Error('Hay cambios de código sin confirmar. Confírmalos e intégralos en main antes de publicar.');
  if (head !== remoteHead) throw Error('main local no coincide con origin/main. Sincroniza y sube los cambios antes de publicar.');
  if (!/^[a-f0-9]{40}$/.test(liveCommit || '')) throw Error('Producción no tiene un commit verificable. Revisa su versión antes de reemplazarla.');
  if (!includesLive) throw Error('main no contiene el commit publicado. Integra esa versión antes de publicar para no perder cambios.');
}

export async function verifyProductionSource({ cwd = process.cwd(), fetchImpl = fetch } = {}) {
  const branch = git(cwd, 'branch', '--show-current').trim();
  if (branch !== 'main') throw Error('Producción solo se publica desde main. Integra primero tus cambios y cambia a main.');
  const dirty = git(cwd, 'status', '--porcelain', '--untracked-files=all', '--', ...PRODUCTION_PATHS);
  if (dirty.trim()) throw Error('Hay cambios de código sin confirmar. Confírmalos e intégralos en main antes de publicar.');
  git(cwd, 'fetch', 'origin', 'main');
  const head = git(cwd, 'rev-parse', 'HEAD').trim();
  const remoteHead = git(cwd, 'rev-parse', 'refs/remotes/origin/main').trim();
  if (head !== remoteHead) throw Error('main local no coincide con origin/main. Sincroniza y sube los cambios antes de publicar.');
  const response = await fetchImpl(`${PRODUCTION_URL}/release.json`, {
    headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error('No se pudo identificar la versión actual de producción.');
  let live;
  try { live = await response.json(); } catch { throw Error('Producción no tiene un manifiesto verificable. Revisa su versión antes de reemplazarla.'); }
  if (live.sourceModified !== false) throw Error('La publicación actual contiene código sin identificar en Git. Revisa esa versión antes de reemplazarla.');
  let includesLive = false;
  if (/^[a-f0-9]{40}$/.test(live.commit || '')) {
    try { git(cwd, 'merge-base', '--is-ancestor', live.commit, head); includesLive = true; }
    catch { /* A deployment from another line of history must be merged first. */ }
  }
  assertProductionState({ branch, head, remoteHead, dirty, liveCommit: live.commit, includesLive, project: process.env.GCLOUD_PROJECT });
  return { commit: head, liveCommit: live.commit, sourceFingerprint: await fingerprintProductionSources(cwd) };
}
