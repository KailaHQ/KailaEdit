import { describe, it, expect } from 'vitest'
import {
  getInferDimensions,
  getMaxDimForQuality,
  MATTE_INFER_MAX_DIMS,
} from '../matte-service'
import {
  autoMatteBakeKey,
  isAutoMatteBakeValid,
  computeAutoMatteFingerprint,
} from '../../../core/src/auto-matte'
import { en } from '../../../frontend/i18n/locales/en'
import { vi } from '../../../frontend/i18n/locales/vi'

describe('KE-1506: Auto Removal Quality Settings', () => {
  describe('Inference Dimensions by Quality', () => {
    it('defines max dimensions: draft 960, standard 1280, high 1920', () => {
      expect(MATTE_INFER_MAX_DIMS.draft).toBe(960)
      expect(MATTE_INFER_MAX_DIMS.standard).toBe(1280)
      expect(MATTE_INFER_MAX_DIMS.high).toBe(1920)
    })

    it('resolves correct max dimension with standard as fallback', () => {
      expect(getMaxDimForQuality('draft')).toBe(960)
      expect(getMaxDimForQuality('standard')).toBe(1280)
      expect(getMaxDimForQuality('high')).toBe(1920)
      expect(getMaxDimForQuality(undefined)).toBe(1280)
      expect(getMaxDimForQuality('unknown')).toBe(1280)
    })

    it('scales portrait 1080x1920 video accurately for all three quality tiers', () => {
      // Draft (cap 960): 540x960
      const draft = getInferDimensions(1080, 1920, 'draft')
      expect(draft.inferW).toBe(540)
      expect(draft.inferH).toBe(960)
      expect(draft.inferW % 2).toBe(0)
      expect(draft.inferH % 2).toBe(0)

      // Standard (cap 1280): 720x1280
      const standard = getInferDimensions(1080, 1920, 'standard')
      expect(standard.inferW).toBe(720)
      expect(standard.inferH).toBe(1280)
      expect(standard.inferW % 2).toBe(0)
      expect(standard.inferH % 2).toBe(0)

      // High (cap 1920): 1080x1920 (no downscale needed)
      const high = getInferDimensions(1080, 1920, 'high')
      expect(high.inferW).toBe(1080)
      expect(high.inferH).toBe(1920)
      expect(high.inferW % 2).toBe(0)
      expect(high.inferH % 2).toBe(0)
    })

    it('scales landscape 1920x1080 video accurately for all three quality tiers', () => {
      // Draft (cap 960): 960x540
      const draft = getInferDimensions(1920, 1080, 'draft')
      expect(draft.inferW).toBe(960)
      expect(draft.inferH).toBe(540)

      // Standard (cap 1280): 1280x720
      const standard = getInferDimensions(1920, 1080, 'standard')
      expect(standard.inferW).toBe(1280)
      expect(standard.inferH).toBe(720)

      // High (cap 1920): 1920x1080
      const high = getInferDimensions(1920, 1080, 'high')
      expect(high.inferW).toBe(1920)
      expect(high.inferH).toBe(1080)
    })

    it('scales 4K 3840x2160 video to respective caps', () => {
      const draft = getInferDimensions(3840, 2160, 'draft')
      expect(draft.inferW).toBe(960)
      expect(draft.inferH).toBe(540)

      const standard = getInferDimensions(3840, 2160, 'standard')
      expect(standard.inferW).toBe(1280)
      expect(standard.inferH).toBe(720)

      const high = getInferDimensions(3840, 2160, 'high')
      expect(high.inferW).toBe(1920)
      expect(high.inferH).toBe(1080)
    })

    it('does not upscale videos smaller than the cap', () => {
      const small = getInferDimensions(640, 360, 'high')
      expect(small.inferW).toBe(640)
      expect(small.inferH).toBe(360)
    })

    it('always outputs even dimensions for ffmpeg compatibility', () => {
      // 1081x1921 with odd sizes
      const res = getInferDimensions(1081, 1921, 'standard')
      expect(res.inferW % 2).toBe(0)
      expect(res.inferH % 2).toBe(0)
    })

    it('computes downsampleRatio targeting the 512px segmentation stage', () => {
      const draft = getInferDimensions(1080, 1920, 'draft') // 540x960
      // 512 / 960 = 0.5333
      expect(draft.downsampleRatio).toBeCloseTo(512 / 960, 3)

      const standard = getInferDimensions(1080, 1920, 'standard') // 720x1280
      // 512 / 1280 = 0.400
      expect(standard.downsampleRatio).toBeCloseTo(512 / 1280, 3)

      const high = getInferDimensions(1080, 1920, 'high') // 1080x1920
      // 512 / 1920 = 0.2667
      expect(high.downsampleRatio).toBeCloseTo(512 / 1920, 3)
    })
  })

  describe('Bake Invalidation across Qualities', () => {
    it('produces distinct bake keys for different qualities', () => {
      const keyDraft = autoMatteBakeKey({
        assetKey: 'clip-1',
        model: 'rvm-mobilenetv3',
        quality: 'draft',
      })
      const keyStandard = autoMatteBakeKey({
        assetKey: 'clip-1',
        model: 'rvm-mobilenetv3',
        quality: 'standard',
      })
      const keyHigh = autoMatteBakeKey({
        assetKey: 'clip-1',
        model: 'rvm-mobilenetv3',
        quality: 'high',
      })

      expect(keyDraft).not.toBe(keyStandard)
      expect(keyStandard).not.toBe(keyHigh)
      expect(keyDraft).not.toBe(keyHigh)
    })

    it('invalidates existing bake when quality is changed', () => {
      const existingBake = {
        path: 'C:/cache/matte_test.mp4',
        fingerprint: computeAutoMatteFingerprint({
          assetKey: 'clip-1',
          trimStart: 0,
          duration: 10,
          model: 'rvm-mobilenetv3',
          quality: 'standard',
        }),
        frameCount: 300,
        createdAt: Date.now(),
        sourceStart: 0,
        sourceSpan: 10,
        speed: 1,
        reversed: false,
        model: 'rvm-mobilenetv3',
        quality: 'standard',
      }

      // Valid with standard
      expect(
        isAutoMatteBakeValid(existingBake, {
          assetKey: 'clip-1',
          trimStart: 0,
          duration: 10,
          speed: 1,
          reversed: false,
          model: 'rvm-mobilenetv3',
          quality: 'standard',
        }),
      ).toBe(true)

      // Invalid with draft
      expect(
        isAutoMatteBakeValid(existingBake, {
          assetKey: 'clip-1',
          trimStart: 0,
          duration: 10,
          speed: 1,
          reversed: false,
          model: 'rvm-mobilenetv3',
          quality: 'draft',
        }),
      ).toBe(false)

      // Invalid with high
      expect(
        isAutoMatteBakeValid(existingBake, {
          assetKey: 'clip-1',
          trimStart: 0,
          duration: 10,
          speed: 1,
          reversed: false,
          model: 'rvm-mobilenetv3',
          quality: 'high',
        }),
      ).toBe(false)
    })
  })

  describe('Localization Parity', () => {
    it('has translation keys for quality in en.ts and vi.ts', () => {
      const enRemoveBg = (en as any).clipProperties.removeBg
      const viRemoveBg = (vi as any).clipProperties.removeBg

      expect(enRemoveBg.quality).toBe('Quality')
      expect(viRemoveBg.quality).toBe('Chất lượng')

      expect(enRemoveBg.qualityDraft).toBe('Draft')
      expect(viRemoveBg.qualityDraft).toBe('Nháp')

      expect(enRemoveBg.qualityStandard).toBe('Standard')
      expect(viRemoveBg.qualityStandard).toBe('Tiêu chuẩn')

      expect(enRemoveBg.qualityHigh).toBe('High')
      expect(viRemoveBg.qualityHigh).toBe('Cao')
    })
  })
})
