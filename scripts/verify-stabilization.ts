/**
 * End-to-end check of clip stabilization, through the app's own code — no mocks:
 *
 *   clip in the editor state → the keeper's bake request → StabilizeService (real ffmpeg)
 *   → bake recorded on the clip → export clips built the way ExportModal builds them
 *   → renderQueue export (real ffmpeg) → measurements.
 *
 * What it measures, per scenario:
 *   - residual shake of the stabilized export against an export of the same clip without
 *     stabilization (vidstab's own motion estimate, high-frequency part);
 *   - frame alignment: each exported frame must be the bake's frame at the clip's trim
 *     offset, not one a handle's worth early or late (SSIM scan over neighbouring frames);
 *   - duration, and that the audio came through;
 *   - what timeline_describe / qc_check would tell the agent afterwards.
 *
 * Usage:
 *   pnpm exec tsx scripts/verify-stabilization.ts <video> <work-dir>
 *
 * Both paths must sit inside a root the main process allows (outside Electron: the
 * temp directory or the project directory), exactly as in the app.
 */
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { findFfmpegPath } from '../electron/export/ffmpeg-utils'
import { renderQueue } from '../electron/export/render-queue'
import { StabilizeService, parseSourceInfo } from '../electron/stabilize/stabilize-service'
import {
  timelineClipSchema,
  DEFAULT_CLIP_STABILIZATION,
  type Asset,
  type StabilizationBake,
  type TimelineClip,
} from '../core/src/project-model'
import { createInitialEditorState, type EditorState } from '../core/src/editor-state'
import { selectAssets, selectClipById, selectClipPathFromAssets, selectClips } from '../core/src/editor-selectors'
import { setClipStabilizationBake } from '../core/src/editor-actions'
import { qcCheck } from '../core/src/qc-check'
import {
  clipSourceRange,
  describeClipStabilization,
  parseVidstabGlobalMotions,
  resolveStabilizedClips,
  stabilizationBakeRange,
  stabilizationContextForClip,
  stabilizedSourceForClip,
} from '../core/src/stabilization'

const [videoArg, workArg] = process.argv.slice(2)
if (!videoArg || !workArg) {
  console.error('usage: tsx scripts/verify-stabilization.ts <video> <work-dir>')
  process.exit(2)
}
const VIDEO = path.resolve(videoArg)
const WORK = path.resolve(workArg)
fs.mkdirSync(WORK, { recursive: true })
const FFMPEG = findFfmpegPath()!
const FPS = 30

interface Scenario {
  name: string
  trimStart: number
  duration: number
}

const SCENARIOS: Scenario[] = [
  // The stretch the user cares about: a handheld tilt at the very start of the file.
  { name: 'open-0-10s', trimStart: 0, duration: 10 },
  // Starts mid-file, so the bake has a leading handle and the trim has to be shifted.
  { name: 'hand-74-82s', trimStart: 74, duration: 8 },
]

