import { describe, it, expect, vi } from 'vitest'
import { parseFfmpegProbeOutput, probeVideo } from '../probe'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('../../export/ffmpeg-utils', () => ({
  findFfmpegPath: vi.fn(() => '/mock/bin/ffmpeg'),
}))

describe('probe.ts - parseFfmpegProbeOutput', () => {
  it('parses standard landscape video without rotation', () => {
    const stderr = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'landscape.mp4':
  Duration: 00:01:23.45, start: 0.000000, bitrate: 4500 kb/s
  Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 4300 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)
  Stream #0:1(und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 192 kb/s (default)
`
    const res = parseFfmpegProbeOutput(stderr)
    expect(res.width).toBe(1920)
    expect(res.height).toBe(1080)
    expect(res.fps).toBe(29.97)
    expect(res.duration).toBeCloseTo(83.45, 2)
    expect(res.rotation).toBe(0)
  })

  it('handles rotation of 90 via displaymatrix and swaps width/height', () => {
    const stderr = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'portrait_phone.mp4':
  Duration: 00:00:15.50, start: 0.000000, bitrate: 8500 kb/s
  Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 8300 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
    Side data:
      displaymatrix: rotation of -90.00 degrees
  Stream #0:1(und): Audio: aac (LC), 48000 Hz, stereo
`
    const res = parseFfmpegProbeOutput(stderr)
    expect(res.width).toBe(1080)
    expect(res.height).toBe(1920)
    expect(res.fps).toBe(30)
    expect(res.duration).toBeCloseTo(15.5, 2)
    expect(res.rotation).toBe(270) // -90 normalized is 270
  })

  it('handles rotation of 270 via displaymatrix and swaps width/height', () => {
    const stderr = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'portrait_phone_270.mp4':
  Duration: 00:00:08.00, start: 0.000000, bitrate: 6000 kb/s
  Stream #0:0(und): Video: h264, yuv420p, 1920x1080, 60 fps
    Side data:
      displaymatrix: rotation of -270.00 degrees
`
    const res = parseFfmpegProbeOutput(stderr)
    expect(res.width).toBe(1080)
    expect(res.height).toBe(1920)
    expect(res.fps).toBe(60)
    expect(res.duration).toBe(8)
    expect(res.rotation).toBe(90) // -270 normalized is 90
  })

  it('handles legacy metadata rotate tag (rotate: 90)', () => {
    const stderr = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'legacy_rotate.mp4':
  Duration: 00:00:05.00, start: 0.000000, bitrate: 4000 kb/s
  Stream #0:0(und): Video: h264, yuv420p, 1280x720, 24 fps
    Metadata:
      rotate          : 90
`
    const res = parseFfmpegProbeOutput(stderr)
    expect(res.width).toBe(720)
    expect(res.height).toBe(1280)
    expect(res.fps).toBe(24)
    expect(res.duration).toBe(5)
    expect(res.rotation).toBe(90)
  })

  it('handles still image with no Duration line', () => {
    const stderr = `
Input #0, png_pipe, from 'photo.png':
  Duration: N/A, bitrate: N/A
  Stream #0:0: Video: png, rgba(pc), 3840x2160 [SAR 1:1 DAR 16:9], 25 fps, 25 tbr, 25 tbn
`
    const res = parseFfmpegProbeOutput(stderr)
    expect(res.width).toBe(3840)
    expect(res.height).toBe(2160)
    expect(res.fps).toBe(25)
    expect(res.duration).toBe(0)
    expect(res.rotation).toBe(0)
  })

  it('isolates stream side-data so multiple video streams do not bleed rotation', () => {
    const stderr = `
Input #0, matroska,webm, from 'multi_stream.mkv':
  Duration: 00:00:30.00, start: 0.000000, bitrate: 5000 kb/s
  Stream #0:0(eng): Video: h264 (High), yuv420p, 1920x1080, 30 fps
    Metadata:
      title           : Primary Stream
  Stream #0:1(und): Video: mjpeg, yuvj420p, 800x600
    Metadata:
      rotate          : 90
      title           : Thumbnail with rotation
  Stream #0:2(eng): Audio: aac, 48000 Hz, stereo
`
    const res = parseFfmpegProbeOutput(stderr)
    // Stream #0:0 has no rotation, so it must stay 1920x1080 with rotation = 0
    expect(res.width).toBe(1920)
    expect(res.height).toBe(1080)
    expect(res.rotation).toBe(0)
  })

  it('prioritizes real video stream over an attached cover art video stream', () => {
    const stderr = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'with_cover.mp4':
  Duration: 00:00:40.00, start: 0.000000, bitrate: 5000 kb/s
  Stream #0:0: Video: png, rgba(pc), 500x500 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)
  Stream #0:1(und): Video: h264, yuv420p, 1920x1080, 30 fps
    Side data:
      displaymatrix: rotation of -90.00 degrees
`
    const res = parseFfmpegProbeOutput(stderr)
    expect(res.width).toBe(1080)
    expect(res.height).toBe(1920)
    expect(res.rotation).toBe(270)
  })
})

describe('probe.ts - probeVideo function', () => {
  it('invokes ffmpeg process and returns parsed probe info', async () => {
    const mockProc = new EventEmitter() as any
    mockProc.stderr = new EventEmitter()

    vi.mocked(spawn).mockImplementationOnce(() => {
      setTimeout(() => {
        mockProc.stderr.emit(
          'data',
          Buffer.from(`
Input #0, mov,mp4:
  Duration: 00:00:10.00
  Stream #0:0: Video: h264, yuv420p, 1280x720, 30 fps
`),
        )
        mockProc.emit('close', 0)
      }, 5)
      return mockProc
    })

    const info = await probeVideo('/media/test.mp4')
    expect(info.width).toBe(1280)
    expect(info.height).toBe(720)
    expect(info.duration).toBe(10)
    expect(info.fps).toBe(30)
  })

  it('supports overload with explicit ffmpegPath', async () => {
    const mockProc = new EventEmitter() as any
    mockProc.stderr = new EventEmitter()

    vi.mocked(spawn).mockImplementationOnce((cmd, args) => {
      expect(cmd).toBe('/custom/ffmpeg')
      setTimeout(() => {
        mockProc.stderr.emit(
          'data',
          Buffer.from(`
Input #0, mov,mp4:
  Duration: 00:00:05.00
  Stream #0:0: Video: h264, yuv420p, 1920x1080, 24 fps
`),
        )
        mockProc.emit('close', 0)
      }, 5)
      return mockProc
    })

    const info = await probeVideo('/custom/ffmpeg', '/media/test.mp4')
    expect(info.width).toBe(1920)
    expect(info.height).toBe(1080)
    expect(info.duration).toBe(5)
  })
})
