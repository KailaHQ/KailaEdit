import { describe, it, expect } from 'vitest'
import {
  timelineSummary,
  qcCheck,
  timelineClipSchema,
  computeAutoMatteFingerprint,
  type Timeline,
  type TimelineClip,
  type SubtitleClip,
  type Track,
} from '../src/index'

function makeClip(overrides: Partial<TimelineClip> & { id: string; trackIndex: number; startTime: number; duration: number; mediaPath?: string; name?: string }): TimelineClip {
  const { duration, mediaPath } = overrides
  const asset = overrides.asset !== undefined
    ? overrides.asset
    : (mediaPath ? {
        id: overrides.assetId || `asset-${overrides.id}`,
        type: 'video' as const,
        path: mediaPath,
        createdAt: Date.now(),
        prompt: '',
        resolution: '',
      } : null)

  return timelineClipSchema.parse({
    trimStart: 0,
    trimEnd: duration,
    type: 'video',
    assetId: null,
    asset,
    importedName: overrides.name,
    ...overrides,
  })
}

function createMockTimeline(overrides?: Partial<Timeline>): Timeline {
  return {
    id: 'tl-1',
    name: 'Main Timeline',
    createdAt: Date.now(),
    tracks: [
      { id: 'track-v1', name: 'V1', muted: false, locked: false, kind: 'video' },
      { id: 'track-a1', name: 'A1', muted: false, locked: false, kind: 'audio' },
    ],
    clips: [],
    subtitles: [],
    ...overrides,
  }
}

