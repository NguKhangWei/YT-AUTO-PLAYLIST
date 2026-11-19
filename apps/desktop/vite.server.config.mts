// Bundles the headless server into one file, out-server/server.mjs: plain Node 24, no node_modules.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  build: {
    ssr: at('./src/server/index.ts'),
    outDir: at('./out-server'),
    emptyOutDir: false, // the web UI is built into out-server/web first
    target: 'node24',
    minify: false, // readable stack traces in journalctl
    rollupOptions: { output: { format: 'es', entryFileNames: 'server.mjs' } },
  },
  ssr: { noExternal: true, target: 'node' }, // bundle every dependency; Node built-ins stay external
})
