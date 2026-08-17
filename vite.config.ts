import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true
  },
  worker: {
    format: 'es'
  },
  build: {
    target: 'esnext',
    sourcemap: false
  }
});