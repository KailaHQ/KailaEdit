import * as MP4Box from 'mp4box'
import type { DemuxedVideoMetadata, VideoDemuxTrackInfo, VideoSampleRecord } from './types'

function extractTrackDescription(file: any, trackId: number): Uint8Array | undefined {
  try {
    const trak = file.getTrackById
      ? file.getTrackById(trackId)
      : file.moov?.traks?.find((t: any) => t.tkhd.track_id === trackId)
    if (!trak) return undefined

    for (const entry of trak.mdia?.minf?.stbl?.stsd?.entries || []) {
      const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C
      if (box) {
        const stream = new (MP4Box as any).DataStream(undefined, 0, (MP4Box as any).DataStream.BIG_ENDIAN)
        box.write(stream)
        // Slice off the 8-byte box header (size + 4-char name)
        return new Uint8Array(stream.buffer, 8)
      }
    }
  } catch (err) {
    console.warn('[VideoDemuxer] Failed to extract track description:', err)
  }
  return undefined
}

/** How much of a local file to ask the main process for at a time. */
const MEDIA_CHUNK_BYTES = 8 * 1024 * 1024

async function fetchRemote(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch media file for demuxing: ${response.statusText} (${url})`)
  }
  return response.arrayBuffer()
}

/**
 * Reads a local media file through the main process.
 *
 * NOT `fetch('file://…')`. The renderer's CSP allows `file:` for `img-src` and
 * `media-src` but not for `connect-src`, so that fetch was blocked outright — every
 * demux threw "Refused to connect", `WebCodecsPlayer.load` returned false, and the
 * hardware-decode path fell back to <video> without anything surfacing in the app. The
 * alternative was to widen `connect-src` to `file:`, which hands the renderer the
 * ability to read any local file; this keeps that shut and puts the read behind
 * `validatePath` in main instead.
 *
 * Requested in ranges so a large source never has to cross the IPC boundary in one
 * message, then joined into the single buffer mp4box expects.
 */
export async function readLocalMedia(filePathOrUrl: string): Promise<ArrayBuffer> {
  const api = (window as { electronAPI?: { readMediaChunk?: (input: { filePath: string; offset: number; length: number }) => Promise<{ data: Uint8Array; totalSize: number }> } }).electronAPI
  if (!api?.readMediaChunk) {
    throw new Error('[VideoDemuxer] readMediaChunk is unavailable; cannot demux a local file')
  }

  const filePath = filePathOrUrl.startsWith('file://') ? fileUrlToPath(filePathOrUrl) : filePathOrUrl

  const chunks: Uint8Array[] = []
  let received = 0
  let totalSize = Infinity

  while (received < totalSize) {
    const { data, totalSize: size } = await api.readMediaChunk({
      filePath,
      offset: received,
      length: MEDIA_CHUNK_BYTES,
    })
    totalSize = size
    if (data.byteLength === 0) break
    chunks.push(data)
    received += data.byteLength
  }

  if (received === 0) {
    throw new Error(`[VideoDemuxer] Media file is empty or unreadable: ${filePath}`)
  }

  const joined = new Uint8Array(received)
  let at = 0
  for (const chunk of chunks) {
    joined.set(chunk, at)
    at += chunk.byteLength
  }
  return joined.buffer
}

/** Undoes pathToFileUrl: `file:///C%3A/dir/a.mp4` back to a Windows or POSIX path. */
export function fileUrlToPath(fileUrl: string): string {
  const withoutScheme = decodeURIComponent(fileUrl.replace(/^file:[/][/]/, ''))
  // A Windows URL carries a leading slash before the drive letter; a POSIX path needs it.
  const trimmed = withoutScheme.replace(/^[/]/, '')
  if (/^[a-zA-Z]:/.test(trimmed)) return trimmed.split('/').join(String.fromCharCode(92))
  return withoutScheme
}

export class VideoDemuxer {
  private metadata: DemuxedVideoMetadata | null = null

  async demux(filePathOrUrl: string): Promise<DemuxedVideoMetadata> {
    const isRemote = filePathOrUrl.startsWith('http://') || filePathOrUrl.startsWith('https://')
    const arrayBuffer = isRemote
      ? await fetchRemote(filePathOrUrl)
      : await readLocalMedia(filePathOrUrl)
    return this.parseBuffer(arrayBuffer)
  }

  parseBuffer(buffer: ArrayBuffer): Promise<DemuxedVideoMetadata> {
    return new Promise((resolve, reject) => {
      const mp4boxfile = (MP4Box as any).createFile()
      let trackInfo: VideoDemuxTrackInfo | null = null
      const samples: VideoSampleRecord[] = []
      const keyframeIndices: number[] = []

      mp4boxfile.onError = (err: any) => {
        reject(new Error(`[VideoDemuxer] MP4Box parsing error: ${String(err)}`))
      }

      mp4boxfile.onReady = (info: any) => {
        if (!info.videoTracks || info.videoTracks.length === 0) {
          reject(new Error('[VideoDemuxer] No video tracks found in MP4 file'))
          return
        }

        const primaryTrack = info.videoTracks[0]
        const description = extractTrackDescription(mp4boxfile, primaryTrack.id)

        trackInfo = {
          id: primaryTrack.id,
          codec: primaryTrack.codec,
          width: primaryTrack.video.width,
          height: primaryTrack.video.height,
          duration: primaryTrack.duration / primaryTrack.timescale,
          timescale: primaryTrack.timescale,
          nb_samples: primaryTrack.nb_samples,
          description,
        }

        // Request all samples for this track
        mp4boxfile.setExtractionOptions(primaryTrack.id, null, {
          nbSamples: primaryTrack.nb_samples || 100000,
        })
        mp4boxfile.start()
      }

      mp4boxfile.onSamples = (trackId: number, _user: any, rawSamples: any[]) => {
        if (!trackInfo || trackId !== trackInfo.id) return

        const timescale = trackInfo.timescale

        for (let i = 0; i < rawSamples.length; i++) {
          const s = rawSamples[i]
          const isKeyframe = Boolean(s.is_sync)
          const pts = s.cts / timescale
          const dts = s.dts / timescale
          const duration = s.duration / timescale

          const chunk = new EncodedVideoChunk({
            type: isKeyframe ? 'key' : 'delta',
            timestamp: Math.round(pts * 1_000_000), // microseconds
            duration: Math.round(duration * 1_000_000),
            data: s.data,
          })

          const recordIndex = samples.length
          if (isKeyframe) {
            keyframeIndices.push(recordIndex)
          }

          samples.push({
            index: recordIndex,
            pts,
            dts,
            duration,
            isKeyframe,
            offset: s.offset,
            size: s.size,
            chunk,
          })
        }

        const duration = trackInfo.duration || (samples.length > 0 ? samples[samples.length - 1].pts : 0)
        const fps = samples.length > 1 ? samples.length / Math.max(0.1, duration) : 30

        const meta: DemuxedVideoMetadata = {
          trackInfo,
          samples,
          keyframeIndices,
          fps,
          duration,
        }

        this.metadata = meta
        resolve(meta)
      }

      ;(buffer as any).fileStart = 0
      mp4boxfile.appendBuffer(buffer)
      mp4boxfile.flush()
    })
  }

  getMetadata(): DemuxedVideoMetadata | null {
    return this.metadata
  }

  /**
   * Finds the list of EncodedVideoChunks needed to decode up to `targetTime`.
   * Finds the nearest previous keyframe (I-frame) and all subsequent delta frames up to `targetTime`.
   */
  getChunksForTimestamp(targetTime: number): EncodedVideoChunk[] {
    if (!this.metadata || this.metadata.samples.length === 0) return []

    const samples = this.metadata.samples
    const keyframes = this.metadata.keyframeIndices

    // 1. Find the sample closest to or right at targetTime
    let sampleIdx = 0
    let minDiff = Infinity
    for (let i = 0; i < samples.length; i++) {
      const diff = Math.abs(samples[i].pts - targetTime)
      if (diff < minDiff) {
        minDiff = diff
        sampleIdx = i
      }
      if (samples[i].pts > targetTime + 0.1) break
    }

    // 2. Find the nearest keyframe index <= sampleIdx
    let keyframeSampleIdx = 0
    for (let k = 0; k < keyframes.length; k++) {
      if (keyframes[k] <= sampleIdx) {
        keyframeSampleIdx = keyframes[k]
      } else {
        break
      }
    }

    // 3. Collect chunks from keyframeSampleIdx to sampleIdx
    const chunks: EncodedVideoChunk[] = []
    for (let i = keyframeSampleIdx; i <= sampleIdx; i++) {
      if (samples[i].chunk) {
        chunks.push(samples[i].chunk!)
      }
    }

    return chunks
  }
}
