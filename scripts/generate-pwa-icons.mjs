/**
 * Generates PWA PNG icons from public/favicon.svg.
 * Run: node scripts/generate-pwa-icons.mjs
 */
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const svgPath = resolve(root, '../public/favicon.svg')
const outDir = resolve(root, '../public/icons')

mkdirSync(outDir, { recursive: true })

const sizes = [
  { name: 'pwa-192x192.png', size: 192 },
  { name: 'pwa-512x512.png', size: 512 },
  { name: 'pwa-512x512-maskable.png', size: 512, maskable: true },
]

for (const { name, size, maskable } of sizes) {
  const pad = maskable ? Math.round(size * 0.2) : 0
  const inner = size - pad * 2
  await sharp(svgPath)
    .resize(inner, inner, { fit: 'contain', background: { r: 20, g: 24, b: 22, alpha: 1 } })
    .extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: { r: 20, g: 24, b: 22, alpha: 1 },
    })
    .png()
    .toFile(resolve(outDir, name))
  console.log(`Wrote public/icons/${name}`)
}
