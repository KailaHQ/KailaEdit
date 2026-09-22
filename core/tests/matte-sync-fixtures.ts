/**
 * Deterministic fixtures for matte synchronisation tests.
 *
 * The fixtures are self-contained data — no media files, no AI model. They let
 * tests prove the pipeline's frame-matching logic is correct at every boundary
 * without touching inference, ffmpeg, or an Electron window.
 *
 * Naming: a "source frame" is one decoded frame of the original media. An
 * "alpha frame" is the matte that belongs to that source frame. A "pair" is
 * the two presented together. The whole point of Sprint 20 is that these two
 * always agree.
 */

// ---------------------------------------------------------------------------
// Frame entry: one decoded frame of a media file
// ---------------------------------------------------------------------------

export interface FixtureFrameEntry {
  /** 0-based ordinal within the source media. */
  frameId: number
  /** Presentation timestamp in microseconds (integer to avoid float drift). */
  pts: number
  /** Duration of this frame's presentation interval, microseconds. */
  duration: number
  /** Decode timestamp — differs from PTS when B-frames are used. */
  dts: number
  /** Whether this sample is a sync / key frame. */
  isKeyframe: boolean
}

// ---------------------------------------------------------------------------
// Fixture sequences
// ---------------------------------------------------------------------------

/** CFR 30 fps, 5 seconds, no B-frames. The simplest possible case. */
export function cfr30fps5s(): FixtureFrameEntry[] {
  const fps = 30
  const frameDuration = Math.round(1_000_000 / fps) // 33333 µs
  const count = fps * 5
  return Array.from({ length: count }, (_, i) => ({
    frameId: i,
    pts: i * frameDuration,
    duration: frameDuration,
    dts: i * frameDuration,
    isKeyframe: i % 30 === 0,
  }))
}

/** CFR 24 fps, 3 seconds — tests non-round frame duration. */
export function cfr24fps3s(): FixtureFrameEntry[] {
  const fps = 24
  const frameDuration = Math.round(1_000_000 / fps) // 41667 µs
  const count = fps * 3
  return Array.from({ length: count }, (_, i) => ({
    frameId: i,
    pts: i * frameDuration,
    duration: frameDuration,
    dts: i * frameDuration,
    isKeyframe: i % 24 === 0,
  }))
}

/** CFR 25 fps, 4 seconds — PAL rate. */
export function cfr25fps4s(): FixtureFrameEntry[] {
  const fps = 25
  const frameDuration = Math.round(1_000_000 / fps) // 40000 µs
  const count = fps * 4
  return Array.from({ length: count }, (_, i) => ({
    frameId: i,
    pts: i * frameDuration,
    duration: frameDuration,
    dts: i * frameDuration,
    isKeyframe: i % 25 === 0,
  }))
}

/** CFR 60 fps, 2 seconds. */
export function cfr60fps2s(): FixtureFrameEntry[] {
  const fps = 60
  const frameDuration = Math.round(1_000_000 / fps) // 16667 µs
  const count = fps * 2
  return Array.from({ length: count }, (_, i) => ({
    frameId: i,
    pts: i * frameDuration,
    duration: frameDuration,
    dts: i * frameDuration,
    isKeyframe: i % 60 === 0,
  }))
}

/**
 * VFR sequence simulating a phone recording.
 *
 * Alternates between 30 fps and 15 fps segments. Frame durations are uneven.
 * This catches any code that assumes constant frame spacing.
 */
export function vfrPhoneRecording(): FixtureFrameEntry[] {
  const entries: FixtureFrameEntry[] = []
  let pts = 0
  let id = 0
  // 30 fps for 1s, 15 fps for 1s, 30 fps for 1s
  const segments: Array<{ fps: number; seconds: number }> = [
    { fps: 30, seconds: 1 },
    { fps: 15, seconds: 1 },
    { fps: 30, seconds: 1 },
  ]
  for (const seg of segments) {
    const frameDuration = Math.round(1_000_000 / seg.fps)
    const count = seg.fps * seg.seconds
    for (let i = 0; i < count; i++) {
      entries.push({
        frameId: id,
        pts,
        duration: frameDuration,
        dts: pts,
        isKeyframe: id % 30 === 0,
      })
      pts += frameDuration
      id++
    }
  }
  return entries
}

/**
 * CFR 30 fps with B-frames.
 *
 * GOP pattern: I B B P B B P B B P (GOP=10, 2 B-frames between references).
 * DTS and PTS diverge for B-frames.
 */
