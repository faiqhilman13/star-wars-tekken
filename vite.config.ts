import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the build runs from any static host path (itch.io, GitHub Pages subfolders).
  base: './',
  server: {
    host: '127.0.0.1',
    port: Number(process.env.SABER_PORT ?? 5188),
    strictPort: true,
    // SABER_NO_HMR=1: a stable review server that never reloads while files are being edited.
    hmr: process.env.SABER_NO_HMR ? false : undefined,
    watch: process.env.SABER_NO_HMR ? { ignored: ['**/*'] } : undefined,
  },
  preview: {
    host: '127.0.0.1',
    port: 4188,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
