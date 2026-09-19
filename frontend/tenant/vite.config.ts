import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: '../../dist/tenant',
    emptyOutDir: true,
    copyPublicDir: false
  },
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:3000' }
  }
});
