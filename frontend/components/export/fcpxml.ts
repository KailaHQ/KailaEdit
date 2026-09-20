import type { TimelineClip, Track } from '../../types/project-model'

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Generate FCPXML for Premiere / DaVinci
 */
export function generateFCPXML(
  clips: TimelineClip[],
  tracks: Track[],
  projectName: string,
  timelineName: string,
  fps: number = 24
): string {
  const frameDuration = `${Math.round(100 * fps)}/${100 * fps}s`
  const totalDuration = clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0)
  const totalFrames = Math.ceil(totalDuration * fps)

  const assetEntries: string[] = []
  const seenAssets = new Set<string>()
  for (const clip of clips) {
    const assetId = clip.assetId || clip.id
    if (seenAssets.has(assetId)) continue
    seenAssets.add(assetId)

    const assetPath = clip.asset?.path || ''
    const dur = clip.asset?.duration || clip.duration
    const durFrames = Math.ceil(dur * fps)
    const format = clip.type === 'audio' ? 'audio' : 'video'

    assetEntries.push(
      `        <asset id="${escapeXml(assetId)}" name="${escapeXml(clip.asset?.prompt?.slice(0, 60) || clip.importedName || 'Clip')}" src="${escapeXml(assetPath)}" start="0s" duration="${durFrames}/${fps}s" hasVideo="${format === 'video' ? '1' : '0'}" hasAudio="1" format="r1" />`
    )
  }

  const trackGroups: Map<number, TimelineClip[]> = new Map()
  for (const clip of clips) {
    if (!trackGroups.has(clip.trackIndex)) trackGroups.set(clip.trackIndex, [])
    trackGroups.get(clip.trackIndex)!.push(clip)
  }

  const laneXml: string[] = []
  const sortedTrackIndices = [...trackGroups.keys()].sort((a, b) => a - b)
  
  for (const trackIdx of sortedTrackIndices) {
    const trackClips = trackGroups.get(trackIdx)!.sort((a, b) => a.startTime - b.startTime)
    const clipElements: string[] = []
    
    for (const clip of trackClips) {
      const assetId = clip.assetId || clip.id
      const startFrame = Math.round(clip.startTime * fps)
      const durFrames = Math.round(clip.duration * fps)
      const trimStartFrame = Math.round(clip.trimStart * fps)
      const name = clip.asset?.prompt?.slice(0, 60) || clip.importedName || 'Clip'

      let clipXml = `            <asset-clip ref="${escapeXml(assetId)}" name="${escapeXml(name)}" offset="${startFrame}/${fps}s" duration="${durFrames}/${fps}s" start="${trimStartFrame}/${fps}s"`
      if (clip.speed !== 1) {
        clipXml += ` tcFormat="NDF"`
      }
      clipXml += ` />`
      clipElements.push(clipXml)
    }

    const trackName = tracks[trackIdx]?.name || `Track ${trackIdx + 1}`
    laneXml.push(
      `          <!-- ${escapeXml(trackName)} -->\n` +
      clipElements.join('\n')
    )
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="FFVideoFormat${fps === 24 ? '1080p2398' : '1080p' + fps}" frameDuration="${frameDuration}" width="1920" height="1080" />
${assetEntries.join('\n')}
  </resources>
  <library>
    <event name="${escapeXml(projectName)}">
      <project name="${escapeXml(timelineName)}">
        <sequence format="r1" duration="${totalFrames}/${fps}s" tcStart="0s" tcFormat="NDF">
          <spine>
${laneXml.join('\n')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`
}
