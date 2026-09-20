import { describe, expect, it } from 'vitest'
import { isAutoMatteBakeValid } from '../../../core/src/auto-matte'
import type { AutoMatteBake } from '../../../core/src/project-model'

/**
 * Added 18/09/2026, from the report "close the project, open it again, and the video is no
 * longer cut out — even though Auto removal is still on".
 *
 * Remove BG being enabled is saved with the project, but a baked matte lives in a cache
 * that evicts, gets cleared from Settings, or is dropped by a format migration. When the
 * matte went, the clip kept `enabled: true` with no usable bake and nothing ever started
 * one: validity is a comparison of recorded fields, and the only thing that began a bake
 * was a click. These assert the condition the keeper hook watches for.
 */
describe('a clip that still wants Remove BG but has no usable matte', () => {
  const params = {
    trimStart: 0,
    duration: 80.003333,
    speed: 1,
    reversed: false,
    model: 'rvm-mobilenetv3',
    quality: 'standard',
  }

  const bake = (over: Partial<AutoMatteBake> = {}): AutoMatteBake => ({
    path: 'C:/cache/matte_abc_0_80003.mp4',
    fingerprint: 'matte_abc_0_80003',
    frameCount: 2400,
    createdAt: Date.now(),
    sourceStart: 0,
    sourceSpan: 80.003,
    speed: 1,
    reversed: false,
    model: 'rvm-mobilenetv3',
    quality: 'standard',
    ...over,
  })

  it('a record cleared because its file vanished reads as needing a bake', () => {
    expect(isAutoMatteBakeValid(undefined, params)).toBe(false)
  })

  it('a bake that still covers the clip does NOT ask for another one', () => {
    // The keeper must stay quiet here, or reopening a healthy project re-bakes everything.
    expect(isAutoMatteBakeValid(bake(), params)).toBe(true)
  })

  it('the range recorded for this clip really does cover it', () => {
    // 80.003 recorded against 80.003333 needed: the fingerprint stores whole milliseconds,
    // so the record is always a hair short. If the tolerance ever tightened, every reopen
    // would re-bake the whole clip.
    expect(isAutoMatteBakeValid(bake({ sourceSpan: 80.003 }), params)).toBe(true)
  })

  it('a genuinely short bake still asks for a new one', () => {
    expect(isAutoMatteBakeValid(bake({ sourceSpan: 30 }), params)).toBe(false)
  })
})
