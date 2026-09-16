import { describe, it, expect } from 'vitest'
import {
  FILTER_REGISTRY,
  FILTER_CATEGORIES,
  getFilterDefinition,
  getFiltersByCategory,
} from '../src/filters'
import { migrateClip, getClipEffectStyles } from '../src/video-editor-utils'
import { addFilterClip } from '../src/editor-actions'
import { createInitialEditorState } from '../src/editor-state'
import { selectClips, selectTracks } from '../src/editor-selectors'
import type { TimelineClip } from '../src/project-model'

describe('Sprint F1: Filter Registry and Migration', () => {
  it('contains at least 12 production filter definitions', () => {
    expect(FILTER_REGISTRY.length).toBeGreaterThanOrEqual(12)
    expect(FILTER_CATEGORIES.length).toBeGreaterThanOrEqual(6)
    for (const filter of FILTER_REGISTRY) {
      expect(filter.id).toBeTruthy()
      expect(filter.name).toBeTruthy()
      expect(filter.category).toBeTruthy()
      expect(filter.lutFile.endsWith('.cube')).toBe(true)
      expect(filter.defaultIntensity).toBe(100)
    }
  })

  it('provides category lookups correctly', () => {
    const all = getFiltersByCategory('all')
    expect(all.length).toBe(FILTER_REGISTRY.length)

    const cinematic = getFiltersByCategory('cinematic')
    expect(cinematic.length).toBeGreaterThan(0)
    expect(cinematic.every(f => f.category === 'cinematic')).toBe(true)

    const film = getFiltersByCategory('film')
    expect(film.length).toBeGreaterThan(0)
    expect(film.every(f => f.category === 'film')).toBe(true)
  })

  it('finds filter definition by id', () => {
    const tealOrange = getFilterDefinition('cine-teal-orange')
    expect(tealOrange).toBeDefined()
    expect(tealOrange?.name).toBe('Cine Teal & Orange')
    expect(tealOrange?.category).toBe('cinematic')

    expect(getFilterDefinition('non-existent')).toBeUndefined()
  })

  it('migrates legacy lut-* effects to 3D clip.filter', () => {
    const legacyClip: TimelineClip = {
      id: 'clip-legacy-1',
      assetId: 'asset-1',
      type: 'video',
      startTime: 0,
      duration: 5,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      reversed: false,
      muted: false,
      volume: 1,
      trackIndex: 0,
      asset: null,
      flipH: false,
      flipV: false,
      transitionIn: { type: 'none', duration: 0.5 },
      transitionOut: { type: 'none', duration: 0.5 },
      colorCorrection: {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        temperature: 0,
        tint: 0,
        exposure: 0,
        highlights: 0,
        shadows: 0,
      },
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
      opacity: 100,
      effects: [
        {
          id: 'fx-1',
          type: 'lut-cinematic' as any,
          enabled: true,
          params: { intensity: 85 },
        },
        {
          id: 'fx-2',
          type: 'blur',
          enabled: true,
          params: { amount: 5 },
        },
      ],
    }

    const migrated = migrateClip(legacyClip)
    expect(migrated.filter).toBeDefined()
    expect(migrated.filter?.id).toBe('cine-teal-orange')
    expect(migrated.filter?.intensity).toBe(85)

    // Legacy lut effect is removed, blur is kept
    expect(migrated.effects?.length).toBe(1)
    expect(migrated.effects?.[0].type).toBe('blur')
  })

  it('migrates all 7 legacy lut-* effects correctly', () => {
    const mappings: Record<string, string> = {
      'lut-cinematic': 'cine-teal-orange',
      'lut-vintage': 'vintage-kodachrome',
      'lut-bw': 'noir-bw',
      'lut-cool': 'cold-winter',
      'lut-warm': 'warm-sunset',
      'lut-muted': 'film-classic',
      'lut-vivid': 'golden-hour',
    }

    for (const [legacyType, expectedId] of Object.entries(mappings)) {
      const clip = migrateClip({
        id: `clip-${legacyType}`,
        type: 'video',
        startTime: 0,
        duration: 5,
        trackIndex: 0,
        effects: [
          {
            id: `fx-${legacyType}`,
            type: legacyType as any,
            enabled: true,
            params: { intensity: 65 },
          },
        ],
      } as any)

      expect(clip.filter?.id).toBe(expectedId)
      expect(clip.filter?.intensity).toBe(65)
      expect(clip.effects).toEqual([])
    }
  })

  it('parses legacy clip JSON via timelineClipSchema and automatically converts lut-* to filter', async () => {
    const { timelineClipSchema } = await import('../src/project-model')
    const rawLegacyJson = {
      id: 'legacy-clip-json',
      assetId: 'asset-1',
      asset: null,
      type: 'video',
      startTime: 0,
      duration: 10,
      trimStart: 0,
      trimEnd: 0,
      trackIndex: 0,
      effects: [
        {
          id: 'fx-old',
          type: 'lut-vintage',
          enabled: true,
          params: { intensity: 70 },
        },
      ],
    }

    const parsed = timelineClipSchema.parse(rawLegacyJson)
    expect(parsed.filter).toEqual({ id: 'vintage-kodachrome', intensity: 70 })
    expect(parsed.effects).toEqual([])
  })

  it('preserves existing clip.filter without overwriting during migration', () => {
    const modernClip: TimelineClip = {
      id: 'clip-modern-1',
      assetId: 'asset-1',
      type: 'video',
      startTime: 0,
      duration: 5,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      reversed: false,
      muted: false,
      volume: 1,
      trackIndex: 0,
      asset: null,
      flipH: false,
      flipV: false,
      transitionIn: { type: 'none', duration: 0.5 },
      transitionOut: { type: 'none', duration: 0.5 },
      colorCorrection: {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        temperature: 0,
        tint: 0,
        exposure: 0,
        highlights: 0,
        shadows: 0,
      },
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
      opacity: 100,
      filter: { id: 'golden-hour', intensity: 75 },
    }

    const migrated = migrateClip(modernClip)
    expect(migrated.filter).toEqual({ id: 'golden-hour', intensity: 75 })
  })

  it('computes CSS filter styles from clip.filter in getClipEffectStyles', () => {
    const clipWithFilter = migrateClip({
      id: 'clip-filter-1',
      assetId: null,
      type: 'adjustment',
      startTime: 0,
      duration: 10,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      reversed: false,
      muted: false,
      volume: 1,
      trackIndex: 0,
      asset: null,
      filter: { id: 'cine-teal-orange', intensity: 100 },
    } as any)
    const styles = getClipEffectStyles(clipWithFilter)
    expect(styles.filter).toBeDefined()
    expect(styles.filter).toContain('contrast')
    expect(styles.filter).toContain('saturate')
    expect(styles.filter).toContain('sepia')
  })

  it('adds filter clip to timeline as an adjustment clip at time 0', () => {
    const timeline = {
      id: 'timeline-1',
      name: 'Main Timeline',
      createdAt: Date.now(),
      tracks: [
        { id: 'v1', kind: 'video' as const, name: 'V1', locked: false, muted: false },
      ],
      clips: [],
      subtitles: [],
    }
    const state = createInitialEditorState({
      timelines: [timeline],
      activeTimelineId: 'timeline-1',
      assets: [],
      bins: {},
    })

    const nextState = addFilterClip(state, {
      filterId: 'cine-teal-orange',
      intensity: 80,
    })

    const clips = selectClips(nextState)
    expect(clips.length).toBe(1)
    const filterClip = clips[0]
    expect(filterClip.type).toBe('adjustment')
    expect(filterClip.startTime).toBe(0)
    expect(filterClip.trackIndex).toBe(1) // Created V2 and placed on top!
    expect(filterClip.filter).toEqual({ id: 'cine-teal-orange', intensity: 80 })
    expect(filterClip.importedName).toBe('Filter: Cine Teal & Orange')
  })

  it('never places filter clip on main track V1 even if trackIndex 0 is requested', () => {
    const timeline = {
      id: 'timeline-1',
      name: 'Main Timeline',
      createdAt: Date.now(),
      tracks: [
        { id: 'v1', kind: 'video' as const, name: 'V1', locked: false, muted: false },
      ],
      clips: [],
      subtitles: [],
    }
    const state = createInitialEditorState({
      timelines: [timeline],
      activeTimelineId: 'timeline-1',
      assets: [],
      bins: {},
    })

    const nextState = addFilterClip(state, {
      filterId: 'vintage-kodachrome',
      trackIndex: 0, // Dropped on track 0 / main video
    })

    const clips = selectClips(nextState)
    expect(clips[0].trackIndex).toBe(1) // Redirected to V2 layer on top
  })

  it('creates a new topmost track if the existing overlay track is already occupied', () => {
    const timeline = {
      id: 'timeline-1',
      name: 'Main Timeline',
      createdAt: Date.now(),
      tracks: [
        { id: 'v1', kind: 'video' as const, name: 'V1', locked: false, muted: false },
        { id: 'v2', kind: 'video' as const, name: 'V2', locked: false, muted: false },
      ],
      clips: [
        {
          id: 'clip-1',
          type: 'video' as const,
          startTime: 0,
          duration: 5,
          trimStart: 0,
          trimEnd: 0,
          speed: 1,
          reversed: false,
          muted: false,
          volume: 1,
          trackIndex: 1, // V2 is occupied
          assetId: 'a1',
        },
      ],
      subtitles: [],
    }
    const state = createInitialEditorState({
      timelines: [timeline as any],
      activeTimelineId: 'timeline-1',
      assets: [],
      bins: {},
    })

    const nextState = addFilterClip(state, {
      filterId: 'golden-hour',
    })

    const tracks = selectTracks(nextState)
    expect(tracks.length).toBe(3) // Created V3 on top
    const filterClip = selectClips(nextState).find(c => c.type === 'adjustment')
    expect(filterClip?.trackIndex).toBe(2) // Placed on V3 (index 2)
  })
})
