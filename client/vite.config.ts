/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Use @fridgestock/shared's TypeScript source directly (no separate build needed).
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // jsdom workers are memory-hungry: more than two can run a machine with little free RAM out of memory.
    maxWorkers: 2,
  },
});
