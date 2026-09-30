import path from 'path'
import { handle } from './typed-handle'
import { getAllowedRoots } from '../config'
import { validatePath } from '../path-validation'
import {
  BUILTIN_TEMPLATES,
  builtinTemplateFileName,
  findBuiltinTemplate,
} from '../../core/src/builtin-templates'
import {
  deleteTemplate,
  getTemplatesDir,
  listTemplates,
  readTemplate,
  writeTemplate,
} from '../storage/template-file-storage'

/**
 * The folder comes from the renderer, so it gets the same allow-list as every
 * other renderer-supplied path. A folder the user picked in Settings is
 * approved for the session by the folder dialog; after a restart they re-pick
 * it once.
 */
function resolveTemplatesDir(presetsDir?: string): string {
  const configured = presetsDir?.trim()
  if (configured) validatePath(configured, getAllowedRoots())
  return getTemplatesDir(presetsDir)
}

/**
 * Templates live wherever the user's presets live, and the renderer is what
 * knows that — settings are its state, not the main process's. So the folder
 * is passed in on every call rather than cached here, which also means a user
 * who changes the setting sees the new folder on the next click.
 *
 * The ones that ship with the app are merged in from code rather than read off
 * disk. A folder beside the executable would have to be located again at
 * runtime, and that path is not the same in a dev run as in a packaged build —
 * a difference that has caused bugs in this repo before.
 */
export function registerTemplateHandlers(): void {
  handle('templateList', ({ presetsDir }) => {
    const dir = resolveTemplatesDir(presetsDir)

    const builtin = BUILTIN_TEMPLATES.map(template => ({
      fileName: builtinTemplateFileName(template),
      id: template.id,
      name: template.name,
      createdAt: template.createdAt,
      width: template.width,
      height: template.height,
      durationSec: template.durationSec,
      slotCount: template.slots.length,
      category: template.category,
      builtin: true,
    }))

    // The user's own come first: a library you built is more interesting than
    // the samples, once you have built one.
    const mine = listTemplates(dir).map(summary => ({ ...summary, builtin: false }))
    return { templatesDir: dir, templates: [...mine, ...builtin] }
  })

  handle('templateRead', ({ presetsDir, fileName }) => {
    const builtin = findBuiltinTemplate(fileName)
    if (builtin) return { success: true, template: builtin }

    const result = readTemplate(resolveTemplatesDir(presetsDir), fileName)
    return result.success
      ? { success: true, template: result.template }
      : { success: false, error: result.error }
  })

  handle('templateSave', ({ presetsDir, template, media, cover }) => {
    const roots = getAllowedRoots()
    for (const entry of media) {
      validatePath(entry.sourcePath, roots)
      if (path.basename(entry.fileName) !== entry.fileName) {
        throw new Error(`Invalid template media name: ${entry.fileName}`)
      }
    }
    if (cover) validatePath(cover.videoPath, roots)
    const result = writeTemplate(resolveTemplatesDir(presetsDir), template, media, cover)
    return result.success
      ? { success: true, fileName: result.fileName, path: result.path }
      : { success: false, error: result.error }
  })

  handle('templateDelete', ({ presetsDir, fileName }) => {
    // There is no file to delete, and the next launch would bring it back
    // anyway; saying so is better than reporting a success that did nothing.
    if (findBuiltinTemplate(fileName)) {
      return { success: false, error: 'BUILTIN_TEMPLATE' }
    }
    return deleteTemplate(resolveTemplatesDir(presetsDir), fileName)
  })
}
