import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

// @auto-yt/core ships TypeScript source, so it must be bundled, not externalized.
const bundleWorkspace = { exclude: ['@auto-yt/core'] }

export default defineConfig({
  main: {
    // Read MAIN_VITE_* from the repo-root .env (one place for all config).
    envDir: resolve('../..'),
    build: { externalizeDeps: bundleWorkspace },
  },
  preload: {
    build: { externalizeDeps: bundleWorkspace },
  },
  renderer: {
    resolve: {
      alias: { '@': resolve('src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
  },
})
