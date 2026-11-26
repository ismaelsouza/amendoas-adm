import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist/web' },
  oxc: { jsx: { runtime: 'automatic' } },
});

