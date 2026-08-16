/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { APP_VERSION, MIN_VERSION } from './src/version'

// Emits dist/version.json from the committed version constants so the served
// file can never drift from what's baked into the bundle. Open tabs poll this
// file to decide whether they must reload. See src/version.ts and
// src/hooks/useForceUpdate.ts.
function emitVersionJson(): Plugin {
  return {
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({
          version: APP_VERSION,
          minVersion: MIN_VERSION,
        }),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), emitVersionJson()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
