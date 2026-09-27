import fs from 'fs'
import path from 'path'
import { Resvg } from '@resvg/resvg-js'
import { COVER_SHAPES } from '../frontend/views/editor/cover/cover-shapes'

async function main() {
  const resourcesDir = path.resolve(process.cwd(), 'resources', 'stickers')
  const publicDir = path.resolve(process.cwd(), 'public', 'stickers')

  fs.mkdirSync(resourcesDir, { recursive: true })
  fs.mkdirSync(publicDir, { recursive: true })

  console.log(`Generating stickers for ${COVER_SHAPES.length} shapes from COVER_SHAPES...`)

  for (const shape of COVER_SHAPES) {
    const isLine = shape.category === 'line'
    const fill = shape.defaultFill === 'transparent' ? 'none' : '#ffffff'
    const stroke = isLine || shape.defaultStroke ? '#ffffff' : undefined
    const strokeWidth = shape.defaultStrokeWidth || (isLine ? 5 : 3)

    const innerMarkup = shape.toSvgMarkup(
      fill,
      stroke,
      strokeWidth,
      shape.defaultSides,
      shape.defaultCornerRounding
    )

    const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${shape.viewBox}" width="512" height="512" style="background:transparent">${innerMarkup}</svg>`

    try {
      const resvg = new Resvg(fullSvg, {
        fitTo: { mode: 'width', value: 512 },
      })
      const pngBuffer = resvg.render().asPng()

      const filename = `shape-${shape.id}.png`
      fs.writeFileSync(path.join(resourcesDir, filename), pngBuffer)
      fs.writeFileSync(path.join(publicDir, filename), pngBuffer)

      console.log(`✓ Generated: ${filename} (${pngBuffer.length} bytes)`)
    } catch (err) {
      console.error(`✗ Error generating ${shape.id}:`, err)
    }
  }

  console.log('All shape stickers generated successfully!')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
