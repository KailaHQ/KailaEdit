// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ffmpegPath from 'ffmpeg-static'
import { spawnSync } from 'child_process'
import { createRequire } from 'module'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  planFrameDecode,
  readFrameChunks,
  readMp4Index,
  sampleAtTime,
  type RangeReader,
} from '../RangeMp4Index'

const MP4Box = createRequire(import.meta.url)('mp4box')

let dir = ''
let endLayout = ''
let startLayout = ''
let large = ''

function ffmpeg(args: string[]): void {
  const result = spawnSync(ffmpegPath as string, ['-hide_banner', '-loglevel', 'error', '-y', ...args])
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr?.toString()}`)
}

function topLevelBoxes(file: string): string[] {
  const buf = fs.readFileSync(file)
  const names: string[] = []
  for (let pos = 0; pos + 8 <= buf.length;) {
    let size = buf.readUInt32BE(pos)
    if (size === 1) size = Number(buf.readBigUInt64BE(pos + 8))
    names.push(buf.toString('latin1', pos + 4, pos + 8))
    pos += size
  }
  return names
}

/** A reader over a file that remembers what it was asked for. */
function trackedReader(file: string) {
  const fd = fs.openSync(file, 'r')
  const totalSize = fs.statSync(file).size
  const calls: Array<{ offset: number; length: number }> = []
  let bytes = 0
  const read: RangeReader = async (offset, length) => {
    const n = Math.max(0, Math.min(length, totalSize - offset))
    const buf = Buffer.alloc(n)
    fs.readSync(fd, buf, 0, n, offset)
    calls.push({ offset, length })
    bytes += n
    return { data: new Uint8Array(buf.buffer, buf.byteOffset, n), totalSize }
  }
  return { read, calls, bytesRead: () => bytes, totalSize, close: () => fs.closeSync(fd) }
}

/** The sample table as a parse of the whole file reports it. */
function fullParse(file: string) {
  const buf = fs.readFileSync(file)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer & { fileStart?: number }
  ab.fileStart = 0
  const mp4 = MP4Box.createFile()
  let samples: Array<{ cts: number; dts: number; offset: number; size: number; is_sync: boolean }> = []
  mp4.onReady = (info: any) => { samples = mp4.getTrackById(info.videoTracks[0].id).samples }
  mp4.appendBuffer(ab)
  mp4.flush()
  return samples
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'range-mp4-'))
  endLayout = path.join(dir, 'end.mp4')
  startLayout = path.join(dir, 'start.mp4')
  large = path.join(dir, 'large.mp4')
  const source = ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=6', '-f', 'lavfi', '-i', 'sine=d=6']
  // B-frames and a keyframe every second, as a phone writes them.
  ffmpeg([...source, '-c:v', 'libx264', '-g', '30', '-bf', '2', '-c:a', 'aac', '-shortest', endLayout])
  ffmpeg(['-i', endLayout, '-c', 'copy', '-movflags', '+faststart', startLayout])
  // Lossless, so the footage is megabytes and the sliver read of it means something.
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=10', '-c:v', 'libx264', '-crf', '0', '-preset', 'ultrafast', '-g', '30', large])
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('sample table read from the end of a file', () => {
  it('exercises both places a file keeps its index', () => {
    const end = topLevelBoxes(endLayout)
    const start = topLevelBoxes(startLayout)
    expect(end.indexOf('moov')).toBeGreaterThan(end.indexOf('mdat'))
    expect(start.indexOf('moov')).toBeLessThan(start.indexOf('mdat'))
  })

  it.each([['at the end', () => endLayout], ['at the start', () => startLayout]])(
    'matches a parse of the whole file when the index is %s',
    async (_name, file) => {
      const reader = trackedReader(file())
      const index = await readMp4Index(reader.read)
      reader.close()
      const truth = fullParse(file())

      expect(index.samples).toHaveLength(truth.length)
      expect(index.trackInfo.width).toBe(640)
      expect(index.trackInfo.height).toBe(360)
      expect(index.trackInfo.codec).toMatch(/^avc1/)
      expect(index.trackInfo.description?.byteLength).toBeGreaterThan(0)

      // Everything but the presentation origin, which the edit list moves, must be exact.
      const timescale = index.trackInfo.timescale
      const shift = index.samples[0].pts * timescale - truth[0].cts
      truth.forEach((t, i) => {
        const s = index.samples[i]
        expect(s.offset).toBe(t.offset)
        expect(s.size).toBe(t.size)
        expect(s.isKeyframe).toBe(Boolean(t.is_sync))
        expect(s.dts * timescale - t.dts).toBeCloseTo(shift, 3)
        expect(s.pts * timescale - t.cts).toBeCloseTo(shift, 3)
      })
      expect(index.keyframeIndices.length).toBeGreaterThanOrEqual(6)
      expect(index.duration).toBeGreaterThan(5.9)
    },
  )

  it('reads a sliver of a large file, wherever the index is', async () => {
    const reader = trackedReader(large)
    await readMp4Index(reader.read)
    reader.close()
    expect(reader.totalSize).toBeGreaterThan(5 * 1024 * 1024)
    expect(reader.calls.length).toBeLessThanOrEqual(6)
    expect(reader.bytesRead()).toBeLessThan(reader.totalSize * 0.03)
  })

  it('rejects a file with no index', async () => {
    const junk = Buffer.alloc(2048)
    junk.writeUInt32BE(2048, 0)
    junk.write('mdat', 4, 'latin1')
    const read: RangeReader = async (offset, length) => ({
      data: new Uint8Array(junk.subarray(offset, Math.min(junk.length, offset + length))),
      totalSize: junk.length,
    })
    await expect(readMp4Index(read)).rejects.toThrow(/No moov/)
  })
})

describe('choosing what to decode for a frame', () => {
  it('finds the frame on screen, the keyframe it depends on and the bytes between', async () => {
    const reader = trackedReader(endLayout)
    const index = await readMp4Index(reader.read)
    reader.close()

    for (const time of [0, 0.01, 1, 1.234, 2.999, 3, 5.5, 5.99]) {
      const plan = planFrameDecode(index, time)
      const onScreen = index.samples
        .filter(s => s.pts <= time + 0.000001)
        .reduce((best, s) => (s.pts > best.pts ? s : best))
      expect(plan.target.index).toBe(onScreen.index)
      expect(index.samples[plan.first].isKeyframe).toBe(true)
      expect(plan.first).toBeLessThanOrEqual(plan.target.index)
      expect(plan.end).toBeGreaterThan(plan.target.index)
      expect(plan.byteStart).toBeLessThanOrEqual(plan.target.offset)
      expect(plan.byteEnd).toBeGreaterThanOrEqual(plan.target.offset + plan.target.size)
      // Nothing between the keyframe and the target is another keyframe.
      for (let i = plan.first + 1; i <= plan.target.index; i++) expect(index.samples[i].isKeyframe).toBe(false)
    }
  })

  it('clamps a time before the start or past the end to the first and last frame', async () => {
    const reader = trackedReader(endLayout)
    const index = await readMp4Index(reader.read)
    reader.close()
    const first = sampleAtTime(index, -5)
    const last = sampleAtTime(index, 500)
    expect(first.pts).toBe(Math.min(...index.samples.map(s => s.pts)))
    expect(last.pts).toBe(Math.max(...index.samples.map(s => s.pts)))
  })

  it('reads the stored bytes of those samples and nothing like the whole file', async () => {
    const reader = trackedReader(large)
    const index = await readMp4Index(reader.read)
    const afterIndex = reader.bytesRead()
    // Late in the footage: the cost must not depend on how far in it is.
    const plan = planFrameDecode(index, 8.4)
    const chunks = await readFrameChunks(index, reader.read, plan)
    reader.close()

    const file = fs.readFileSync(large)
    expect(chunks).toHaveLength(plan.end - plan.first)
    chunks.forEach((chunk, i) => {
      const s = index.samples[plan.first + i]
      expect(chunk.type).toBe(s.isKeyframe ? 'key' : 'delta')
      expect(chunk.timestamp).toBe(Math.round(s.pts * 1_000_000))
      expect(Buffer.from(chunk.data).equals(file.subarray(s.offset, s.offset + s.size))).toBe(true)
    })
    expect(chunks[0].type).toBe('key')
    expect(reader.bytesRead() - afterIndex).toBeLessThan(reader.totalSize * 0.25)
  })
})
