import type { Project, Asset } from './project-model'

/**
 * Resolves the representative asset for a project's thumbnail card on the Home screen.
 * Strictly prioritizes the first video clip on Track 1 (V1) (earliest startTime / frame 1).
 * Never selects internal sticker assets as a project thumbnail.
 */
export function getProjectThumbnailAsset(project: Project): Asset | null {
  const activeTimeline = project.timelines?.find(t => t.id === project.activeTimelineId) || project.timelines?.[0]

  if (activeTimeline) {
    const v1Index = activeTimeline.tracks
      ? activeTimeline.tracks.findIndex(
          track => track.kind === 'video' && track.type !== 'subtitle' && (track.id === 'track-v1' || track.name === 'V1' || track.sourcePatched),
        )
      : 0
    const targetTrackIndex = v1Index >= 0 ? v1Index : 0

    // 1. First video clip on Track 1 (V1), ordered by startTime
    const v1VideoClips = (activeTimeline.clips || [])
      .filter(clip => {
        if (clip.trackIndex !== targetTrackIndex) return false
        const asset = clip.asset || project.assets?.find(a => a.id === clip.assetId)
        return clip.type === 'video' || asset?.type === 'video'
      })
      .sort((a, b) => a.startTime - b.startTime)

    if (v1VideoClips.length > 0) {
      const firstClip = v1VideoClips[0]
      const asset = firstClip.asset || project.assets?.find(a => a.id === firstClip.assetId)
      if (asset) return asset
    }

    // 2. Fallback: Any non-sticker visual clip on Track 1 (V1), ordered by startTime
    const v1VisualClips = (activeTimeline.clips || [])
      .filter(clip => {
        if (clip.trackIndex !== targetTrackIndex) return false
        const asset = clip.asset || project.assets?.find(a => a.id === clip.assetId)
        if (asset?.path?.startsWith('stickers/') || asset?.id?.startsWith('sticker-')) return false
        return clip.type === 'image' || clip.type === 'video' || asset?.type === 'image' || asset?.type === 'video'
      })
      .sort((a, b) => a.startTime - b.startTime)

    if (v1VisualClips.length > 0) {
      const firstClip = v1VisualClips[0]
      const asset = firstClip.asset || project.assets?.find(a => a.id === firstClip.assetId)
      if (asset) return asset
    }

    // 3. Fallback: Any video clip on any timeline track, ordered by startTime
    const anyVideoClips = (activeTimeline.clips || [])
      .filter(clip => {
        const asset = clip.asset || project.assets?.find(a => a.id === clip.assetId)
        return clip.type === 'video' || asset?.type === 'video'
      })
      .sort((a, b) => a.startTime - b.startTime)

    if (anyVideoClips.length > 0) {
      const firstClip = anyVideoClips[0]
      const asset = firstClip.asset || project.assets?.find(a => a.id === firstClip.assetId)
      if (asset) return asset
    }
  }

  // 4. Fallback: First video asset in project assets
  const videoAsset = project.assets?.find(a => a.type === 'video')
  if (videoAsset) return videoAsset

  // 5. Fallback: Non-sticker asset (in case of image-only project, but never stickers!)
  const nonStickerAsset = project.assets?.find(a => {
    if (a.path?.startsWith('stickers/') || a.id?.startsWith('sticker-')) return false
    return true
  })
  if (nonStickerAsset) return nonStickerAsset

  return null
}
