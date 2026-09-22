/**
 * Test harness for matte synchronisation.
 *
 * Records every frame-pair presentation request and its outcome so tests can
 * assert on the full trace rather than one-shot snapshots. The harness is
 * pure TypeScript — no DOM, no Electron, no AI — so it runs in Vitest without
 * any special environment.
 */

export type MatteBackend = 'webcodecs' | 'html-video' | 'live-inference' | 'none'
export type MatteState = 'ready' | 'preparing' | 'stale' | 'error' | 'missing'

export interface PresentationRecord {
  /** Monotonically increasing per test run. */
  sequence: number
  /** Incremented on clip/project/bake/seek change. */
  generation: number
  /** Source frame id that was requested. */
  requestedSourceFrameId: number
  /** Alpha frame id that was actually presented (-1 = none). */
  presentedAlphaFrameId: number
  /** Timeline time the request was for. */
  timelineTime: number
  /** Which backend provided the matte. */
  matteBackend: MatteBackend
  /** Matte state at presentation time. */
  matteState: MatteState
  /** Simulated latency of the matte delivery, ms. */
  matteLatencyMs: number
  /** Whether the frame was dropped (not presented). */
  dropped: boolean
  /** Timestamp of presentation (performance.now() equivalent for tests). */
  presentedAt: number
}

/**
 * Accumulates presentation records and provides analysis helpers.
 */
export class MatteTestHarness {
  private records: PresentationRecord[] = []
  private sequence = 0
  private generation = 0
  private clock = 0

  /** Start a new generation (simulates clip/project switch). */
  nextGeneration(): number {
    return ++this.generation
  }

  /** Advance the simulated clock. */
  advanceClock(ms: number): void {
    this.clock += ms
  }

  /** Record a presentation event. */
  record(params: {
    requestedSourceFrameId: number
    presentedAlphaFrameId: number
    timelineTime: number
    matteBackend: MatteBackend
    matteState: MatteState
    matteLatencyMs?: number
    dropped?: boolean
  }): PresentationRecord {
    const rec: PresentationRecord = {
      sequence: this.sequence++,
      generation: this.generation,
      requestedSourceFrameId: params.requestedSourceFrameId,
      presentedAlphaFrameId: params.presentedAlphaFrameId,
      timelineTime: params.timelineTime,
      matteBackend: params.matteBackend,
      matteState: params.matteState,
      matteLatencyMs: params.matteLatencyMs ?? 0,
      dropped: params.dropped ?? false,
      presentedAt: this.clock,
    }
    this.records.push(rec)
    return rec
  }

  /** All records in order. */
  getRecords(): readonly PresentationRecord[] {
    return this.records
  }

  /** Records where source and alpha disagree (the pair is wrong). */
  getMismatchedPairs(): PresentationRecord[] {
    return this.records.filter(
      (r) =>
        !r.dropped &&
        r.matteState === 'ready' &&
        r.presentedAlphaFrameId !== -1 &&
        r.presentedAlphaFrameId !== r.requestedSourceFrameId,
    )
  }

  /**
   * Records where the matte was supposed to be active but the raw source
   * was shown (alpha = -1 and state is not 'preparing' or 'missing').
   */
  getBackgroundFlashes(): PresentationRecord[] {
    return this.records.filter(
      (r) =>
        !r.dropped &&
        r.presentedAlphaFrameId === -1 &&
        r.matteState !== 'preparing' &&
        r.matteState !== 'missing',
    )
  }

  /** Records from a stale generation (callback arrived too late). */
  getStaleGenerationRecords(): PresentationRecord[] {
    return this.records.filter(
      (r) => r.generation < this.generation && !r.dropped,
    )
  }

  /** Dropped frame count. */
  getDroppedCount(): number {
    return this.records.filter((r) => r.dropped).length
  }

  /** Average matte latency for non-dropped, ready records. */
  getAverageLatencyMs(): number {
    const valid = this.records.filter((r) => !r.dropped && r.matteState === 'ready')
    if (valid.length === 0) return 0
    return valid.reduce((sum, r) => sum + r.matteLatencyMs, 0) / valid.length
  }

  /** Reset for a new test. */
  reset(): void {
    this.records = []
    this.sequence = 0
    this.generation = 0
    this.clock = 0
  }

  /**
   * Format a summary suitable for a baseline report.
   */
  summary(): string {
    const total = this.records.length
    const mismatched = this.getMismatchedPairs().length
    const flashes = this.getBackgroundFlashes().length
    const dropped = this.getDroppedCount()
    const avgLatency = this.getAverageLatencyMs().toFixed(1)
    return [
      `Total presentations: ${total}`,
      `Mismatched pairs: ${mismatched}`,
      `Background flashes: ${flashes}`,
      `Dropped frames: ${dropped}`,
      `Average matte latency: ${avgLatency} ms`,
      `Final generation: ${this.generation}`,
    ].join('\n')
  }
}

/**
 * Simulates a sequence of seek operations and records the outcomes.
 *
 * `resolveAlpha` is the system-under-test: given a source frame id, it returns
 * the alpha frame id that would actually be presented (or -1 if no matte).
 */
export function runSeekSequence(
  harness: MatteTestHarness,
  seekTimes: number[],
  sourceFrameForTime: (t: number) => number,
  resolveAlpha: (sourceFrameId: number) => { alphaFrameId: number; state: MatteState; backend: MatteBackend; latencyMs: number },
): void {
  for (const t of seekTimes) {
    const sourceFrameId = sourceFrameForTime(t)
    const alpha = resolveAlpha(sourceFrameId)
    harness.advanceClock(alpha.latencyMs)
    harness.record({
      requestedSourceFrameId: sourceFrameId,
      presentedAlphaFrameId: alpha.alphaFrameId,
      timelineTime: t,
      matteBackend: alpha.backend,
      matteState: alpha.state,
      matteLatencyMs: alpha.latencyMs,
    })
  }
}
