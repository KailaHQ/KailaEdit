import type { SubtitleClip, Track } from '../../../types/project-model'
import { DEFAULT_SUBTITLE_STYLE } from '../../../types/project-model'

export interface MonitorSubtitlesOverlayProps {
  activeSubtitles: SubtitleClip[]
  tracks: Track[]
}

export function MonitorSubtitlesOverlay({ activeSubtitles, tracks }: MonitorSubtitlesOverlayProps) {
  if (activeSubtitles.length === 0) return null

  return (
    <div className="absolute inset-0 z-[25] pointer-events-none flex flex-col justify-end">
      {activeSubtitles.map(sub => {
        const track = tracks[sub.trackIndex]
        const style = { ...DEFAULT_SUBTITLE_STYLE, ...(track?.subtitleStyle || {}), ...sub.style }
        return (
          <div
            key={sub.id}
            className={`w-full flex ${
              style.position === 'top'
                ? 'self-start'
                : style.position === 'center'
                ? 'self-center absolute inset-0 items-center justify-center'
                : 'self-end'
            }`}
            style={style.position !== 'center' ? { padding: style.position === 'top' ? '12px 16px 0' : '0 16px 12px' } : undefined}
          >
            <span
              className="inline-block max-w-[90%] text-center mx-auto rounded px-3 py-1.5 leading-snug whitespace-pre-wrap"
              style={{
                fontSize: `${style.fontSize}px`,
                fontFamily: style.fontFamily,
                fontWeight: style.fontWeight,
                fontStyle: style.italic ? 'italic' : 'normal',
                color: style.color,
                backgroundColor: style.backgroundColor,
                textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
              }}
            >
              {sub.text}
            </span>
          </div>
        )
      })}
    </div>
  )
}
