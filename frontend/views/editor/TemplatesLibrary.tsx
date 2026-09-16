import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, LayoutTemplate, Loader2, Plus, Save, Search, Trash2 } from 'lucide-react'
import type { Asset } from '@core/project-model'
import {
  buildTemplateFromTimeline,
  type KomfyTemplate,
  type TemplateSlot,
} from '@core/template-model'
import { fitAssetToSlot } from '@core/template-apply'
import { pathToFileUrl } from '../../lib/file-url'
import { useProjects } from '../../contexts/ProjectContext'
import { useSettings } from '../../contexts/SettingsContext'
import { useTranslation } from '../../i18n/I18nContext'
import { selectActiveTimeline } from './editor-selectors'
import { useEditorActions, useEditorStore } from './editor-store'

/* ────────────────────────────────────────────────────────────────
   The template library.

   Two halves that mirror each other: turn the edit you are looking at into a
   template, and turn a template back into an edit. Nothing here reaches the
   network — the library is a folder of files under the user's presets path.
   ──────────────────────────────────────────────────────────────── */

interface TemplateSummary {
  fileName: string
  id: string
  name: string
  createdAt: number
  width: number
  height: number
  durationSec: number
  slotCount: number
  category: string
  coverPath?: string
  builtin: boolean
}

type Feedback = { success: boolean; message: string } | null

/**
 * What this piece of media will actually do in this slot, said before the
 * template is applied rather than discovered afterwards.
 *
 * The fit was always computed — `fitAssetToSlot` decides whether a clip gets
 * trimmed, slowed, or leaves the slot short — but it happened silently during
 * the apply. A clip two seconds short became slow motion with no warning, and
 * one far too short left a gap the user only found by playing it back.
 */
function describeSlotFit(
  slot: TemplateSlot,
  asset: Asset,
  t: (key: string, params?: Record<string, string | number>) => string,
): { text: string; tone: 'info' | 'warn' } | null {
  // A slot cut for video, filled with a still: it will hold rather than play,
  // which is a choice rather than a mistake — but worth saying out loud.
  if (slot.kind === 'video' && asset.type === 'image') {
    return { text: t('library.templates.fitStill'), tone: 'info' }
  }

  const fit = fitAssetToSlot(slot, asset.duration)
  if (fit.short) {
    return {
      text: t('library.templates.fitShort', { missing: (slot.duration - fit.duration).toFixed(1) }),
      tone: 'warn',
    }
  }
  if (fit.speed < 1) {
    return { text: t('library.templates.fitSlowed', { speed: fit.speed.toFixed(2) }), tone: 'warn' }
  }
  return null
}

/**
 * The picture on a card when there is no photograph to show.
 *
 * The built-in templates ship without media, so there is nothing to grab a
 * frame from — and a grid of eight blank rectangles is not a visual browser,
 * it is a list with extra whitespace. This draws the template instead: the
 * frame in its real proportions, the shots as blocks sized by how long each
 * one runs, and a marker where a title sits.
 *
 * It is a diagram, not a fake screenshot. Showing stock imagery the template
 * does not contain would look better and tell the user something untrue.
 */
function TemplateSchematic({ summary }: { summary: TemplateSummary }) {
  const portrait = summary.height > summary.width
  // Slot durations are not in the summary, so the blocks are even. The count
  // and the shape are what the diagram is really communicating.
  const blocks = Array.from({ length: Math.min(summary.slotCount, 8) })

  return (
    <div className="flex h-28 w-full items-center justify-center rounded bg-zinc-950">
      <div
        className={`flex gap-[2px] overflow-hidden rounded-sm border border-zinc-700 bg-zinc-900 p-[3px] ${
          portrait ? 'h-[88px] w-[50px] flex-col' : 'h-[50px] w-[88px] flex-row'
        }`}
      >
        {blocks.map((_, index) => (
          <div
            key={index}
            className="flex-1 rounded-[1px] bg-accent/25"
            style={{ opacity: 0.45 + (index / Math.max(1, blocks.length)) * 0.55 }}
          />
        ))}
      </div>
    </div>
  )
}

