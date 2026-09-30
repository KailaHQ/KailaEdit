import { describe, expect, it } from 'vitest'
import { sampleKeyframeTrack } from '../src/keyframes'
import {
  TEXT_ANIMATIONS,
  applyTextAnimation,
  createTextClipWithPreset,
  textAnimationSpan,
  textAnimationsForPhase,
} from '../src/text-presets'
import { setTextAnimationPhase } from '../src/text-animations'

const REST: Record<string, number> = {
  'transform.positionX': 0,
  'transform.positionY': 0,
  'transform.scale': 100,
  'transform.rotation': 0,
  opacity: 100,
  'text.progress': 100,
}

describe('text animations', () => {
  it('offers plenty of entrances, exits and loops', () => {
    expect(textAnimationsForPhase('in').length).toBeGreaterThanOrEqual(25)
    expect(textAnimationsForPhase('out').length).toBeGreaterThanOrEqual(25)
    expect(textAnimationsForPhase('loop').length).toBeGreaterThanOrEqual(10)
    expect(new Set(TEXT_ANIMATIONS.map(a => a.id)).size).toBe(TEXT_ANIMATIONS.length)
  })

  it('keeps every point inside the clip, sorted, and small enough to export', () => {
    for (const anim of TEXT_ANIMATIONS) {
      for (const duration of [0.4, 2, 12, 120]) {
        for (const track of anim.createTracks(duration)) {
          expect(track.points.length, `${anim.id} on ${duration}s`).toBeLessThanOrEqual(100)
          track.points.forEach((p, i) => {
            expect(p.t).toBeGreaterThanOrEqual(0)
            expect(p.t).toBeLessThanOrEqual(duration + 1e-6)
            if (i > 0) expect(p.t).toBeGreaterThanOrEqual(track.points[i - 1].t)
          })
        }
      }
    }
  })

  it('entrances end at rest and exits start at rest', () => {
    for (const anim of TEXT_ANIMATIONS.filter(a => a.phase !== 'loop')) {
      for (const track of anim.createTracks(4)) {
        const rest = REST[track.property]
        const atEnd = sampleKeyframeTrack(track, 4, rest)
        const atStart = sampleKeyframeTrack(track, 0, rest)
        if (anim.phase === 'in') expect(atEnd, `${anim.id} ${track.property}`).toBeCloseTo(rest, 3)
        else expect(atStart, `${anim.id} ${track.property}`).toBeCloseTo(rest, 3)
      }
    }
  })

  it('keeps an entrance, an exit and a loop side by side', () => {
    let clip = createTextClipWithPreset('default', undefined, 'Hi', 0, 0, 5)
    clip = applyTextAnimation(clip, 'fade-in')
    clip = applyTextAnimation(clip, 'fade-out')
    clip = applyTextAnimation(clip, 'pulse')
    expect(clip.textAnimation).toMatchObject({ in: 'fade-in', out: 'fade-out', loop: 'pulse' })

    const opacity = clip.keyframes!.find(k => k.property === 'opacity')!
    expect(sampleKeyframeTrack(opacity, 0, 100)).toBe(0)
    expect(sampleKeyframeTrack(opacity, 2.5, 100)).toBe(100)
    expect(sampleKeyframeTrack(opacity, 5, 100)).toBe(0)
    expect(clip.keyframes!.some(k => k.property === 'transform.scale')).toBe(true)
  })

  it('replacing an entrance leaves nothing of the old one behind, and none clears it', () => {
    let clip = createTextClipWithPreset('default', 'fly-in', 'Hi', 0, 0, 4)
    expect(clip.keyframes!.some(k => k.property === 'transform.positionY')).toBe(true)
    clip = applyTextAnimation(clip, 'fade-in')
    expect(clip.keyframes!.some(k => k.property === 'transform.positionY')).toBe(false)
    clip = setTextAnimationPhase(clip, 'in', undefined)
    expect(clip.keyframes).toBeUndefined()
    expect(clip.textAnimation).toBeUndefined()
  })

  it('never lets an entrance and an exit overlap on a short clip', () => {
    expect(textAnimationSpan('zoom-out', 0.5)).toBeLessThanOrEqual(0.25)
    expect(textAnimationSpan('nope', 5)).toBe(0)
  })
})

describe('text animation after retiming', () => {
  it('moves the exit to the clip\'s new end', async () => {
    const { refitTextAnimations } = await import('../src/text-animations')
    let clip = createTextClipWithPreset('default', undefined, 'Hi', 0, 0, 5)
    clip = applyTextAnimation(clip, 'fade-out')
    const shorter = refitTextAnimations([{ ...clip, duration: 3 }])[0]
    const opacity = shorter.keyframes!.find(k => k.property === 'opacity')!
    expect(sampleKeyframeTrack(opacity, 1, 100)).toBe(100)
    expect(sampleKeyframeTrack(opacity, 3, 100)).toBe(0)
    expect(shorter.textAnimation?.stamp).toContain('3|')
    // Nothing to do: the very same array comes back.
    const clips = [shorter]
    expect(refitTextAnimations(clips)).toBe(clips)
  })
})

