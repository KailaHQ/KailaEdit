import fs from 'fs'
import path from 'path'
import { Resvg } from '@resvg/resvg-js'

export const KOMFY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">
  <defs>
    <!-- Cyan Gradient for K: Vibrant and crisp brand identity -->
    <linearGradient id="kBodyGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#00F2FE"/>
      <stop offset="50%" stop-color="#18E2DC"/>
      <stop offset="100%" stop-color="#10BFBF"/>
    </linearGradient>

    <!-- Pearl white accent at center -->
    <linearGradient id="kAccentGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#E2FBF8"/>
    </linearGradient>
  </defs>

  <!-- Charcoal dark squircle background for desktop app (#131315) -->
  <rect width="1024" height="1024" rx="224" ry="224" fill="#131315"/>

  <!-- Large letter K group -->
  <g id="komfyedit-brand-k">
    <!-- 1. Left vertical stem: rounded top-left and bottom-left, chevron notch on right edge -->
    <path d="
      M 432 186
      L 326 186
      C 252 186 200 238 200 312
      L 200 712
      C 200 786 252 838 326 838
      L 432 838
      L 432 616
      L 342 512
      L 432 408
      Z
    " fill="url(#kBodyGrad)"/>

    <!-- 2. Upper diagonal arm: pointing up-right, rounded outer corner -->
    <path d="
      M 432 408
      L 674 186
      L 776 186
      C 804 186 824 206 824 234
      L 824 246
      C 824 266 812 286 794 302
      L 548 616
      L 432 512
      Z
    " fill="url(#kBodyGrad)"/>

    <!-- 3. Lower diagonal arm: flat bottom parallel to axis, rounded outer corner -->
    <path d="
      M 432 512
      L 548 616
      L 720 786
      C 736 802 744 822 744 834
      L 744 838
      L 620 838
      C 600 838 580 828 566 814
      L 432 676
      Z
    " fill="url(#kBodyGrad)"/>

    <!-- 4. Pearl White Accent at chevron center notch -->
    <path d="
      M 432 408
      L 342 512
      L 432 616
      C 472 580 472 444 432 408
      Z
    " fill="url(#kAccentGrad)"/>
  </g>
</svg>
`

/**
 * Builds a Windows .ico binary buffer from an array of PNG buffers with their dimensions.
 */
function createIcoBuffer(images) {
  const count = images.length
  const headerLen = 6
  const dirEntryLen = 16
  const dirLen = headerLen + count * dirEntryLen

  let totalSize = dirLen
  for (const img of images) {
    totalSize += img.pngBuffer.length
  }

  const out = Buffer.alloc(totalSize)
  // ICONDIR: 0, 0, 1 (type=ico), count
  out.writeUInt16LE(0, 0)
  out.writeUInt16LE(1, 2)
  out.writeUInt16LE(count, 4)

  let currentOffset = dirLen
  for (let i = 0; i < count; i++) {
    const { size, pngBuffer } = images[i]
    const entryOffset = headerLen + i * dirEntryLen

    out.writeUInt8(size >= 256 ? 0 : size, entryOffset)      // Width
    out.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1)  // Height
    out.writeUInt8(0, entryOffset + 2)                       // Color count
    out.writeUInt8(0, entryOffset + 3)                       // Reserved
    out.writeUInt16LE(1, entryOffset + 4)                    // Color planes
    out.writeUInt16LE(32, entryOffset + 6)                   // Bits per pixel
    out.writeUInt32LE(pngBuffer.length, entryOffset + 8)     // Size of PNG data
    out.writeUInt32LE(currentOffset, entryOffset + 12)       // Offset of PNG data

    pngBuffer.copy(out, currentOffset)
    currentOffset += pngBuffer.length
  }

  return out
}

/**
 * Builds a macOS .icns binary buffer from PNG buffers.
 */
function createIcnsBuffer(chunks) {
  // chunks: Array of { type: string (4-char), pngBuffer: Buffer }
  // ICNS Chunk Types:
  // ic07: 128x128 PNG
  // ic08: 256x256 PNG
  // ic09: 512x512 PNG
  // ic10: 1024x1024 PNG
  let totalLength = 8 // 'icns' (4) + file length (4)
  for (const c of chunks) {
    totalLength += 8 + c.pngBuffer.length
  }

  const out = Buffer.alloc(totalLength)
  out.write('icns', 0, 4, 'ascii')
  out.writeUInt32BE(totalLength, 4)

  let offset = 8
  for (const c of chunks) {
    const chunkLen = 8 + c.pngBuffer.length
    out.write(c.type, offset, 4, 'ascii')
    out.writeUInt32BE(chunkLen, offset + 4)
    c.pngBuffer.copy(out, offset + 8)
    offset += chunkLen
  }

  return out
}

export function generateAllIcons(resourcesDir) {
  console.log('[generateAllIcons] Rendering KomfyEdit app icons...')

  // 1. Write icon_source.svg
  const svgPath = path.join(resourcesDir, 'icon_source.svg')
  fs.writeFileSync(svgPath, KOMFY_ICON_SVG.trim(), 'utf8')
  console.log(`Saved: ${svgPath}`)

  // 2. Render resolutions
  const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
  const renderedMap = new Map()

  const iconsSubdir = path.join(resourcesDir, 'icons')
  if (!fs.existsSync(iconsSubdir)) {
    fs.mkdirSync(iconsSubdir, { recursive: true })
  }

  for (const size of SIZES) {
    const resvg = new Resvg(KOMFY_ICON_SVG, {
      fitTo: { mode: 'width', value: size },
    })
    const pngBuffer = resvg.render().asPng()
    renderedMap.set(size, pngBuffer)

    const outPath = path.join(iconsSubdir, `${size}x${size}.png`)
    fs.writeFileSync(outPath, pngBuffer)
    console.log(`Rendered icon: ${size}x${size} -> ${outPath}`)
  }

  // 3. Save resources/icon.png (1024x1024 master)
  const masterPngPath = path.join(resourcesDir, 'icon.png')
  fs.writeFileSync(masterPngPath, renderedMap.get(1024))
  console.log(`Saved master PNG: ${masterPngPath}`)

  // 4. Generate resources/icon.ico (Windows icon: 16, 24, 32, 48, 64, 128, 256)
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoImages = icoSizes.map(size => ({
    size,
    pngBuffer: renderedMap.get(size),
  }))
  const icoBuffer = createIcoBuffer(icoImages)
  const icoPath = path.join(resourcesDir, 'icon.ico')
  fs.writeFileSync(icoPath, icoBuffer)
  console.log(`Saved Windows ICO: ${icoPath} (${icoBuffer.length} bytes)`)

  // 5. Generate resources/icon.icns (macOS icon: 128, 256, 512, 1024)
  const icnsChunks = [
    { type: 'ic07', pngBuffer: renderedMap.get(128) },
    { type: 'ic08', pngBuffer: renderedMap.get(256) },
    { type: 'ic09', pngBuffer: renderedMap.get(512) },
    { type: 'ic10', pngBuffer: renderedMap.get(1024) },
  ]
  const icnsBuffer = createIcnsBuffer(icnsChunks)
  const icnsPath = path.join(resourcesDir, 'icon.icns')
  fs.writeFileSync(icnsPath, icnsBuffer)
  console.log(`Saved macOS ICNS: ${icnsPath} (${icnsBuffer.length} bytes)`)

  // 6. Also copy 256x256 or 512x512 to public/favicon.ico / public/icon.png for web/renderer if needed
  const publicDir = path.resolve(resourcesDir, '../public')
  if (fs.existsSync(publicDir)) {
    fs.writeFileSync(path.join(publicDir, 'favicon.ico'), icoBuffer)
    fs.writeFileSync(path.join(publicDir, 'icon.png'), renderedMap.get(256))
    console.log(`Updated public/favicon.ico and public/icon.png`)
  }

  console.log('[generateAllIcons] Done!')
}

// Execute when run directly
if (process.argv[1]?.endsWith('generate-icons.js')) {
  const root = process.cwd()
  const resourcesDir = path.join(root, 'resources')
  generateAllIcons(resourcesDir)
}
