import fs from 'fs'
import path from 'path'
import { removeEntry } from './remove-entry'
import { extractVideoFrameToFile } from '../export/ffmpeg-utils'
import {
  TEMPLATE_FILE_EXTENSION,
  TEMPLATE_FILE_EXTENSIONS,
  TEMPLATE_MEDIA_DIR,
  kailaTemplateSchema,
  komfyTemplateSchema,
  type KailaTemplate,
  type KomfyTemplate,
  type TemplateMediaRef,
} from '../../core/src/template-model'

/* ────────────────────────────────────────────────────────────────
   Templates on disk.

   One JSON file per template, in a folder of their own. No archive, no
   database: the repo carries no compression library, and a template a user
   can open in a text editor is one they can fix when something goes wrong.

   The folder is `<presetsDir>/templates` when the user has set a presets
   location, and a folder under userData when they have not. That setting has
   existed in the schema without a reader since it was added; this is its
   first use, so the empty case has to work rather than throw.
   ──────────────────────────────────────────────────────────────── */

/*
 * Two shapes on disk, and both must keep working.
 *
 * A template with nothing of its own is a single JSON file — one file to send
 * someone, readable in any editor. One that carries a music bed or an overlay
 * becomes a FOLDER with the same extension, holding `template.json` and a
 * `media/` folder beside it. No archive format, because the repo carries no
 * compression library and a folder needs none.
 *
 * Everything below therefore probes for both, and templates saved before
 * bundled media existed keep opening exactly as they did.
 */
const TEMPLATE_DOC_NAME = 'template.json'

function isTemplateFolder(entryPath: string): boolean {
  try {
    return fs.statSync(entryPath).isDirectory()
      && fs.existsSync(path.join(entryPath, TEMPLATE_DOC_NAME))
  } catch {
    return false
  }
}

/** Where the template document lives, whichever shape this entry is. */
function templateDocPath(templatesDir: string, fileName: string): string | null {
  const entryPath = path.join(templatesDir, fileName)
  if (isTemplateFolder(entryPath)) return path.join(entryPath, TEMPLATE_DOC_NAME)
  return fs.existsSync(entryPath) ? entryPath : null
}

export function getTemplatesDir(presetsDir?: string): string {
  const configured = presetsDir?.trim()
  if (configured) {
    const isAbs = path.isAbsolute(configured) || path.win32.isAbsolute(configured) || path.posix.isAbsolute(configured)
    const base = isAbs ? configured : path.join(process.cwd(), configured)
    return path.join(base, 'templates')
  }

  let userDataPath: string | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron')
    if (app && typeof app.getPath === 'function') {
      userDataPath = app.getPath('userData')
    }
  } catch {
    // Running in standalone Node or the test runner.
  }

  const defaultHeadlessDir = fs.existsSync(path.join(process.cwd(), '.kailaedit-data'))
    ? path.join(process.cwd(), '.kailaedit-data')
    : (fs.existsSync(path.join(process.cwd(), '.komfyedit-data'))
        ? path.join(process.cwd(), '.komfyedit-data')
        : path.join(process.cwd(), '.kailaedit-data'))
  const base = userDataPath || defaultHeadlessDir
  return path.join(base, 'templates')
}

/**
 * Turns a template name into a file name that cannot escape the folder.
 *
 * The name comes from a text box, so it can hold slashes, dots and anything
 * else a file system treats as navigation. Everything outside a small safe set
 * becomes an underscore.
 */
export function templateFileName(template: Pick<KomfyTemplate, 'id' | 'name'>): string {
  const safeName = template.name
    .trim()
    .replace(/[^\p{L}\p{N} _-]/gu, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 60)
    .trim()
  const stem = safeName ? `${safeName} (${template.id})` : template.id
  return `${stem}${TEMPLATE_FILE_EXTENSION}`
}

/** Rejects any file name that is not a plain leaf inside the templates folder. */
export function isSafeTemplateFileName(fileName: string): boolean {
  if (!TEMPLATE_FILE_EXTENSIONS.some(ext => fileName.endsWith(ext))) return false
  if (fileName.includes('/') || fileName.includes('\\')) return false
  if (fileName.includes('..')) return false
  return path.basename(fileName) === fileName
}

/** What the browser needs to draw a card, without loading every timeline. */
export interface TemplateSummary {
  fileName: string
  id: string
  name: string
  createdAt: number
  width: number
  height: number
  durationSec: number
  slotCount: number
  category: string
  /** Absolute path to the cover on this disk, when the template has one. */
  coverPath?: string
}

export function listTemplates(templatesDir: string): TemplateSummary[] {
  if (!fs.existsSync(templatesDir)) return []

  const summaries: TemplateSummary[] = []
  for (const fileName of fs.readdirSync(templatesDir)) {
    if (!TEMPLATE_FILE_EXTENSIONS.some(ext => fileName.endsWith(ext))) continue
    try {
      const docPath = templateDocPath(templatesDir, fileName)
      if (!docPath) continue
      const raw = fs.readFileSync(docPath, 'utf8')
      const parsed = komfyTemplateSchema.safeParse(JSON.parse(raw))
      // A file that fails to parse is skipped rather than thrown: one bad
      // template must not take the whole library down with it.
      if (!parsed.success) continue
      const template = parsed.data
      summaries.push({
        fileName,
        id: template.id,
        name: template.name,
        createdAt: template.createdAt,
        width: template.width,
        height: template.height,
        durationSec: template.durationSec,
        slotCount: template.slots.length,
        category: template.category,
        ...(template.cover
          ? { coverPath: path.join(path.dirname(docPath), template.cover) }
          : {}),
      })
    } catch {
      continue
    }
  }

  return summaries.sort((left, right) => right.createdAt - left.createdAt)
}

