import { MoveUp, MoveRight, Eye, Zap, Keyboard, Type, Sparkles } from 'lucide-react'
import { TEXT_PRESETS, TEXT_ANIMATIONS } from '@core/text-presets'
import { useTranslation } from '../../i18n/I18nContext'
import { selectClips, selectSelectedClipIds } from './editor-selectors'
import { useEditorActions, useEditorStore } from './editor-store'

export function TextLibrary({ section }: { section: string }) {
  const { t } = useTranslation()
  const actions = useEditorActions()
  const clips = useEditorStore(selectClips)
  const selectedClipIds = useEditorStore(selectSelectedClipIds)

  const selectedTextClip = clips.find(
    c => selectedClipIds.has(c.id) && c.type === 'text',
  )

  const showTemplates = section === 'text-templates' || section === 'add-text' || !section
  const showEffects = section === 'text-effects' || section === 'add-text' || !section

  const handleApplyPreset = (presetId: string, style?: any) => {
    if (selectedTextClip) {
      actions.applyTextPresetToClip(selectedTextClip.id, presetId)
    } else {
      actions.addTextClip({ preset: presetId, style })
    }
  }

  const handleApplyAnimation = (animId: string) => {
    if (selectedTextClip) {
      actions.applyTextAnimationToClip(selectedTextClip.id, animId)
    } else {
      actions.addTextClip({ animation: animId })
    }
  }

  const animIcons: Record<string, React.ReactNode> = {
    'fly-in': <MoveUp className="h-4 w-4 text-cyan-400" />,
    'slide-in': <MoveRight className="h-4 w-4 text-emerald-400" />,
    'fade-in': <Eye className="h-4 w-4 text-violet-400" />,
    'pop': <Zap className="h-4 w-4 text-amber-400" />,
    'typewriter': <Keyboard className="h-4 w-4 text-pink-400" />,
  }

  return (
    <div className="space-y-4">
      {selectedTextClip && (
        <div className="rounded-[6px] bg-cyan-950/40 border border-cyan-800/40 px-3 py-2 text-[11px] text-cyan-300">
          {t('library.text.selectedNotice')}
        </div>
      )}

      {/* Basic Text Button */}
      {section !== 'text-effects' && (
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{t('library.text.basicTitle')}</h4>
          <button
            onClick={() => actions.addTextClip({})}
            className="flex h-[68px] w-full items-center gap-3 rounded-[6px] bg-zinc-900 px-4 text-zinc-200 transition-colors hover:bg-zinc-800 border border-white/5 hover:border-white/10"
            title={t('library.text.addDefaultTitle')}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded bg-zinc-800 text-zinc-200">
              <Type className="h-5 w-5" />
            </div>
            <div className="text-left">
              <div className="text-[12px] font-medium text-zinc-200">{t('library.text.defaultText')}</div>
              <div className="text-[10px] text-zinc-500">{t('library.text.defaultTextDesc')}</div>
            </div>
          </button>
        </div>
      )}

      {/* Presets Grid */}
      {showTemplates && (
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            {t('library.text.stylePresets', { count: TEXT_PRESETS.length })}
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {TEXT_PRESETS.map((preset) => {
              const st = preset.style
              return (
                <button
                  key={preset.id}
                  onClick={() => handleApplyPreset(preset.id, st)}
                  className="group flex flex-col overflow-hidden rounded-[6px] border border-white/5 bg-zinc-900 transition-all hover:border-accent/50 hover:bg-zinc-850 text-left"
                  title={`${preset.name}: ${preset.description}`}
                >
                  <div
                    className="flex h-[56px] w-full items-center justify-center overflow-hidden p-2"
                    style={{
                      backgroundColor: st.backgroundColor && st.backgroundColor !== 'transparent' && !st.backgroundColor.startsWith('rgba(0,0,0') ? '#18181b' : '#121214',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: st.fontFamily || 'sans-serif',
                        fontWeight: st.fontWeight || 'bold',
                        fontStyle: st.fontStyle || 'normal',
                        color: st.color || '#FFFFFF',
                        backgroundColor: st.backgroundColor || 'transparent',
                        padding: st.padding ? `${Math.min(st.padding, 6)}px` : undefined,
                        borderRadius: st.borderRadius ? `${Math.min(st.borderRadius, 4)}px` : undefined,
                        letterSpacing: st.letterSpacing ? `${st.letterSpacing}px` : undefined,
                        textShadow: st.shadowBlur ? `${st.shadowOffsetX || 0}px ${st.shadowOffsetY || 0}px ${st.shadowBlur}px ${st.shadowColor || 'black'}` : undefined,
                        WebkitTextStroke: st.strokeWidth && st.strokeColor ? `${st.strokeWidth}px ${st.strokeColor}` : undefined,
                        fontSize: '15px',
                        lineHeight: 1,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Aa Text
                    </span>
                  </div>
                  <div className="px-2 py-1.5 border-t border-white/5">
                    <div className="truncate text-[11px] font-medium text-zinc-300 group-hover:text-zinc-100">
                      {preset.name}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Animations Grid */}
      {showEffects && (
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            {t('library.text.animations')}
          </h4>
          <div className="grid grid-cols-1 gap-2">
            {TEXT_ANIMATIONS.map((anim) => (
              <button
                key={anim.id}
                onClick={() => handleApplyAnimation(anim.id)}
                className="group flex items-center justify-between rounded-[6px] border border-white/5 bg-zinc-900 p-2.5 transition-all hover:border-accent/50 hover:bg-zinc-850 text-left"
                title={anim.description}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded bg-zinc-800">
                    {animIcons[anim.id] || <Sparkles className="h-4 w-4 text-cyan-400" />}
                  </div>
                  <div>
                    <div className="text-[12px] font-medium text-zinc-200 group-hover:text-zinc-100">
                      {anim.name}
                    </div>
                    <div className="text-[10px] text-zinc-500 leading-tight">
                      {anim.description}
                    </div>
                  </div>
                </div>
                <span className="text-[9px] font-mono text-zinc-500 rounded bg-zinc-800 px-1.5 py-0.5">
                  KF
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
