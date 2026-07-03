import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds ONLY the notes editor (BlockNote + React) into a single self-contained
// ES bundle that the Express server serves as a static asset from public/notes/.
// The rest of the app stays no-build vanilla ES modules.
export default defineConfig({
  plugins: [react()],
  // Lib build — don't treat public/ as a static dir to copy (outDir lives inside it).
  publicDir: false,
  // React/BlockNote reference process.env.NODE_ENV; replace it at build time so
  // the browser bundle runs in production mode and doesn't hit `process`.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'public/notes',
    emptyOutDir: true,
    lib: {
      entry: 'src/notes/index.js',
      formats: ['es'],
      fileName: () => 'notes.js',
      cssFileName: 'notes',
    },
  },
});
