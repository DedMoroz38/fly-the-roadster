/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Allow public tunnel URLs (ngrok) to reach the dev and preview servers.
  server: { allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io'] },
  preview: { allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io'] },
  build: {
    chunkSizeWarningLimit: 3000, // three.js + Rapier's embedded WASM are inherently large
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
