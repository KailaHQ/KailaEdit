import type {
  CoverElement,
  TextCoverElement,
  ImageCoverElement,
  ShapeCoverElement,
} from './types'
import { shapeToFullSvgString } from './cover-shapes'

/**
 * Generate high-resolution composite cover thumbnail via off-screen HTML5 Canvas
 */
export async function generateCompositeCoverThumbnail(
  elements: CoverElement[],
  fallbackBgUrl: string,
): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = 540
  canvas.height = 960
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#09090b'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const sorted = [...elements]
    .filter(el => el.visible !== false)
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))

  for (const el of sorted) {
    const pxX = (el.x / 100) * canvas.width
    const pxY = (el.y / 100) * canvas.height
    const pxW = (el.width / 100) * canvas.width
    const pxH = (el.height / 100) * canvas.height

    ctx.save()
    ctx.translate(pxX, pxY)
    if (el.rotation) {
      ctx.rotate((el.rotation * Math.PI) / 180)
    }
    ctx.globalAlpha = el.opacity ?? 1

    if (el.id === 'background-layer' || el.type === 'background') {
      const bg = el as ImageCoverElement
      if (bg.src || fallbackBgUrl) {
        const img = new Image()
        if ((bg.src || fallbackBgUrl).startsWith('http://') || (bg.src || fallbackBgUrl).startsWith('https://')) {
          img.crossOrigin = 'anonymous'
        }
        img.src = bg.src || fallbackBgUrl
        await new Promise(r => {
          img.onload = r
          img.onerror = r
        })
        if (img.naturalWidth > 0 && img.naturalHeight > 0 && pxW > 0 && pxH > 0) {
          ctx.drawImage(img, -pxW / 2, -pxH / 2, pxW, pxH)
        }
      } else {
        ctx.fillStyle = '#141416'
        ctx.fillRect(-pxW / 2, -pxH / 2, pxW, pxH)
      }
    } else if (el.type === 'image') {
      const imgEl = el as ImageCoverElement
      if (imgEl.src) {
        const img = new Image()
        if (imgEl.src.startsWith('http://') || imgEl.src.startsWith('https://')) {
          img.crossOrigin = 'anonymous'
        }
        img.src = imgEl.src
        await new Promise(r => {
          img.onload = r
          img.onerror = r
        })

        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          ctx.save()
          if (imgEl.flipH || imgEl.flipV) {
            ctx.scale(imgEl.flipH ? -1 : 1, imgEl.flipV ? -1 : 1)
          }

          if (imgEl.filters) {
            const f = imgEl.filters
            ctx.filter = `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) blur(${f.blur}px)`
          }

          const crop = imgEl.crop || { x: 0, y: 0, width: 100, height: 100 }
          const natW = img.naturalWidth
          const natH = img.naturalHeight
          const sx = Math.max(0, ((crop.x || 0) / 100) * natW)
          const sy = Math.max(0, ((crop.y || 0) / 100) * natH)
          const sW = Math.min(natW - sx, ((crop.width || 100) / 100) * natW)
          const sH = Math.min(natH - sy, ((crop.height || 100) / 100) * natH)

          if (sW > 0 && sH > 0) {
            ctx.drawImage(img, sx, sy, sW, sH, -pxW / 2, -pxH / 2, pxW, pxH)
          }
          ctx.restore()
        }
      }
    } else if (el.type === 'shape') {
      const sEl = el as ShapeCoverElement
      try {
        const svgStr = shapeToFullSvgString(sEl, pxW, pxH)
        const img = new Image()
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`
        await new Promise(r => {
          img.onload = r
          img.onerror = r
        })
        if (img.naturalWidth > 0 && img.naturalHeight > 0 && pxW > 0 && pxH > 0) {
          ctx.drawImage(img, -pxW / 2, -pxH / 2, pxW, pxH)
        }
      } catch (e) {
        console.warn('[cover-thumbnail-generator] Failed to draw shape in thumbnail:', e)
      }
    } else if (el.type === 'text') {
      const tEl = el as TextCoverElement
      const scaledFontSize = Math.round((tEl.fontSize || 32) * 1.6)
      const fontFam = tEl.fontFamily || 'Inter, sans-serif'
      const fontStyle = tEl.fontStyle || 'normal'
      const fontWeight = tEl.fontWeight || 'bold'

      ctx.font = `${fontStyle} ${fontWeight} ${scaledFontSize}px ${fontFam}`
      ctx.textAlign = (tEl.textAlign as CanvasTextAlign) || 'center'
      ctx.textBaseline = 'middle'

      const shownText = tEl.textTransform === 'uppercase' ? (tEl.text || '').toUpperCase()
        : tEl.textTransform === 'lowercase' ? (tEl.text || '').toLowerCase()
        : tEl.textTransform === 'capitalize' ? (tEl.text || '').replace(/(^|\s)(\S)/g, (_m, sp: string, ch: string) => sp + ch.toUpperCase())
        : (tEl.text || '')
      if (tEl.letterSpacing) {
        ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${tEl.letterSpacing * 1.6}px`
      }
      const rawWords = shownText.split(' ')
      const lines: string[] = []
      let currentLine = ''

      for (let n = 0; n < rawWords.length; n++) {
        const testLine = currentLine ? `${currentLine} ${rawWords[n]}` : rawWords[n]
        const metrics = ctx.measureText(testLine)
        if (metrics.width > pxW && currentLine) {
          lines.push(currentLine)
          currentLine = rawWords[n]
        } else {
          currentLine = testLine
        }
      }
      if (currentLine) lines.push(currentLine)
      if (lines.length === 0) lines.push(shownText)

      const lineHeight = scaledFontSize * (tEl.lineHeight || 1.2)
      const totalHeight = lines.length * lineHeight
      const startY = -(totalHeight / 2) + (lineHeight / 2)

      // Background Badge
      if (tEl.backgroundBadge?.enabled) {
        let maxLineWidth = 0
        for (const line of lines) {
          maxLineWidth = Math.max(maxLineWidth, ctx.measureText(line).width)
        }
        const padX = (tEl.backgroundBadge.paddingX ?? 10) * 1.6
        const padY = (tEl.backgroundBadge.paddingY ?? 4) * 1.6
        const bgW = Math.min(pxW + padX * 2, maxLineWidth + padX * 2)
        const bgH = totalHeight + padY * 2
        const rad = (tEl.backgroundBadge.borderRadius ?? 4) * 1.6

        if (bgW > 0 && bgH > 0) {
          ctx.fillStyle = tEl.backgroundBadge.color || '#000000'
          ctx.beginPath()
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(-bgW / 2, -bgH / 2, bgW, bgH, Math.max(0, rad))
          } else {
            ctx.rect(-bgW / 2, -bgH / 2, bgW, bgH)
          }
          ctx.fill()
        }
      }

      if (!tEl.backgroundBadge?.enabled && tEl.backgroundColor && tEl.backgroundColor !== 'transparent') {
        ctx.fillStyle = tEl.backgroundColor
        ctx.fillRect(-pxW / 2, -totalHeight / 2, pxW, totalHeight)
      }

      const anchorX = tEl.textAlign === 'left' ? -pxW / 2 : tEl.textAlign === 'right' ? pxW / 2 : 0

      lines.forEach((line, idx) => {
        const lineY = startY + idx * lineHeight
        if (tEl.stroke?.enabled) {
          ctx.strokeStyle = tEl.stroke.color || '#000000'
          ctx.lineWidth = (tEl.stroke.width ?? 1) * 1.6
          ctx.lineJoin = 'round'
          ctx.strokeText(line, anchorX, lineY)
        }
      })

      if (tEl.shadow?.enabled) {
        ctx.shadowColor = tEl.shadow.color || 'rgba(0,0,0,0.85)'
        ctx.shadowBlur = (tEl.shadow.blur ?? 10) * 1.6
        ctx.shadowOffsetX = (tEl.shadow.offsetX ?? 0) * 1.6
        ctx.shadowOffsetY = (tEl.shadow.offsetY ?? 4) * 1.6
      }
      ctx.fillStyle = tEl.color || '#ffffff'
      lines.forEach((line, idx) => {
        const lineY = startY + idx * lineHeight
        ctx.fillText(line, anchorX, lineY)
      })
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
    }

    ctx.restore()
  }

  return canvas.toDataURL('image/png', 0.92)
}