export function cfr30fpsWithBFrames(): FixtureFrameEntry[] {
  const fps = 30
  const frameDuration = Math.round(1_000_000 / fps)
  const count = 60 // 2 seconds
  const entries: FixtureFrameEntry[] = []

  // Simplified IBBBPBBBP... pattern where B-frames have reordered DTS
  for (let i = 0; i < count; i++) {
    const gopPos = i % 10
    const isKey = gopPos === 0
    const isRef = isKey || gopPos === 3 || gopPos === 6 || gopPos === 9
    // B-frames are decoded before their reference but presented after.
    // Simplified: DTS = PTS - 2*frameDuration for B-frames
    const pts = i * frameDuration
    const dts = isRef ? pts : pts - 2 * frameDuration
    entries.push({
      frameId: i,
      pts,
      duration: frameDuration,
      dts: Math.max(0, dts),
      isKeyframe: isKey,
    })
  }
  return entries
}

/**
 * 90° rotation (phone portrait → landscape coded).
 *
 * Same as CFR 30fps but the fixture carries rotation metadata so the consumer
 * can verify it propagates through the index correctly.
 */
export interface FixtureMetadata {
  entries: FixtureFrameEntry[]
  rotation: number
  /** Coded dimensions (before rotation). */
  codedWidth: number
  codedHeight: number
  /** Display dimensions (after rotation). */
  displayWidth: number
  displayHeight: number
  fps: number
  durationSec: number
}

export function rotated90Portrait(): FixtureMetadata {
  const entries = cfr30fps5s()
  return {
    entries,
    rotation: 90,
    codedWidth: 1920,
    codedHeight: 1080,
    displayWidth: 1080,
    displayHeight: 1920,
    fps: 30,
    durationSec: 5,
  }
}

export function standardLandscape(): FixtureMetadata {
  const entries = cfr30fps5s()
  return {
    entries,
    rotation: 0,
    codedWidth: 1920,
    codedHeight: 1080,
    displayWidth: 1920,
    displayHeight: 1080,
    fps: 30,
    durationSec: 5,
  }
}

// ---------------------------------------------------------------------------
// Expected PTS tables for boundary tests
// ---------------------------------------------------------------------------

/**
 * What source frame should be selected for a given timeline time, given
 * trim/speed/reverse parameters.
 */
export interface ExpectedFrameMapping {
  /** Timeline time in seconds. */
  timelineTime: number
  /** Expected source frame id (0-based ordinal). */
  expectedFrameId: number
  /** Expected source PTS in µs. */
  expectedPts: number
  /** Description of why this case matters. */
  label: string
}

/**
 * Basic CFR 30fps, no trim, speed 1x, not reversed.
 * Timeline time = source time.
 */
export function basicMappingCfr30(): ExpectedFrameMapping[] {
  const fd = 33333 // frame duration µs
  return [
    { timelineTime: 0, expectedFrameId: 0, expectedPts: 0, label: 'first frame' },
    { timelineTime: 0.5, expectedFrameId: 15, expectedPts: 15 * fd, label: 'mid-second' },
    { timelineTime: 1.0, expectedFrameId: 30, expectedPts: 30 * fd, label: 'exactly 1s' },
    // 4.966s = 4966000µs. Frame 149 starts at 149*33333=4966617µs, so 4.966s is still in frame 148.
    { timelineTime: 4.966, expectedFrameId: 148, expectedPts: 148 * fd, label: 'last frame via time' },
    // Actually reach frame 149: its PTS is 4966617µs → 4.966617s
    { timelineTime: 4.967, expectedFrameId: 149, expectedPts: 149 * fd, label: 'true last frame' },
    // Frame boundary: 0.033333s is the end of frame 0, start of frame 1
    { timelineTime: 0.033, expectedFrameId: 0, expectedPts: 0, label: 'just before frame 1' },
    { timelineTime: 0.034, expectedFrameId: 1, expectedPts: fd, label: 'just after frame 1 start' },
  ]
}

/**
 * CFR 30fps, trimStart = 2s, speed 1x.
 * Timeline time 0 → source time 2s → frame 60.
 */
export function trimmedMappingCfr30(): ExpectedFrameMapping[] {
  const fd = 33333
  return [
    { timelineTime: 0, expectedFrameId: 60, expectedPts: 60 * fd, label: 'trimmed first frame' },
    { timelineTime: 1.0, expectedFrameId: 90, expectedPts: 90 * fd, label: '1s into trimmed clip' },
    // 2.966s timeline + 2s trim = 4.966s source = frame 148 (see basicMapping comment)
    { timelineTime: 2.966, expectedFrameId: 148, expectedPts: 148 * fd, label: 'last frame of trimmed clip' },
  ]
}

/**
 * CFR 30fps, speed 2x.
 * Timeline time 1s → source time 2s → frame 60.
 */
