import type { CSSProperties } from 'react'
import { DEFAULT_TEXT_STYLE, type TextOverlayStyle } from '../../../types/project-model'

/**
 * The look-only presets in the text panel's "Preset style" grid: colour, outline, box and
 * shadow. Unlike the named templates (TEXT_PRESETS) they leave the font, size, position
 * and text alone — picking one restyles the words, it does not move or resize them.
 */
export type TextLook = Pick<
  TextOverlayStyle,
  | 'color'
  | 'strokeColor'
  | 'strokeWidth'
  | 'backgroundColor'
  | 'padding'
  | 'borderRadius'
  | 'shadowColor'
  | 'shadowBlur'
  | 'shadowOffsetX'
  | 'shadowOffsetY'
>

export interface TextStylePreset {
  id: string
  look: TextLook
}

const PLAIN: TextLook = {
  color: '#FFFFFF',
  strokeColor: 'transparent',
  strokeWidth: 0,
  backgroundColor: 'transparent',
  padding: 0,
  borderRadius: 0,
  shadowColor: 'rgba(0,0,0,0)',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
}

const outlined = (color: string, stroke: string, width = 4): TextLook =>
  ({ ...PLAIN, color, strokeColor: stroke, strokeWidth: width })
const boxed = (color: string, background: string): TextLook =>
  ({ ...PLAIN, color, backgroundColor: background, padding: 16, borderRadius: 8 })
const glowing = (color: string, glow: string): TextLook =>
  ({ ...PLAIN, color, shadowColor: glow, shadowBlur: 18 })
const shadowed = (color: string, shadow: string): TextLook =>
  ({ ...PLAIN, color, shadowColor: shadow, shadowBlur: 0, shadowOffsetX: 4, shadowOffsetY: 4 })

/** "None": plain white text — no outline, box or shadow. Always first in the grid. */
export const PLAIN_TEXT_LOOK_ID = 'plain'

export const TEXT_STYLE_PRESETS: TextStylePreset[] = [
  { id: PLAIN_TEXT_LOOK_ID, look: PLAIN },
  { id: 'white-black-outline', look: outlined('#FFFFFF', '#000000') },
  { id: 'black-white-outline', look: outlined('#000000', '#FFFFFF') },
  { id: 'white-soft-shadow', look: { ...PLAIN, shadowColor: 'rgba(0,0,0,0.85)', shadowBlur: 8, shadowOffsetX: 2, shadowOffsetY: 3 } },
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

/** Is `style` wearing exactly this look? Used to mark the active tile. */
export function isTextLook(style: TextOverlayStyle, look: TextLook): boolean {
  return (Object.keys(look) as (keyof TextLook)[]).every(key => {
    const a = style[key]
    const b = look[key]
    return typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b
  })
}

/** Font size of the "Aa" sample on a preset tile, in CSS px. */
export const TEXT_TILE_FONT_PX = 15

/**
 * The CSS that draws a text style on a preset tile — the way the monitor draws it, shrunk.
 *
 * Every length in a text style (stroke, shadow, padding, corners, letter spacing) is
 * measured against the style's own font size, so a tile with a 15px sample must scale them
 * by 15 / fontSize. Using the raw numbers made a 3px outline on a 72px font into a 3px
 * outline on a 15px one — five times too heavy — which is why tiles such as Bold Impact and
 * Retro Sunset looked nothing like what applying them produced.
 */
export function textStyleTileCss(
  style: Partial<TextOverlayStyle>,
  tileFontPx = TEXT_TILE_FONT_PX,
): CSSProperties {
  const fontSize = style.fontSize && style.fontSize > 0 ? style.fontSize : DEFAULT_TEXT_STYLE.fontSize
  const k = tileFontPx / fontSize
  const strokeWidth = style.strokeWidth ?? 0
  const strokeColor = style.strokeColor ?? 'transparent'
  const shadowBlur = style.shadowBlur ?? 0
  const shadowX = style.shadowOffsetX ?? 0
  const shadowY = style.shadowOffsetY ?? 0
  const hasShadow = shadowBlur > 0 || shadowX !== 0 || shadowY !== 0
  const background = style.backgroundColor
  return {
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontSize: tileFontPx,
    lineHeight: 1,
    color: style.color,
    backgroundColor: background && background !== 'transparent' ? background : undefined,
    padding: style.padding && style.padding > 0 ? style.padding * k : undefined,
    borderRadius: style.borderRadius && style.borderRadius > 0 ? style.borderRadius * k : undefined,
    letterSpacing: style.letterSpacing ? style.letterSpacing * k : undefined,
    WebkitTextStroke: strokeWidth > 0 && strokeColor !== 'transparent'
      ? `${strokeWidth * k}px ${strokeColor}`
      : undefined,
    paintOrder: 'stroke fill',
    textShadow: hasShadow
      ? `${shadowX * k}px ${shadowY * k}px ${shadowBlur * k}px ${style.shadowColor ?? 'black'}`
      : undefined,
  }
}

/** A look preset's tile: the look on the default font size, as the panel applies it. */
export function textLookCss(look: TextLook): CSSProperties {
  return textStyleTileCss({ ...look, fontSize: DEFAULT_TEXT_STYLE.fontSize })
}
