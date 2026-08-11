#!/usr/bin/env node
// Regenerates every raster icon from the three source SVGs.
//   npm i --no-save sharp png-to-ico && node assets/icon/build-icons.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const here = dirname(fileURLToPath(import.meta.url))
const APP_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
// At and below this, the full mark loses its spokes; use the fattened source.
const SMALL_AT_OR_UNDER = 32

// librsvg has no colour context for a bare `currentColor`, so bind it here.
const paint = (svg, colour) => svg.replaceAll('currentColor', colour)

const render = (svg, size) =>
  sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()

await mkdir(join(here, 'png'), { recursive: true })
await mkdir(join(here, 'tray'), { recursive: true })

const app = await readFile(join(here, 'nexus.svg'), 'utf8')
const small = await readFile(join(here, 'nexus-small.svg'), 'utf8')
const tray = await readFile(join(here, 'nexus-tray.svg'), 'utf8')

const appAt = (size) => render(size <= SMALL_AT_OR_UNDER ? small : app, size)

for (const size of APP_SIZES) {
  await writeFile(join(here, 'png', `nexus-${size}.png`), await appAt(size))
}

await writeFile(
  join(here, 'nexus.ico'),
  await pngToIco(await Promise.all(ICO_SIZES.map(appAt))),
)

// macOS menu bar wants a black+alpha template pair; Windows/Linux dark themes
// want the white one. Both are rendered from the 16px-tuned source.
const variants = [
  ['nexus-trayTemplate.png', '#000000', 16],
  ['nexus-trayTemplate@2x.png', '#000000', 32],
  ['nexus-tray-white.png', '#FFFFFF', 16],
  ['nexus-tray-white@2x.png', '#FFFFFF', 32],
]
for (const [name, colour, size] of variants) {
  await writeFile(join(here, 'tray', name), await render(paint(tray, colour), size))
}

await writeFile(
  join(here, 'tray', 'nexus-tray.ico'),
  await pngToIco(await Promise.all([16, 24, 32].map((s) => render(paint(tray, '#FFFFFF'), s)))),
)

console.log('icons rebuilt')