export function speed2xMappingCfr30(): ExpectedFrameMapping[] {
  const fd = 33333
  return [
    { timelineTime: 0, expectedFrameId: 0, expectedPts: 0, label: '2x first frame' },
    { timelineTime: 0.5, expectedFrameId: 30, expectedPts: 30 * fd, label: '2x: 0.5s timeline = 1s source' },
    { timelineTime: 1.0, expectedFrameId: 60, expectedPts: 60 * fd, label: '2x: 1s timeline = 2s source' },
  ]
}

/**
 * CFR 30fps, speed 0.5x.
 * Timeline time 2s → source time 1s → frame 30.
 */
export function speed05xMappingCfr30(): ExpectedFrameMapping[] {
  const fd = 33333
  return [
    { timelineTime: 0, expectedFrameId: 0, expectedPts: 0, label: '0.5x first frame' },
    { timelineTime: 2.0, expectedFrameId: 30, expectedPts: 30 * fd, label: '0.5x: 2s timeline = 1s source' },
    { timelineTime: 4.0, expectedFrameId: 60, expectedPts: 60 * fd, label: '0.5x: 4s timeline = 2s source' },
  ]
}

/**
 * CFR 30fps, reversed.
 * Timeline time 0 → source last frame; timeline end → source frame 0.
 */
export function reversedMappingCfr30(): ExpectedFrameMapping[] {
  const fd = 33333
  const lastId = 149
  return [
    { timelineTime: 0, expectedFrameId: lastId, expectedPts: lastId * fd, label: 'reversed first frame = source last' },
    { timelineTime: 1.0, expectedFrameId: lastId - 30, expectedPts: (lastId - 30) * fd, label: 'reversed 1s in' },
    // Reversed: timeline 4.966s → source = duration - 4.966*speed = 5.0 - 4.966 = 0.034s
    // 0.034s = 34000µs → frame 1 (frame 0 is [0, 33333), frame 1 is [33333, 66666))
    { timelineTime: 4.966, expectedFrameId: 1, expectedPts: fd, label: 'reversed near-end frame' },
  ]
}

// ---------------------------------------------------------------------------
// Deterministic seek sequences (seeded)
// ---------------------------------------------------------------------------

/**
 * A simple seeded PRNG (xorshift32) for reproducible seek sequences.
 * Not cryptographic; just needs to be deterministic across runs.
 */
export function seededRandom(seed: number): () => number {
  let state = seed | 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >> 17
    state ^= state << 5
    return (state >>> 0) / 0xFFFFFFFF
  }
}

/**
 * Generates `count` random seek positions within [0, durationSec).
 */
export function randomSeekSequence(seed: number, count: number, durationSec: number): number[] {
  const rng = seededRandom(seed)
  return Array.from({ length: count }, () => rng() * durationSec)
}

/**
 * Generates a bidirectional drag sequence: sweeps forward then backward.
 */
export function bidirectionalDragSequence(
  startSec: number,
  endSec: number,
  steps: number,
): number[] {
  const forward: number[] = []
  const backward: number[] = []
  const range = endSec - startSec
  for (let i = 0; i <= steps; i++) {
    forward.push(startSec + (range * i) / steps)
  }
  for (let i = steps; i >= 0; i--) {
    backward.push(startSec + (range * i) / steps)
  }
  return [...forward, ...backward]
}

// ---------------------------------------------------------------------------
// Synthetic alpha pattern for fixture verification
// ---------------------------------------------------------------------------

/**
 * Creates a synthetic alpha mask with a known pattern at each frame.
 *
 * The pattern embeds the frame id in the pixel data so a test can read
 * back which frame's matte is on screen without depending on AI output.
 *
 * Pattern: the first 4 pixels of row 0 encode the frame id as a big-endian
 * 32-bit integer (value 0–255 per pixel), and the rest is a checkerboard
 * that inverts every 8 frames.
 */
export function syntheticAlphaMask(frameId: number, width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height)
  // Encode frame id in first 4 pixels
  data[0] = (frameId >>> 24) & 0xFF
  data[1] = (frameId >>> 16) & 0xFF
  data[2] = (frameId >>> 8) & 0xFF
  data[3] = frameId & 0xFF
  // Checkerboard (inverts every 8 frames for visual distinction)
  const invert = Math.floor(frameId / 8) % 2 === 1
  for (let y = 0; y < height; y++) {
    for (let x = (y === 0 ? 4 : 0); x < width; x++) {
      const checker = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0) !== invert
      data[y * width + x] = checker ? 255 : 0
    }
  }
  return data
}

/**
 * Reads the frame id back from a synthetic alpha mask.
 * Returns -1 if the mask doesn't have the expected header.
 */
export function readFrameIdFromAlpha(data: Uint8Array): number {
  if (data.length < 4) return -1
  return (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]
}
