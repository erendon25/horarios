import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
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
