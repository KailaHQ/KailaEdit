import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import {
  Brush,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Diamond,
  Heart,
  Link2,
  Link2Off,
  PanelTop,
  PenTool,
  Plus,
  RotateCcw,
  Rows3,
  Square,
  Star,
  Type,
  X,
} from 'lucide-react'
import type { TimelineClip, ClipMask, ClipMaskShape } from '../../../types/project-model'
import { DEFAULT_CLIP_MASK, getClipMasks } from '../../../types/project-model'
import { useTranslation } from '../../../i18n/I18nContext'
import { selectActiveMaskId } from '../editor-selectors'
import { useEditorActions, useEditorStore } from '../editor-store'
import { PropertyNumberInput, PropertyRotateDial } from '../PropertyControls'

interface MaskPropertiesSectionProps {
  selectedClip: TimelineClip
}

type TileIcon = ComponentType<{ className?: string }>

/** The first row of the picker, in the order the reference shows it. */
const SHAPE_CHOICES: Array<{ shape: ClipMaskShape; labelKey: string; Icon: TileIcon }> = [
  { shape: 'linear', labelKey: 'split', Icon: PanelTop },
  { shape: 'mirror', labelKey: 'filmstrip', Icon: Rows3 },
  { shape: 'ellipse', labelKey: 'circle', Icon: Circle },
  { shape: 'rectangle', labelKey: 'rectangle', Icon: Square },
  { shape: 'star', labelKey: 'star', Icon: Star },
  { shape: 'heart', labelKey: 'heart', Icon: Heart },
]

/** The second row: kinds of mask the picker shows but the editor cannot cut yet. */
const UPCOMING_CHOICES: Array<{ labelKey: string; Icon: TileIcon; premium: boolean }> = [
  { labelKey: 'text', Icon: Type, premium: false },
  { labelKey: 'brush', Icon: Brush, premium: true },
  { labelKey: 'pen', Icon: PenTool, premium: true },
]

/** The picture's size in pixels when the clip's own is unknown. */
const FALLBACK_SIZE = { width: 1080, height: 1920 }

