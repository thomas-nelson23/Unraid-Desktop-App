import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev:web` serves the app in a browser and passes /api on to a
// Home-Dashboard server (HOME_DASHBOARD_URL, default localhost:3000).
export default defineConfig({
  plugins: [react()],
  base: './',
  // noVNC (the VMs page) waits at the top level of a module, which needs ES2022.
  build: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  server: {
    port: 5180,
    strictPort: true,
    // ws: the VMs page's screens are WebSockets under /api.
    proxy: { '/api': { target: process.env.HOME_DASHBOARD_URL || 'http://localhost:3000', ws: true } },
  },
});
