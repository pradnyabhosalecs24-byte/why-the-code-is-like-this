import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser only talks to /api on the Vite server, which proxies to the backend.
// No credentials ever reach the frontend.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:4000', changeOrigin: true } },
  },
});
