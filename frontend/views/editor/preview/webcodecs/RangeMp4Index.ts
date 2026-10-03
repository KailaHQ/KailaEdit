import * as MP4Box from 'mp4box'
import type { VideoDemuxTrackInfo } from './types'
import { extractRotationDegrees, extractTrackDescription } from './VideoDemuxer'

/**
 * A byte range of a file. `totalSize` is the size of the whole file, so a reader can tell
 * when it has reached the end.
 */
export type RangeReader = (offset: number, length: number) => Promise<{ data: Uint8Array; totalSize: number }>

export interface IndexedSample {
  /** Position in decode order. */
  index: number
  pts: number
  dts: number
  duration: number
  isKeyframe: boolean
  /** Absolute byte offset in the file. */
  offset: number
  size: number
}

export interface Mp4SampleIndex {
  trackInfo: VideoDemuxTrackInfo
  /** Decode order, as stored in the file. */
  samples: IndexedSample[]
  keyframeIndices: number[]
  /** Indices into `samples`, ordered by presentation time. */
  presentationOrder: number[]
  duration: number
  totalSize: number
}

export interface FramePlan {
  target: IndexedSample
  /** First sample to decode: the keyframe the target depends on. */
  first: number
  /** One past the last sample to decode. */
  end: number
  byteStart: number
  byteEnd: number
}

export interface RawChunk {
  type: 'key' | 'delta'
  /** Microseconds. */
  timestamp: number
  duration: number
  data: Uint8Array
}

/** Enough to cover every box header before the first big one in practice. */
const HEAD_PROBE_BYTES = 64 * 1024
/** How much to ask a reader for at a time, so no single message is huge. */
const READ_STEP_BYTES = 8 * 1024 * 1024
/** Frames after the target that may be needed to resolve B-frame references. */
const REORDER_LOOKAHEAD = 7
/** Above this a frame's byte span is fetched sample by sample instead of in one read. */
const MAX_SPAN_BYTES = 24 * 1024 * 1024

/** `ftyp` with the `isom` brand, for files whose own was lost: the parser insists on one. */
const FALLBACK_FTYP = new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])

async function readExact(read: RangeReader, offset: number, length: number): Promise<Uint8Array> {
  const out = new Uint8Array(length)
  let got = 0
  while (got < length) {
    const { data } = await read(offset + got, Math.min(READ_STEP_BYTES, length - got))
    if (data.byteLength === 0) throw new Error(`[RangeMp4Index] File ends ${length - got} bytes short at ${offset + got}`)
    out.set(data.subarray(0, length - got), got)
    got += Math.min(data.byteLength, length - got)
  }
  return out
}

interface BoxRange {
  offset: number
  size: number
}

/**
 * Walks the top-level boxes by their headers, jumping over `mdat` without reading it, to
 * find `moov`. Phones write `moov` after the footage, so it sits at the very end of a file
 * that may be hundreds of megabytes.
 */
async function locateBoxes(read: RangeReader): Promise<{ ftyp: BoxRange | null; moov: BoxRange; totalSize: number }> {
  const first = await read(0, HEAD_PROBE_BYTES)
  const totalSize = first.totalSize
  let window = { start: 0, bytes: first.data }
  let ftyp: BoxRange | null = null
  let pos = 0

  while (pos + 8 <= totalSize) {
    const needed = Math.min(16, totalSize - pos)
    if (pos < window.start || pos - window.start + needed > window.bytes.byteLength) {
      const probe = await read(pos, 32)
      window = { start: pos, bytes: probe.data }
      if (probe.data.byteLength < 8) break
    }
    const view = new DataView(window.bytes.buffer, window.bytes.byteOffset, window.bytes.byteLength)
    const at = pos - window.start
    let size = view.getUint32(at)
    const type = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7))
    let header = 8
    if (size === 1) {
      size = Number(view.getBigUint64(at + 8))
      header = 16
    } else if (size === 0) {
      size = totalSize - pos
    }
    if (size < header) throw new Error(`[RangeMp4Index] Malformed '${type}' box at ${pos}`)
    if (type === 'ftyp') ftyp = { offset: pos, size }
    if (type === 'moov') return { ftyp, moov: { offset: pos, size }, totalSize }
    pos += size
  }
  throw new Error('[RangeMp4Index] No moov box: not an MP4/MOV file, or it is cut short')
}

