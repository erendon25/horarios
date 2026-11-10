import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { execFileSync } from 'node:child_process';
import { fingerprintProductionSources, PRODUCTION_PATHS } from './scripts/production-state.mjs';

const releaseInfo = () => ({
  name: 'release-info',
  async generateBundle() {
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
    this.emitFile({
      type: 'asset',
      fileName: 'release.json',
      source: JSON.stringify({
        commit: git('rev-parse', 'HEAD'),
        branch: git('branch', '--show-current'),
        builtAt: new Date().toISOString(),
        sourceModified: Boolean(git('status', '--porcelain', '--untracked-files=all', '--', ...PRODUCTION_PATHS)),
        sourceFingerprint: await fingerprintProductionSources(),
      }, null, 2),
    });
  },
});

export default defineConfig({
  plugins: [
    releaseInfo(),
    react({
      include: '**/*.{jsx,js}'
    }),
    viteStaticCopy({
      targets: [
        {
          src: 'public/templates',
          dest: ''
        }
      ]
    })
  ],
  server: {
    hmr: {
      overlay: true
    }
  },
  build: {
    outDir: 'build',
    // Open tabs can still request lazy chunks from the previous release.
    emptyOutDir: false,
  }
});