/** A block with the reference's header: a title and a caret that folds it. */
function Section({ title, leading, trailing, children }: { title: string; leading?: ReactNode; trailing?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
        {leading}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
          className="flex items-center gap-1 text-xs font-semibold text-zinc-200"
        >
          {title}
          <ChevronDown className={`h-3 w-3 text-zinc-400 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        </div>
        {trailing}
      </div>
      {open && children}
    </section>
  )
}

/** The reference's "< ◇ >" keyframe control at the end of a row. Masks cannot be keyframed yet. */
function KeyframeSlot({ title }: { title: string }) {
  return (
    <span className="flex flex-shrink-0 items-center text-zinc-600" title={title} aria-hidden="true">
      <ChevronLeft className="h-3 w-3" />
      <Diamond className="h-3 w-3" />
      <ChevronRight className="h-3 w-3" />
    </span>
  )
}

export function MaskPropertiesSection({ selectedClip }: MaskPropertiesSectionProps) {
  const { t } = useTranslation()
  const { addClipMask, removeClipMask, updateClipMask, setClipMaskShape, setActiveMaskId, setClipMask, setMaskMode } = useEditorActions()
  const activeMaskId = useEditorStore(selectActiveMaskId)
  const [lockRatio, setLockRatio] = useState(false)

  // The canvas handles and the dimmed picture are on for as long as this tab is open.
  useEffect(() => {
    setMaskMode(true)
    return () => setMaskMode(false)
  }, [setMaskMode])

  const masks = getClipMasks(selectedClip)
  const activeMask: ClipMask | undefined = masks.find(mask => mask.id === activeMaskId) ?? masks[0]
  const mask = activeMask ?? DEFAULT_CLIP_MASK
  const anyEnabled = masks.some(item => item.enabled !== false)
  const soon = t('clipProperties.mask.comingSoon')

  // The panel speaks in pixels of the clip's own picture, centred on 0,0 with Y up, as the
  // reference does; the mask itself keeps percentages of the picture.
  const pictureWidth = selectedClip.asset?.width || FALLBACK_SIZE.width
  const pictureHeight = selectedClip.asset?.height || FALLBACK_SIZE.height

  const shapeLabel = (shape: ClipMaskShape) => {
    const choice = SHAPE_CHOICES.find(item => item.shape === shape)
    return t(`clipProperties.mask.shapes.${choice?.labelKey ?? 'rectangle'}`)
  }

  const patchActive = (patch: Partial<ClipMask>) => {
    if (activeMask) updateClipMask(selectedClip.id, activeMask.id!, patch)
  }

  const addMask = (shape: ClipMaskShape) => {
    addClipMask(selectedClip.id, shape)
    setMaskMode(true)
  }

  const setAllEnabled = (enabled: boolean) => {
    if (enabled && masks.length === 0) {
      addMask('rectangle')
      return
    }
    masks.forEach(item => updateClipMask(selectedClip.id, item.id!, { enabled }))
    setMaskMode(enabled)
  }

  const resetActive = () => {
    patchActive({
      x: DEFAULT_CLIP_MASK.x,
      y: DEFAULT_CLIP_MASK.y,
      width: DEFAULT_CLIP_MASK.width,
      height: DEFAULT_CLIP_MASK.height,
      rotation: 0,
      feather: 0,
      roundCorners: 0,
      invert: false,
    })
  }

  const changeWidthPx = (px: number) => {
    const width = Math.max(1, Math.min(200, (px / pictureWidth) * 100))
    if (lockRatio && mask.width > 0) {
      patchActive({ width, height: Math.max(1, Math.min(200, (mask.height * width) / mask.width)) })
    } else {
      patchActive({ width })
    }
  }

  const changeHeightPx = (px: number) => {
    const height = Math.max(1, Math.min(200, (px / pictureHeight) * 100))
    if (lockRatio && mask.height > 0) {
      patchActive({ height, width: Math.max(1, Math.min(200, (mask.width * height) / mask.height)) })
    } else {
      patchActive({ height })
    }
  }

  /** A slider with the value box beside it, then the keyframe slot, as in the reference. */
  const sliderRow = (label: string, value: number, onChange: (v: number) => void) => (
    <div className="space-y-1.5">
      <span className="text-xs text-zinc-400">{label}</span>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="h-1.5 flex-1 accent-cyan-400"
        />
        <PropertyNumberInput className="w-16" value={Math.round(value)} min={0} max={100} onChange={onChange} />
        <KeyframeSlot title={soon} />
      </div>
    </div>
  )

  const row = (label: string, controls: ReactNode) => (
    <div className="flex items-center gap-3">
      <span className="w-[88px] flex-shrink-0 text-xs text-zinc-400">{label}</span>
      <div className="flex flex-1 items-center gap-2">{controls}</div>
      <KeyframeSlot title={soon} />
    </div>
  )

  return (
    <div className="space-y-4">
      <Section
        title={t('clipProperties.mask.title')}
        leading={
          <input
            type="checkbox"
            aria-label={t('clipProperties.mask.title')}
            checked={anyEnabled}
            onChange={(e) => setAllEnabled(e.target.checked)}
            className="rounded bg-zinc-800 border-zinc-600 accent-cyan-400"
          />
        }
      >
        {/* One tab per mask; a tab picks which mask the settings and the canvas handles edit. */}
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={t('clipProperties.mask.title')}>
          {masks.map((item, index) => {
            const selected = item.id === activeMask?.id
            return (
              <div
                key={item.id}
                className={`flex items-center rounded-full text-xs font-semibold transition-colors ${
                  selected ? 'bg-zinc-600 text-zinc-100' : 'bg-zinc-700/60 text-zinc-400 hover:bg-zinc-700'
                } ${item.enabled === false ? 'opacity-50' : ''}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`py-1 pl-3 ${selected ? 'pr-1.5' : 'pr-3'}`}
                  onClick={() => {
                    setActiveMaskId(item.id!)
                    setMaskMode(true)
                  }}
                >
                  {`${t('clipProperties.mask.name')}${index + 1} ${shapeLabel(item.shape)}`}
                </button>
                {selected && (
                  <button
                    type="button"
                    aria-label={t('clipProperties.mask.remove')}
                    title={t('clipProperties.mask.remove')}
                    className="pr-2 text-zinc-400 hover:text-red-400"
                    onClick={() => {
                      removeClipMask(selectedClip.id, item.id!)
                      if (masks.length <= 1) setMaskMode(false)
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )
          })}
          <button
            type="button"
            aria-label={t('clipProperties.mask.add')}
            title={t('clipProperties.mask.add')}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-700/60 text-zinc-300 hover:bg-zinc-700"
            onClick={() => addMask('rectangle')}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* The picker: square tiles with the name underneath. */}
        <div className="grid grid-cols-6 gap-x-2 gap-y-3">
          {SHAPE_CHOICES.map(({ shape, labelKey, Icon }) => {
            const selected = !!activeMask && activeMask.shape === shape
            const label = t(`clipProperties.mask.shapes.${labelKey}`)
            return (
              <div key={shape} className="flex w-full max-w-[62px] flex-col items-center gap-1.5">
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={selected}
                  onClick={() => {
                    if (activeMask) setClipMaskShape(selectedClip.id, activeMask.id!, shape)
                    else addMask(shape)
                  }}
                  className={`flex aspect-square w-full items-center justify-center rounded-lg border-2 bg-zinc-700/50 transition-colors ${
                    selected
                      ? 'border-cyan-400 text-zinc-100'
                      : 'border-transparent text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  <Icon className="h-6 w-6" />
                </button>
                <span className={`text-[11px] ${selected ? 'text-zinc-100' : 'text-zinc-400'}`}>{label}</span>
              </div>
            )
          })}
          {UPCOMING_CHOICES.map(({ labelKey, Icon, premium }) => {
            const label = t(`clipProperties.mask.shapes.${labelKey}`)
            return (
              <div key={labelKey} className="flex w-full max-w-[62px] flex-col items-center gap-1.5">
                <button
                  type="button"
                  disabled
                  aria-label={label}
                  title={soon}
                  className="relative flex aspect-square w-full cursor-not-allowed items-center justify-center rounded-lg border-2 border-transparent bg-zinc-700/30 text-zinc-500"
                >
                  <Icon className="h-6 w-6" />
                  {premium && (
                    <span className="absolute left-1 top-1 flex h-3 w-3 items-center justify-center rounded-sm bg-violet-500 text-white">
                      <Diamond className="h-2 w-2" />
                    </span>
                  )}
                </button>
                <span className="text-[11px] text-zinc-500">{label}</span>
              </div>
            )
          })}
        </div>
      </Section>

      {activeMask && (
        <Section
          title={t('clipProperties.mask.settings')}
          trailing={
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={t('clipProperties.mask.reset')}
                title={t('clipProperties.mask.reset')}
                onClick={resetActive}
                className="text-zinc-400 hover:text-zinc-100"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <KeyframeSlot title={soon} />
            </div>
          }
        >
          {row(
            t('clipProperties.mask.position'),
            <>
              <PropertyNumberInput
                className="w-[84px]"
                prefix="X"
                value={Math.round(((mask.x - 50) / 100) * pictureWidth)}
                onChange={(v) => patchActive({ x: Math.max(0, Math.min(100, 50 + (v / pictureWidth) * 100)) })}
              />
              <PropertyNumberInput
                className="w-[84px]"
                prefix="Y"
                value={Math.round((-(mask.y - 50) / 100) * pictureHeight)}
                onChange={(v) => patchActive({ y: Math.max(0, Math.min(100, 50 - (v / pictureHeight) * 100)) })}
              />
            </>,
          )}

          {row(
            t('clipProperties.mask.rotation'),
            <>
              <PropertyNumberInput
                className="w-[84px]"
                value={mask.rotation ?? 0}
                min={-180}
                max={180}
                precision={1}
                suffix="°"
                onChange={(v) => patchActive({ rotation: v })}
              />
              <PropertyRotateDial rotation={mask.rotation ?? 0} onReset={() => patchActive({ rotation: 0 })} />
            </>,
          )}

          {mask.shape !== 'linear' &&
            row(
              t('clipProperties.mask.size'),
              <>
                {mask.shape !== 'mirror' ? (
                  <PropertyNumberInput
                    className="w-[84px]"
                    prefix="↔"
                    value={Math.round((mask.width / 100) * pictureWidth)}
                    min={1}
                    onChange={changeWidthPx}
                  />
                ) : (
                  <span className="flex-1" />
                )}
                {mask.shape !== 'mirror' && (
                  <button
                    type="button"
                    aria-label={t('clipProperties.mask.lockRatio')}
                    aria-pressed={lockRatio}
                    title={t('clipProperties.mask.lockRatio')}
                    onClick={() => setLockRatio(value => !value)}
                    className={`flex-shrink-0 ${lockRatio ? 'text-cyan-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    {lockRatio ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
                  </button>
                )}
                <PropertyNumberInput
                  className="w-[84px]"
                  prefix="↕"
                  value={Math.round((mask.height / 100) * pictureHeight)}
                  min={1}
                  onChange={changeHeightPx}
                />
              </>,
            )}

          {sliderRow(t('clipProperties.mask.feather'), mask.feather ?? 0, (v) => patchActive({ feather: v }))}
          {mask.shape === 'rectangle' &&
            sliderRow(t('clipProperties.mask.roundCorners'), mask.roundCorners ?? 0, (v) => patchActive({ roundCorners: v }))}

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={mask.invert ?? false}
              onChange={(e) => patchActive({ invert: e.target.checked })}
              className="rounded bg-zinc-800 border-zinc-600 accent-cyan-400"
            />
            <span className="text-xs text-zinc-300">{t('clipProperties.mask.invert')}</span>
          </label>

          <button
            type="button"
            className="text-xs text-zinc-500 transition-colors hover:text-red-400"
            onClick={() => {
              setClipMask(selectedClip.id, null)
              setMaskMode(false)
            }}
          >
            {t('clipProperties.mask.removeAll')}
          </button>
        </Section>
      )}

      {activeMask && (
        <div className="border-t border-zinc-800/80 pt-3">
          <Section title={t('clipProperties.mask.trackTitle')}>
            {/* Tracking a mask along the footage is not built yet; the controls hold their place. */}
            <div className="flex items-center gap-3">
              <span className="w-[88px] flex-shrink-0 text-xs text-zinc-400">{t('clipProperties.mask.direction')}</span>
              <select
                disabled
                title={soon}
                aria-label={t('clipProperties.mask.direction')}
                className="h-7 flex-1 cursor-not-allowed rounded bg-zinc-800 px-2 text-xs text-zinc-500"
                defaultValue="both"
              >
                <option value="both">{t('clipProperties.mask.directionBoth')}</option>
                <option value="forward">{t('clipProperties.mask.directionForward')}</option>
                <option value="backward">{t('clipProperties.mask.directionBackward')}</option>
              </select>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                disabled
                title={soon}
                className="cursor-not-allowed rounded bg-zinc-700/60 px-6 py-1.5 text-xs font-medium text-zinc-500"
              >
                {t('clipProperties.mask.track')}
              </button>
            </div>
          </Section>
        </div>
      )}
    </div>
  )
}
