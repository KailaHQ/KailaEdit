import {
  type ParsedTimeline,
  type ParsedMediaRef,
  type ParsedClip,
  type ParsedClipEffects,
  decodePathUrl,
  getChildText,
  getChildNumber,
  getTimebase,
  detectMediaType,
} from './import-helpers'

// ─── Helper: parse clip effects (FCP7) ───────────────────────────────────
// Extracts speed, reverse, flips, opacity, muted from <filter>/<effect> and
// other clip-level elements in FCP 7 XML.
export function parseFcp7ClipEffects(clipEl: Element): ParsedClipEffects {
  const result: ParsedClipEffects = {
    speed: 1,
    reversed: false,
    flipH: false,
    flipV: false,
    opacity: 100,
    muted: false,
  }

  // ── Check <enabled>FALSE</enabled> → clip is disabled/muted ──
  const enabled = getChildText(clipEl, 'enabled')
  if (enabled.toUpperCase() === 'FALSE') {
    result.muted = true
  }

  // ── Collect all effects ──
  const effects = clipEl.querySelectorAll(':scope > filter > effect')
  effects.forEach(effect => {
    const effectId = getChildText(effect, 'effectid').toLowerCase()
    const effectName = getChildText(effect, 'name').toLowerCase()

    // ── Speed / Time Remap ──
    if (effectId.includes('timeremap') || effectId.includes('speed') ||
        effectName.includes('time remap') || effectName.includes('speed')) {
      // Get all parameters
      const params = effect.querySelectorAll(':scope > parameter')
      params.forEach(param => {
        const paramId = getChildText(param, 'parameterid').toLowerCase()
        const paramName = getChildText(param, 'name').toLowerCase()

        if (paramId === 'speed' || paramName === 'speed') {
          const val = getChildText(param, 'value')
          if (val) {
            // Speed is stored as percentage (100 = normal, 200 = 2x, 50 = half)
            const speedPercent = parseFloat(val)
            if (!isNaN(speedPercent) && speedPercent !== 0) {
              // Negative speed = reverse (in some exports)
              if (speedPercent < 0) {
                result.speed = Math.abs(speedPercent) / 100
                result.reversed = true
              } else {
                result.speed = speedPercent / 100
              }
            }
          }
        }

        if (paramId === 'reverse' || paramName === 'reverse') {
          const val = getChildText(param, 'value').toUpperCase()
          if (val === 'TRUE' || val === '1') {
            result.reversed = true
          }
        }
      })
    }

    // ── Horizontal Flip ──
    if (effectId.includes('horizflip') || effectId.includes('hflip') ||
        effectName.includes('horizontal flip') || effectName.includes('flip horizontal')) {
      result.flipH = true
    }

    // ── Vertical Flip ──
    if (effectId.includes('vertflip') || effectId.includes('vflip') ||
        effectName.includes('vertical flip') || effectName.includes('flip vertical')) {
      result.flipV = true
    }

    // ── Basic Motion — check for negative scale (flip via scale) ──
    if (effectId === 'basic' || effectName.includes('basic motion') || effectName.includes('motion')) {
      const params = effect.querySelectorAll(':scope > parameter')
      params.forEach(param => {
        const paramId = getChildText(param, 'parameterid').toLowerCase()

        // Scale X negative = horizontal flip
        if (paramId === 'scalex' || paramId === 'scale_x') {
          const val = parseFloat(getChildText(param, 'value'))
          if (!isNaN(val) && val < 0) result.flipH = true
        }
        // Scale Y negative = vertical flip
        if (paramId === 'scaley' || paramId === 'scale_y') {
          const val = parseFloat(getChildText(param, 'value'))
          if (!isNaN(val) && val < 0) result.flipV = true
        }
      })
    }

    // ── Opacity ──
    if (effectId === 'opacity' || effectId.includes('opacity') ||
        effectName.includes('opacity')) {
      const params = effect.querySelectorAll(':scope > parameter')
      params.forEach(param => {
        const paramId = getChildText(param, 'parameterid').toLowerCase()
        if (paramId === 'opacity' || paramId === 'level') {
          const val = getChildText(param, 'value')
          if (val) {
            const opacityVal = parseFloat(val)
            if (!isNaN(opacityVal)) {
              result.opacity = Math.max(0, Math.min(100, opacityVal))
            }
          }
        }
      })
    }
  })

  // ── Check <compositemode> for opacity (alternative location) ──
  const compositeOpacity = clipEl.querySelector(':scope > compositemode > opacity > value')
  if (compositeOpacity) {
    const val = parseFloat(compositeOpacity.textContent || '')
    if (!isNaN(val)) {
      result.opacity = Math.max(0, Math.min(100, val))
    }
  }

  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// FCP 7 XML Parser
// ═══════════════════════════════════════════════════════════════════════════

export function parseFcp7Xml(doc: Document): ParsedTimeline | null {
  // Look for sequence element
  const sequence = doc.querySelector('xmeml > sequence') 
    || doc.querySelector('xmeml > project > children > sequence')
    || doc.querySelector('sequence')
  
  if (!sequence) return null
  
  const name = getChildText(sequence, 'name') || 'Imported Timeline'
  const fps = getTimebase(sequence) || 24
  const totalDuration = getChildNumber(sequence, 'duration') / fps
  
  // Sequence format (resolution)
  const seqFormat = sequence.querySelector(':scope > media > video > format > samplecharacteristics')
  const seqWidth = seqFormat ? getChildNumber(seqFormat, 'width') : undefined
  const seqHeight = seqFormat ? getChildNumber(seqFormat, 'height') : undefined
  
  // Collect all file references (deduplicating by id)
  const mediaRefs = new Map<string, ParsedMediaRef>()
  const fileElements = sequence.querySelectorAll('file')
  
  fileElements.forEach(fileEl => {
    const fileId = fileEl.getAttribute('id') || ''
    if (!fileId || mediaRefs.has(fileId)) return
    
    // Some file elements are just references (no children) - skip those
    const xmlPath = getChildText(fileEl, 'pathurl')
    if (!xmlPath && fileEl.children.length === 0) return
    
    const decodedPath = decodePathUrl(xmlPath)
    const fileName = getChildText(fileEl, 'name') || decodedPath.split(/[/\\]/).pop() || 'Unknown'
    const fileFps = getTimebase(fileEl) ?? undefined
    const fileDuration = getChildNumber(fileEl, 'duration') / (fileFps || fps)
    
    // Get media dimensions
    const mediaVideo = fileEl.querySelector(':scope > media > video > samplecharacteristics')
    const width = mediaVideo ? getChildNumber(mediaVideo, 'width') : undefined
    const height = mediaVideo ? getChildNumber(mediaVideo, 'height') : undefined
    
    const type = detectMediaType(fileName)
    
    mediaRefs.set(fileId, {
      id: fileId,
      name: fileName,
      path: decodedPath,
      duration: fileDuration,
      type,
      width,
      height,
      fps: fileFps,
    })
  })
  
  // Parse clips from video tracks
  const clips: ParsedClip[] = []
  let videoTrackCount = 0
  let audioTrackCount = 0
  
  // Video tracks
  const videoTracks = sequence.querySelectorAll(':scope > media > video > track')
  videoTracks.forEach((trackEl, trackIdx) => {
    videoTrackCount++
    const clipItems = trackEl.querySelectorAll(':scope > clipitem')
    
    clipItems.forEach(clipEl => {
      const clipName = getChildText(clipEl, 'name')
      const clipFps = getTimebase(clipEl) || fps
      
      const startFrame = getChildNumber(clipEl, 'start')
      const endFrame = getChildNumber(clipEl, 'end')
      const inFrame = getChildNumber(clipEl, 'in')
      const outFrame = getChildNumber(clipEl, 'out')
      
      // Find the file reference
      const fileEl = clipEl.querySelector(':scope > file')
      let mediaRefId = fileEl?.getAttribute('id') || ''
      
      // If file element has no children, it's a reference - look it up
      if (fileEl && fileEl.children.length === 0 && mediaRefId) {
        // Just a reference to an existing file
      } else if (fileEl && mediaRefId) {
        // Full file definition inline - make sure it's in our map
        if (!mediaRefs.has(mediaRefId)) {
          const xmlPath = getChildText(fileEl, 'pathurl')
          const decodedPath = decodePathUrl(xmlPath)
          const fileName = getChildText(fileEl, 'name') || decodedPath.split(/[/\\]/).pop() || clipName
          mediaRefs.set(mediaRefId, {
            id: mediaRefId,
            name: fileName,
            path: decodedPath,
            duration: (outFrame - inFrame) / clipFps,
            type: detectMediaType(fileName),
          })
        }
      }
      
      // Parse all clip effects (speed, reverse, flips, opacity, muted)
      const effects = parseFcp7ClipEffects(clipEl)
      
      if (startFrame >= 0 && endFrame > startFrame && mediaRefId) {
        clips.push({
          name: clipName,
          mediaRefId,
          trackIndex: trackIdx,
          trackType: 'video',
          startTime: startFrame / clipFps,
          duration: (endFrame - startFrame) / clipFps,
          sourceIn: inFrame / clipFps,
          sourceOut: outFrame / clipFps,
          speed: effects.speed !== 1 ? effects.speed : undefined,
          reversed: effects.reversed || undefined,
          flipH: effects.flipH || undefined,
          flipV: effects.flipV || undefined,
          opacity: effects.opacity !== 100 ? effects.opacity : undefined,
          muted: effects.muted || undefined,
        })
      }
    })
  })
  
  // Audio tracks
  const audioTracks = sequence.querySelectorAll(':scope > media > audio > track')
  audioTracks.forEach((trackEl, audioIdx) => {
    audioTrackCount++
    const clipItems = trackEl.querySelectorAll(':scope > clipitem')
    
    clipItems.forEach(clipEl => {
      const clipName = getChildText(clipEl, 'name')
      const clipFps = getTimebase(clipEl) || fps
      
      const startFrame = getChildNumber(clipEl, 'start')
      const endFrame = getChildNumber(clipEl, 'end')
      const inFrame = getChildNumber(clipEl, 'in')
      const outFrame = getChildNumber(clipEl, 'out')
      
      const fileEl = clipEl.querySelector(':scope > file')
      const mediaRefId = fileEl?.getAttribute('id') || ''
      
      // Parse effects (muted via <enabled>FALSE</enabled>)
      const effects = parseFcp7ClipEffects(clipEl)
      
      // Check volume from audio level filter
      let volume: number | undefined
      const volFilter = Array.from(clipEl.querySelectorAll('filter > effect')).find(e => 
        getChildText(e, 'effectid')?.toLowerCase().includes('audiolevel') ||
        getChildText(e, 'name')?.toLowerCase().includes('level')
      )
      if (volFilter) {
        const volParam = volFilter.querySelector('parameter > value')
        if (volParam) {
          volume = parseFloat(volParam.textContent || '0')
          // FCP7 volume is in dB, convert rough approximation: 0dB=1, -inf=0
          volume = Math.pow(10, (volume || 0) / 20)
        }
      }
      
      // Find matching video clip (same file, same timeline position) to establish a link
      const linkedVideoIndex = clips.findIndex(c => 
        c.mediaRefId === mediaRefId && 
        c.trackType === 'video' &&
        Math.abs(c.startTime - startFrame / clipFps) < 0.01
      )
      
      if (startFrame >= 0 && endFrame > startFrame && mediaRefId) {
        clips.push({
          name: clipName,
          mediaRefId,
          trackIndex: videoTrackCount + audioIdx, // offset by video tracks
          trackType: 'audio',
          startTime: startFrame / clipFps,
          duration: (endFrame - startFrame) / clipFps,
          sourceIn: inFrame / clipFps,
          sourceOut: outFrame / clipFps,
          volume,
          muted: effects.muted || undefined,
          linkedVideoClipIndex: linkedVideoIndex >= 0 ? linkedVideoIndex : undefined,
        })
      }
    })
  })
  
  // ── Merge stereo pairs: Premiere exports stereo as two mono audio tracks ──
  // If multiple audio clips reference the same source file at the same timeline
  // position, they are channel splits of a single stereo clip. Keep only one
  // clip per unique (mediaRefId, startTime) and collapse the track count.
  const audioClips = clips.filter(c => c.trackType === 'audio')
  const nonAudioClips = clips.filter(c => c.trackType !== 'audio')
  
  // Group audio clips by (mediaRefId + startTime) to detect stereo pairs
  const audioGroups = new Map<string, ParsedClip[]>()
  for (const ac of audioClips) {
    const key = `${ac.mediaRefId}|${ac.startTime.toFixed(4)}`
    if (!audioGroups.has(key)) audioGroups.set(key, [])
    audioGroups.get(key)!.push(ac)
  }
  
  // Build merged audio clips: keep the first clip of each group, discard duplicates
  const mergedAudioClips: ParsedClip[] = []
  let mergedAudioTrackIdx = 0
  // Track which original track indices have been assigned a merged index
  const trackRemap = new Map<number, number>()
  
  for (const group of audioGroups.values()) {
    const representative = group[0] // keep first channel's metadata (volume, link, etc.)
    
    // Determine the merged track index for this clip
    const origTrack = representative.trackIndex
    if (!trackRemap.has(origTrack)) {
      trackRemap.set(origTrack, videoTrackCount + mergedAudioTrackIdx)
      mergedAudioTrackIdx++
    }
    representative.trackIndex = trackRemap.get(origTrack)!
    
    // If any channel in the group has a linked video, preserve it
    if (representative.linkedVideoClipIndex === undefined) {
      const linked = group.find(c => c.linkedVideoClipIndex !== undefined)
      if (linked) representative.linkedVideoClipIndex = linked.linkedVideoClipIndex
    }
    
    mergedAudioClips.push(representative)
  }
  
  // Reassemble clips and update track count
  const finalClips = [...nonAudioClips, ...mergedAudioClips]
  const finalAudioTrackCount = mergedAudioTrackIdx || (audioTrackCount > 0 ? 1 : 0)
  
  return {
    name,
    fps,
    duration: totalDuration || Math.max(...finalClips.map(c => c.startTime + c.duration), 0),
    width: seqWidth,
    height: seqHeight,
    videoTrackCount,
    audioTrackCount: finalAudioTrackCount,
    mediaRefs: Array.from(mediaRefs.values()),
    clips: finalClips,
    format: 'fcp7xml',
  }
}
