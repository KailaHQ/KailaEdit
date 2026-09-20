/**
 * Timeline Import: Parse FCP7 XML and FCPXML files from Premiere Pro, DaVinci Resolve, Final Cut Pro
 * 
 * Supported formats:
 * - FCP 7 XML (.xml) - Universal interchange format (Premiere, DaVinci, FCP7)
 * - FCPXML (.fcpxml) - Final Cut Pro X / DaVinci Resolve
 * 
 * AAF is a binary format and cannot be parsed in JavaScript.
 * Users should export as XML from their NLE instead.
 */

import { parseFcp7Xml } from './parsers/fcp7-parser'
import { parseFcpXml } from './parsers/fcpxml-parser'
import type { ParsedTimeline } from './parsers/import-helpers'

// Re-export shared types for consumers
export type { ParsedMediaRef, ParsedClip, ParsedTimeline } from './parsers/import-helpers'

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

export type ImportFormat = 'fcp7xml' | 'fcpxml' | 'aaf' | 'unknown'

export function detectFormat(content: string, filename: string = ''): ImportFormat {
  const ext = filename ? filename.split('.').pop()?.toLowerCase() || '' : ''
  
  if (ext === 'aaf') return 'aaf'
  
  // Check XML content
  if (content.includes('<xmeml') || content.includes('<!DOCTYPE xmeml')) return 'fcp7xml'
  if (content.includes('<fcpxml')) return 'fcpxml'
  
  if (ext === 'fcpxml') return 'fcpxml'
  if (ext === 'xml') return 'fcp7xml' // default XML to FCP7
  
  return 'unknown'
}

export function parseTimelineXml(content: string, filename: string = ''): ParsedTimeline | null {
  const format = detectFormat(content, filename)
  
  if (format === 'aaf') {
    throw new Error(
      'AAF files cannot be imported directly. Please export your timeline as FCP 7 XML (.xml) from your editing software:\n\n' +
      '- Premiere Pro: File → Export → Final Cut Pro XML\n' +
      '- DaVinci Resolve: File → Export Timeline → FCP 7 XML\n' +
      '- Avid Media Composer: File → Export → FCP 7 XML'
    )
  }
  
  // Parse XML
  const parser = new DOMParser()
  const doc = parser.parseFromString(content, 'text/xml')
  
  // Check for parse errors
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error('Invalid XML file: ' + (parseError.textContent?.slice(0, 200) || 'Parse error'))
  }
  
  if (format === 'fcpxml') {
    const result = parseFcpXml(doc)
    if (result) return result
  }
  
  if (format === 'fcp7xml' || format === 'unknown') {
    const result = parseFcp7Xml(doc)
    if (result) return result
  }
  
  // Try both parsers
  const fcpxml = parseFcpXml(doc)
  if (fcpxml) return fcpxml
  
  const fcp7 = parseFcp7Xml(doc)
  if (fcp7) return fcp7
  
  throw new Error('Could not parse timeline. The file format is not recognized as FCP 7 XML or FCPXML.')
}

/**
 * Export the current timeline as FCP 7 XML
 */
