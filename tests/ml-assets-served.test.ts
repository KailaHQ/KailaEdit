import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/**
 * Added 18/09/2026, after live background removal turned out never to have run in the app.
 *
 * Two traps, one after the other:
 *
 * 1. `public/wasm/` held the `.wasm` binaries but none of the `.mjs` loaders beside them,
 *    so every session creation failed — WebGPU with "Failed to fetch dynamically imported
 *    module", then the wasm fallback with "previous call to initWasm() failed".
 * 2. Copying the loaders into `public/` did not fix it either: onnxruntime loads them with
 *    a dynamic `import()`, and Vite refuses to serve a module out of `public/` ("should not
 *    be imported from source code"). They have to be resolved from the package.
 *
 * Neither failure reaches the session log — both live only in the renderer console — so
 * these assertions stand in for a browser nobody runs in CI.
 */
describe('ML runtime files the preview loads', () => {
  /** The exact specifiers MatteEngine imports. */
  const specifiers = [
    'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs',
    'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm',
    'onnxruntime-web/ort-wasm-simd-threaded.mjs',
    'onnxruntime-web/ort-wasm-simd-threaded.wasm',
  ]

  it('every specifier MatteEngine imports is one the package actually exports', () => {
    for (const spec of specifiers) {
      // Throws if the package's `exports` map does not publish it — which is what happened
      // with `onnxruntime-web/dist/...`, a path that is not exported at all.
      expect(() => require.resolve(spec), spec).not.toThrow()
    }
  })

  it('MatteEngine imports them through the bundler, never from /public', () => {
    const src = fs.readFileSync(
      path.join(root, 'frontend', 'views', 'editor', 'preview', 'MatteEngine.ts'),
      'utf-8',
    )
    for (const spec of specifiers) {
      expect(src, `thiếu import ${spec}`).toContain(`${spec}?url`)
    }
    expect(src).not.toContain("wasmPaths = '/wasm/'")
  })

  it('keeps the loaders out of public/, where they cannot be imported', () => {
    const wasmDir = path.join(root, 'public', 'wasm')
    if (!fs.existsSync(wasmDir)) return
    const loaders = fs.readdirSync(wasmDir).filter(f => f.endsWith('.mjs'))
    expect(loaders, `public/wasm phải không chứa .mjs: ${loaders.join(', ')}`).toEqual([])
  })

  it('ships the matting model the preview loads from /models/', () => {
    const model = path.join(root, 'public', 'models', 'rvm_mobilenetv3.onnx')
    expect(fs.existsSync(model)).toBe(true)
    expect(fs.statSync(model).size).toBeGreaterThan(1_000_000)
  })
})