function parseSampleTable(ftyp: Uint8Array, moov: Uint8Array, totalSize: number): Promise<Mp4SampleIndex> {
  return new Promise((resolve, reject) => {
    const file = (MP4Box as any).createFile()

    file.onError = (err: unknown) => reject(new Error(`[RangeMp4Index] MP4Box parsing error: ${String(err)}`))
    file.onReady = (info: any) => {
      try {
        if (!info.videoTracks || info.videoTracks.length === 0) {
          reject(new Error('[RangeMp4Index] No video tracks found'))
          return
        }
        const track = info.videoTracks[0]
        const trak = file.getTrackById(track.id)

        // HTMLVideoElement applies the edit list, WebCodecs does not: use the same
        // presentation origin as the element so both show the same frame for a time.
        let presentationOffset = 0
        let emptyDuration = 0
        for (const edit of trak?.edts?.elst?.entries ?? []) {
          if (edit.media_time === -1) {
            emptyDuration += edit.segment_duration / info.timescale
          } else {
            if (edit.media_rate_integer !== 1 || edit.media_rate_fraction !== 0) {
              reject(new Error('[RangeMp4Index] Unsupported MP4 edit rate'))
              return
            }
            presentationOffset = emptyDuration - edit.media_time / track.timescale
            break
          }
        }

        const rotation = extractRotationDegrees(track.matrix)
        const codedWidth = track.video.width
        const codedHeight = track.video.height
        const swap = rotation === 90 || rotation === 270
        const timescale = track.timescale

        const samples: IndexedSample[] = []
        const keyframeIndices: number[] = []
        for (const raw of trak.samples as any[]) {
          const isKeyframe = Boolean(raw.is_sync)
          if (isKeyframe) keyframeIndices.push(samples.length)
          samples.push({
            index: samples.length,
            pts: raw.cts / timescale + presentationOffset,
            dts: raw.dts / timescale + presentationOffset,
            duration: raw.duration / timescale,
            isKeyframe,
            offset: raw.offset,
            size: raw.size,
          })
        }
        if (samples.length === 0) {
          reject(new Error('[RangeMp4Index] The video track has no samples'))
          return
        }

        const presentationOrder = samples.map(s => s.index).sort((a, b) => samples[a].pts - samples[b].pts)
        resolve({
          trackInfo: {
            id: track.id,
            codec: track.codec,
            width: swap ? codedHeight : codedWidth,
            height: swap ? codedWidth : codedHeight,
            duration: track.duration / timescale,
            timescale,
            nb_samples: samples.length,
            description: extractTrackDescription(file, track.id),
            codedWidth,
            codedHeight,
            rotation,
          },
          samples,
          keyframeIndices,
          presentationOrder,
          duration: samples.reduce((end, s) => Math.max(end, s.pts + s.duration), 0),
          totalSize,
        })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }

    // `ftyp` then `moov`, back to back, is a complete file as far as the parser can tell.
    // The sample offsets it reports stay the real ones: they were written into `moov`.
    const joined = new Uint8Array(ftyp.byteLength + moov.byteLength)
    joined.set(ftyp, 0)
    joined.set(moov, ftyp.byteLength)
    const buffer = joined.buffer as ArrayBuffer & { fileStart?: number }
    buffer.fileStart = 0
    file.appendBuffer(buffer)
    file.flush()
  })
}

/**
 * Builds the sample table of a video from `ftyp` and `moov` alone: a few reads of a few
 * kilobytes, whatever the length of the file or the place the footage was cut from.
 */
export async function readMp4Index(read: RangeReader): Promise<Mp4SampleIndex> {
  const { ftyp, moov, totalSize } = await locateBoxes(read)
  const [moovBytes, ftypBytes] = await Promise.all([
    readExact(read, moov.offset, moov.size),
    ftyp ? readExact(read, ftyp.offset, ftyp.size) : Promise.resolve(FALLBACK_FTYP),
  ])
  return parseSampleTable(ftypBytes, moovBytes, totalSize)
}

/** The sample on screen at `time`: the last one that starts at or before it. */
export function sampleAtTime(index: Mp4SampleIndex, time: number): IndexedSample {
  const { samples, presentationOrder } = index
  let lo = 0
  let hi = presentationOrder.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (samples[presentationOrder[mid]].pts <= time + 0.000001) lo = mid + 1
    else hi = mid
  }
  return samples[presentationOrder[Math.max(0, lo - 1)]]
}

/** What has to be decoded to show the frame at `time`, and which bytes hold it. */
export function planFrameDecode(index: Mp4SampleIndex, time: number): FramePlan {
  const target = sampleAtTime(index, time)
  const { samples, keyframeIndices } = index

  let first = 0
  for (const k of keyframeIndices) {
    if (k <= target.index) first = k
    else break
  }
  const nextKey = keyframeIndices.find(k => k > target.index) ?? samples.length
  const end = Math.min(nextKey, target.index + 1 + REORDER_LOOKAHEAD)

  let byteStart = Infinity
  let byteEnd = 0
  for (let i = first; i < end; i++) {
    byteStart = Math.min(byteStart, samples[i].offset)
    byteEnd = Math.max(byteEnd, samples[i].offset + samples[i].size)
  }
  return { target, first, end, byteStart, byteEnd }
}

/** The encoded samples of a plan, read from the file in one go where it is reasonable. */
export async function readFrameChunks(index: Mp4SampleIndex, read: RangeReader, plan: FramePlan): Promise<RawChunk[]> {
  const span = plan.byteEnd - plan.byteStart
  const block = span <= MAX_SPAN_BYTES ? await readExact(read, plan.byteStart, span) : null
  const chunks: RawChunk[] = []
  for (let i = plan.first; i < plan.end; i++) {
    const s = index.samples[i]
    const data = block
      ? block.subarray(s.offset - plan.byteStart, s.offset - plan.byteStart + s.size)
      : await readExact(read, s.offset, s.size)
    chunks.push({
      type: s.isKeyframe ? 'key' : 'delta',
      timestamp: Math.round(s.pts * 1_000_000),
      duration: Math.round(s.duration * 1_000_000),
      data,
    })
  }
  return chunks
}
