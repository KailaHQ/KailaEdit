// Isolated, hidden Electron test window. Does not open or modify user projects.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync, spawn } = require('node:child_process')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '..')

if (!process.versions.electron) {
  ;(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ke-matte-runtime-'))
  const ffmpeg = require('ffmpeg-static')
  for (const name of ['source', 'alpha']) {
    // Moving red subject on green background, with an independently encoded matching
    // alpha. A one-frame mismatch leaks green or removes part of the red rectangle.
    const raw = Buffer.alloc(90 * 96 * 64 * 3)
    for (let n = 0; n < 90; n++) for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) {
      const inside = x >= (n * 8) % 64 && x < (n * 8) % 64 + 24
      const offset = ((n * 64 + y) * 96 + x) * 3
      raw[offset] = inside ? (name === 'alpha' ? 255 : 220) : 0
      raw[offset + 1] = name === 'alpha' ? (inside ? 255 : 0) : (inside ? 0 : 220)
      raw[offset + 2] = name === 'alpha' && inside ? 255 : 0
    }
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '96x64', '-r', '30', '-i', 'pipe:0', '-c:v', 'libx264', '-crf', '10', '-g', '30', '-bf', '3', '-pix_fmt', 'yuv420p', '-y', path.join(dir, name + '.mp4')], { input: raw })
    if (result.status !== 0) throw Error(String(result.stderr))
  }
  const esbuild = createRequire(require.resolve('vite'))('esbuild')
  if (process.env.KE_SCRUB_PROXY) {
    const compiled = await esbuild.build({ entryPoints: [path.join(root, 'electron/matte/scrub-proxy.ts')], bundle: true, platform: 'node', format: 'cjs', write: false,
      plugins: [{ name: 'isolated-cache', setup(build) {
        build.onResolve({ filter: /export\/(ffmpeg-utils|render-cache-manager)$/ }, args => ({ path: args.path, namespace: 'cache-test' }))
        build.onLoad({ filter: /.*/, namespace: 'cache-test' }, args => ({ contents: args.path.endsWith('ffmpeg-utils')
          ? `export const findFfmpegPath = () => ${JSON.stringify(ffmpeg)}`
          : 'export const renderCacheManager = { getCacheDir() { throw Error("Explicit isolated cache required") } }', loader: 'js' }))
      } }],
    })
    const Module = require('module'), mod = new Module('scrub-args')
    mod._compile(compiled.outputFiles[0].text, 'scrub-args.cjs')
    const measurements = []
    for (const [name, input] of [['source', process.env.KE_MATTE_SOURCE || path.join(dir, 'source.mp4')], ['alpha', process.env.KE_MATTE_ALPHA || path.join(dir, 'alpha.mp4')]]) {
      const started = performance.now()
      const output = await mod.exports.ensureScrubProxy(input, path.join(dir, 'scrub-cache'))
      const coldMs = performance.now() - started
      const reuseStarted = performance.now()
      const reused = await mod.exports.ensureScrubProxy(input, path.join(dir, 'scrub-cache'))
      const warmMs = performance.now() - reuseStarted
      if (reused !== output) throw Error('Scrub cache was not reused')
      measurements.push({ name, coldMs, warmMs, bytes: fs.statSync(output).size })
      fs.copyFileSync(output, path.join(dir, name + '-scrub.mp4'))
    }
    fs.writeFileSync(path.join(dir, 'proxy-preparation.json'), JSON.stringify(measurements, null, 2))
    console.log(JSON.stringify({ proxyPreparation: measurements }))
  }
  await esbuild.build({ external: ['node:*', 'electron'], plugins: [{ name: 'no-live-ai', setup(build) { build.onResolve({ filter: /MatteEngine$/ }, () => ({ path: 'matte-test-stub', namespace: 'test' })); build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const matteEngine = { getCachedResult: () => undefined, processFrame: async () => { throw new Error("Unexpected live inference") } }', loader: 'js' })) } }], entryPoints: [path.join(__dirname, 'verify-matte-runtime.tsx')], bundle: true, outfile: path.join(dir, 'renderer.js'), platform: 'browser', format: 'iife', alias: { '@core': path.join(root, 'core/src') }, define: { 'process.env.NODE_ENV': '"production"' } })
  fs.writeFileSync(path.join(dir, 'index.html'), '<body><div id="root"></div><script src="renderer.js"></script></body>')
  const env = { ...process.env, KE_MATTE_TEST_DIR: dir }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: 'inherit' })
  child.on('exit', code => { process.exitCode = code ?? 1 })
  })().catch(error => { console.error(error); process.exitCode = 1 })
} else {
  const { app, BrowserWindow, ipcMain } = require('electron')
  const dir = process.env.KE_MATTE_TEST_DIR
  app.setPath('userData', path.join(dir, 'profile'))
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
  const timeout = setTimeout(() => { console.error('Matte runtime timeout'); app.exit(1) }, 60000)
  ipcMain.once('result', (_event, result) => {
    console.log(JSON.stringify(result, null, 2))
    clearTimeout(timeout)
    app.exit(result.error ? 1 : 0)
  })
  app.whenReady().then(() => {
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } })
    win.webContents.setFrameRate(60)
    win.webContents.on('console-message', (event) => console.error('renderer:', event.message))
    win.webContents.on('did-finish-load', () => { win.webContents.executeJavaScript('JSON.stringify({root:document.body.innerText,decoder:typeof VideoDecoder})').then(console.log) })
    win.loadFile(path.join(dir, 'index.html'))
  })
}
