import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Test config. Renderer tests opt into jsdom with a `// @vitest-environment jsdom` comment.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/desktop/src/renderer/src', import.meta.url)),
    },
  },
  test: {
    include: ['apps/*/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    unstubGlobals: true,
  },
})
