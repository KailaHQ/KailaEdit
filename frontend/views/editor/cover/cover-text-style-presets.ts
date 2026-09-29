import type { TextCoverElement } from './types'
import type { CSSProperties } from 'react'

/**
 * A "look" preset for text on the cover: colour, outline, box and shadow.
 * Unlike COVER_TEXT_PRESETS (which add a new text element), these only restyle
 * the selected text — same as "Preset style" in the video editor's text panel.
 */
export interface CoverTextLook {
  color: string
  strokeEnabled: boolean
  strokeColor: string
  strokeWidth: number
  backgroundColor?: string
  shadowEnabled: boolean
  shadowColor: string
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
}

export interface CoverTextStylePreset {
  id: string
  look: CoverTextLook
}

const PLAIN: CoverTextLook = {
  color: '#FFFFFF',
  strokeEnabled: false,
  strokeColor: 'transparent',
  strokeWidth: 0,
  backgroundColor: undefined,
  shadowEnabled: false,
  shadowColor: 'rgba(0,0,0,0)',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
}

const outlined = (color: string, stroke: string, width = 4): CoverTextLook => ({
  ...PLAIN, color, strokeEnabled: true, strokeColor: stroke, strokeWidth: width,
})
const boxed = (color: string, background: string): CoverTextLook => ({
  ...PLAIN, color, backgroundColor: background,
})
const glowing = (color: string, glow: string): CoverTextLook => ({
  ...PLAIN, color, shadowEnabled: true, shadowColor: glow, shadowBlur: 18, shadowOffsetX: 0, shadowOffsetY: 0,
})
const shadowed = (color: string, shadow: string): CoverTextLook => ({
  ...PLAIN, color, shadowEnabled: true, shadowColor: shadow, shadowBlur: 0, shadowOffsetX: 4, shadowOffsetY: 4,
})

/** "None": plain white text — no outline, box or shadow. Always first in the grid. */
export const PLAIN_COVER_TEXT_LOOK_ID = 'plain'

export const COVER_TEXT_STYLE_PRESETS: CoverTextStylePreset[] = [
  { id: PLAIN_COVER_TEXT_LOOK_ID, look: PLAIN },
  { id: 'white-black-outline', look: outlined('#FFFFFF', '#000000') },
  { id: 'black-white-outline', look: outlined('#000000', '#FFFFFF') },
  { id: 'white-soft-shadow', look: { ...PLAIN, shadowEnabled: true, shadowColor: 'rgba(0,0,0,0.85)', shadowBlur: 8, shadowOffsetX: 2, shadowOffsetY: 3 } },
  { id: 'white-hard-shadow', look: shadowed('#FFFFFF', '#000000') },
  { id: 'yellow-black-outline', look: outlined('#FFE600', '#000000') },
  { id: 'red-white-outline', look: outlined('#EF233C', '#FFFFFF') },
  { id: 'orange-white-outline', look: outlined('#FF8A00', '#FFFFFF') },
  { id: 'blue-white-outline', look: outlined('#1E90FF', '#FFFFFF') },
  { id: 'green-black-outline', look: outlined('#00FF66', '#000000') },
  { id: 'white-on-grey', look: boxed('#FFFFFF', '#6B7280E6') },
  { id: 'white-on-silver', look: boxed('#FFFFFF', '#A1A1AAE6') },
  { id: 'black-on-yellow', look: boxed('#000000', '#FFE600FF') },
  { id: 'white-on-purple', look: boxed('#FFFFFF', '#8B00FFFF') },
  { id: 'purple-on-white', look: boxed('#8B00FF', '#FFFFFFFF') },
  { id: 'black-on-white', look: boxed('#000000', '#FFFFFFFF') },
  { id: 'white-on-black', look: boxed('#FFFFFF', '#000000FF') },
  { id: 'green-on-black', look: boxed('#00FF66', '#000000FF') },
  { id: 'black-green-shadow', look: shadowed('#000000', '#00FF66') },
  { id: 'orange-dark-outline', look: outlined('#FFB000', '#7C2D12', 3) },
  { id: 'pink-white-outline', look: outlined('#E11D48', '#FFFFFF', 3) },
  { id: 'white-gold-glow', look: glowing('#FFFFFF', '#FFD60A') },
  { id: 'green-glow', look: glowing('#B6FF3B', '#16A34A') },
]

/** Is `el` wearing exactly this look? Used to mark the active tile. */
export function isCoverTextLook(el: TextCoverElement, look: CoverTextLook): boolean {
  if (el.color?.toLowerCase() !== look.color.toLowerCase()) return false

  const hasStroke = el.stroke?.enabled && (el.stroke?.width ?? 0) > 0
  if (look.strokeEnabled !== !!hasStroke) return false
  if (look.strokeEnabled && hasStroke) {
    if (el.stroke!.color.toLowerCase() !== look.strokeColor.toLowerCase()) return false
    if (el.stroke!.width !== look.strokeWidth) return false
  }

  const hasShadow = el.shadow?.enabled && (el.shadow!.blur > 0 || el.shadow!.offsetX !== 0 || el.shadow!.offsetY !== 0)
  if (look.shadowEnabled !== !!hasShadow) return false
  if (look.shadowEnabled && hasShadow) {
    if (el.shadow!.color.toLowerCase() !== look.shadowColor.toLowerCase()) return false
    if (el.shadow!.blur !== look.shadowBlur) return false
  }

  const elBg = el.backgroundColor ?? undefined
  if ((look.backgroundColor ?? undefined) !== elBg) {
    // Loose compare: both undefined/absent → match
    if (look.backgroundColor && elBg && look.backgroundColor.toLowerCase() !== elBg.toLowerCase()) return false
    if ((look.backgroundColor && !elBg) || (!look.backgroundColor && elBg)) return false
  }

  return true
}

/** Apply a look to a cover text element (partial updates only — preserves text, font, position). */
export function applyCoverTextLook(look: CoverTextLook): Partial<TextCoverElement> {
  return {
    color: look.color,
    backgroundColor: look.backgroundColor,
    stroke: look.strokeEnabled
      ? { enabled: true, color: look.strokeColor, width: look.strokeWidth }
      : { enabled: false, color: 'transparent', width: 0 },
    shadow: look.shadowEnabled
      ? { enabled: true, color: look.shadowColor, blur: look.shadowBlur, offsetX: look.shadowOffsetX, offsetY: look.shadowOffsetY }
      : { enabled: false, color: 'rgba(0,0,0,0)', blur: 0, offsetX: 0, offsetY: 0 },
  }
}

/** The CSS that draws a look on a preset tile — the same way the cover canvas draws text. */
export function coverTextLookCss(look: CoverTextLook, scale = 0.35): CSSProperties {
  const hasShadow = look.shadowEnabled && (look.shadowBlur > 0 || look.shadowOffsetX !== 0 || look.shadowOffsetY !== 0)
  return {
    color: look.color,
    backgroundColor: look.backgroundColor ?? undefined,
    padding: look.backgroundColor ? '0 3px' : undefined,
    borderRadius: look.backgroundColor ? 3 : undefined,
    WebkitTextStroke: look.strokeEnabled && look.strokeColor !== 'transparent'
      ? `${Math.max(1, look.strokeWidth * scale)}px ${look.strokeColor}`
      : undefined,
    paintOrder: 'stroke fill',
    textShadow: hasShadow
      ? `${look.shadowOffsetX * scale}px ${look.shadowOffsetY * scale}px ${look.shadowBlur * scale}px ${look.shadowColor}`
      : undefined,
  }
}
