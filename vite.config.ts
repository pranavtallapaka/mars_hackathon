import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'client',
  // .env lives at the repo root for the server; keep Vite from reading it.
  envDir: 'client',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', '../server/**/*.test.ts'],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
});
