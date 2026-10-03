import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  getHardwareEncoderCandidates,
  getEncoderDisplayName,
  getEncoderArgs,
  detectHardwareEncoders,
  getCachedHardwareCapabilities,
  setCachedHardwareCapabilitiesForTest,
} from '../hardware-encoder'
import * as hwModule from '../hardware-encoder'

describe('hardware-encoder', () => {
  beforeEach(() => {
    setCachedHardwareCapabilitiesForTest(null)
  })

  afterEach(() => {
    setCachedHardwareCapabilitiesForTest(null)
    vi.restoreAllMocks()
  })

  it('returns appropriate platform candidate encoders', () => {
    expect(getHardwareEncoderCandidates('darwin')).toEqual(['h264_videotoolbox'])
    expect(getHardwareEncoderCandidates('win32')).toEqual(['h264_nvenc', 'h264_qsv', 'h264_amf'])
    expect(getHardwareEncoderCandidates('linux')).toContain('h264_nvenc')
  })

  it('formats display names for all supported encoders', () => {
    expect(getEncoderDisplayName('h264_nvenc')).toBe('NVIDIA NVENC (H.264)')
    expect(getEncoderDisplayName('h264_qsv')).toBe('Intel Quick Sync (H.264)')
    expect(getEncoderDisplayName('h264_videotoolbox')).toBe('Apple VideoToolbox (H.264)')
    expect(getEncoderDisplayName('h264_amf')).toBe('AMD AMF (H.264)')
    expect(getEncoderDisplayName('libx264')).toBe('CPU (libx264)')
    expect(getEncoderDisplayName(null)).toContain('libx264')
  })

  it('generates correct encoder arguments for all encoder types', () => {
    const x264Args = getEncoderArgs('libx264', 18, 'fast')
    expect(x264Args).toContain('libx264')
    expect(x264Args).toContain('-crf')
    expect(x264Args).toContain('18')

    const nvencArgs = getEncoderArgs('h264_nvenc', 18, 'p4')
    expect(nvencArgs).toContain('h264_nvenc')
    expect(nvencArgs).toContain('-cq')
    expect(nvencArgs).toContain('-preset')
    expect(nvencArgs).toContain('p4')

    const qsvArgs = getEncoderArgs('h264_qsv', 20, 'medium')
    expect(qsvArgs).toContain('h264_qsv')
    expect(qsvArgs).toContain('-global_quality')

    const vtbArgs = getEncoderArgs('h264_videotoolbox', 18)
    expect(vtbArgs).toContain('h264_videotoolbox')
    expect(vtbArgs).toContain('-q:v')

    const amfArgs = getEncoderArgs('h264_amf', 18, 'speed')
    expect(amfArgs).toContain('h264_amf')
    expect(amfArgs).toContain('-rc')
    expect(amfArgs).toContain('cqp')
  })

  it('probes and caches hardware capabilities', async () => {
    const mockProbe = (_: string, enc: string) => enc === 'h264_nvenc'

    const caps = await detectHardwareEncoders('mock-ffmpeg', true, mockProbe)
    expect(caps.hardwareAccelerationSupported).toBe(true)
    expect(caps.preferredEncoder).toBe('h264_nvenc')
    expect(caps.availableEncoders).toEqual(['h264_nvenc'])

    // Re-retrieval from cache
    const cached = getCachedHardwareCapabilities()
    expect(cached).toBe(caps)
  })

  it('handles scenario when no hardware encoder is operational', async () => {
    const mockProbe = () => false

    const caps = await detectHardwareEncoders('mock-ffmpeg', true, mockProbe)
    expect(caps.hardwareAccelerationSupported).toBe(false)
    expect(caps.preferredEncoder).toBeNull()
    expect(caps.availableEncoders).toEqual([])
  })

  it('keeps candidate order as preference even when a later probe finishes first', async () => {
    const candidates = getHardwareEncoderCandidates()
    const [first, second] = candidates
    // The first candidate answers last.
    const mockProbe = (_: string, enc: string) =>
      new Promise<boolean>(resolve => setTimeout(() => resolve(enc === first || enc === second), enc === first ? 20 : 0))

    const caps = await detectHardwareEncoders('mock-ffmpeg', true, mockProbe)
    expect(caps.preferredEncoder).toBe(first)
    expect(caps.availableEncoders).toEqual([first, second])
  })

  it('shares one in-flight probe between callers', async () => {
    setCachedHardwareCapabilitiesForTest(null)
    let probes = 0
    const mockProbe = async () => { probes++; return false }

    const a = detectHardwareEncoders('mock-ffmpeg', false, mockProbe)
    const b = detectHardwareEncoders('mock-ffmpeg', false, mockProbe)
    expect(b).toBe(a)
    await a
    expect(probes).toBe(getHardwareEncoderCandidates().length)
  })
})