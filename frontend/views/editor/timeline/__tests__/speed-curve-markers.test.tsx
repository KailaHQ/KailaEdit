// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { TimelineClip } from '../../../../types/project-model'
import {
  clipTimeAtSourceOffset,
  curveMeanSpeed,
  durationForSpeedCurve,
  speedCurveForPreset,
} from '@core/speed-curve'
import { SpeedCurveMarkers } from '../SpeedCurveMarkers'

function clipWith(preset: 'bullet' | 'hero' | 'custom'): TimelineClip {
  const curve = speedCurveForPreset(preset)
  return {
    id: 'c1', type: 'video', startTime: 0, trimStart: 0, trimEnd: 0, reversed: false,
    duration: durationForSpeedCurve(6, curve), speed: curveMeanSpeed(curve), speedCurve: curve,
  } as unknown as TimelineClip
}

describe('SpeedCurveMarkers', () => {
  afterEach(() => { document.body.innerHTML = '' })

  async function mount(clip: TimelineClip, width: number) {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<SpeedCurveMarkers clip={clip} clipWidthPx={width} />) })
    return { host, root }
  }

  it('draws a bar for every curve point, at the time its footage is shown', async () => {
    const clip = clipWith('bullet')
    const width = 600
    const { host, root } = await mount(clip, width)
    const bars = [...host.querySelectorAll('[data-speed-curve-marker] rect')]
    expect(bars).toHaveLength(clip.speedCurve!.points.length)

    const span = clip.duration * clip.speed
    clip.speedCurve!.points.forEach((point, index) => {
      if (index === 0 || index === clip.speedCurve!.points.length - 1) return
      const expected = (clipTimeAtSourceOffset(clip, point.x * span) / clip.duration) * width
      const centre = Number(bars[index].getAttribute('x')) + 1.5
      expect(centre).toBeCloseTo(expected, 1)
    })
    await act(async () => { root.unmount() })
  })

  it('bunches the arrows where the clip plays fast and spreads them where it is slow', async () => {
    const { host, root } = await mount(clipWith('bullet'), 800)
    const xs = [...host.querySelectorAll('polyline')]
      .map(p => Number(p.getAttribute('points')!.split(' ')[1].split(',')[0]))
      .sort((a, b) => a - b)
    const gaps = xs.slice(1).map((x, i) => x - xs[i])
    // The dip in the middle is 5x slower than the ends, so its gaps are wider.
    const middle = gaps.filter((_, i) => xs[i] > 300 && xs[i] < 500)
    const ends = gaps.filter((_, i) => xs[i] < 150)
    expect(Math.max(...middle)).toBeGreaterThan(Math.max(...ends))
    await act(async () => { root.unmount() })
  })

  it('draws nothing for a clip without a curve', async () => {
    const plain = { ...clipWith('custom'), speedCurve: undefined } as TimelineClip
    const { host, root } = await mount(plain, 400)
    expect(host.querySelector('[data-speed-curve-markers]')).toBeNull()
    await act(async () => { root.unmount() })
  })
})
