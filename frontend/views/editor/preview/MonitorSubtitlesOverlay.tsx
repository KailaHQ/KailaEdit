import type { SubtitleClip, Track } from '../../../types/project-model'
import { DEFAULT_SUBTITLE_STYLE } from '../../../types/project-model'

export interface MonitorSubtitlesOverlayProps {
  activeSubtitles: SubtitleClip[]
  tracks: Track[]
}

/**
 * A length in the export's terms — pixels of a 1080-high frame — as a share of the frame the
 * monitor is drawing into. The export scales a subtitle's font size by height / 1080, so the
 * monitor must too: with raw pixels a subtitle looked two to three times bigger on screen than
 * in the file it produced.
 */
const ref = (px: number) => `${(px * 100) / 1080}cqh`

export function MonitorSubtitlesOverlay({ activeSubtitles, tracks }: MonitorSubtitlesOverlayProps) {
  if (activeSubtitles.length === 0) return null

  return (
    <div className="absolute inset-0 z-[25] pointer-events-none flex flex-col justify-end" style={{ containerType: 'size' }}>
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
            style={style.position !== 'center'
              // The export puts the text 20px from the top or 30px from the bottom, with its
              // 8px box border outside that.
              ? { padding: style.position === 'top' ? `${ref(12)} ${ref(16)} 0` : `0 ${ref(16)} ${ref(22)}` }
              : undefined}
          >
            <span
              className="inline-block max-w-[90%] text-center mx-auto leading-snug whitespace-pre-wrap"
              style={{
                fontSize: ref(style.fontSize),
                padding: style.backgroundColor && style.backgroundColor !== 'transparent' ? ref(8) : 0,
                borderRadius: ref(4),
                fontFamily: style.fontFamily,
                fontWeight: style.fontWeight,
                fontStyle: style.italic ? 'italic' : 'normal',
                color: style.color,
                backgroundColor: style.backgroundColor,
                textShadow: `${ref(1)} ${ref(1)} ${ref(3)} rgba(0,0,0,0.8)`,
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
