import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  base: '/widget/',
  plugins: [react()],
  build: {
    outDir: '../../dist/widget',
    emptyOutDir: true,
    copyPublicDir: false,
    rollupOptions: {
      input: {
        widget: path.resolve(import.meta.dirname, 'index.html'),
        embed: path.resolve(import.meta.dirname, 'src/embed.ts')
      },
      output: {
        entryFileNames: (chunk) => chunk.name === 'embed' ? 'embed.js' : 'assets/[name]-[hash].js'
      }
    }
  },
  server: {
    port: 5175,
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
});
