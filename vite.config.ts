import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { execSync } from 'child_process'

// Capture the build SHA + timestamp at build time so the diagnostic
// overlay can show exactly which deploy a user is looking at. Prefers
// the CI-provided $GITHUB_SHA when available, falls back to `git
// rev-parse` for local builds, then to 'dev' if git isn't usable
// (e.g. a Docker build without .git in the context).
function buildSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Inlined into the bundle as a literal string so users can read it
    // off the diagnostic overlay even when the network is down.
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/auth': {
        target: 'http://localhost:3008',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3008',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3008',
        changeOrigin: true,
      },
    },
  },
})