function ffmpeg(args: string[], cwd?: string): string {
  const res = spawnSync(FFMPEG, ['-hide_banner', ...args], { encoding: 'utf8', cwd, maxBuffer: 64 * 1024 * 1024 })
  if (res.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}\n${res.stderr?.slice(-2000)}`)
  return (res.stdout || '') + (res.stderr || '')
}

function probe(file: string) {
  const out = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr ?? ''
  return { ...parseSourceInfo(out), hasAudio: /Audio:/.test(out) }
}

/** High-frequency camera motion left in a file, in px at its own width (the metric used in the trials). */
function residualShake(file: string, label: string): number {
  const dir = path.join(WORK, `shake-${label}`)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(file, path.join(dir, 'in.mp4'))
  ffmpeg(['-i', 'in.mp4', '-an', '-vf', 'vidstabdetect=shakiness=8:accuracy=15:stepsize=4:result=m.trf', '-f', 'null', '-'], dir)
  ffmpeg(['-i', 'in.mp4', '-an', '-vf', 'vidstabtransform=input=m.trf:debug=1', '-f', 'null', '-'], dir)
  const motions = parseVidstabGlobalMotions(fs.readFileSync(path.join(dir, 'global_motions.trf'), 'utf8'))
  const hf = (key: 'dx' | 'dy') => motions.map((m, i) => {
    let sum = 0, n = 0
    for (let j = -4; j <= 4; j++) { const q = motions[i + j]; if (q) { sum += q[key]; n++ } }
    return m[key] - sum / n
  })
  const hx = hf('dx'), hy = hf('dy')
  const rms = Math.sqrt(hx.reduce((a, x, i) => a + x * x + hy[i] * hy[i], 0) / hx.length)
  fs.rmSync(dir, { recursive: true, force: true })
  return Number(rms.toFixed(3))
}

/** SSIM between frame `a` of one file and frame `b` of another, at 270 px wide. */
function ssimAt(fileA: string, a: number, fileB: string, b: number): number {
  const out = ffmpeg([
    '-i', fileA, '-i', fileB, '-filter_complex',
    `[0]select=eq(n\\,${a}),scale=270:-2,setpts=PTS-STARTPTS[x];[1]select=eq(n\\,${b}),scale=270:-2,setpts=PTS-STARTPTS[y];[x][y]ssim`,
    '-frames:v', '1', '-f', 'null', '-',
  ])
  const m = /All:([0-9.]+)/.exec(out)
  return m ? Number(m[1]) : NaN
}

/** Which bake frame each sampled export frame best matches, relative to the expected one. */
function alignment(exported: string, bake: string, expectedOffsetFrames: number) {
  // Start, middle and near the end — sampled from the export's own length.
  const frames = Math.floor(probe(exported).duration * FPS)
  const samples = [45, Math.floor(frames / 2), frames - 15]
  return samples.map(k => {
    let best = { delta: 0, ssim: -1 }
    const scores: Record<number, number> = {}
    for (let d = -4; d <= 4; d++) {
      const s = ssimAt(exported, k, bake, k + expectedOffsetFrames + d)
      scores[d] = Number(s.toFixed(4))
      if (s > best.ssim) best = { delta: d, ssim: s }
    }
    return { exportFrame: k, bestDelta: best.delta, bestSsim: Number(best.ssim.toFixed(4)), scores }
  })
}

function makeState(scenario: Scenario, asset: Asset, stabilized: boolean): EditorState {
  const clip: TimelineClip = timelineClipSchema.parse({
    id: 'clip-1', assetId: asset.id, type: 'video', startTime: 0, duration: scenario.duration,
    trimStart: scenario.trimStart, trimEnd: asset.duration! - scenario.trimStart - scenario.duration,
    trackIndex: 0, asset, ...(stabilized ? { stabilization: { ...DEFAULT_CLIP_STABILIZATION } } : {}),
  })
  const timeline = {
    id: 'tl-1', name: 'Timeline 1', createdAt: 0, clips: [clip], subtitles: [],
    tracks: [{ id: 'v1', name: 'V1', kind: 'video' as const, muted: false, locked: false }],
  }
  return createInitialEditorState({ assets: [asset], bins: {}, timelines: [timeline], activeTimelineId: timeline.id })
}

/** The fields ExportModal sends for a plain video clip, from the clips it resolves. */
function exportClipsOf(state: EditorState) {
  const assets = selectAssets(state)
  return resolveStabilizedClips(selectClips(state), assets).map(clip => ({
    id: clip.id,
    path: selectClipPathFromAssets(assets, clip) || '',
    type: clip.type,
    startTime: clip.startTime,
    duration: clip.duration,
    trimStart: clip.trimStart,
    speed: clip.speed || 1,
    reversed: clip.reversed || false,
    flipH: clip.flipH || false,
    flipV: clip.flipV || false,
    opacity: clip.opacity ?? 100,
    trackIndex: clip.trackIndex,
    muted: clip.muted || false,
    volume: clip.volume ?? 1,
    transform: { ...clip.transform },
    colorCorrection: { ...clip.colorCorrection },
    assetId: clip.assetId,
  }))
}

async function exportState(state: EditorState, outputPath: string) {
  const clips = exportClipsOf(state)
  const started = renderQueue.startJob({ clips, outputPath, codec: 'h264', width: 1080, height: 1920, fps: FPS, quality: 18 })
  if (!started.success) throw new Error(`export did not start: ${started.error}`)
  const job = await renderQueue.waitForJob(started.jobId, 20 * 60_000)
  if (job.status !== 'completed') throw new Error(`export ${job.status}: ${job.error}`)
  return clips[0]
}

async function waitForBake(service: StabilizeService, jobId: string): Promise<StabilizationBake> {
  for (;;) {
    const status = service.status(jobId)
    if (status.status === 'done' && status.bake) return status.bake
    if (status.status === 'error' || status.status === 'cancelled') throw new Error(`bake ${status.status}: ${status.error}`)
    await new Promise(r => setTimeout(r, 250))
  }
}

async function run() {
  const source = probe(VIDEO)
  const asset: Asset = {
    id: 'asset-1', type: 'video', path: VIDEO, prompt: '', resolution: `${source.width}x${source.height}`,
    width: source.width, height: source.height, duration: source.duration, createdAt: 0, rotationChecked: true,
  }
  const service = new StabilizeService(path.join(WORK, 'stabilize-cache'))
  const report: Record<string, unknown> = { source: { file: path.basename(VIDEO), ...source } }

  for (const scenario of SCENARIOS) {
    const t0 = Date.now()
    let state = makeState(scenario, asset, true)
    const clip = selectClipById(state, 'clip-1')!

    // What the keeper asks for.
    const ctx = stabilizationContextForClip(clip, [asset])
    const range = stabilizationBakeRange(clipSourceRange(clip, ctx.mediaDuration), ctx.mediaDuration)
    const jobId = `verify-${scenario.name}`
    const started = service.start({
      jobId, assetId: asset.id, filePath: VIDEO, ...range,
      smoothing: clip.stabilization!.smoothing, mode: clip.stabilization!.mode, hdrOutput: 'sdr',
    })
    const bake = started.cached ? started.bake! : (started.started ? await waitForBake(service, jobId) : (() => { throw new Error(started.error) })())
    const bakeSeconds = (Date.now() - t0) / 1000

    // What the keeper records, and what the reader tools then say.
    state = setClipStabilizationBake(state, 'clip-1', bake)
    const recorded = selectClipById(state, 'clip-1')!
    const shifted = stabilizedSourceForClip(recorded, ctx)
    const described = describeClipStabilization(recorded, [asset], p => fs.existsSync(p))
    const qc = qcCheck(state.editorModel, { fileExists: p => fs.existsSync(p) })
      .filter(i => i.type.startsWith('STABILIZATION_'))
      .map(i => i.type)

    // Export with and without stabilization, through the real export pipeline.
    const t1 = Date.now()
    const outStab = path.join(WORK, `${scenario.name}.stabilized.mp4`)
    const outOrig = path.join(WORK, `${scenario.name}.original.mp4`)
    const sentStab = await exportState(state, outStab)
    const exportSeconds = (Date.now() - t1) / 1000
    const sentOrig = await exportState(makeState(scenario, asset, false), outOrig)

    const expectedOffsetFrames = Math.round((scenario.trimStart - bake.sourceStart) * FPS)
    const aligned = alignment(outStab, bake.path, expectedOffsetFrames)
    const stabInfo = probe(outStab)
    const origInfo = probe(outOrig)

    report[scenario.name] = {
      bake: {
        seconds: Number(bakeSeconds.toFixed(1)),
        sourceStart: bake.sourceStart,
        sourceSpan: bake.sourceSpan,
        zoomPercent: bake.zoomPercent,
        warnings: bake.warnings ?? [],
        warningTimes: bake.warningTimes ?? [],
      },
      sentToExport: {
        stabilized: { path: path.basename(sentStab.path), trimStart: sentStab.trimStart },
        original: { path: path.basename(sentOrig.path), trimStart: sentOrig.trimStart },
      },
      shiftedTrim: shifted,
      describe: described,
      qc,
      export: {
        seconds: Number(exportSeconds.toFixed(1)),
        stabilized: { duration: stabInfo.duration, size: `${stabInfo.width}x${stabInfo.height}`, audio: stabInfo.hasAudio },
        original: { duration: origInfo.duration, size: `${origInfo.width}x${origInfo.height}`, audio: origInfo.hasAudio },
      },
      alignment: { expectedOffsetFrames, samples: aligned },
      residualShakePx: {
        original: residualShake(outOrig, `${scenario.name}-orig`),
        stabilized: residualShake(outStab, `${scenario.name}-stab`),
      },
    }
    console.log(`done: ${scenario.name}`)
  }

  const reportPath = path.join(WORK, 'report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

run().then(() => process.exit(0), err => { console.error(err); process.exit(1) })