export function exportFcp7Xml(options: {
  name: string
  fps: number
  width: number
  height: number
  clips: Array<{
    name: string
    filePath: string
    trackIndex: number
    type: 'video' | 'audio' | 'image'
    startTime: number
    duration: number
    trimStart: number
    sourceDuration: number
    width?: number
    height?: number
  }>
}): string {
  const { name, fps, width, height, clips } = options
  
  // Collect unique files
  const files = new Map<string, { id: string; path: string; name: string; duration: number; type: string; width?: number; height?: number }>()
  clips.forEach((clip, i) => {
    if (!files.has(clip.filePath)) {
      files.set(clip.filePath, {
        id: `file-${i + 1}`,
        path: clip.filePath,
        name: clip.name,
        duration: clip.sourceDuration,
        type: clip.type,
        width: clip.width,
        height: clip.height,
      })
    }
  })
  
  const toFrames = (seconds: number) => Math.round(seconds * fps)
  
  // Escape XML special characters
  const escXml = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
  
  // Build file path URL
  const toPathUrl = (p: string) => {
    let normalized = p.replace(/\\/g, '/')
    if (!normalized.startsWith('/')) normalized = '/' + normalized
    return `file://localhost${encodeURI(normalized)}`
  }
  
  // Group clips by video/audio tracks
  const videoClips = clips.filter(c => c.type !== 'audio')
  const audioClips = clips.filter(c => c.type === 'audio')
  
  // Group by track index
  const videoTrackMap = new Map<number, typeof videoClips>()
  videoClips.forEach(c => {
    const arr = videoTrackMap.get(c.trackIndex) || []
    arr.push(c)
    videoTrackMap.set(c.trackIndex, arr)
  })
  
  const audioTrackMap = new Map<number, typeof audioClips>()
  audioClips.forEach(c => {
    const arr = audioTrackMap.get(c.trackIndex) || []
    arr.push(c)
    audioTrackMap.set(c.trackIndex, arr)
  })
  
  const totalDuration = Math.max(...clips.map(c => c.startTime + c.duration), 1)
  
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4">\n  <sequence id="sequence-1">\n    <name>${escXml(name)}</name>\n    <duration>${toFrames(totalDuration)}</duration>\n    <rate>\n      <timebase>${Math.round(fps)}</timebase>\n      <ntsc>${Math.abs(fps - Math.round(fps)) > 0.01 ? 'TRUE' : 'FALSE'}</ntsc>\n    </rate>\n    <media>\n      <video>\n        <format>\n          <samplecharacteristics>\n            <width>${width}</width>\n            <height>${height}</height>\n          </samplecharacteristics>\n        </format>\n`
  
  // Video tracks
  for (const [, trackClips] of videoTrackMap) {
    xml += `        <track>\n`
    for (const clip of trackClips) {
      const file = files.get(clip.filePath)!
      const inFrame = toFrames(clip.trimStart)
      const outFrame = toFrames(clip.trimStart + clip.duration)
      xml += `          <clipitem id="clipitem-${Math.random().toString(36).slice(2, 8)}">\n`
      xml += `            <name>${escXml(clip.name)}</name>\n`
      xml += `            <duration>${toFrames(clip.sourceDuration)}</duration>\n`
      xml += `            <rate><timebase>${Math.round(fps)}</timebase></rate>\n`
      xml += `            <start>${toFrames(clip.startTime)}</start>\n`
      xml += `            <end>${toFrames(clip.startTime + clip.duration)}</end>\n`
      xml += `            <in>${inFrame}</in>\n`
      xml += `            <out>${outFrame}</out>\n`
      xml += `            <file id="${file.id}">\n`
      xml += `              <name>${escXml(file.name)}</name>\n`
      xml += `              <pathurl>${escXml(toPathUrl(file.path))}</pathurl>\n`
      xml += `              <duration>${toFrames(file.duration)}</duration>\n`
      xml += `              <rate><timebase>${Math.round(fps)}</timebase></rate>\n`
      if (file.width && file.height) {
        xml += `              <media><video><samplecharacteristics><width>${file.width}</width><height>${file.height}</height></samplecharacteristics></video></media>\n`
      }
      xml += `            </file>\n`
      xml += `          </clipitem>\n`
    }
    xml += `        </track>\n`
  }
  
  xml += `      </video>\n      <audio>\n`
  
  // Audio tracks
  for (const [, trackClips] of audioTrackMap) {
    xml += `        <track>\n`
    for (const clip of trackClips) {
      const file = files.get(clip.filePath)!
      const inFrame = toFrames(clip.trimStart)
      const outFrame = toFrames(clip.trimStart + clip.duration)
      xml += `          <clipitem id="clipitem-${Math.random().toString(36).slice(2, 8)}">\n`
      xml += `            <name>${escXml(clip.name)}</name>\n`
      xml += `            <duration>${toFrames(clip.sourceDuration)}</duration>\n`
      xml += `            <rate><timebase>${Math.round(fps)}</timebase></rate>\n`
      xml += `            <start>${toFrames(clip.startTime)}</start>\n`
      xml += `            <end>${toFrames(clip.startTime + clip.duration)}</end>\n`
      xml += `            <in>${inFrame}</in>\n`
      xml += `            <out>${outFrame}</out>\n`
      xml += `            <file id="${file.id}">\n`
      xml += `              <name>${escXml(file.name)}</name>\n`
      xml += `              <pathurl>${escXml(toPathUrl(file.path))}</pathurl>\n`
      xml += `              <duration>${toFrames(file.duration)}</duration>\n`
      xml += `              <rate><timebase>${Math.round(fps)}</timebase></rate>\n`
      xml += `            </file>\n`
      xml += `          </clipitem>\n`
    }
    xml += `        </track>\n`
  }
  
  xml += `      </audio>\n    </media>\n  </sequence>\n</xmeml>\n`
  
  return xml
}