/** One template in the browser. Shared by the user's own and the built-ins. */
function TemplateCard({ summary, busy, onUse, onDelete }: {
  summary: TemplateSummary
  busy: boolean
  onUse: () => void
  /** Absent for a built-in: there is no file to delete. */
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  const aspect = summary.height > summary.width
    ? '9:16'
    : summary.width > summary.height ? '16:9' : '1:1'

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5 transition-colors hover:border-zinc-700">
      {summary.coverPath
        ? (
          <img
            src={pathToFileUrl(summary.coverPath)}
            alt=""
            className="h-28 w-full rounded bg-zinc-950 object-cover"
          />
        )
        : <TemplateSchematic summary={summary} />}
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-100">
          {summary.name}
        </span>
        {onDelete && (
          <button
            onClick={onDelete}
            title={t('common.delete')}
            className="flex-shrink-0 cursor-pointer rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-500">
        <span className="rounded bg-zinc-800 px-1 py-[1px]">{summary.slotCount}</span>
        <span>{summary.durationSec.toFixed(1)}s</span>
        <span>·</span>
        <span>{aspect}</span>
      </div>
      <button
        onClick={onUse}
        disabled={busy}
        className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded bg-zinc-800 px-2.5 py-1.5 text-[11px] font-medium text-accent transition-colors hover:bg-zinc-700 disabled:pointer-events-none disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        <span>{t('library.templates.useBtn')}</span>
      </button>
    </div>
  )
}

/** Sub-nav pill id → the category it filters to. 'templates' means everything. */
const SECTION_CATEGORY: Record<string, string> = {
  'tpl-opener': 'opener',
  'tpl-montage': 'montage',
  'tpl-compare': 'compare',
  'tpl-text': 'text',
}

export function TemplatesLibrary({ section }: { section: string }) {
  const { t } = useTranslation()
  const { settings } = useSettings()
  const { activeProject } = useProjects()
  const actions = useEditorActions()
  const activeTimeline = useEditorStore(selectActiveTimeline)
  const assets = useEditorStore(s => s.editorModel.assets)

  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [busyFileName, setBusyFileName] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('')
  const [makeCover, setMakeCover] = useState(true)
  const [feedback, setFeedback] = useState<Feedback>(null)
  /** Which template the slot picker is open for, and what has been chosen. */
  const [pending, setPending] = useState<{ template: KomfyTemplate; picks: (string | null)[] } | null>(null)
  const [query, setQuery] = useState('')
  const [orientation, setOrientation] = useState<'all' | 'vertical' | 'horizontal'>('all')
  const [slotFilter, setSlotFilter] = useState<'all' | 'few' | 'many'>('all')

  const presetsDir = settings.presetsDir || undefined
  const projectId = activeProject?.id ?? null

  /** Media the project can put into a slot. */
  const fillable = useMemo(
    () => assets.filter(asset => asset.type === 'video' || asset.type === 'image'),
    [assets],
  )

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.templateList) return
    setLoading(true)
    try {
      const res = await window.electronAPI.templateList({ presetsDir })
      setTemplates(res.templates)
    } catch (err: any) {
      setFeedback({ success: false, message: err?.message || String(err) })
    } finally {
      setLoading(false)
    }
  }, [presetsDir])

  useEffect(() => { void refresh() }, [refresh])

  const handleSave = async () => {
    if (!activeTimeline || !window.electronAPI?.templateSave) return

    const { template, media } = buildTemplateFromTimeline(activeTimeline, { name: saveName })
    if (template.slots.length === 0) {
      setFeedback({ success: false, message: t('library.templates.noSlotsToSave') })
      return
    }

    /*
     * The cover is a frame of the first shot, taken from the middle of the part
     * the edit actually uses. It is a real picture of the edit as it stood when
     * it was saved — which means it also shows the footage of whoever saved it,
     * so it is a choice rather than a default side effect.
     */
    const firstSlot = template.slots[0]
    const firstClip = activeTimeline.clips.find(clip => clip.id === firstSlot?.clipId)
    const coverPath = firstClip?.asset?.path
    const cover = makeCover && coverPath && firstClip
      ? {
          videoPath: coverPath,
          seekTime: firstClip.trimStart + (firstClip.duration * (firstClip.speed || 1)) / 2,
        }
      : undefined

    setBusyFileName('__save__')
    try {
      const res = await window.electronAPI.templateSave({ presetsDir, template, media, cover })
      if (!res.success) {
        setFeedback({ success: false, message: res.error || t('library.templates.saveFailed') })
        return
      }
      setSaveName('')
      setFeedback({
        success: true,
        message: media.length > 0
          ? t('library.templates.savedWithMedia', {
              name: template.name, count: template.slots.length, files: media.length,
            })
          : t('library.templates.saved', { name: template.name, count: template.slots.length }),
      })
      await refresh()
    } finally {
      setBusyFileName(null)
    }
  }

  const openPicker = async (summary: TemplateSummary) => {
    if (!window.electronAPI?.templateRead) return
    setBusyFileName(summary.fileName)
    setFeedback(null)
    try {
      const res = await window.electronAPI.templateRead({ presetsDir, fileName: summary.fileName })
      if (!res.success || !res.template) {
        setFeedback({ success: false, message: res.error || t('library.templates.readFailed') })
        return
      }
      // Pre-fill in project order: the common case is "use the clips I just
      // imported, in the order I imported them".
      const picks = res.template.slots.map((_, index) => fillable[index]?.id ?? null)
      setPending({ template: res.template, picks })
    } finally {
      setBusyFileName(null)
    }
  }

  /**
   * Copies the template's own media into this project before applying it.
   *
   * Referencing the files where they sit in the template folder would be less
   * work and would leave the project depending on a template the user is free
   * to delete or move. Projects here keep their media in their own folder, and
   * one applied from a template should be no different.
   */
  const adoptBundledMedia = async (template: KomfyTemplate): Promise<KomfyTemplate> => {
    if (template.bundledMedia.length === 0) return template
    if (!projectId || !window.electronAPI?.addGenericAssetToProject) return template

    const copied = new Map<string, string>()
    const clips = await Promise.all(template.timeline.clips.map(async clip => {
      const source = clip.asset?.path
      if (!source) return clip

      // Only the template's own files; a slot's media is not here at all.
      const isBundled = template.bundledMedia.some(name => source.endsWith(name))
      if (!isBundled) return clip

      const already = copied.get(source)
      if (already) return { ...clip, asset: { ...clip.asset!, path: already } }

      const res = await window.electronAPI!.addGenericAssetToProject!({ srcPath: source, projectId })
      if (!res.success || !res.path) return clip
      copied.set(source, res.path)
      return { ...clip, asset: { ...clip.asset!, path: res.path } }
    }))

    return { ...template, timeline: { ...template.timeline, clips } }
  }

  const handleApply = async () => {
    if (!pending) return
    const bindings = pending.picks
      .map((assetId, index) => ({ slotIndex: pending.template.slots[index].slotIndex, assetId }))
      .filter((binding): binding is { slotIndex: number; assetId: string } => Boolean(binding.assetId))

    setBusyFileName('__apply__')
    try {
      const template = await adoptBundledMedia(pending.template)
      actions.applyTemplateAsTimeline({ template, bindings })

      const empty = template.slots.length - bindings.length
      setFeedback({
        success: true,
        message: empty > 0
          ? t('library.templates.appliedWithGaps', { name: template.name, count: empty })
          : t('library.templates.applied', { name: template.name }),
      })
      setPending(null)
    } finally {
      setBusyFileName(null)
    }
  }

  const handleDelete = async (summary: TemplateSummary) => {
    if (!window.electronAPI?.templateDelete) return
    setBusyFileName(summary.fileName)
    try {
      const res = await window.electronAPI.templateDelete({ presetsDir, fileName: summary.fileName })
      if (!res.success) {
        setFeedback({
          success: false,
          message: res.error === 'BUILTIN_TEMPLATE'
            ? t('library.templates.builtinReadOnly')
            : res.error || t('library.templates.deleteFailed'),
        })
        return
      }
      await refresh()
    } finally {
      setBusyFileName(null)
    }
  }

  /**
   * What the browser is actually showing.
   *
   * The pill on the left picks a shelf, the search box narrows by name, and the
   * two dropdowns narrow by shape and by how many shots the template wants —
   * the three things you can tell about a template before opening it, and
   * the three standard filters placed at the top of the browser for the same reason.
   */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const category = SECTION_CATEGORY[section]

    return templates.filter(entry => {
      if (section === 'tpl-yours' && entry.builtin) return false
      if (category && entry.category !== category) return false
      if (needle && !entry.name.toLowerCase().includes(needle)) return false

      if (orientation === 'vertical' && entry.height <= entry.width) return false
      if (orientation === 'horizontal' && entry.width <= entry.height) return false

      if (slotFilter === 'few' && entry.slotCount > 3) return false
      if (slotFilter === 'many' && entry.slotCount <= 3) return false
      return true
    })
  }, [templates, section, query, orientation, slotFilter])

  const mine = useMemo(() => visible.filter(entry => !entry.builtin), [visible])
  const builtin = useMemo(() => visible.filter(entry => entry.builtin), [visible])

  return (
    <div className="flex flex-col gap-4 p-1">
      <div className="border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-1.5">
          <LayoutTemplate className="h-4 w-4 text-accent" />
          <p className="text-[12px] font-semibold text-zinc-200">{t('library.templates.title')}</p>
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
          {t('library.templates.desc')}
        </p>
      </div>

      {/* Save the current edit */}
      <div className="space-y-1.5">
        <label className="block text-[11px] font-medium text-zinc-300">
          {t('library.templates.saveLabel')}
        </label>
        <div className="flex gap-2">
          <input
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            placeholder={t('library.templates.namePlaceholder')}
            className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-200 placeholder:text-zinc-600"
          />
          <button
            onClick={handleSave}
            disabled={!activeTimeline || busyFileName === '__save__'}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-zinc-950 transition-colors hover:bg-accent/90 disabled:pointer-events-none disabled:opacity-40"
          >
            {busyFileName === '__save__'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Save className="h-3.5 w-3.5" />}
            <span>{t('common.save')}</span>
          </button>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-[11px] text-zinc-400">
          <input
            type="checkbox"
            checked={makeCover}
            onChange={e => setMakeCover(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-accent"
          />
          <span className="leading-relaxed">
            {t('library.templates.makeCover')}
            <span className="block text-[10.5px] text-zinc-500">
              {t('library.templates.makeCoverHint')}
            </span>
          </span>
        </label>
        <p className="text-[10.5px] leading-relaxed text-zinc-500">
          {t('library.templates.saveHint')}
        </p>
      </div>

      {feedback && (
        <div className={`flex items-start gap-1.5 rounded-lg border p-2.5 text-[11px] ${
          feedback.success
            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
            : 'border-amber-800/80 bg-amber-950/40 text-amber-300'
        }`}>
          {feedback.success
            ? <CheckCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            : <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Slot picker for the template being applied */}
      {pending && (
        <div className="space-y-2 rounded-lg border border-accent/40 bg-zinc-900 p-2.5">
          <p className="text-[11px] font-semibold text-zinc-200">
            {t('library.templates.fillSlots', { name: pending.template.name })}
          </p>
          {fillable.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-amber-300">
              {t('library.templates.noMedia')}
            </p>
          ) : (
            pending.template.slots.map((slot, index) => {
              const chosen = fillable.find(asset => asset.id === pending.picks[index])
              const note = chosen ? describeSlotFit(slot, chosen, t) : null

              return (
              <div key={slot.slotIndex} className="space-y-1 text-[11px]">
                <div className="flex items-center gap-2">
                <span className="w-24 flex-shrink-0 text-zinc-400">
                  {slot.label || t('library.templates.slotN', { index: slot.slotIndex })}
                  <span className="ml-1 font-mono text-zinc-600">{slot.duration.toFixed(1)}s</span>
                </span>
                <select
                  value={pending.picks[index] ?? ''}
                  onChange={e => setPending(prev => prev && {
                    ...prev,
                    picks: prev.picks.map((pick, i) => (i === index ? (e.target.value || null) : pick)),
                  })}
                  className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-zinc-200"
                >
                  <option value="">{t('library.templates.leaveEmpty')}</option>
                  {fillable.map((asset: Asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.path ? asset.path.split(/[/\\]/).pop() : asset.id}
                    </option>
                  ))}
                </select>
                </div>
                {note && (
                  <p className={`pl-[6.5rem] text-[10.5px] leading-relaxed ${
                    note.tone === 'warn' ? 'text-amber-400/90' : 'text-zinc-500'
                  }`}>
                    {note.text}
                  </p>
                )}
              </div>
              )
            })
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setPending(null)}
              className="flex-1 cursor-pointer rounded-lg bg-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleApply}
              disabled={busyFileName === '__apply__'}
              className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-zinc-950 transition-colors hover:bg-accent/90 disabled:pointer-events-none disabled:opacity-40"
            >
              {busyFileName === '__apply__' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{t('library.templates.applyBtn')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Search and the two things you can judge before opening one */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('library.templates.searchPlaceholder')}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-1.5 pl-8 pr-2 text-[11px] text-zinc-200 placeholder:text-zinc-600"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={orientation}
            onChange={e => setOrientation(e.target.value as typeof orientation)}
            className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-300"
          >
            <option value="all">{t('library.templates.orientationAll')}</option>
            <option value="vertical">{t('library.templates.orientationVertical')}</option>
            <option value="horizontal">{t('library.templates.orientationHorizontal')}</option>
          </select>
          <select
            value={slotFilter}
            onChange={e => setSlotFilter(e.target.value as typeof slotFilter)}
            className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-300"
          >
            <option value="all">{t('library.templates.slotsAll')}</option>
            <option value="few">{t('library.templates.slotsFew')}</option>
            <option value="many">{t('library.templates.slotsMany')}</option>
          </select>
        </div>
      </div>

      {/* The library */}
      <div className="space-y-2">
        {visible.length === 0 && !loading && templates.length > 0 && (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-[11px] leading-relaxed text-zinc-500">
            {t('library.templates.noMatches')}
          </p>
        )}

        {mine.length > 0 && (
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
            {t('library.templates.yours', { count: mine.length })}
          </p>
        )}

        {loading && <p className="text-[11px] text-zinc-500">{t('common.loading')}</p>}

        {!loading && section === 'tpl-yours' && mine.length === 0 && (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-[11px] leading-relaxed text-zinc-500">
            {t('library.templates.empty')}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
        {mine.map(summary => (
          <TemplateCard
            key={summary.fileName}
            summary={summary}
            busy={busyFileName === summary.fileName}
            onUse={() => openPicker(summary)}
            onDelete={() => handleDelete(summary)}
          />
        ))}
        </div>

        {builtin.length > 0 && (
          <>
            <p className="pt-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
              {t('library.templates.builtin', { count: builtin.length })}
            </p>
            <p className="text-[10.5px] leading-relaxed text-zinc-500">
              {t('library.templates.builtinHint')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {builtin.map(summary => (
                <TemplateCard
                  key={summary.fileName}
                  summary={summary}
                  busy={busyFileName === summary.fileName}
                  onUse={() => openPicker(summary)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
