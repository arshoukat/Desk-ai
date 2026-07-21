import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(fileURLToPath(import.meta.url))

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

/** Keep ORT WASM files in public/ so workers can load them reliably. */
function copyTransformersWasm(): Plugin {
  const copy = () => {
    const src = resolve(rootDir, 'node_modules/@xenova/transformers/dist')
    const dest = resolve(rootDir, 'public/wasm')
    mkdirSync(dest, { recursive: true })
    for (const file of readdirSync(src)) {
      if (file.endsWith('.wasm')) {
        cpSync(resolve(src, file), resolve(dest, file))
      }
    }
  }

  return {
    name: 'copy-transformers-wasm',
    buildStart: copy,
    configureServer() {
      copy()
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    copyTransformersWasm(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Desk Ai',
        short_name: 'Desk Ai',
        description:
          'Private offline document Q&A on your device — nothing leaves your machine.',
        theme_color: '#141816',
        background_color: '#161b18',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/pwa-512x512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2}'],
        globIgnores: [
          '**/ai.worker*.js',
          '**/embedding.worker*.js',
          '**/pdf.worker*.js',
          '**/sqlite3*.wasm',
          '**/pdf.worker*.mjs',
          '**/db.worker*.js',
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/wasm\//],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/.*\.(js|wasm|mjs)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'desk-ai-assets',
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    // Use the prebundled browser build — Vite's ESM graph of onnxruntime-web
    // breaks registerBackend inside module workers.
    alias: {
      '@xenova/transformers': resolve(
        rootDir,
        'node_modules/@xenova/transformers/dist/transformers.js',
      ),
    },
  },
  server: {
    headers: isolationHeaders,
  },
  preview: {
    headers: isolationHeaders,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@xenova/transformers', 'onnxruntime-web', 'onnxruntime-common', '@sqlite.org/sqlite-wasm'],
  },
  assetsInclude: ['**/*.wasm'],
})
