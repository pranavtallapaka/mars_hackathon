import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  // .env lives at the repo root for the server; keep Vite from reading it.
  envDir: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
});
