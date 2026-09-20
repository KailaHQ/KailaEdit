/**
 * Puts the two sets of files the renderer needs for on-device background removal into
 * `public/`, where Vite serves them:
 *
 *   public/models/*.onnx  ← copied from resources/models/ (the tracked master copy)
 *   public/wasm/*.wasm    ← copied from node_modules/onnxruntime-web/dist/
 *
 * Both destinations are gitignored on purpose. They are byte-for-byte copies of files
 * that already exist elsewhere in the tree, and committing them would put ~95 MB of
 * duplicated binaries into the repo's history forever.
 *
 * Runs before `dev` and before every build, and is cheap: files are skipped when the
 * destination already matches the source size.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const MODEL_SRC_DIR = path.join(root, 'resources', 'models')
const MODEL_DEST_DIR = path.join(root, 'public', 'models')
const WASM_SRC_DIR = path.join(root, 'node_modules', 'onnxruntime-web', 'dist')
const WASM_DEST_DIR = path.join(root, 'public', 'wasm')

let copied = 0
let skipped = 0

function copyInto(srcDir, destDir, filter, label) {
  if (!fs.existsSync(srcDir)) {
    console.warn(`[prepare-ml-assets] ${label}: source missing (${srcDir}) — skipping`)
    return
  }

  fs.mkdirSync(destDir, { recursive: true })

  for (const name of fs.readdirSync(srcDir)) {
    if (!filter(name)) continue

    const src = path.join(srcDir, name)
    const dest = path.join(destDir, name)
    const srcStat = fs.statSync(src)
    if (!srcStat.isFile()) continue

    if (fs.existsSync(dest) && fs.statSync(dest).size === srcStat.size) {
      skipped++
      continue
    }

    fs.copyFileSync(src, dest)
    copied++
    console.log(`[prepare-ml-assets] ${label}: ${name} (${(srcStat.size / 1048576).toFixed(1)} MB)`)
  }
}

copyInto(MODEL_SRC_DIR, MODEL_DEST_DIR, n => n.endsWith('.onnx'), 'model')
// Binaries only. The `.mjs` loaders must NOT be copied here: onnxruntime imports them
// with a dynamic `import()`, and Vite refuses to serve a module out of `public/`. They are
// resolved from the package by the bundler instead — see ORT_RUNTIME_FILES in MatteEngine.
copyInto(WASM_SRC_DIR, WASM_DEST_DIR, n => n.endsWith('.wasm'), 'onnxruntime wasm')

if (!fs.existsSync(path.join(MODEL_DEST_DIR, 'rvm_mobilenetv3.onnx'))) {
  console.warn(
    '[prepare-ml-assets] WARNING: rvm_mobilenetv3.onnx is missing from resources/models/. ' +
      'Auto background removal will not work. See resources/models/README.md.',
  )
}

console.log(`[prepare-ml-assets] done — ${copied} copied, ${skipped} already up to date`)
