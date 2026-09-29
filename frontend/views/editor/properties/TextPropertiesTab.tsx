import { useState, type ReactNode } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Ban, ChevronDown } from 'lucide-react'
import type { TimelineClip, TextOverlayStyle } from '../../../types/project-model'
import { useEditorActions } from '../editor-store'
import { FontPicker } from '../FontPicker'
import { PropertyNumberInput, PropertyToggle } from '../PropertyControls'
import {
  PLAIN_TEXT_LOOK_ID,
  TEXT_STYLE_PRESETS,
  isTextLook,
  textLookCss,
} from './text-style-presets'

export interface TextPropertiesTabProps {
  selectedClip: TimelineClip
}

type TextSubTab = 'basic' | 'bubble' | 'effects'

/** The default line height; the panel's "Line" value counts tenths away from it. */
const BASE_LINE_HEIGHT = 1.2

// ── Case ────────────────────────────────────────────────────────────────────

export type TextCase = 'upper' | 'lower' | 'title'

export function applyTextCase(text: string, mode: TextCase): string {
  if (mode === 'upper') return text.toUpperCase()
  if (mode === 'lower') return text.toLowerCase()
  return text.toLowerCase().replace(/(^|[\s\n(“"'-])(\p{L})/gu, (_, lead: string, ch: string) => lead + ch.toUpperCase())
}

/** Which case the text is already in, if any — the lit button. */
export function textCaseOf(text: string): TextCase | null {
  if (!/\p{L}/u.test(text)) return null
  if (text === text.toUpperCase()) return 'upper'
  if (text === text.toLowerCase()) return 'lower'
  if (text === applyTextCase(text, 'title')) return 'title'
  return null
}

// ── Colours ─────────────────────────────────────────────────────────────────

/** A stored colour as a hex swatch plus an alpha 0–1. Handles #rgb, #rrggbb(aa), rgb(a)(), transparent. */
export function parseColor(value: string | undefined): { hex: string; alpha: number } {
  const v = (value ?? '').trim()
  if (!v || v === 'transparent') return { hex: '#000000', alpha: 0 }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v)
  if (short) return { hex: `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase(), alpha: 1 }
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v)
  if (long) return { hex: `#${long[1]}`.toLowerCase(), alpha: long[2] ? parseInt(long[2], 16) / 255 : 1 }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v)
  if (rgb) {
    const hex = [rgb[1], rgb[2], rgb[3]]
      .map(n => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0'))
      .join('')
    return { hex: `#${hex}`, alpha: rgb[4] !== undefined ? Math.max(0, Math.min(1, parseFloat(rgb[4]))) : 1 }
  }
  return { hex: '#ffffff', alpha: 1 }
}

/** `#rrggbbaa` — the form the export reads a box colour's opacity from. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')
  return `${hex.slice(0, 7)}${a}`
}

// ── Small building blocks ───────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 min-h-7">
      <span className="w-[76px] flex-shrink-0 text-xs text-zinc-300">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  )
}

function ToggleButton({ active, title, onClick, children }: { active: boolean; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-7 min-w-8 items-center justify-center rounded px-2 text-xs transition-colors ${
        active ? 'bg-zinc-600 text-white' : 'bg-[#232327] text-zinc-300 hover:bg-zinc-700 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function ColorSwatch({ value, onChange, title }: { value: string; onChange: (hex: string) => void; title: string }) {
  const { hex, alpha } = parseColor(value)
  return (
    <label
      title={title}
      className="relative flex h-7 w-[84px] cursor-pointer items-center gap-1 rounded bg-[#232327] px-1 hover:bg-zinc-700"
    >
      <span
        className="h-5 flex-1 rounded-sm border border-zinc-600"
        style={{
          backgroundColor: alpha > 0 ? hex : 'transparent',
          backgroundImage: alpha > 0 ? undefined : 'linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%),linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%)',
          backgroundSize: '8px 8px',
          backgroundPosition: '0 0,4px 4px',
        }}
      />
      <ChevronDown className="h-3.5 w-3.5 text-zinc-300" />
      <input
        type="color"
        value={hex}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  )
}

function Slider({ value, min, max, step = 1, onChange, suffix = '', precision = 0 }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string; precision?: number
}) {
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-white"
      />
      <PropertyNumberInput
        value={value}
        min={min}
        max={max}
        step={step}
        precision={precision}
        suffix={suffix}
        onChange={onChange}
        className="w-[70px] flex-shrink-0"
      />
    </>
  )
}

function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between pt-1">
      <span className="text-xs font-medium text-zinc-200">{children}</span>
      {right}
    </div>
  )
}

// ── The panel ───────────────────────────────────────────────────────────────

export function TextPropertiesTab({ selectedClip }: TextPropertiesTabProps) {
  const { updateClip } = useEditorActions()
  const [subTab, setSubTab] = useState<TextSubTab>('basic')

  if (selectedClip.type !== 'text' || !selectedClip.textStyle) return null

  const ts = selectedClip.textStyle
  const updateText = (patch: Partial<TextOverlayStyle>) => {
    updateClip(selectedClip.id, { textStyle: { ...ts, ...patch } })
  }

  const isBold = ts.fontWeight === 'bold' || Number(ts.fontWeight) >= 600
  const activeCase = textCaseOf(ts.text)
  const lineValue = Math.round((ts.lineHeight - BASE_LINE_HEIGHT) * 10)

  const hasBox = parseColor(ts.backgroundColor).alpha > 0
  const box = parseColor(ts.backgroundColor)
  const hasStroke = ts.strokeWidth > 0 && ts.strokeColor !== 'transparent'
  const hasShadow = ts.shadowBlur > 0 || ts.shadowOffsetX !== 0 || ts.shadowOffsetY !== 0
  const shadow = parseColor(ts.shadowColor)
  const shadowDistance = Math.round(Math.max(Math.abs(ts.shadowOffsetX), Math.abs(ts.shadowOffsetY)))

  return (
    <div className="space-y-4" data-text-properties>
      {/* Level 2 sub-tabs */}
      <div className="flex items-center gap-1 rounded-lg border border-zinc-800/80 bg-[#141416] p-1 select-none">
        {([
          ['basic', 'Basic'],
          ['bubble', 'Bubble'],
          ['effects', 'Effects'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={`flex-1 rounded-md px-2 py-1.5 text-center text-xs font-medium transition-all ${
              subTab === id
                ? 'bg-[#252529] font-semibold text-white shadow-sm'
                : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === 'basic' && (
        <div className="space-y-3.5">
          <textarea
            value={ts.text}
            onChange={e => updateText({ text: e.target.value })}
            rows={3}
            className="w-full resize-none rounded-md border border-zinc-800 bg-[#1c1c1f] px-2.5 py-2 text-xs text-white focus:border-zinc-600 focus:outline-none"
            placeholder="Enter text..."
          />

          <Row label="Font">
            <FontPicker
              value={ts.fontFamily}
              onChange={value => updateText({ fontFamily: value })}
              dropdownAlign="right"
              className="min-w-0 flex-1"
              buttonClassName="w-full"
            />
          </Row>

          <div className="space-y-1.5">
            <span className="text-xs text-zinc-300">Font size</span>
            <div className="flex items-center gap-2">
              <Slider value={ts.fontSize} min={8} max={300} onChange={v => updateText({ fontSize: Math.round(v) })} />
            </div>
          </div>

          <Row label="Pattern">
            <ToggleButton active={isBold} title="Bold" onClick={() => updateText({ fontWeight: isBold ? 'normal' : 'bold' })}>
              <span className="font-bold">B</span>
            </ToggleButton>
            <ToggleButton active={Boolean(ts.underline)} title="Underline" onClick={() => updateText({ underline: !ts.underline })}>
              <span className="underline">U</span>
            </ToggleButton>
            <ToggleButton active={ts.fontStyle === 'italic'} title="Italic" onClick={() => updateText({ fontStyle: ts.fontStyle === 'italic' ? 'normal' : 'italic' })}>
              <span className="italic font-serif">I</span>
            </ToggleButton>
          </Row>

          <Row label="Case">
            <div className="flex overflow-hidden rounded bg-[#232327]">
              {([
                ['upper', 'TT', 'Uppercase'],
                ['lower', 'tt', 'Lowercase'],
                ['title', 'Tt', 'Capitalize each word'],
              ] as const).map(([mode, label, title]) => (
                <button
                  key={mode}
                  type="button"
                  title={title}
                  aria-pressed={activeCase === mode}
                  onClick={() => updateText({ text: applyTextCase(ts.text, mode) })}
                  className={`h-7 px-3 text-xs font-semibold transition-colors ${
                    activeCase === mode ? 'bg-zinc-600 text-white' : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>

          <Row label="Color">
            <ColorSwatch value={ts.color} title="Text color" onChange={hex => updateText({ color: hex })} />
          </Row>

          <div className="flex items-center gap-3">
            <div className="flex flex-1 items-center gap-2">
              <span className="w-[76px] flex-shrink-0 text-xs text-zinc-300">Character</span>
              <PropertyNumberInput
                value={ts.letterSpacing}
                min={-20}
                max={100}
                step={1}
                onChange={v => updateText({ letterSpacing: v })}
                className="w-[58px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-300">Line</span>
              <PropertyNumberInput
                value={lineValue}
                min={-10}
                max={40}
                step={1}
                onChange={v => updateText({ lineHeight: Math.round((BASE_LINE_HEIGHT + v / 10) * 100) / 100 })}
                className="w-[58px]"
              />
            </div>
          </div>

          <Row label="Alignment">
            <div className="flex overflow-hidden rounded bg-[#232327]">
              {([
                ['left', AlignLeft, 'Align left'],
                ['center', AlignCenter, 'Align center'],
                ['right', AlignRight, 'Align right'],
              ] as const).map(([align, Icon, title]) => (
                <button
                  key={align}
                  type="button"
                  title={title}
                  aria-pressed={ts.textAlign === align}
                  onClick={() => updateText({ textAlign: align })}
                  className={`flex h-7 w-9 items-center justify-center transition-colors ${
                    ts.textAlign === align ? 'bg-zinc-600 text-white' : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          </Row>

          <div className="space-y-2 border-t border-zinc-800 pt-3">
            <SectionTitle>Preset style</SectionTitle>
            <div className="grid grid-cols-6 gap-1.5">
              {TEXT_STYLE_PRESETS.map(preset => {
                const active = isTextLook(ts, preset.look)
                return (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.id === PLAIN_TEXT_LOOK_ID ? 'None' : preset.id}
                    data-text-look={preset.id}
                    onClick={() => updateText({ ...preset.look })}
                    className={`flex aspect-square items-center justify-center rounded-md bg-[#2a2a2e] transition-colors hover:bg-zinc-700 ${
                      active ? 'ring-2 ring-cyan-400' : ''
                    }`}
                  >
                    {preset.id === PLAIN_TEXT_LOOK_ID ? (
                      <Ban className="h-5 w-5 text-zinc-400" />
                    ) : (
                      <span className="text-[15px] font-black leading-none" style={textLookCss(preset.look)}>
                        Aa
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2.5 border-t border-zinc-800 pt-3">
            <SectionTitle>Transform</SectionTitle>
            <Row label="Position">
              <PropertyNumberInput prefix="X" value={ts.positionX} min={0} max={100} step={1} suffix="%" onChange={v => updateText({ positionX: v })} className="flex-1" />
              <PropertyNumberInput prefix="Y" value={ts.positionY} min={0} max={100} step={1} suffix="%" onChange={v => updateText({ positionY: v })} className="flex-1" />
            </Row>
            <Row label="Opacity">
              <Slider value={ts.opacity} min={0} max={100} suffix="%" onChange={v => updateText({ opacity: Math.round(v) })} />
            </Row>
          </div>
        </div>
      )}

      {subTab === 'bubble' && (
        <div className="space-y-3.5">
          <SectionTitle
            right={
              <PropertyToggle
                checked={hasBox}
                onChange={on => updateText(on
                  ? { backgroundColor: withAlpha(box.hex, 0.8), padding: ts.padding || 16, borderRadius: ts.borderRadius || 8 }
                  : { backgroundColor: 'transparent' })}
              />
            }
          >
            Background
          </SectionTitle>
          <div className={hasBox ? 'space-y-3.5' : 'pointer-events-none space-y-3.5 opacity-40'}>
            <Row label="Color">
              <ColorSwatch value={ts.backgroundColor} title="Background color" onChange={hex => updateText({ backgroundColor: withAlpha(hex, hasBox ? box.alpha : 0.8) })} />
            </Row>
            <Row label="Opacity">
              <Slider value={Math.round(box.alpha * 100)} min={0} max={100} suffix="%" onChange={v => updateText({ backgroundColor: withAlpha(box.hex, v / 100) })} />
            </Row>
            <Row label="Padding">
              <Slider value={ts.padding} min={0} max={80} onChange={v => updateText({ padding: Math.round(v) })} />
            </Row>
            <Row label="Corners">
              <Slider value={ts.borderRadius} min={0} max={60} onChange={v => updateText({ borderRadius: Math.round(v) })} />
            </Row>
          </div>
        </div>
      )}

      {subTab === 'effects' && (
        <div className="space-y-3.5">
          <SectionTitle
            right={
              <PropertyToggle
                checked={hasStroke}
                onChange={on => updateText(on
                  ? { strokeColor: ts.strokeColor === 'transparent' ? '#000000' : ts.strokeColor, strokeWidth: ts.strokeWidth || 3 }
                  : { strokeWidth: 0 })}
              />
            }
          >
            Stroke
          </SectionTitle>
          <div className={hasStroke ? 'space-y-3.5' : 'pointer-events-none space-y-3.5 opacity-40'}>
            <Row label="Color">
              <ColorSwatch value={ts.strokeColor} title="Stroke color" onChange={hex => updateText({ strokeColor: hex })} />
            </Row>
            <Row label="Width">
              <Slider value={ts.strokeWidth} min={0} max={20} step={0.5} precision={1} onChange={v => updateText({ strokeWidth: v })} />
            </Row>
          </div>

          <div className="border-t border-zinc-800 pt-3" />
          <SectionTitle
            right={
              <PropertyToggle
                checked={hasShadow}
                onChange={on => updateText(on
                  ? { shadowColor: shadow.alpha > 0 ? ts.shadowColor : 'rgba(0,0,0,0.6)', shadowBlur: 6, shadowOffsetX: 2, shadowOffsetY: 2 }
                  : { shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 })}
              />
            }
          >
            Shadow
          </SectionTitle>
          <div className={hasShadow ? 'space-y-3.5' : 'pointer-events-none space-y-3.5 opacity-40'}>
            <Row label="Color">
              <ColorSwatch value={ts.shadowColor} title="Shadow color" onChange={hex => updateText({ shadowColor: withAlpha(hex, shadow.alpha || 0.6) })} />
            </Row>
            <Row label="Opacity">
              <Slider value={Math.round(shadow.alpha * 100)} min={0} max={100} suffix="%" onChange={v => updateText({ shadowColor: withAlpha(shadow.hex, v / 100) })} />
            </Row>
            <Row label="Blur">
              <Slider value={ts.shadowBlur} min={0} max={40} onChange={v => updateText({ shadowBlur: Math.round(v) })} />
            </Row>
            <Row label="Distance">
              <Slider value={shadowDistance} min={0} max={30} onChange={v => updateText({ shadowOffsetX: Math.round(v), shadowOffsetY: Math.round(v) })} />
            </Row>
          </div>
        </div>
      )}
    </div>
  )
}
