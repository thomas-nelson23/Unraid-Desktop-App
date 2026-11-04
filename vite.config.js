import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Which build this is, for the updater: the branch and commit from GitHub
// Actions, or from git when built by hand. The page gets it as __BUILD__ and
// the main process reads dist/build.json.
function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}
const build = {
  branch: process.env.GITHUB_REF_NAME || git('rev-parse --abbrev-ref HEAD') || 'local',
  sha: process.env.GITHUB_SHA || git('rev-parse HEAD') || '',
  at: new Date().toISOString(),
};

// `npm run dev:web` serves the app in a browser and passes /api on to a
// Home-Dashboard server (HOME_DASHBOARD_URL, default localhost:3000).
const buildInfo = {
  name: 'build-info',
  closeBundle() {
    mkdirSync('dist', { recursive: true });
    writeFileSync('dist/build.json', JSON.stringify(build));
  },
};

export default defineConfig({
  plugins: [react(), buildInfo],
  base: './',
  define: { __BUILD__: JSON.stringify(build) },
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