describe('S3-3 · timeline.summary và qc.check', () => {
  describe('timelineSummary', () => {
    it('summarizes a 500-clip timeline within <= 16KB', () => {
      const tracks: Track[] = [
        { id: 'track-v1', name: 'V1', muted: false, locked: false, kind: 'video' },
        { id: 'track-a1', name: 'A1', muted: false, locked: false, kind: 'audio' },
      ]

      const clips: TimelineClip[] = []
      for (let i = 0; i < 500; i++) {
        clips.push(makeClip({
          id: `clip-${i}`,
          assetId: `asset-${i % 10}`,
          trackIndex: i % 2,
          startTime: i * 2.0,
          duration: 2.0,
          type: i % 2 === 0 ? 'video' : 'audio',
          mediaPath: `/path/to/media_${i}.mp4`,
          name: `Shot_${i}`,
        } as any))
      }

      const timeline = createMockTimeline({ tracks, clips })
      const summary = timelineSummary(timeline, { maxBytes: 16 * 1024 })

      expect(summary.clipCount).toBe(500)
      expect(summary.byteSize).toBeLessThanOrEqual(16 * 1024)
      expect(Buffer.byteLength(summary.text, 'utf8')).toBeLessThanOrEqual(16 * 1024)
    })

    it('contains sufficient information to reconstruct clip order and timing (round-trip test)', () => {
      const tracks: Track[] = [
        { id: 'track-v1', name: 'V1', muted: false, locked: false, kind: 'video' },
        { id: 'track-a1', name: 'A1', muted: false, locked: false, kind: 'audio' },
      ]

      const originalClips: TimelineClip[] = [
        makeClip({
          id: 'c1',
          trackIndex: 0,
          startTime: 0,
          duration: 5,
          mediaPath: '/media/c1.mp4',
          name: 'Intro',
        } as any),
        makeClip({
          id: 'c2',
          trackIndex: 0,
          startTime: 5,
          duration: 10,
          mediaPath: '/media/c2.mp4',
          name: 'Main',
        } as any),
        makeClip({
          id: 'a1',
          trackIndex: 1,
          startTime: 0,
          duration: 15,
          type: 'audio',
          mediaPath: '/media/music.mp3',
          name: 'BGM',
        } as any),
      ]

      const timeline = createMockTimeline({ tracks, clips: originalClips })
      const summary = timelineSummary(timeline)

      expect(summary.trackCount).toBe(2)
      expect(summary.clipCount).toBe(3)
      expect(summary.duration).toBe(15)

      // Reconstruct clips from track summaries
      const reconstructed: Array<{ id: string; start: number; end: number; trackIndex: number }> = []
      for (const t of summary.tracks) {
        for (const c of t.clips) {
          reconstructed.push({
            id: c.id,
            start: c.start,
            end: c.end,
            trackIndex: c.trackIndex,
          })
        }
      }

      expect(reconstructed).toHaveLength(3)
      // Check V1 clips
      const v1Clips = reconstructed.filter(c => c.trackIndex === 0)
      expect(v1Clips[0]).toEqual({ id: 'c1', start: 0, end: 5, trackIndex: 0 })
      expect(v1Clips[1]).toEqual({ id: 'c2', start: 5, end: 15, trackIndex: 0 })
      // Check A1 clip
      const a1Clips = reconstructed.filter(c => c.trackIndex === 1)
      expect(a1Clips[0]).toEqual({ id: 'a1', start: 0, end: 15, trackIndex: 1 })
    })
  })

  describe('qcCheck', () => {
    it('returns empty array when timeline is completely clean', () => {
      const cleanTimeline = createMockTimeline({
        tracks: [
          { id: 'track-v1', name: 'V1', muted: false, locked: false, kind: 'video' },
          { id: 'track-a1', name: 'A1', muted: false, locked: false, kind: 'audio' },
        ],
        clips: [
          makeClip({
            id: 'c1',
            trackIndex: 0,
            startTime: 0,
            duration: 5,
            mediaPath: '/valid/media.mp4',
            name: 'Valid Clip',
          } as any),
        ],
      })

      const issues = qcCheck(cleanTimeline, { fileExists: () => true })
      expect(issues).toEqual([])
    })

    it('detects orphan clips referencing non-existent track index', () => {
      const timeline = createMockTimeline({
        tracks: [{ id: 'track-v1', name: 'V1', muted: false, locked: false, kind: 'video' }],
        clips: [
          makeClip({
            id: 'orphan-1',
            trackIndex: 99, // Only 1 track exists (index 0)
            startTime: 0,
            duration: 2,
            mediaPath: '/valid/path.mp4',
          } as any),
        ],
      })

      const issues = qcCheck(timeline)
      expect(issues.some(i => i.type === 'ORPHAN_CLIP' && i.clipId === 'orphan-1')).toBe(true)
    })

    it('detects missing media files', () => {
      const timeline = createMockTimeline({
        tracks: [{ id: 'track-v1', name: 'V1', muted: false, locked: false, kind: 'video' }],
        clips: [
          makeClip({
            id: 'missing-path',
            trackIndex: 0,
            startTime: 0,
            duration: 2,
            mediaPath: '', // Empty path
          } as any),
          makeClip({
            id: 'nonexistent-disk',
            trackIndex: 0,
            startTime: 2,
            duration: 2,
            mediaPath: '/disk/missing.mp4',
          } as any),
        ],
      })

      const issues = qcCheck(timeline, {
        fileExists: p => p !== '/disk/missing.mp4',
      })

      const missing = issues.filter(i => i.type === 'MISSING_MEDIA')
      expect(missing).toHaveLength(2)
      expect(missing.some(i => i.clipId === 'missing-path')).toBe(true)
      expect(missing.some(i => i.clipId === 'nonexistent-disk')).toBe(true)
    })

    it('detects unusually short clips (< 0.5s duration)', () => {
      const timeline = createMockTimeline({
        tracks: [{ id: 'track-v1', name: 'V1', muted: false, locked: false, kind: 'video' }],
        clips: [
          makeClip({
            id: 'too-short',
            trackIndex: 0,
            startTime: 0,
            duration: 0.2, // 0.2s duration < 0.5s
            mediaPath: '/media/video.mp4',
          } as any),
        ],
      })

      const issues = qcCheck(timeline)
      const shortIssues = issues.filter(i => i.type === 'UNUSUALLY_SHORT_CLIP')
      expect(shortIssues).toHaveLength(1)
      expect(shortIssues[0].clipId).toBe('too-short')
      expect(shortIssues[0].severity).toBe('warning')
    })

    it('detects gaps on overlay tracks', () => {
      const timeline = createMockTimeline({
        tracks: [
          { id: 'track-v1', name: 'V1', muted: false, locked: false, kind: 'video' },
          { id: 'track-v2', name: 'V2', muted: false, locked: false, kind: 'video' }, // Overlay track
        ],
        clips: [
          makeClip({
            id: 'base-1',
            trackIndex: 0,
            startTime: 0,
            duration: 10,
            mediaPath: '/media/base.mp4',
          } as any),
          makeClip({
            id: 'overlay-1',
            trackIndex: 1,
            startTime: 2, // Gap between 0 and 2 on overlay track
            duration: 3,
            mediaPath: '/media/broll.mp4',
          } as any),
          makeClip({
            id: 'overlay-2',
            trackIndex: 1,
            startTime: 7, // Gap between 5 and 7 on overlay track
            duration: 2,
            mediaPath: '/media/broll2.mp4',
          } as any),
        ],
      })

      const issues = qcCheck(timeline)
      const overlayGapIssues = issues.filter(i => i.type === 'OVERLAY_GAP')
      expect(overlayGapIssues.length).toBeGreaterThan(0)
      expect(overlayGapIssues[0].trackIndex).toBe(1)
    })

    it('detects overlapping subtitle clips', () => {
      const subtitles: SubtitleClip[] = [
        {
          id: 'sub-1',
          text: 'Hello world',
          startTime: 1.0,
          endTime: 4.0,
          trackIndex: 0,
        },
        {
          id: 'sub-2',
          text: 'Overlapping text',
          startTime: 3.0, // Overlaps with sub-1 (3.0 < 4.0)
          endTime: 6.0,
          trackIndex: 0,
        },
      ]

      const timeline = createMockTimeline({ subtitles })

      const issues = qcCheck(timeline)
      const subOverlap = issues.filter(i => i.type === 'SUBTITLE_OVERLAP')
      expect(subOverlap).toHaveLength(1)
      expect(subOverlap[0].clipIds).toEqual(['sub-1', 'sub-2'])
      expect(subOverlap[0].severity).toBe('error')
    })

    it('detects invalid or 0% intensity filters on clips', () => {
      const clips: TimelineClip[] = [
        makeClip({
          id: 'c-valid',
          trackIndex: 0,
          startTime: 0,
          duration: 5,
          mediaPath: '/media/valid.mp4',
          filter: { id: 'cine-teal-orange', intensity: 80 },
        } as any),
        makeClip({
          id: 'c-unknown-filter',
          trackIndex: 0,
          startTime: 5,
          duration: 5,
          mediaPath: '/media/unknown.mp4',
          filter: { id: 'non-existent-filter-id', intensity: 80 },
        } as any),
        makeClip({
          id: 'c-zero-filter',
          trackIndex: 0,
          startTime: 10,
          duration: 5,
          mediaPath: '/media/zero.mp4',
          filter: { id: 'film-classic', intensity: 0 },
        } as any),
      ]

      const timeline = createMockTimeline({ clips })

      // Check timelineSummary includes filter info
      const summary = timelineSummary(timeline)
      expect(summary.tracks[0].clips[0].filter).toEqual({ id: 'cine-teal-orange', intensity: 80 })
      expect(summary.text).toContain('{filter: cine-teal-orange@80%}')

      // Check qcCheck reports invalid and 0% intensity filters
      const issues = qcCheck(timeline)
      const filterIssues = issues.filter(i => i.type === 'INVALID_FILTER')
      expect(filterIssues).toHaveLength(2)

      const errorIssue = filterIssues.find(i => i.severity === 'error')
      expect(errorIssue?.clipId).toBe('c-unknown-filter')
      expect(errorIssue?.message).toContain('references unknown filter ID')

      const warnIssue = filterIssues.find(i => i.severity === 'warning')
      expect(warnIssue?.clipId).toBe('c-zero-filter')
      expect(warnIssue?.message).toContain('0% intensity')
    })

    it('detects invalid keyframes: single point warning, out-of-bounds time, and out-of-bounds value (KE-205)', () => {
      const clips: TimelineClip[] = [
        // 1. Valid keyframed clip
        makeClip({
          id: 'c-valid-kf',
          trackIndex: 0,
          startTime: 0,
          duration: 5,
          mediaPath: '/media/valid.mp4',
          keyframes: [
            {
              property: 'transform.scale',
              points: [
                { t: 0, value: 100, easing: 'linear' },
                { t: 5, value: 150, easing: 'linear' },
              ],
            },
          ],
        } as any),
        // 2. Single keyframe point warning
        makeClip({
          id: 'c-single-kf',
          trackIndex: 0,
          startTime: 5,
          duration: 5,
          mediaPath: '/media/single.mp4',
          keyframes: [
            {
              property: 'opacity',
              points: [{ t: 2, value: 80, easing: 'linear' }],
            },
          ],
        } as any),
        // 3. Time out of bounds error (t > duration)
        makeClip({
          id: 'c-oob-time',
          trackIndex: 0,
          startTime: 10,
          duration: 5,
          mediaPath: '/media/oob-time.mp4',
          keyframes: [
            {
              property: 'volume',
              points: [
                { t: 0, value: 1, easing: 'linear' },
                { t: 10, value: 0.5, easing: 'linear' }, // 10s > duration 5s
              ],
            },
          ],
        } as any),
        // 4. Value out of bounds error (opacity 150 > 100, scale -10 < 0)
        makeClip({
          id: 'c-oob-value',
          trackIndex: 0,
          startTime: 15,
          duration: 5,
          mediaPath: '/media/oob-value.mp4',
          keyframes: [
            {
              property: 'opacity',
              points: [
                { t: 0, value: 0, easing: 'linear' },
                { t: 2, value: 150, easing: 'linear' }, // > 100
              ],
            },
            {
              property: 'transform.scale',
              points: [
                { t: 0, value: 100, easing: 'linear' },
                { t: 2, value: -20, easing: 'linear' }, // < 0
              ],
            },
          ],
        } as any),
      ]

      const timeline = createMockTimeline({ clips })
      const issues = qcCheck(timeline)
      const kfIssues = issues.filter(i => i.type === 'INVALID_KEYFRAME')

      // Check single point warning
      const singleIssue = kfIssues.find(i => i.clipId === 'c-single-kf')
      expect(singleIssue).toBeDefined()
      expect(singleIssue?.severity).toBe('warning')
      expect(singleIssue?.message).toContain('only 1 keyframe point')

      // Check time out of bounds error
      const timeIssue = kfIssues.find(i => i.clipId === 'c-oob-time')
      expect(timeIssue).toBeDefined()
      expect(timeIssue?.severity).toBe('error')
      expect(timeIssue?.message).toContain('outside clip duration')

      // Check value out of bounds errors
      const valueIssues = kfIssues.filter(i => i.clipId === 'c-oob-value')
      expect(valueIssues).toHaveLength(2)
      expect(valueIssues.some(i => i.message.includes('opacity keyframe value 150'))).toBe(true)
      expect(valueIssues.some(i => i.message.includes('scale keyframe value -20'))).toBe(true)

      // c-valid-kf has no keyframe issues
      expect(kfIssues.find(i => i.clipId === 'c-valid-kf')).toBeUndefined()
    })

    it('detects invalid chroma key configurations in qcCheck', () => {
      const clips = [
        makeClip({
          id: 'c-valid-chroma',
          trackIndex: 0,
          startTime: 0,
          duration: 3,
          mediaPath: '/path/to/media.mp4',
          chromaKey: {
            enabled: true,
            color: '#00FF00',
            similarity: 30,
            smoothness: 10,
            spill: 50,
          },
        } as any),
        makeClip({
          id: 'c-invalid-color',
          trackIndex: 0,
          startTime: 3,
          duration: 3,
          mediaPath: '/path/to/media.mp4',
          chromaKey: {
            enabled: true,
            color: 'not-a-hex',
            similarity: 30,
            smoothness: 10,
            spill: 50,
          },
        } as any),
        makeClip({
          id: 'c-zero-sim',
          trackIndex: 0,
          startTime: 6,
          duration: 3,
          mediaPath: '/path/to/media.mp4',
          chromaKey: {
            enabled: true,
            color: '#0000FF',
            similarity: 0,
            smoothness: 10,
            spill: 50,
          },
        } as any),
      ]

      const timeline = createMockTimeline({ clips })
      const issues = qcCheck(timeline)
      const chromaIssues = issues.filter(i => i.type === 'INVALID_CHROMA_KEY')

      expect(chromaIssues.find(i => i.clipId === 'c-valid-chroma')).toBeUndefined()

      const colorIssue = chromaIssues.find(i => i.clipId === 'c-invalid-color')
      expect(colorIssue).toBeDefined()
      expect(colorIssue?.severity).toBe('error')
      expect(colorIssue?.message).toContain('invalid chroma key color')

      const simIssue = chromaIssues.find(i => i.clipId === 'c-zero-sim')
      expect(simIssue).toBeDefined()
      expect(simIssue?.severity).toBe('warning')
      expect(simIssue?.message).toContain('similarity at 0%')
    })

    it('detects unbaked auto matte and invalid stroke configurations in qcCheck', () => {
      // A bake belongs to a stretch of media, not to the clip that asked for it, so the
      // record carries the range it covers and QC checks that the clip fits inside it.
      const validFp = computeAutoMatteFingerprint({
        assetKey: '/path/to/media.mp4',
        trimStart: 0,
        duration: 3,
        speed: 1,
        reversed: false,
        model: 'rvm-mobilenetv3',
        quality: 'standard',
      })

      const clips = [
        makeClip({
          id: 'c-baked',
          assetId: 'asset-c-baked',
          trackIndex: 0,
          startTime: 0,
          duration: 3,
          mediaPath: '/path/to/media.mp4',
          autoMatte: {
            enabled: true,
            model: 'rvm-mobilenetv3',
            quality: 'standard',
            featherEdge: 0,
            cleanEdge: 0,
            bake: {
              path: '/tmp/baked.mp4',
              fingerprint: validFp,
              frameCount: 90,
              createdAt: Date.now(),
              sourceStart: 0,
              sourceSpan: 3,
              speed: 1,
              reversed: false,
              model: 'rvm-mobilenetv3',
              quality: 'standard',
            },
          },
        } as any),
        makeClip({
          id: 'c-unbaked',
          assetId: 'asset-c-unbaked',
          trackIndex: 0,
          startTime: 3,
          duration: 3,
          mediaPath: '/path/to/media.mp4',
          autoMatte: {
            enabled: true,
            model: 'rvm-mobilenetv3',
            quality: 'standard',
            featherEdge: 0,
            cleanEdge: 0,
          },
        } as any),
        makeClip({
          id: 'c-fp-mismatch',
          assetId: 'asset-c-mismatch',
          trackIndex: 0,
          startTime: 6,
          duration: 3,
          mediaPath: '/path/to/media.mp4',
          autoMatte: {
            enabled: true,
            model: 'rvm-mobilenetv3',
            quality: 'standard',
            featherEdge: 0,
            cleanEdge: 0,
            bake: {
              path: '/tmp/old.mp4',
              fingerprint: 'stale-fingerprint',
              frameCount: 90,
              createdAt: Date.now(),
            },
          },
        } as any),
        makeClip({
          id: 'c-valid-stroke',
          trackIndex: 0,
          startTime: 9,
          duration: 3,
          mediaPath: '/path/to/media.mp4',
          stroke: {
            enabled: true,
            style: 'solid',
            color: '#FF0000',
            width: 10,
            opacity: 100,
          },
        } as any),
        makeClip({
          id: 'c-invalid-stroke-color',
          trackIndex: 0,
          startTime: 12,
          duration: 3,
          mediaPath: '/path/to/media.mp4',
          stroke: {
            enabled: true,
            style: 'solid',
            color: 'not-hex',
            width: 10,
            opacity: 100,
          },
        } as any),
        makeClip({
          id: 'c-zero-stroke-width',
          trackIndex: 0,
          startTime: 15,
          duration: 3,
          mediaPath: '/path/to/media.mp4',
          stroke: {
            enabled: true,
            style: 'dotted',
            color: '#00FF00',
            width: 0,
            opacity: 100,
          },
        } as any),
      ]

      const timeline = createMockTimeline({ clips })
      const issues = qcCheck(timeline)

      const matteIssues = issues.filter(i => i.type === 'AUTO_MATTE_NOT_BAKED')
      expect(matteIssues.find(i => i.clipId === 'c-baked')).toBeUndefined()
      expect(matteIssues.find(i => i.clipId === 'c-unbaked')).toBeDefined()
      expect(matteIssues.find(i => i.clipId === 'c-unbaked')?.severity).toBe('warning')
      expect(matteIssues.find(i => i.clipId === 'c-fp-mismatch')).toBeDefined()
      expect(matteIssues.find(i => i.clipId === 'c-fp-mismatch')?.message).toContain('not baked or fingerprint is mismatched')

      const strokeIssues = issues.filter(i => i.type === 'INVALID_STROKE')
      expect(strokeIssues.find(i => i.clipId === 'c-valid-stroke')).toBeUndefined()
      const colorIssue = strokeIssues.find(i => i.clipId === 'c-invalid-stroke-color')
      expect(colorIssue).toBeDefined()
      expect(colorIssue?.severity).toBe('error')
      expect(colorIssue?.message).toContain('invalid stroke color')

      const widthIssue = strokeIssues.find(i => i.clipId === 'c-zero-stroke-width')
      expect(widthIssue).toBeDefined()
      expect(widthIssue?.severity).toBe('warning')
      expect(widthIssue?.message).toContain('stroke width at 0%')
    })
  })
})

