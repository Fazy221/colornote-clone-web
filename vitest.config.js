import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // mcp-server has its own tests (node:test); run them with `npm test` inside that folder.
    exclude: ['**/node_modules/**', 'dist/**', 'mcp-server/**'],
  },
});
