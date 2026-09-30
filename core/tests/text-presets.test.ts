import { describe, it, expect } from 'vitest'
import {
  TEXT_PRESETS,
  TEXT_ANIMATIONS,
  getTextPreset,
  getTextAnimation,
  applyTextPreset,
  applyTextAnimation,
  createTextClipWithPreset,
} from '../src/text-presets'
import type { TimelineClip } from '../src/project-model'

describe('KE-701: Text Presets and Animations', () => {
  describe('Presets definition', () => {
    it('has at least 8 distinctive text presets', () => {
      expect(TEXT_PRESETS.length).toBeGreaterThanOrEqual(8)
    })

    it('each preset has a unique ID, valid style and font properties', () => {
      const ids = new Set<string>()
      for (const preset of TEXT_PRESETS) {
        expect(ids.has(preset.id)).toBe(false)
        ids.add(preset.id)
        expect(preset.name).toBeTruthy()
        expect(preset.style.fontSize).toBeGreaterThan(0)
        expect(preset.style.color).toBeTruthy()
      }
    })

    it('retrieves preset by ID with getTextPreset', () => {
      const gold = getTextPreset('cinematic-gold')
      expect(gold).toBeDefined()
      expect(gold?.name).toBe('Cinematic Gold')
      expect(gold?.style.color).toBe('#F59E0B')

      const unknown = getTextPreset('non-existent-preset')
      expect(unknown).toBeUndefined()
    })
  })

  describe('applyTextPreset', () => {
    it('applies styling but preserves existing text content', () => {
      const existingClip: TimelineClip = {
        id: 'clip-1',
        assetId: null,
        type: 'text',
        startTime: 2,
        duration: 4,
        trimStart: 0,
        trimEnd: 0,
        speed: 1,
        reversed: false,
        muted: true,
        volume: 1,
        trackIndex: 1,
        asset: null,
        flipH: false,
        flipV: false,
        transitionIn: { type: 'none', duration: 0 },
        transitionOut: { type: 'none', duration: 0 },
        colorCorrection: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, exposure: 0, highlights: 0, shadows: 0 },
        transform: { scale: 100, positionX: 0, positionY: 0, rotation: 0, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 },
        opacity: 100,
        textStyle: {
          text: 'My Custom Title Content',
          fontFamily: 'Arial',
          fontSize: 30,
          fontWeight: 'normal',
          fontStyle: 'normal',
          color: '#000000',
          backgroundColor: 'transparent',
          textAlign: 'center',
          positionX: 50,
          positionY: 50,
          strokeColor: 'transparent',
          strokeWidth: 0,
          shadowColor: 'transparent',
          shadowBlur: 0,
          shadowOffsetX: 0,
          shadowOffsetY: 0,
          letterSpacing: 0,
          lineHeight: 1.2,
          maxWidth: 80,
          padding: 0,
          borderRadius: 0,
          opacity: 100,
        },
      }

      const updated = applyTextPreset(existingClip, 'neon-cyan')
      // Style is updated to neon cyan
      expect(updated.textStyle?.color).toBe('#38BDF8')
      expect(updated.textStyle?.strokeColor).toBe('#0284C7')
      // CRITICAL: Text content MUST NOT be lost!
      expect(updated.textStyle?.text).toBe('My Custom Title Content')
    })

    it('drops what an earlier look left behind when the preset does not name it', () => {
      const bold = createTextClipWithPreset('bold-punch', undefined, 'Keep me')
      const updated = applyTextPreset(bold, 'end-card')
      expect(updated.textStyle?.text).toBe('Keep me')
      expect(updated.textStyle?.strokeWidth).toBe(0)
      expect(updated.textStyle?.strokeColor).toBe('transparent')
      expect(updated.textStyle?.fontFamily).toBe('Inter, Arial, sans-serif')
      expect(updated.textStyle?.color).toBe('#E4E4E7')
    })

    it('preserves existing positionX and positionY even if the preset defines different positions', () => {
      const existingClip: TimelineClip = {
        id: 'clip-positioned',
        assetId: null,
        type: 'text',
        startTime: 0,
        duration: 3,
        trimStart: 0,
        trimEnd: 0,
        speed: 1,
        reversed: false,
        muted: true,
        volume: 1,
        trackIndex: 1,
        asset: null,
        flipH: false,
        flipV: false,
        transitionIn: { type: 'none', duration: 0 },
        transitionOut: { type: 'none', duration: 0 },
        colorCorrection: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, exposure: 0, highlights: 0, shadows: 0 },
        transform: { scale: 100, positionX: 0, positionY: 0, rotation: 0, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0 },
        opacity: 100,
        textStyle: {
          text: 'Header Title',
          fontFamily: 'Arial',
          fontSize: 40,
          fontWeight: 'normal',
          fontStyle: 'normal',
          color: '#ffffff',
          backgroundColor: 'transparent',
          textAlign: 'center',
          positionX: 25,
          positionY: 15,
          strokeColor: 'transparent',
          strokeWidth: 0,
          shadowColor: 'transparent',
          shadowBlur: 0,
          shadowOffsetX: 0,
          shadowOffsetY: 0,
          letterSpacing: 0,
          lineHeight: 1.2,
          maxWidth: 80,
          padding: 0,
          borderRadius: 0,
          opacity: 100,
        },
      }

      // tiktok-classic defines positionX: 50, positionY: 75
      const updatedTiktok = applyTextPreset(existingClip, 'tiktok-classic')
      expect(updatedTiktok.textStyle?.positionX).toBe(25)
      expect(updatedTiktok.textStyle?.positionY).toBe(15)

      // lower-third defines positionX: 30, positionY: 82
      const updatedLowerThird = applyTextPreset(existingClip, 'lower-third')
      expect(updatedLowerThird.textStyle?.positionX).toBe(25)
      expect(updatedLowerThird.textStyle?.positionY).toBe(15)
    })
  })

  describe('Animations definition', () => {
    it('has at least 5 keyframe animations: fly-in, slide-in, fade-in, pop, typewriter', () => {
      expect(TEXT_ANIMATIONS.length).toBeGreaterThanOrEqual(5)
      const ids = TEXT_ANIMATIONS.map(a => a.id)
      expect(ids).toContain('fly-in')
      expect(ids).toContain('slide-in')
      expect(ids).toContain('fade-in')
      expect(ids).toContain('pop')
      expect(ids).toContain('typewriter')

      const fly = getTextAnimation('fly-in')
      expect(fly).toBeDefined()
      expect(fly?.name).toContain('Fly In')
      expect(getTextAnimation('unknown')).toBeUndefined()
    })

    it('each animation creates valid keyframe tracks on KE-201 keyframe model', () => {
      for (const anim of TEXT_ANIMATIONS) {
        const tracks = anim.createTracks(4.0)
        expect(tracks.length).toBeGreaterThan(0)
        for (const track of tracks) {
          expect(track.property).toBeTruthy()
          expect(track.points.length).toBeGreaterThanOrEqual(1)
          for (const pt of track.points) {
            expect(pt.t).toBeGreaterThanOrEqual(0)
            expect(pt.t).toBeLessThanOrEqual(4.0)
            expect(typeof pt.value).toBe('number')
            expect(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold']).toContain(pt.easing)
          }
        }
      }
    })

    it('applyTextAnimation merges animation keyframe tracks into clip', () => {
      const clip = createTextClipWithPreset('default', undefined, 'Sample Text', 0, 0, 5)
      expect(clip.keyframes).toBeUndefined()

      const animatedClip = applyTextAnimation(clip, 'pop')
      expect(animatedClip.keyframes).toBeDefined()
      expect(animatedClip.keyframes?.some(k => k.property === 'transform.scale')).toBe(true)
      expect(animatedClip.keyframes?.some(k => k.property === 'opacity')).toBe(true)
    })

    it('typewriter animation uses text.progress keyframe property', () => {
      const clip = createTextClipWithPreset('default', 'typewriter', 'Typewriter Text', 0, 0, 3)
      const progTrack = clip.keyframes?.find(k => k.property === 'text.progress')
      expect(progTrack).toBeDefined()
      expect(progTrack?.points[0].value).toBe(0)
      expect(progTrack?.points[progTrack.points.length - 1].value).toBe(100)
    })
  })
})
