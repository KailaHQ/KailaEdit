import { describe, it, expect } from 'vitest'
import {
  timelineClipSchema,
  createDefaultTimeline,
  type TimelineClip,
} from '../src/project-model'
import {
  evaluateEasing,
  interpolatePoints,
  sampleKeyframeTrack,
  sampleClipAt,
  upsertKeyframe,
  removeKeyframe,
  moveKeyframePoint,
  hasKeyframes,
  hasKeyframesForProperty,
} from '../src/keyframes'
import { getEditorModel, updatedProject } from '../src/editor-project-bridging'
import { getUndoSnapshot, applyUndoSnapshot, createInitialEditorState } from '../src/editor-state'
import { getClipEffectStyles, resolveEffectiveClipFilter } from '../src/video-editor-utils'
import { setClipTransform, setCropMode, toggleCropMode, setKeyframe } from '../src/editor-actions'
import { selectCropMode } from '../src/editor-selectors'

describe('KE-201: Shared Keyframe Model & Interpolation', () => {
  describe('Easing evaluation', () => {
    it('evaluates linear easing correctly', () => {
      expect(evaluateEasing(0, 'linear')).toBe(0)
      expect(evaluateEasing(0.5, 'linear')).toBe(0.5)
      expect(evaluateEasing(1, 'linear')).toBe(1)
    })

    it('evaluates ease-in correctly', () => {
      expect(evaluateEasing(0, 'ease-in')).toBe(0)
      expect(evaluateEasing(0.5, 'ease-in')).toBe(0.25)
      expect(evaluateEasing(1, 'ease-in')).toBe(1)
    })

    it('evaluates ease-out correctly', () => {
      expect(evaluateEasing(0, 'ease-out')).toBe(0)
      expect(evaluateEasing(0.5, 'ease-out')).toBe(0.75)
      expect(evaluateEasing(1, 'ease-out')).toBe(1)
    })

    it('evaluates ease-in-out symmetrically', () => {
      expect(evaluateEasing(0, 'ease-in-out')).toBe(0)
      expect(evaluateEasing(0.25, 'ease-in-out')).toBeCloseTo(0.125, 5)
      expect(evaluateEasing(0.5, 'ease-in-out')).toBe(0.5)
      expect(evaluateEasing(0.75, 'ease-in-out')).toBeCloseTo(0.875, 5)
      expect(evaluateEasing(1, 'ease-in-out')).toBe(1)
    })

    it('evaluates hold easing as step function', () => {
      expect(evaluateEasing(0, 'hold')).toBe(0)
      expect(evaluateEasing(0.999, 'hold')).toBe(0)
      expect(evaluateEasing(1, 'hold')).toBe(0)
    })

    it('clamps progress to [0, 1] range', () => {
      expect(evaluateEasing(-0.5, 'linear')).toBe(0)
      expect(evaluateEasing(1.5, 'linear')).toBe(1)
    })

    it('interpolates between points using interpolatePoints', () => {
      const p0 = { t: 0, value: 10, easing: 'linear' as const }
      const p1 = { t: 2, value: 30, easing: 'linear' as const }
      expect(interpolatePoints(p0, p1, -1)).toBe(10)
      expect(interpolatePoints(p0, p1, 0)).toBe(10)
      expect(interpolatePoints(p0, p1, 1)).toBe(20)
      expect(interpolatePoints(p0, p1, 2)).toBe(30)
      expect(interpolatePoints(p0, p1, 3)).toBe(30)
    })
  })

  describe('Track sampling & boundary conditions', () => {
    it('returns default value when track is undefined or empty', () => {
      expect(sampleKeyframeTrack(undefined, 2.0, 100)).toBe(100)
      expect(sampleKeyframeTrack({ property: 'opacity', points: [] }, 2.0, 100)).toBe(100)
    })

    it('returns single point value regardless of time', () => {
      const track = {
        property: 'opacity' as const,
        points: [{ t: 2.0, value: 50, easing: 'linear' as const }],
      }
      expect(sampleKeyframeTrack(track, 0.5, 100)).toBe(50)
      expect(sampleKeyframeTrack(track, 2.0, 100)).toBe(50)
      expect(sampleKeyframeTrack(track, 5.0, 100)).toBe(50)
    })

    it('clamps to first point value before first point t', () => {
      const track = {
        property: 'transform.scale' as const,
        points: [
          { t: 1.0, value: 120, easing: 'linear' as const },
          { t: 3.0, value: 160, easing: 'linear' as const },
        ],
      }
      expect(sampleKeyframeTrack(track, 0.0, 100)).toBe(120)
      expect(sampleKeyframeTrack(track, 0.99, 100)).toBe(120)
    })

    it('clamps to last point value after last point t', () => {
      const track = {
        property: 'transform.scale' as const,
        points: [
          { t: 1.0, value: 120, easing: 'linear' as const },
          { t: 3.0, value: 160, easing: 'linear' as const },
        ],
      }
      expect(sampleKeyframeTrack(track, 3.0, 100)).toBe(160)
      expect(sampleKeyframeTrack(track, 5.0, 100)).toBe(160)
    })

    it('interpolates linearly between points', () => {
      const track = {
        property: 'opacity' as const,
        points: [
          { t: 0.0, value: 0, easing: 'linear' as const },
          { t: 2.0, value: 100, easing: 'linear' as const },
          { t: 4.0, value: 50, easing: 'linear' as const },
        ],
      }
      expect(sampleKeyframeTrack(track, 1.0, 0)).toBe(50)
      expect(sampleKeyframeTrack(track, 3.0, 0)).toBe(75)
    })

    it('respects hold easing across intervals', () => {
      const track = {
        property: 'opacity' as const,
        points: [
          { t: 0.0, value: 100, easing: 'hold' as const },
          { t: 2.0, value: 20, easing: 'linear' as const },
        ],
      }
      expect(sampleKeyframeTrack(track, 0.0, 0)).toBe(100)
      expect(sampleKeyframeTrack(track, 1.0, 0)).toBe(100)
      expect(sampleKeyframeTrack(track, 1.99, 0)).toBe(100)
      expect(sampleKeyframeTrack(track, 2.0, 0)).toBe(20)
    })
  })

  describe('sampleClipAt multi-property sampling', () => {
    const baseClip: TimelineClip = timelineClipSchema.parse({
      id: 'clip-test-1',
      assetId: 'asset-1',
      asset: null,
      type: 'video',
      startTime: 5.0,
      duration: 10.0,
      trimStart: 0,
      trimEnd: 0,
      trackIndex: 0,
      transform: {
        scale: 100,
        positionX: 10,
        positionY: -10,
        rotation: 0,
        cropTop: 0,
        cropRight: 0,
        cropBottom: 0,
        cropLeft: 0,
      },
      opacity: 80,
      volume: 1.2, // Linear gain
      filter: { id: 'cine-teal-orange', intensity: 90 },
      keyframes: [
        {
          property: 'transform.scale',
          points: [
            { t: 0, value: 100, easing: 'linear' },
            { t: 4, value: 200, easing: 'linear' },
          ],
        },
        {
          property: 'volume',
          points: [
            { t: 0, value: 0, easing: 'linear' },
            { t: 2, value: 1.0, easing: 'linear' },
            { t: 8, value: 1.0, easing: 'linear' },
            { t: 10, value: 0, easing: 'linear' },
          ],
        },
      ],
    })

    it('samples animated properties and preserves static properties', () => {
      // At t = 2s in clip (clip-local time, NOT timeline time!)
      const sampled = sampleClipAt(baseClip, 2.0)

      // scale was 100 at 0s, 200 at 4s -> at 2s should be 150
      expect(sampled.scale).toBe(150)

      // volume was 0 at 0s, 1.0 at 2s -> at 2s should be 1.0
      expect(sampled.volume).toBe(1.0)

      // Un-keyed properties fall back to clip static values
      expect(sampled.positionX).toBe(10)
      expect(sampled.positionY).toBe(-10)
      expect(sampled.rotation).toBe(0)
      expect(sampled.opacity).toBe(80)
      expect(sampled.filterIntensity).toBe(90)
    })

    it('correctly samples volume fade-out at end of clip', () => {
      const sampledAt9 = sampleClipAt(baseClip, 9.0)
      // Volume: between t=8 (1.0) and t=10 (0) -> at t=9 is 0.5
      expect(sampledAt9.volume).toBeCloseTo(0.5, 5)
    })

    it('returns all static values when clip has no keyframes', () => {
      const clipWithoutKeyframes: TimelineClip = {
        ...baseClip,
        keyframes: undefined,
      }

      const sampled = sampleClipAt(clipWithoutKeyframes, 3.0)
      expect(sampled.scale).toBe(100)
      expect(sampled.positionX).toBe(10)
      expect(sampled.positionY).toBe(-10)
      expect(sampled.rotation).toBe(0)
      expect(sampled.opacity).toBe(80)
      expect(sampled.volume).toBe(1.2)
      expect(sampled.filterIntensity).toBe(90)
    })
  })

  describe('Keyframe manipulation helpers', () => {
    const clip: TimelineClip = timelineClipSchema.parse({
      id: 'clip-kf-1',
      assetId: null,
      asset: null,
      type: 'adjustment',
      startTime: 0,
      duration: 5,
      trimStart: 0,
      trimEnd: 0,
      trackIndex: 0,
    })

    it('adds and updates keyframes while keeping points sorted by t', () => {
      expect(hasKeyframes(clip)).toBe(false)

      const withPoint1 = upsertKeyframe(clip, 'opacity', { t: 3, value: 50, easing: 'linear' })
      expect(hasKeyframes(withPoint1)).toBe(true)
      expect(hasKeyframesForProperty(withPoint1, 'opacity')).toBe(true)
      expect(hasKeyframesForProperty(withPoint1, 'volume')).toBe(false)

      // Insert point before t=3
      const withPoint2 = upsertKeyframe(withPoint1, 'opacity', { t: 1, value: 100, easing: 'ease-in-out' })
      const track = withPoint2.keyframes?.find(k => k.property === 'opacity')
      expect(track?.points.length).toBe(2)
      expect(track?.points[0].t).toBe(1)
      expect(track?.points[1].t).toBe(3)

      // Update existing point at t=1 (within tolerance)
      const updated = upsertKeyframe(withPoint2, 'opacity', { t: 1.002, value: 80, easing: 'linear' })
      const updatedTrack = updated.keyframes?.find(k => k.property === 'opacity')
      expect(updatedTrack?.points.length).toBe(2)
      expect(updatedTrack?.points[0].value).toBe(80)
    })

    it('removes keyframe points by time', () => {
      const clipWithPoints = upsertKeyframe(
        upsertKeyframe(clip, 'volume', { t: 1, value: 0.5, easing: 'linear' }),
        'volume',
        { t: 3, value: 1.0, easing: 'linear' },
      )

      const removed = removeKeyframe(clipWithPoints, 'volume', 1.0)
      const track = removed.keyframes?.find(k => k.property === 'volume')
      expect(track?.points.length).toBe(1)
      expect(track?.points[0].t).toBe(3)

      // Removing the last point removes the track
      const allRemoved = removeKeyframe(removed, 'volume', 3.0)
      expect(allRemoved.keyframes).toBeUndefined()
    })
  })

  describe('Zod Schema & Persistence', () => {
    it('parses legacy clip JSON without keyframes successfully', () => {
      const legacyJson = {
        id: 'legacy-clip',
        assetId: 'asset-1',
        asset: null,
        type: 'video',
        startTime: 0,
        duration: 5,
        trimStart: 0,
        trimEnd: 0,
        trackIndex: 0,
      }

      const parsed = timelineClipSchema.parse(legacyJson)
      expect(parsed.keyframes).toBeUndefined()
    })

    it('parses clip JSON with valid keyframes successfully', () => {
      const keyframedJson = {
        id: 'kf-clip',
        assetId: 'asset-1',
        asset: null,
        type: 'video',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 0,
        trackIndex: 0,
        keyframes: [
          {
            property: 'transform.scale',
            points: [
              { t: 0, value: 100, easing: 'linear' },
              { t: 5, value: 150, easing: 'ease-in' },
            ],
          },
        ],
      }

      const parsed = timelineClipSchema.parse(keyframedJson)
      expect(parsed.keyframes?.length).toBe(1)
      expect(parsed.keyframes?.[0].property).toBe('transform.scale')
      expect(parsed.keyframes?.[0].points.length).toBe(2)
    })

    it('rejects invalid keyframe property or negative t', () => {
      const invalidJson = {
        id: 'invalid-kf-clip',
        assetId: 'asset-1',
        asset: null,
        type: 'video',
        startTime: 0,
        duration: 5,
        trimStart: 0,
        trimEnd: 0,
        trackIndex: 0,
        keyframes: [
          {
            property: 'nonexistent.property',
            points: [{ t: -1, value: 10 }],
          },
        ],
      }

      expect(() => timelineClipSchema.parse(invalidJson)).toThrow()
    })

    it('preserves keyframes across editor-project-bridging and undo snapshots', () => {
      const timeline = {
        ...createDefaultTimeline('Timeline 1'),
        clips: [
          {
            id: 'clip-kf',
            assetId: null,
            asset: null,
            type: 'adjustment' as const,
            startTime: 0,
            duration: 10,
            trimStart: 0,
            trimEnd: 0,
            trackIndex: 0,
            keyframes: [
              {
                property: 'opacity' as const,
                points: [{ t: 0, value: 0, easing: 'linear' as const }, { t: 5, value: 100, easing: 'linear' as const }],
              },
            ],
          },
        ],
      }

      const project = {
        version: 2 as const,
        id: 'proj-1',
        name: 'Project with Keyframes',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        bins: {},
        assets: [],
        timelines: [timeline],
      }

      // Bridging into EditorModel
      const editorModel = getEditorModel(project as any)
      expect(editorModel.timelines[0].clips[0].keyframes).toBeDefined()
      expect(editorModel.timelines[0].clips[0].keyframes?.[0].property).toBe('opacity')

      // Bridging back to Project
      const savedProject = updatedProject(project as any, editorModel)
      expect(savedProject.timelines[0].clips[0].keyframes).toEqual(timeline.clips[0].keyframes)

      // Undo snapshot preservation
      const state = createInitialEditorState(editorModel)
      const snapshot = getUndoSnapshot(state)
      expect(snapshot.timelines[0].clips[0].keyframes).toEqual(timeline.clips[0].keyframes)

      const restoredState = applyUndoSnapshot(state, snapshot)
      expect(restoredState.editorModel.timelines[0].clips[0].keyframes).toEqual(timeline.clips[0].keyframes)
    })
  })

  describe('KE-202: Preview reads keyframes in getClipEffectStyles', () => {
    it('returns identical styles when clip has no keyframes', () => {
      const staticClip = timelineClipSchema.parse({
        id: 'static-clip',
        assetId: null,
        asset: null,
        type: 'adjustment',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 0,
        trackIndex: 0,
        transform: {
          scale: 125,
          positionX: 15,
          positionY: -20,
          rotation: 45,
          cropTop: 0,
          cropRight: 0,
          cropBottom: 0,
          cropLeft: 0,
        },
        opacity: 75,
      })

      const withoutTime = getClipEffectStyles(staticClip)
      const withTime = getClipEffectStyles(staticClip, 4.0)

      expect(withTime.transform).toBe(withoutTime.transform)
      expect(withTime.opacity).toBe(withoutTime.opacity)
      expect(withTime.transform).toContain('scale(1.25)')
      expect(withTime.transform).toContain('rotate(45deg)')
      expect(withTime.transform).toContain('translate(15%, -20%)')
      expect(withTime.opacity).toBe(0.75)
    })

    it('dynamically animates transform and opacity based on keyframe progress', () => {
      const animatedClip = timelineClipSchema.parse({
        id: 'animated-clip',
        assetId: null,
        asset: null,
        type: 'adjustment',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 0,
        trackIndex: 0,
        transform: {
          scale: 100,
          positionX: 0,
          positionY: 0,
          rotation: 0,
          cropTop: 0,
          cropRight: 0,
          cropBottom: 0,
          cropLeft: 0,
        },
        opacity: 0,
        keyframes: [
          {
            property: 'transform.scale',
            points: [
              { t: 0, value: 100, easing: 'linear' },
              { t: 4, value: 200, easing: 'linear' },
            ],
          },
          {
            property: 'opacity',
            points: [
              { t: 0, value: 0, easing: 'linear' },
              { t: 2, value: 100, easing: 'linear' },
            ],
          },
        ],
      })

      // At t = 0
      const style0 = getClipEffectStyles(animatedClip, 0)
      expect(style0.opacity).toBe(0)
      expect(style0.transform).toBeUndefined() // scale 100%, translate 0% -> no transform

      // At t = 1 (halfway for opacity)
      const style1 = getClipEffectStyles(animatedClip, 1.0)
      expect(style1.opacity).toBe(0.5)
      expect(style1.transform).toContain('scale(1.25)')

      // At t = 2 (opacity reaches 100%, CSS style omits opacity when 1)
      const style2 = getClipEffectStyles(animatedClip, 2.0)
      expect(style2.opacity).toBeUndefined()
      expect(style2.transform).toContain('scale(1.5)')

      // At t = 4 (scale reaches 200%)
      const style4 = getClipEffectStyles(animatedClip, 4.0)
      expect(style4.opacity).toBeUndefined()
      expect(style4.transform).toContain('scale(2)')
    })

    it('samples keyframed filter intensity in resolveEffectiveClipFilter', () => {
      const filterClip = timelineClipSchema.parse({
        id: 'filter-clip',
        assetId: 'asset-1',
        asset: null,
        type: 'video',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 0,
        trackIndex: 0,
        filter: { id: 'cine-teal-orange', intensity: 100 },
        keyframes: [
          {
            property: 'filter.intensity',
            points: [
              { t: 0, value: 20, easing: 'linear' },
              { t: 4, value: 80, easing: 'linear' },
            ],
          },
        ],
      })

      const filterAt0 = resolveEffectiveClipFilter(filterClip, [], [], 0)
      expect(filterAt0?.intensity).toBe(20)

      const filterAt2 = resolveEffectiveClipFilter(filterClip, [], [], 2.0)
      expect(filterAt2?.intensity).toBe(50)

      const filterAt4 = resolveEffectiveClipFilter(filterClip, [], [], 4.0)
      expect(filterAt4?.intensity).toBe(80)
    })
  })

  describe('KE-302: Volume envelope point movement', () => {
    it('moves a keyframe point to both a new time and a new value', () => {
      const clip = timelineClipSchema.parse({
        id: 'audio-clip-1',
        assetId: 'asset-1',
        asset: null,
        type: 'audio',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 0,
        trackIndex: 0,
        volume: 1,
        keyframes: [
          {
            property: 'volume',
            points: [
              { t: 2.0, value: 0.5, easing: 'linear' },
              { t: 5.0, value: 1.0, easing: 'linear' },
            ],
          },
        ],
      })

      // Move point at t=2.0 (val=0.5) to t=3.0 and val=0.8
      const updated = moveKeyframePoint(clip, 'volume', 2.0, 3.0, 0.05, 0.8)
      const points = updated.keyframes?.[0].points
      expect(points).toHaveLength(2)
      expect(points?.[0]).toEqual({ t: 3.0, value: 0.8, easing: 'linear' })
      expect(points?.[1]).toEqual({ t: 5.0, value: 1.0, easing: 'linear' })

      // Move only time when newValue is not specified
      const movedTimeOnly = moveKeyframePoint(updated, 'volume', 5.0, 6.0)
      const points2 = movedTimeOnly.keyframes?.[0].points
      expect(points2?.[1]).toEqual({ t: 6.0, value: 1.0, easing: 'linear' })
    })
  })

  describe('KE-403: Transform Bounding Box Actions & Keyframing', () => {
    it('updates clip transform fields statically when no keyframes exist', () => {
      const clip = timelineClipSchema.parse({
        id: 'clip-v1',
        assetId: 'asset-1',
        asset: null,
        type: 'video',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 0,
        trackIndex: 0,
        volume: 1,
      })
      const timeline = {
        ...createDefaultTimeline('Main'),
        id: 'tl-1',
        clips: [clip],
      }
      const state = createInitialEditorState({
        assets: [],
        bins: {},
        timelines: [timeline],
        activeTimelineId: 'tl-1',
      })

      const updated = setClipTransform(state, 'clip-v1', {
        positionX: 12.5,
        positionY: -5.0,
        scale: 120,
        rotation: 45,
        cropTop: 10,
      })

      const clipAfter = updated.editorModel.timelines[0].clips[0]
      expect(clipAfter.transform?.positionX).toBe(12.5)
      expect(clipAfter.transform?.positionY).toBe(-5.0)
      expect(clipAfter.transform?.scale).toBe(120)
      expect(clipAfter.transform?.rotation).toBe(45)
      expect(clipAfter.transform?.cropTop).toBe(10)
      expect(clipAfter.keyframes).toBeUndefined()
    })

    it('records keyframe at specified time if keyframe track already exists', () => {
      const clip = timelineClipSchema.parse({
        id: 'clip-v2',
        assetId: 'asset-1',
        asset: null,
        type: 'video',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 0,
        trackIndex: 0,
        volume: 1,
      })
      const timeline = {
        ...createDefaultTimeline('Main'),
        id: 'tl-2',
        clips: [clip],
      }
      let state = createInitialEditorState({
        assets: [],
        bins: {},
        timelines: [timeline],
        activeTimelineId: 'tl-2',
      })

      // Establish initial keyframe for positionX at t=0
      state = setKeyframe(state, 'clip-v2', 'transform.positionX', 0, 0)

      // Call setClipTransform with recordKeyframeAt: 3.5s
      const stateAfter = setClipTransform(
        state,
        'clip-v2',
        { positionX: 25.0, scale: 150 },
        { recordKeyframeAt: 3.5 },
      )

      const clipAfter = stateAfter.editorModel.timelines[0].clips[0]
      // positionX gets keyframed at t=3.5
      const posXTrack = clipAfter.keyframes?.find(k => k.property === 'transform.positionX')
      expect(posXTrack?.points).toHaveLength(2)
      expect(posXTrack?.points[1]).toEqual({ t: 3.5, value: 25.0, easing: 'linear' })
      // scale was not previously keyframed, so it updates transform without creating a scale keyframe track
      expect(clipAfter.transform?.scale).toBe(150)
    })

    it('manages cropMode state in session UI', () => {
      const timeline = {
        ...createDefaultTimeline('Main'),
        id: 'tl-3',
      }
      let state = createInitialEditorState({
        assets: [],
        bins: {},
        timelines: [timeline],
        activeTimelineId: 'tl-3',
      })

      expect(selectCropMode(state)).toBe(false)
      state = setCropMode(state, true)
      expect(selectCropMode(state)).toBe(true)
      state = toggleCropMode(state)
      expect(selectCropMode(state)).toBe(false)
    })
  })

})

