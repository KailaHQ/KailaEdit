import type { ActiveLetterboxState } from './preview-frame-engine'

export interface MonitorLetterboxProps {
  activeLetterbox: ActiveLetterboxState | null
}

export function MonitorLetterbox({ activeLetterbox }: MonitorLetterboxProps) {
  if (!activeLetterbox) return null

  const containerRatio = 16 / 9
  const targetRatio = activeLetterbox.ratio
  if (targetRatio >= containerRatio) {
    const barPct = ((1 - containerRatio / targetRatio) / 2) * 100
    if (barPct <= 0) return null
    return (
      <>
        <div
          className="absolute left-0 right-0 top-0 z-[18] pointer-events-none"
          style={{ height: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
        />
        <div
          className="absolute left-0 right-0 bottom-0 z-[18] pointer-events-none"
          style={{ height: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
        />
      </>
    )
  } else {
    const barPct = ((1 - targetRatio / containerRatio) / 2) * 100
    if (barPct <= 0) return null
    return (
      <>
        <div
          className="absolute top-0 bottom-0 left-0 z-[18] pointer-events-none"
          style={{ width: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
        />
        <div
          className="absolute top-0 bottom-0 right-0 z-[18] pointer-events-none"
          style={{ width: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
        />
      </>
    )
  }
}
