import { HardwareVideoDecoder } from './HardwareVideoDecoder'
import { fileUrlToPath } from './VideoDemuxer'
import {
  planFrameDecode,
  readFrameChunks,
  readMp4Index,
  type Mp4SampleIndex,
  type RangeReader,
} from './RangeMp4Index'

/** A reader for a local file, through the main process (the renderer cannot open it). */
export function makeLocalRangeReader(filePathOrUrl: string): RangeReader {
  const api = (window as {
    electronAPI?: { readMediaChunk?: (input: { filePath: string; offset: number; length: number }) => Promise<{ data: Uint8Array; totalSize: number }> }
  }).electronAPI
  if (!api?.readMediaChunk) {
    throw new Error('[FirstFrameSource] readMediaChunk is unavailable; cannot read a local file')
  }
  const filePath = filePathOrUrl.startsWith('file://') ? fileUrlToPath(filePathOrUrl) : filePathOrUrl
  return (offset, length) => api.readMediaChunk!({ filePath, offset, length })
}

/**
 * Decodes single frames of a video on demand.
 *
 * Nothing is loaded up front. The sample table comes from the file's `moov` box and a frame
 * costs one read of the group of pictures it belongs to, so a frame cut from the middle of a
 * long recording is as quick to reach as one at its start. The source file is never read in
 * full, and an HTML video element is not involved.
 */
export class FirstFrameSource {
  private indexPromise: Promise<Mp4SampleIndex> | null = null
  private decoder: HardwareVideoDecoder | null = null
  private decoderReady: Promise<boolean> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private destroyed = false

  constructor(private readonly read: RangeReader) {}

  /** The sample table. Read once; a failure is kept, so a file that cannot be read is not retried. */
  open(): Promise<Mp4SampleIndex> {
    if (!this.indexPromise) this.indexPromise = readMp4Index(this.read)
    return this.indexPromise
  }

  private ensureDecoder(index: Mp4SampleIndex): Promise<boolean> {
    if (!this.decoderReady) {
      this.decoder = new HardwareVideoDecoder({ preferHardware: true })
      this.decoderReady = this.decoder.configure(index.trackInfo)
    }
    return this.decoderReady
  }

  /**
   * The frame shown at `time`, as a VideoFrame the caller must close; null if it cannot be
   * decoded here. Calls are served one at a time: the decoder is reset for each.
   */
  frameAt(time: number): Promise<VideoFrame | null> {
    const run = this.queue.then(() => this.decodeFrameAt(time))
    this.queue = run.catch(() => {})
    return run
  }

  private async decodeFrameAt(time: number): Promise<VideoFrame | null> {
    const index = await this.open()
    if (this.destroyed) return null
    if (!(await this.ensureDecoder(index)) || !this.decoder || this.destroyed) return null

    const plan = planFrameDecode(index, time)
    const raw = await readFrameChunks(index, this.read, plan)
    if (this.destroyed) return null
    const chunks = raw.map(chunk => new EncodedVideoChunk(chunk))
    return this.decoder.decodeChunks(chunks, plan.target.pts)
  }

  destroy(): void {
    this.destroyed = true
    this.decoder?.destroy()
    this.decoder = null
  }
}

const MAX_CACHED_SOURCES = 3
const sources = new Map<string, FirstFrameSource>()

/** The source for a file, kept for the next frame asked of it; the least recent are let go. */
export function getFirstFrameSource(filePathOrUrl: string): FirstFrameSource {
  const known = sources.get(filePathOrUrl)
  if (known) {
    sources.delete(filePathOrUrl)
    sources.set(filePathOrUrl, known)
    return known
  }
  const created = new FirstFrameSource(makeLocalRangeReader(filePathOrUrl))
  sources.set(filePathOrUrl, created)
  while (sources.size > MAX_CACHED_SOURCES) {
    const oldest = sources.keys().next().value as string
    sources.get(oldest)?.destroy()
    sources.delete(oldest)
  }
  return created
}

export function clearFirstFrameSources(): void {
  for (const source of sources.values()) source.destroy()
  sources.clear()
}
