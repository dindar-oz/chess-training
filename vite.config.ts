import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// A unique id per build. The client carries it as __APP_BUILD__ and the server
// reads it from dist/version.json, so open pages can tell when the site has been
// updated underneath them.
const appBuild = process.env.APP_BUILD ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'app-build-version',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: appBuild }) })
      },
    },
  ],
  define: {
    __APP_BUILD__: JSON.stringify(appBuild),
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
