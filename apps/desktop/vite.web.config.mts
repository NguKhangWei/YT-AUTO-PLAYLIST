// Builds the window's React UI for a browser (the cloud server's web UI) into out-server/web.
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  root: at('./src/renderer'),
  base: '/',
  resolve: { alias: { '@': at('./src/renderer/src') } },
  plugins: [react(), tailwindcss()],
  build: { outDir: at('./out-server/web'), emptyOutDir: true, minify: true },
})
