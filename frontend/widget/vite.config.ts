import { defineConfig } from 'vite';

// The widget has no entry point yet. Keep this build isolated so a future
// embeddable bundle cannot accidentally include either authenticated UI.
export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: '../../dist/widget',
    emptyOutDir: true,
    copyPublicDir: false
  }
});
