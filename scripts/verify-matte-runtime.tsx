import React from 'react'
import { createRoot } from 'react-dom/client'
import { LutCanvas, type LutCanvasRef } from '../frontend/views/editor/preview/LutCanvas'
import { WebCodecsPlayer } from '../frontend/views/editor/preview/webcodecs/WebCodecsPlayer'

// This file is bundled only by verify-matte-runtime.cjs, in an isolated test window.
declare const require: (name: string) => any
const fs = require('node:fs')
const path = require('node:path')
const { ipcRenderer } = require('electron')
const dir = require('node:process').env.KE_MATTE_TEST_DIR
const sourcePath = require('node:process').env.KE_MATTE_SOURCE || path.join(dir, 'source.mp4')
const alphaPath = require('node:process').env.KE_MATTE_ALPHA || path.join(dir, 'alpha.mp4')
;(window as any).electronAPI = { readMediaChunk: async ({ filePath, offset, length }: any) => {
  const bytes = fs.readFileSync(filePath)
  return { data: new Uint8Array(bytes.subarray(offset, offset + length)), totalSize: bytes.length }
} }
if (require('node:process').env.KE_SCRUB_PROXY) {
  ;(window as any).electronAPI.matteScrubProxy = async () => ({ sourcePath: path.join(dir, 'source-scrub.mp4'), mattePath: path.join(dir, 'alpha-scrub.mp4') })
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(check: () => boolean, label: string) {
  const start = performance.now()
  while (!check()) {
    if (performance.now() - start > 8000) throw Error('Timeout: ' + label)
    await pause(10)
  }
}
async function run() {
  console.log('runtime: loading')
  const player = new WebCodecsPlayer()
  if (!await player.load(sourcePath)) throw Error('WebCodecs load failed')
  console.log('runtime: loaded', player.getMetadata()?.samples.length)
  const decoded: number[] = []
  for (const t of [0, 0.034, 0.7, 2.6, 0.1, 1.6, 2.99]) {
    console.log('runtime: seek', t)
    const frame = await player.seek(t)
    if (!frame) throw Error('No decoded frame at ' + t)
    const expected = Math.floor(t * 30 + 1e-6) / 30
    if (Math.abs(frame.timestamp / 1e6 - expected) > 0.000002) throw Error(`Wrong PTS ${frame.timestamp} at ${t}, expected ${expected}`)
    decoded.push(frame.timestamp)
  }
  player.destroy()
  if (require('node:process').env.KE_MATTE_FORCE_FALLBACK) {
    const supported = VideoDecoder.isConfigSupported.bind(VideoDecoder)
    let attempts = 0
    VideoDecoder.isConfigSupported = async config => require('node:process').env.KE_MATTE_FORCE_FALLBACK === 'all' || ++attempts <= 2 ? ({ supported: false, config }) : supported(config)
  }

  const video = document.createElement('video')
  video.muted = true
  video.src = require('node:url').pathToFileURL(sourcePath).href
  document.body.append(video)
  const ref = React.createRef<LutCanvasRef>()
  const root = createRoot(document.getElementById('root')!)
  root.render(<LutCanvas ref={ref} sourceElement={null} bakeVideoPath={alphaPath}
    clipId="fixture" autoMatte={{ enabled: true, model: 'rvm-mobilenetv3', quality: 'standard', cleanEdge: 0, featherEdge: 0 }} />)
  await until(() => !!ref.current, 'mount')
  // Supply the pool source before it has decoded, without updating React props.
  ref.current!.renderNow(video)
  video.load()
  await until(() => ref.current!.hasContent(), 'frame zero without play or second seek')
  const canvas = ref.current!.getCanvas()!
  function pixels() {
    const gl = canvas.getContext('webgl2')!
    const result = new Uint8Array(canvas.width * canvas.height * 4)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, result)
    return result
  }
  let pixelChecks = 0
  function verifyPixels() {
    if (require('node:process').env.KE_MATTE_SOURCE) return
    const data = pixels()
    let leaked = 0, subject = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 180 && data[i + 1] > 100 && data[i] < 100) leaked++
      if (data[i + 3] > 180 && data[i] > 100 && data[i + 1] < 100) subject++
    }
    if (leaked > 64 || subject < 22 * 64) throw Error(`RGB/alpha pixel mismatch: leaked=${leaked}, subject=${subject}, source=${canvas.dataset.sourceTime}, alpha=${canvas.dataset.matteTime}`)
    pixelChecks++
  }
  verifyPixels()
  let previous = pixels()
  const changed: number[] = []
  for (const time of [1.2, 2.4, 0.1]) {
    video.currentTime = time
    ref.current!.renderNow(video)
    await until(() => !video.seeking, 'source seek')
    await until(() => {
      const next = pixels()
      const different = next.some((v, i) => Math.abs(v - previous[i]) > 10)
      if (different) { previous = next; return true }
      return false
    }, 'paused canvas changes at ' + time)
    changed.push(time)
    verifyPixels()
  }
  if (process.env.KE_SCRUB_PROXY) await until(() => canvas.dataset.scrubProxy === 'ready', 'playback proxies ready')
  const presented = new Set<string>()
  const pairs: Array<{ source: number; alpha: number }> = []
  root.render(<LutCanvas ref={ref} sourceElement={video} bakeVideoPath={alphaPath} isPlaying
    clipId="fixture" autoMatte={{ enabled: true, model: 'rvm-mobilenetv3', quality: 'standard', cleanEdge: 0, featherEdge: 0 }} />)
  video.currentTime = 0
  await until(() => !video.seeking, 'playback start')
  await video.play()
  const playbackStart = performance.now()
  const playbackLag: number[] = []
  while (performance.now() - playbackStart < 2000) {
    ref.current!.renderNow(video, { sourceTime: video.currentTime })
    await pause(10)
    const source = canvas.dataset.sourceTime
    const alpha = canvas.dataset.matteTime
    if (source) playbackLag.push(Math.max(0, video.currentTime - Number(source)) * 1000)
    if (source && alpha && !presented.has(source)) {
      presented.add(source)
      pairs.push({ source: Number(source), alpha: Number(alpha) })
      verifyPixels()
    }
  }
  video.pause()
  ref.current!.renderNow(video, null)
  playbackLag.sort((a, b) => a - b)
  console.log(JSON.stringify({ playbackLagP50Ms: playbackLag[Math.floor(playbackLag.length * 0.5)], playbackLagP95Ms: playbackLag[Math.floor(playbackLag.length * 0.95)] }))
  const speedResults: Array<{ speed: number; frames: number; drift: number }> = []
  for (const speed of [0.25, 0.5, 2, 4, 1]) {
    video.currentTime = 0.1
    await until(() => !video.seeking, 'speed seek')
    video.playbackRate = speed
    root.render(<LutCanvas ref={ref} sourceElement={video} bakeVideoPath={alphaPath} isPlaying speed={speed}
      clipId="fixture" autoMatte={{ enabled: true, model: 'rvm-mobilenetv3', quality: 'standard', cleanEdge: 0, featherEdge: 0,
        bake: { path: alphaPath, fingerprint: 'fixture', createdAt: 0, frameCount: 90, sourceStart: 0, sourceSpan: 3, speed: 1 } }} />)
    await until(() => Math.abs(Number(canvas.dataset.sourceTime) - 0.1) < 0.034, 'speed first frame')
    const seen = new Set<string>()
    let drift = 0
    await video.play()
    const start = performance.now()
    while (performance.now() - start < 550) {
      ref.current!.renderNow(video)
      await pause(10)
      if (canvas.dataset.sourceTime) seen.add(canvas.dataset.sourceTime)
      drift = Math.max(drift, Math.abs(Number(canvas.dataset.sourceTime) - Number(canvas.dataset.matteTime)))
      verifyPixels()
    }
    video.pause()
    if (seen.size < 3 || drift > 0.034) throw Error(`Speed ${speed}: ${seen.size} frames, drift ${drift}, video ${video.currentTime}, state ${ref.current!.getMatteReadiness()}, source ${canvas.dataset.sourceTime}, alpha ${canvas.dataset.matteTime}`)
    speedResults.push({ speed, frames: seen.size, drift })
    // Drag backwards/forwards while the renderer is still in playback mode, then
    // settle on a non-frame-boundary time. Old async completions must not win.
    for (const target of [1.717, 0.217, 2.417, 0.517]) {
      video.currentTime = target
      ref.current!.renderNow(video)
      await pause(5)
    }
    await until(() => !video.seeking && Math.abs(Number(canvas.dataset.sourceTime) - 0.5) < 0.000002, 'latest scrub target')
    verifyPixels()
  }
  const outputPixels = pixels()
  // Hold-drag: the transport video can remain seeking for the whole gesture.
  // Preview must still change BEFORE release, using the explicit timeline target.
  root.render(<LutCanvas ref={ref} sourceElement={video} bakeVideoPath={alphaPath}
    clipId="fixture" autoMatte={{ enabled: true, model: 'rvm-mobilenetv3', quality: 'standard', cleanEdge: 0, featherEdge: 0 }} />)
  await pause(30)
  Object.defineProperty(video, 'seeking', { configurable: true, get: () => true })
  if (require('node:process').env.KE_SCRUB_PROXY) {
    await until(() => canvas.dataset.scrubProxy === 'ready', 'scrub proxies with matching PTS')
  }
  const dragFrames = new Set<string>()
  const requestedAt = new Map<string, number>()
  const dragLatencies: number[] = []
  const dragStart = performance.now()
  let pointer = 0
  while (performance.now() - dragStart < 1500) {
    const target = ((pointer++ * 7) % 80) / 30 + 0.01
    requestedAt.set(String(Math.round(Math.floor(target * 30) / 30 * 1e6)), performance.now())
    if (!require('node:process').env.KE_SCRUB_PROXY) video.currentTime = target
    ref.current!.renderNow(video, { sourceTime: target })
    await pause(16)
    const presentedTime = canvas.dataset.sourceTime ?? ''
    const issued = requestedAt.get(String(Math.round(Number(presentedTime) * 1e6)))
    if (!dragFrames.has(presentedTime) && issued !== undefined) dragLatencies.push(performance.now() - issued)
    dragFrames.add(presentedTime)
    verifyPixels()
  }
  if (dragFrames.size < 5) throw Error('Held scrub preview stalled: ' + dragFrames.size + ' distinct frames before release')
  delete (video as any).seeking
  video.currentTime = 0.517
  const settleStart = performance.now()
  ref.current!.renderNow(video, { sourceTime: 0.517 })
  await until(() => Math.abs(Number(canvas.dataset.sourceTime) - 0.5) < 0.000002, 'held scrub final target')
  if (require('node:process').env.KE_SCRUB_PROXY) {
    await until(() => Number(canvas.dataset.pairWidth) === video.videoWidth, 'full quality after release')
  }
  const settleMs = performance.now() - settleStart
  dragLatencies.sort((a, b) => a - b)
  verifyPixels()
  let transparent = 0
  for (let i = 3; i < outputPixels.length; i += 4) if (outputPixels[i] < 20) transparent++
  if (transparent < canvas.width * canvas.height / 8) {
    const gl = canvas.getContext('webgl2')!
    const program = gl.getParameter(gl.CURRENT_PROGRAM)
    throw Error('No removed background: ' + JSON.stringify({ alphaPath, enabled: gl.getUniform(program, gl.getUniformLocation(program, 'u_matte_enabled')), error: gl.getError() }))
  }
  if (presented.size < 15) throw Error('Playback stalled: only ' + presented.size + ' distinct frames')
  if (pairs.some(p => Math.abs(p.source - p.alpha) > 1 / 30 + 0.001)) throw Error('Playback mismatch: ' + JSON.stringify(pairs))
  const capture = document.createElement('canvas')
  capture.width = canvas.width
  capture.height = canvas.height
  const captureContext = capture.getContext('2d')!
  captureContext.fillStyle = 'black'
  captureContext.fillRect(0, 0, capture.width, capture.height)
  captureContext.drawImage(canvas, 0, 0)
  fs.writeFileSync(path.join(dir, 'canvas.png'), Buffer.from(capture.toDataURL('image/png').split(',')[1], 'base64'))
  root.unmount()
  return { decodedPTS: decoded, pixelChecks, heldScrubFrames: dragFrames.size, dragP50Ms: dragLatencies[Math.floor(dragLatencies.length * 0.5)], dragP95Ms: dragLatencies[Math.floor(dragLatencies.length * 0.95)], settleMs, firstFrame: 'passed', pausedSeeks: changed, playbackFrames: presented.size, speedResults, maxPairDrift: Math.max(...pairs.map(p => Math.abs(p.source - p.alpha))), capture: path.join(dir, 'canvas.png'), electron: require('node:process').versions.electron }
}
run().then(result => ipcRenderer.send('result', result)).catch(error => ipcRenderer.send('result', { error: String(error), stack: error.stack }))