describe('flights from the frame edge', () => {
  it('start with the whole text outside the frame, wherever the text sits', async () => {
    const { createTextClipWithPreset } = await import('../src/text-presets')
    for (const [x, y] of [[50, 50], [20, 80], [85, 15]]) {
      let clip = createTextClipWithPreset('default', undefined, 'Fly me in', 0, 0, 4)
      clip = { ...clip, textStyle: { ...clip.textStyle!, positionX: x, positionY: y } }
      const cases: [string, 'transform.positionX' | 'transform.positionY', (v: number) => boolean][] = [
        ['fly-in-top', 'transform.positionY', v => y + v < 0],
        ['fly-in', 'transform.positionY', v => y + v > 100],
        ['fly-in-left', 'transform.positionX', v => x + v < 0],
        ['fly-in-right', 'transform.positionX', v => x + v > 100],
      ]
      for (const [id, property, isOutside] of cases) {
        const flown = applyTextAnimation(clip, id)
        const track = flown.keyframes!.find(k => k.property === property)!
        expect(isOutside(track.points[0].value), `${id} at ${x},${y}`).toBe(true)
        expect(sampleKeyframeTrack(track, 4, 0)).toBe(0)
      }
    }
  })

  it('rebuilds the flight when the text is moved', async () => {
    const { refitTextAnimations } = await import('../src/text-animations')
    let clip = createTextClipWithPreset('default', undefined, 'Hi', 0, 0, 4)
    clip = applyTextAnimation(clip, 'fly-in-top')
    const before = clip.keyframes!.find(k => k.property === 'transform.positionY')!.points[0].value
    const moved = refitTextAnimations([{ ...clip, textStyle: { ...clip.textStyle!, positionY: 80 } }])[0]
    const after = moved.keyframes!.find(k => k.property === 'transform.positionY')!.points[0].value
    expect(after).toBeLessThan(before)
  })
})

describe('exits leave the frame', () => {
  it('end with the whole text outside the frame, wherever it sits', () => {
    for (const [x, y] of [[50, 50], [20, 80], [85, 15]]) {
      let clip = createTextClipWithPreset('default', undefined, 'Fly me out', 0, 0, 4)
      clip = { ...clip, textStyle: { ...clip.textStyle!, positionX: x, positionY: y } }
      const cases: [string, 'transform.positionX' | 'transform.positionY', (v: number) => boolean][] = [
        ['fly-out', 'transform.positionY', v => y + v > 100],
        ['fly-out-top', 'transform.positionY', v => y + v < 0],
        ['fly-out-left', 'transform.positionX', v => x + v < 0],
        ['fly-out-right', 'transform.positionX', v => x + v > 100],
        ['whip-out-left', 'transform.positionX', v => x + v < 0],
        ['slide-out', 'transform.positionX', v => x + v < 0],
        ['slide-out-right', 'transform.positionX', v => x + v > 100],
        ['slide-out-down', 'transform.positionY', v => y + v > 100],
        ['slide-out-up', 'transform.positionY', v => y + v < 0],
      ]
      for (const [id, property, isOutside] of cases) {
        const track = applyTextAnimation(clip, id).keyframes!.find(k => k.property === property)!
        expect(isOutside(track.points[track.points.length - 1].value), `${id} at ${x},${y}`).toBe(true)
        expect(sampleKeyframeTrack(track, 0, 0)).toBe(0)
      }
    }
  })
})

describe('custom in and out durations', () => {
  it('stretches the entrance and the exit to the seconds asked for', async () => {
    const { setTextAnimationDuration } = await import('../src/text-animations')
    let clip = createTextClipWithPreset('default', undefined, 'Hi', 0, 0, 6)
    clip = applyTextAnimation(clip, 'fade-in')
    clip = applyTextAnimation(clip, 'fade-out')
    clip = setTextAnimationDuration(clip, 'in', 2)
    clip = setTextAnimationDuration(clip, 'out', 1.5)
    const opacity = clip.keyframes!.find(k => k.property === 'opacity')!
    expect(sampleKeyframeTrack(opacity, 1, 100)).toBeGreaterThan(0)
    expect(sampleKeyframeTrack(opacity, 1, 100)).toBeLessThan(100)
    expect(sampleKeyframeTrack(opacity, 2, 100)).toBe(100)
    expect(sampleKeyframeTrack(opacity, 4.5, 100)).toBe(100)
    expect(sampleKeyframeTrack(opacity, 6, 100)).toBe(0)
    expect(textAnimationSpan('fade-in', 6, clip.textAnimation?.inDuration)).toBe(2)
  })

  it('survives choosing another animation and is dropped when everything is cleared', async () => {
    const { setTextAnimationDuration, withTextAnimation } = await import('../src/text-animations')
    let clip = createTextClipWithPreset('default', undefined, 'Hi', 0, 0, 6)
    clip = applyTextAnimation(clip, 'fade-in')
    clip = setTextAnimationDuration(clip, 'in', 2)
    clip = applyTextAnimation(clip, 'zoom-in')
    expect(clip.textAnimation?.inDuration).toBe(2)
    expect(withTextAnimation(clip, {}).textAnimation).toBeUndefined()
  })

  it('never lets a duration outgrow the clip', async () => {
    const { setTextAnimationDuration } = await import('../src/text-animations')
    let clip = createTextClipWithPreset('default', undefined, 'Hi', 0, 0, 3)
    clip = applyTextAnimation(clip, 'fade-in')
    clip = setTextAnimationDuration(clip, 'in', 99)
    expect(clip.textAnimation?.inDuration).toBe(3)
  })
})
