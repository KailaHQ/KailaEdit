import { describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { buildVideoFilterGraph } from '../video-filter'
import { findFfmpegPath } from '../ffmpeg-utils'
import type { ExportClip } from '../timeline'
import { clipScreenBox } from '../../../core/src/video-editor-utils'

const FRAME = { width: 1080, height: 1920 }

function shapeExportClip(scaleX: number | undefined, scaleY: number | undefined, pngPath = '/tmp/shape.png'): ExportClip {
  return {
    id: 'shape', type: 'image', path: pngPath, startTime: 0, duration: 1, trimStart: 0, speed: 1, reversed: false,
    flipH: false, flipV: false, opacity: 100, trackIndex: 1, muted: true, volume: 1,
    transform: {
      scale: 100, positionX: 0, positionY: 0, rotation: 0, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0,
      ...(scaleX !== undefined ? { scaleX } : {}),
      ...(scaleY !== undefined ? { scaleY } : {}),
    },
  }
}

describe('per-axis scale in export', () => {
  it('fits the media first, then stretches each axis', () => {
    const { filterScript } = buildVideoFilterGraph([shapeExportClip(150, 50)], { ...FRAME, fps: 30, totalDuration: 1 })
    expect(filterScript).toContain(
      "scale=1080:1920:force_original_aspect_ratio=decrease,scale=w='max(2,round(iw*1.500000))':h='max(2,round(ih*0.500000))'",
    )
  })

  it('leaves a uniformly scaled clip on the fitted path', () => {
    const { filterScript } = buildVideoFilterGraph([shapeExportClip(undefined, undefined)], { ...FRAME, fps: 30, totalDuration: 1 })
    expect(filterScript).toContain('scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1')
    expect(filterScript).not.toContain('iw*')
  })

  const ffmpeg = findFfmpegPath()
  it.skipIf(!ffmpeg).each([
    [150, 50],
    [100, 100],
    [60, 140],
  ])('renders a square image stretched %s × %s to the box the preview draws', (scaleX, scaleY) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaila-shape-scale-'))
    try {
      const png = path.join(dir, 'square.png')
      const run = (args: string[]) => spawnSync(ffmpeg!, ['-hide_banner', '-y', ...args], { encoding: 'utf8' })
      expect(run(['-f', 'lavfi', '-i', 'color=white:s=1024x1024', '-frames:v', '1', png]).status).toBe(0)

      const { inputs, filterScript } = buildVideoFilterGraph([shapeExportClip(scaleX, scaleY, png)], { ...FRAME, fps: 30, totalDuration: 1 })
      const script = path.join(dir, 'graph.txt')
      fs.writeFileSync(script, filterScript)
      const out = path.join(dir, 'frame.png')
      const rendered = run([...inputs, '-filter_complex_script', script, '-map', '[outv]', '-frames:v', '1', out])
      expect(rendered.status, rendered.stderr?.slice(-600)).toBe(0)

      // The white area on the black canvas is the shape's box.
      const detect = run(['-i', out, '-vf', 'cropdetect=limit=0.5:round=2:reset=0:skip=0', '-f', 'null', '-']).stderr ?? ''
      // Read the bounds, not crop=: when the white touches both edges of an axis there is
      // nothing to crop, and cropdetect reports x2 < x1 (a negative width) for it.
      const line = detect.split('\n').filter(l => l.includes('x1:')).pop() ?? ''
      const m = /x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/.exec(line)
      expect(m, detect.slice(-400)).not.toBeNull()
      const [x1, x2, y1, y2] = m!.slice(1).map(Number)
      const w = x2 >= x1 ? x2 - x1 + 1 : FRAME.width
      const h = y2 >= y1 ? y2 - y1 + 1 : FRAME.height

      // What the preview and the transform box compute for the same clip.
      const box = clipScreenBox(FRAME, { width: 512, height: 512 }, { scale: 100, scaleX, scaleY })
      expect(Math.abs(w - Math.min(FRAME.width, box.width))).toBeLessThanOrEqual(4)
      expect(Math.abs(h - Math.min(FRAME.height, box.height))).toBeLessThanOrEqual(4)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
