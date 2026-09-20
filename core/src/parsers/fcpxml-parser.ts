import {
  type ParsedTimeline,
  type ParsedMediaRef,
  type ParsedClip,
  type ParsedClipEffects,
  decodePathUrl,
  detectMediaType,
} from './import-helpers'

// ─── Helper: parse clip effects from FCPXML elements ─────────────────────
// FCPXML stores speed in <timeMap> or <conform-rate>, flips via <filter-video> transform,
// opacity as an attribute, etc.
export function parseFcpxmlClipEffects(el: Element): Partial<ParsedClipEffects> {
  const result: Partial<ParsedClipEffects> = {}

  // ── Enabled attribute (enabled="0" = muted/disabled) ──
  const enabled = el.getAttribute('enabled')
  if (enabled === '0') {
    result.muted = true
  }

  // ── Speed: check for <timeMap> with remapped speed ──
  const timeMap = el.querySelector(':scope > timeMap')
  if (timeMap) {
    const timepts = timeMap.querySelectorAll(':scope > timept')
    // Simple constant speed: 2 timepts → calculate speed ratio
    if (timepts.length >= 2) {
      const parseFcpxmlTimeLocal = (timeStr: string | null): number => {
        if (!timeStr) return 0
        const rational = timeStr.trim().match(/^(\d+)\/(\d+)s$/)
        if (rational) return parseInt(rational[1]) / parseInt(rational[2])
        const simple = timeStr.trim().match(/^([\d.]+)s$/)
        if (simple) return parseFloat(simple[1])
        return 0
      }
      const first = timepts[0]
      const last = timepts[timepts.length - 1]
      const srcDur = parseFcpxmlTimeLocal(last.getAttribute('time')) - parseFcpxmlTimeLocal(first.getAttribute('time'))
      const dstDur = parseFcpxmlTimeLocal(last.getAttribute('value')) - parseFcpxmlTimeLocal(first.getAttribute('value'))
      if (srcDur > 0 && dstDur > 0) {
        result.speed = dstDur / srcDur
      }
    }
  }

  // ── Speed: check for <conform-rate> ──
  const conformRate = el.querySelector(':scope > conform-rate')
  if (conformRate) {
    const scaleEnabled = conformRate.getAttribute('scaleEnabled')
    if (scaleEnabled === '1') {
      const srcFrameDur = conformRate.getAttribute('srcFrameDuration')
      const frameDur = conformRate.getAttribute('frameDuration')
      if (srcFrameDur && frameDur) {
        const parseFcpxmlTimeLocal = (timeStr: string): number => {
          const rational = timeStr.trim().match(/^(\d+)\/(\d+)s$/)
          if (rational) return parseInt(rational[1]) / parseInt(rational[2])
          const simple = timeStr.trim().match(/^([\d.]+)s$/)
          if (simple) return parseFloat(simple[1])
          return 0
        }
        const src = parseFcpxmlTimeLocal(srcFrameDur)
        const dst = parseFcpxmlTimeLocal(frameDur)
        if (src > 0 && dst > 0) {
          result.speed = src / dst
        }
      }
    }
  }

  // ── Flips and opacity: check <adjust-transform> ──
  const adjustTransform = el.querySelector(':scope > adjust-transform')
  if (adjustTransform) {
    // Flips: scaleX="-100" or scaleY="-100"
    const scaleX = parseFloat(adjustTransform.getAttribute('scaleX') || '100')
    const scaleY = parseFloat(adjustTransform.getAttribute('scaleY') || '100')
    if (scaleX < 0) result.flipH = true
    if (scaleY < 0) result.flipV = true
  }

  // ── Flips: check <filter-video> with "Flipped" or transform ──
  const filterVideos = el.querySelectorAll(':scope > filter-video')
  filterVideos.forEach(fv => {
    const filterName = (fv.getAttribute('name') || '').toLowerCase()
    const filterRef = (fv.getAttribute('ref') || '').toLowerCase()
    if (filterName.includes('flipped') || filterName.includes('flip') ||
        filterRef.includes('flip')) {
      // Check params for which axis
      const params = fv.querySelectorAll(':scope > param')
      let hasSpecificAxis = false
      params.forEach(p => {
        const pName = (p.getAttribute('name') || '').toLowerCase()
        if (pName.includes('horizontal') || pName.includes('horiz')) {
          result.flipH = true
          hasSpecificAxis = true
        }
        if (pName.includes('vertical') || pName.includes('vert')) {
          result.flipV = true
          hasSpecificAxis = true
        }
      })
      // If no specific axis param found, assume horizontal flip
      if (!hasSpecificAxis) result.flipH = true
    }
  })

  // ── Opacity: check <adjust-blend> ──
  const adjustBlend = el.querySelector(':scope > adjust-blend')
  if (adjustBlend) {
    const amount = adjustBlend.getAttribute('amount')
    if (amount) {
      const opacityVal = parseFloat(amount) * 100 // FCPXML uses 0-1 range
      if (!isNaN(opacityVal)) {
        result.opacity = Math.max(0, Math.min(100, opacityVal))
      }
    }
  }

  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// FCPXML Parser (Final Cut Pro X / DaVinci Resolve)
// ═══════════════════════════════════════════════════════════════════════════

export function parseFcpXml(doc: Document): ParsedTimeline | null {
  const fcpxml = doc.querySelector('fcpxml')
  if (!fcpxml) return null
  
  // Find the first project/event/sequence
  const project = fcpxml.querySelector('project') || fcpxml.querySelector('event > project')
  const sequence = project?.querySelector('sequence') || fcpxml.querySelector('sequence')
  
  if (!sequence) return null
  
  const name = sequence.getAttribute('name') || project?.getAttribute('name') || 'Imported Timeline'
  const format = sequence.getAttribute('format') || ''
  
  // Parse duration (FCPXML uses rational time: "86400/2400s" or "10s")
  const parseFcpxmlTime = (timeStr: string | null): number => {
    if (!timeStr) return 0
    timeStr = timeStr.trim()
    // Format: "86400/2400s" (rational)
    const rational = timeStr.match(/^(\d+)\/(\d+)s$/)
    if (rational) return parseInt(rational[1]) / parseInt(rational[2])
    // Format: "10s" (simple seconds)
    const simple = timeStr.match(/^([\d.]+)s$/)
    if (simple) return parseFloat(simple[1])
    return 0
  }
  
  const totalDuration = parseFcpxmlTime(sequence.getAttribute('duration'))
  
  // Get format info (resolution, fps)
  let fps = 24
  let seqWidth: number | undefined
  let seqHeight: number | undefined
  
  if (format) {
    // Format is defined as a resource reference
    const formatEl = fcpxml.querySelector(`resources > format[id="${format}"]`)
    if (formatEl) {
      seqWidth = parseInt(formatEl.getAttribute('width') || '0') || undefined
      seqHeight = parseInt(formatEl.getAttribute('height') || '0') || undefined
      const frameDur = formatEl.getAttribute('frameDuration')
      if (frameDur) {
        const dur = parseFcpxmlTime(frameDur)
        if (dur > 0) fps = 1 / dur
      }
    }
  }
  
  // Collect media references from resources
  const mediaRefs = new Map<string, ParsedMediaRef>()
  
  const assets = fcpxml.querySelectorAll('resources > asset')
  assets.forEach(assetEl => {
    const assetId = assetEl.getAttribute('id') || ''
    if (!assetId) return
    
    const assetName = assetEl.getAttribute('name') || ''
    const src = assetEl.getAttribute('src') || ''
    const dur = parseFcpxmlTime(assetEl.getAttribute('duration'))
    const hasVideo = assetEl.getAttribute('hasVideo') !== '0'
    const hasAudio = assetEl.getAttribute('hasAudio') !== '0'
    
    // Get format from the asset's format ref
    const assetFormat = assetEl.getAttribute('format')
    let width: number | undefined
    let height: number | undefined
    if (assetFormat) {
      const fmtEl = fcpxml.querySelector(`resources > format[id="${assetFormat}"]`)
      if (fmtEl) {
        width = parseInt(fmtEl.getAttribute('width') || '0') || undefined
        height = parseInt(fmtEl.getAttribute('height') || '0') || undefined
      }
    }
    
    const decodedPath = decodePathUrl(src)
    const type = !hasVideo && hasAudio ? 'audio' : detectMediaType(assetName || src)
    
    mediaRefs.set(assetId, {
      id: assetId,
      name: assetName || src.split('/').pop() || 'Unknown',
      path: decodedPath,
      duration: dur,
      type,
      width,
      height,
      fps,
    })
  })
  
  // Parse spine (main timeline) and lanes
  const clips: ParsedClip[] = []
  let videoTrackCount = 0
  let audioTrackCount = 0
  
  // FCPXML has a "spine" which is the main track, with clips that can have "lane" attributes
  const spine = sequence.querySelector(':scope > spine')
  if (spine) {
    let currentOffset = 0
    const spineChildren = spine.children
    
    for (let i = 0; i < spineChildren.length; i++) {
      const el = spineChildren[i]
      const tagName = el.tagName.toLowerCase()
      
      if (tagName === 'asset-clip' || tagName === 'clip' || tagName === 'video' || tagName === 'audio') {
        const ref = el.getAttribute('ref') || ''
        const clipName = el.getAttribute('name') || ''
        const clipDuration = parseFcpxmlTime(el.getAttribute('duration'))
        const clipOffset = parseFcpxmlTime(el.getAttribute('offset')) || currentOffset
        const clipStart = parseFcpxmlTime(el.getAttribute('start'))
        const lane = parseInt(el.getAttribute('lane') || '0')
        
        const trackIdx = Math.max(0, lane)
        videoTrackCount = Math.max(videoTrackCount, trackIdx + 1)
        
        if (ref && mediaRefs.has(ref)) {
          const fx = parseFcpxmlClipEffects(el)
          clips.push({
            name: clipName,
            mediaRefId: ref,
            trackIndex: trackIdx,
            trackType: tagName === 'audio' ? 'audio' : 'video',
            startTime: clipOffset,
            duration: clipDuration,
            sourceIn: clipStart,
            sourceOut: clipStart + clipDuration,
            speed: fx.speed && fx.speed !== 1 ? fx.speed : undefined,
            reversed: fx.speed !== undefined && fx.speed < 0 ? true : undefined,
            flipH: fx.flipH || undefined,
            flipV: fx.flipV || undefined,
            opacity: fx.opacity !== undefined && fx.opacity !== 100 ? fx.opacity : undefined,
            muted: fx.muted || undefined,
          })
        }
        
        // If no lane attribute (lane 0 / spine), advance the offset
        if (lane === 0 || !el.hasAttribute('lane')) {
          currentOffset += clipDuration
        }
        
        // Check for attached clips (connected clips / B-roll)
        const attached = el.querySelectorAll(':scope > asset-clip, :scope > clip, :scope > audio, :scope > video')
        attached.forEach(att => {
          const attRef = att.getAttribute('ref') || ''
          const attName = att.getAttribute('name') || ''
          const attDur = parseFcpxmlTime(att.getAttribute('duration'))
          const attOffset = parseFcpxmlTime(att.getAttribute('offset'))
          const attStart = parseFcpxmlTime(att.getAttribute('start'))
          const attLane = parseInt(att.getAttribute('lane') || '1')
          
          const attTrackIdx = Math.max(0, attLane)
          videoTrackCount = Math.max(videoTrackCount, attTrackIdx + 1)
          
          if (attRef && mediaRefs.has(attRef)) {
            const isAudio = att.tagName.toLowerCase() === 'audio'
            const attFx = parseFcpxmlClipEffects(att)
            clips.push({
              name: attName,
              mediaRefId: attRef,
              trackIndex: attTrackIdx,
              trackType: isAudio ? 'audio' : 'video',
              startTime: clipOffset + attOffset,
              duration: attDur,
              sourceIn: attStart,
              sourceOut: attStart + attDur,
              speed: attFx.speed && attFx.speed !== 1 ? attFx.speed : undefined,
              reversed: attFx.speed !== undefined && attFx.speed < 0 ? true : undefined,
              flipH: attFx.flipH || undefined,
              flipV: attFx.flipV || undefined,
              opacity: attFx.opacity !== undefined && attFx.opacity !== 100 ? attFx.opacity : undefined,
              muted: attFx.muted || undefined,
            })
          }
        })
      } else if (tagName === 'gap') {
        // Empty space
        const gapDuration = parseFcpxmlTime(el.getAttribute('duration'))
        currentOffset += gapDuration
        
        // Check for clips attached to the gap
        const attached = el.querySelectorAll(':scope > asset-clip, :scope > clip, :scope > audio, :scope > video')
        attached.forEach(att => {
          const attRef = att.getAttribute('ref') || ''
          const attName = att.getAttribute('name') || ''
          const attDur = parseFcpxmlTime(att.getAttribute('duration'))
          const attOffset = parseFcpxmlTime(att.getAttribute('offset'))
          const attStart = parseFcpxmlTime(att.getAttribute('start'))
          const attLane = parseInt(att.getAttribute('lane') || '1')
          
          const attTrackIdx = Math.max(0, attLane)
          videoTrackCount = Math.max(videoTrackCount, attTrackIdx + 1)
          
          if (attRef && mediaRefs.has(attRef)) {
            const attFx = parseFcpxmlClipEffects(att)
            clips.push({
              name: attName,
              mediaRefId: attRef,
              trackIndex: attTrackIdx,
              trackType: att.tagName.toLowerCase() === 'audio' ? 'audio' : 'video',
              startTime: (currentOffset - gapDuration) + attOffset,
              duration: attDur,
              sourceIn: attStart,
              sourceOut: attStart + attDur,
              speed: attFx.speed && attFx.speed !== 1 ? attFx.speed : undefined,
              reversed: attFx.speed !== undefined && attFx.speed < 0 ? true : undefined,
              flipH: attFx.flipH || undefined,
              flipV: attFx.flipV || undefined,
              opacity: attFx.opacity !== undefined && attFx.opacity !== 100 ? attFx.opacity : undefined,
              muted: attFx.muted || undefined,
            })
          }
        })
      }
    }
  }
  
  if (videoTrackCount === 0) videoTrackCount = 1
  
  // ── Merge stereo pairs (same logic as FCP7 XML) ──
  // FCPXML can also represent stereo as two separate audio clips from the same
  // source at the same position. Collapse them into a single stereo clip.
  const fcpxAudioClips = clips.filter(c => c.trackType === 'audio')
  const fcpxNonAudioClips = clips.filter(c => c.trackType !== 'audio')
  
  const fcpxAudioGroups = new Map<string, ParsedClip[]>()
  for (const ac of fcpxAudioClips) {
    const key = `${ac.mediaRefId}|${ac.startTime.toFixed(4)}`
    if (!fcpxAudioGroups.has(key)) fcpxAudioGroups.set(key, [])
    fcpxAudioGroups.get(key)!.push(ac)
  }
  
  const fcpxMergedAudio: ParsedClip[] = []
  let fcpxMergedTrackIdx = 0
  const fcpxTrackRemap = new Map<number, number>()
  
  for (const group of fcpxAudioGroups.values()) {
    const representative = group[0]
    const origTrack = representative.trackIndex
    if (!fcpxTrackRemap.has(origTrack)) {
      fcpxTrackRemap.set(origTrack, videoTrackCount + fcpxMergedTrackIdx)
      fcpxMergedTrackIdx++
    }
    representative.trackIndex = fcpxTrackRemap.get(origTrack)!
    fcpxMergedAudio.push(representative)
  }
  
  const fcpxFinalClips = [...fcpxNonAudioClips, ...fcpxMergedAudio]
  const fcpxFinalAudioCount = fcpxMergedTrackIdx || (audioTrackCount > 0 ? 1 : 0)
  
  return {
    name,
    fps,
    duration: totalDuration || Math.max(...fcpxFinalClips.map(c => c.startTime + c.duration), 0),
    width: seqWidth,
    height: seqHeight,
    videoTrackCount,
    audioTrackCount: fcpxFinalAudioCount,
    mediaRefs: Array.from(mediaRefs.values()),
    clips: fcpxFinalClips,
    format: 'fcpxml',
  }
}
