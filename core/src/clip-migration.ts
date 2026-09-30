import type { TimelineClip, Track } from './project-model'
import { DEFAULT_CLIP_TRANSFORM, DEFAULT_COLOR_CORRECTION } from './project-model'

/** Migrate old clips that don't have new effect fields */
export function migrateClip(clip: TimelineClip): TimelineClip {
  let filter = clip.filter
  let effects = clip.effects

  // Migrate legacy lut-* effects to 3D clip.filter
  if (effects) {
    const legacyLut = effects.find((fx: any) => typeof fx?.type === 'string' && fx.type.startsWith('lut-') && fx.enabled)
    if (!filter && legacyLut) {
      const mapping: Record<string, string> = {
        'lut-cinematic': 'cine-teal-orange',
        'lut-vintage': 'vintage-kodachrome',
        'lut-bw': 'noir-bw',
        'lut-cool': 'cold-winter',
        'lut-warm': 'warm-sunset',
        'lut-muted': 'film-classic',
        'lut-vivid': 'golden-hour',
      }
      const mappedId = mapping[legacyLut.type] || 'cine-teal-orange'
      filter = {
        id: mappedId,
        intensity: legacyLut.params?.intensity ?? 100,
      }
    }
    effects = effects.filter((fx: any) => typeof fx?.type !== 'string' || !fx.type.startsWith('lut-'))
  }

  return {
    ...clip,
    flipH: clip.flipH ?? false,
    flipV: clip.flipV ?? false,
    transitionIn: clip.transitionIn ?? { type: 'none', duration: 0.5 },
    transitionOut: clip.transitionOut ?? { type: 'none', duration: 0.5 },
    colorCorrection: clip.colorCorrection ?? { ...DEFAULT_COLOR_CORRECTION },
    transform: clip.transform ?? { ...DEFAULT_CLIP_TRANSFORM },
    opacity: clip.opacity ?? 100,
    filter,
    effects,
  }
}

/**
 * Migrate tracks from old format (no kind) to new NLE layout.
 * Heuristic: if a track has no `kind`, infer from its name or position.
 */
export function migrateTracks(tracks: Track[]): Track[] {
  return tracks.map(t => {
    if (t.kind) return t
    if (t.type === 'subtitle') return t
    if (/^A\d/i.test(t.name)) return { ...t, kind: 'audio' as const }
    if (/^V\d/i.test(t.name)) return { ...t, kind: 'video' as const }
    return { ...t, kind: 'video' as const }
  })
}