export function readTemplate(
  templatesDir: string,
  fileName: string,
): { success: true; template: KomfyTemplate } | { success: false; error: string } {
  if (!isSafeTemplateFileName(fileName)) {
    return { success: false, error: 'INVALID_TEMPLATE_NAME' }
  }

  const docPath = templateDocPath(templatesDir, fileName)
  if (!docPath) return { success: false, error: 'TEMPLATE_NOT_FOUND' }

  try {
    const parsed = komfyTemplateSchema.safeParse(JSON.parse(fs.readFileSync(docPath, 'utf8')))
    if (!parsed.success) return { success: false, error: 'TEMPLATE_UNREADABLE' }
    return { success: true, template: resolveBundledMedia(parsed.data, path.dirname(docPath)) }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

/**
 * Points the stored `media/song.mp3` at the file actually on this disk.
 *
 * The document keeps relative names so it survives being moved or sent to
 * somebody else; the renderer needs a path it can open. Resolving on read
 * keeps the portable form on disk and the usable form in memory.
 */
function resolveBundledMedia(template: KomfyTemplate, baseDir: string): KomfyTemplate {
  if (template.bundledMedia.length === 0) return template

  const prefix = `${TEMPLATE_MEDIA_DIR}/`
  return {
    ...template,
    timeline: {
      ...template.timeline,
      clips: template.timeline.clips.map(clip => {
        const stored = clip.asset?.path
        if (!stored || !stored.startsWith(prefix)) return clip
        return {
          ...clip,
          asset: { ...clip.asset!, path: path.join(baseDir, TEMPLATE_MEDIA_DIR, stored.slice(prefix.length)) },
        }
      }),
    },
  }
}

/**
 * Writes through a temporary file and renames over the target, so an
 * interrupted save leaves the previous template intact rather than a truncated
 * one — the same care project files already take.
 */
/** A frame to grab for the card, taken from the footage the template was built on. */
export interface TemplateCoverSource {
  videoPath: string
  seekTime: number
}

export const TEMPLATE_COVER_NAME = 'cover.jpg'

export function writeTemplate(
  templatesDir: string,
  template: KomfyTemplate,
  media: ReadonlyArray<TemplateMediaRef> = [],
  cover?: TemplateCoverSource,
): { success: true; fileName: string; path: string } | { success: false; error: string } {
  const parsed = komfyTemplateSchema.safeParse(template)
  if (!parsed.success) {
    return { success: false, error: `TEMPLATE_INVALID: ${parsed.error.issues[0]?.message ?? ''}` }
  }

  try {
    fs.mkdirSync(templatesDir, { recursive: true })
    const fileName = templateFileName(parsed.data)
    const entryPath = path.join(templatesDir, fileName)

    // Nothing of its own: stays a single file, which is the shape a user can
    // send someone as one attachment. A cover is a file beside the document,
    // so asking for one is asking for the folder shape.
    if (media.length === 0 && !cover) {
      const tempPath = `${entryPath}.tmp`
      fs.writeFileSync(tempPath, JSON.stringify(parsed.data, null, 2), 'utf8')
      fs.renameSync(tempPath, entryPath)
      return { success: true, fileName, path: entryPath }
    }

    // Carries media: build the whole folder off to one side and swap it in, so
    // an interrupted save cannot leave a template whose document promises a
    // music bed that is not there yet.
    const stagingPath = `${entryPath}.staging`
    removeEntry(stagingPath)
    fs.mkdirSync(path.join(stagingPath, TEMPLATE_MEDIA_DIR), { recursive: true })

    for (const entry of media) {
      fs.copyFileSync(entry.sourcePath, path.join(stagingPath, TEMPLATE_MEDIA_DIR, entry.fileName))
    }
    /*
     * The cover is a real frame of the edit as it stood when it was saved —
     * the same insight that makes template previews work: a template is taken
     * FROM a finished video, so at save time there is a finished video to
     * photograph. A failure here loses the picture, not the template.
     */
    let document = parsed.data
    if (cover) {
      try {
        extractVideoFrameToFile({
          videoPath: cover.videoPath,
          seekTime: Math.max(0, cover.seekTime),
          outputPath: path.join(stagingPath, TEMPLATE_COVER_NAME),
          width: 480,
          timeoutMs: 30000,
        })
        document = { ...document, cover: TEMPLATE_COVER_NAME }
      } catch {
        // No cover, still a template.
      }
    }

    fs.writeFileSync(
      path.join(stagingPath, TEMPLATE_DOC_NAME),
      JSON.stringify(document, null, 2),
      'utf8',
    )

    removeEntry(entryPath)
    fs.renameSync(stagingPath, entryPath)
    return { success: true, fileName, path: entryPath }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

export function deleteTemplate(
  templatesDir: string,
  fileName: string,
): { success: boolean; error?: string } {
  if (!isSafeTemplateFileName(fileName)) return { success: false, error: 'INVALID_TEMPLATE_NAME' }

  try {
    // A template that carries media is a folder, so this has to handle both.
    removeEntry(path.join(templatesDir, fileName))
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}
