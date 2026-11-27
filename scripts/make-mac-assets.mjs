// Makes the Mac app's icon (resources/mac/icon.icns) and the installer window's background
// (resources/mac/background.png and background@2x.png for Retina screens) from their sources:
// resources/mac/icon.svg and resources/mac/dmg-background.html.
//
//   node scripts/make-mac-assets.mjs
//
// Needs Playwright's Chromium (npx playwright install chromium). The results are committed, so
// building the Mac app doesn't need this; run it again only after changing a source.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'mac')

// Every size macOS asks for, 16 to 1024 points with their @2x versions, as PNGs inside one .icns.
// OSType -> pixel size.
const ICNS = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic11', 32], // 16@2x
  ['icp6', 64],
  ['ic12', 64], // 32@2x
  ['ic07', 128],
  ['ic08', 256],
  ['ic13', 256], // 128@2x
  ['ic09', 512],
  ['ic14', 512], // 256@2x
  ['ic10', 1024] // 512@2x
]

const browser = await chromium.launch()
try {
  const svg = readFileSync(join(dir, 'icon.svg'), 'utf8')
  const pngs = new Map()
  for (const size of [...new Set(ICNS.map(([, s]) => s))]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    // Drawn at each size from the vector (not scaled down from one big picture), so small sizes stay sharp.
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="1024" height="1024"/, `width="${size}" height="${size}"`)}</body></html>`)
    pngs.set(size, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }))
    await page.close()
  }
  writeFileSync(join(dir, 'icon-1024.png'), pngs.get(1024))
  const chunks = ICNS.map(([type, size]) => {
    const data = pngs.get(size)
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(body.length + 8, 4)
  writeFileSync(join(dir, 'icon.icns'), Buffer.concat([head, body]))
  console.log(`icon.icns: ${ICNS.length} sizes, ${Math.round((body.length + 8) / 1024)} KB`)

  for (const [scale, name] of [[1, 'background.png'], [2, 'background@2x.png']]) {
    const page = await browser.newPage({ viewport: { width: 660, height: 400 }, deviceScaleFactor: scale })
    await page.goto(pathToFileURL(join(dir, 'dmg-background.html')).href)
    await page.screenshot({ path: join(dir, name) })
    await page.close()
    console.log(`${name}: ${660 * scale} x ${400 * scale}`)
  }
} finally {
  await browser.close()
}
