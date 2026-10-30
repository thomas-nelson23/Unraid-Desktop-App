import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev:web` serves the app in a browser and passes /api on to a
// Home-Dashboard server (HOME_DASHBOARD_URL, default localhost:3000).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5180,
    strictPort: true,
    proxy: { '/api': process.env.HOME_DASHBOARD_URL || 'http://localhost:3000' },
  },
});
