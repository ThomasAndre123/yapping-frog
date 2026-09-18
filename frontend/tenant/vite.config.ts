import { defineConfig } from 'vite';

// The tenant application has no entry point yet. This placeholder build makes
// its reserved output directory visible without shipping a fake UI.
export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: '../../dist/tenant',
    emptyOutDir: true,
    copyPublicDir: false
  }
});
