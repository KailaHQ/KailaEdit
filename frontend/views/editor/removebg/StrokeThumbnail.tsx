import React from 'react'
import type { StrokeStyle } from '@core/project-model'
import { useTranslation } from '../../../i18n/I18nContext'

export interface StrokeThumbnailProps {
  style: StrokeStyle
  selected: boolean
  color?: string
  onClick: () => void
}

export const StrokeThumbnail: React.FC<StrokeThumbnailProps> = ({
  style,
  selected,
  color = '#FFFFFF',
  onClick,
}) => {
  const { t } = useTranslation()
  const strokeColor = color || '#FFFFFF'
  const filterId = `glow-${style}`

  const renderStrokeSvg = () => {
    // Subject silhouette path: head circle (24, 15, r=6.5) + shoulders
    const headCircle = <circle cx="24" cy="15" r="6.5" />
    const bodyPath = <path d="M 12 37 C 12 28, 17 25, 24 25 C 31 25, 36 28, 36 37 Z" />

    switch (style) {
      case 'none':
        return (
          <g fill="#52525b">
            {headCircle}
            {bodyPath}
          </g>
        )

      case 'solid':
        return (
          <g>
            {/* Solid stroke outline */}
            <g fill="none" stroke={strokeColor} strokeWidth="4" strokeLinejoin="round">
              {headCircle}
              {bodyPath}
            </g>
            {/* Silhouette fill */}
            <g fill="#27272a">
              {headCircle}
              {bodyPath}
            </g>
          </g>
        )

      case 'straight':
        return (
          <g>
            {/* Crisp straight stroke outline */}
            <g fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinejoin="miter">
              {headCircle}
              {bodyPath}
            </g>
            <g fill="#27272a">
              {headCircle}
              {bodyPath}
            </g>
          </g>
        )

      case 'offset':
        return (
          <g>
            {/* Offset shadow / stroke contour shifted by +3, +3 */}
            <g transform="translate(3, 3)" fill="none" stroke={strokeColor} strokeWidth="3" strokeLinejoin="round" opacity={0.9}>
              {headCircle}
              {bodyPath}
            </g>
            <g fill="#27272a">
              {headCircle}
              {bodyPath}
            </g>
          </g>
        )

      case 'dotted':
        return (
          <g>
            {/* Dotted stroke outline */}
            <g fill="none" stroke={strokeColor} strokeWidth="2.5" strokeDasharray="3 3" strokeLinecap="round">
              {headCircle}
              {bodyPath}
            </g>
            <g fill="#27272a">
              {headCircle}
              {bodyPath}
            </g>
          </g>
        )

      case 'hand-drawn':
        return (
          <g>
            {/* Jittery sketch / hand-drawn stroke */}
            <g fill="none" stroke={strokeColor} strokeWidth="2" strokeDasharray="6 2 2 2" strokeLinejoin="round">
              {headCircle}
              {bodyPath}
            </g>
            <g transform="translate(-0.5, -0.5)" fill="none" stroke={strokeColor} strokeWidth="1" opacity={0.6}>
              {headCircle}
              {bodyPath}
            </g>
            <g fill="#27272a">
              {headCircle}
              {bodyPath}
            </g>
          </g>
        )

      case 'paper':
        return (
          <g>
            {/* Paper cut contour with white paper border */}
            <g fill="none" stroke={strokeColor} strokeWidth="4.5" strokeLinejoin="bevel">
              {headCircle}
              {bodyPath}
            </g>
            <g fill="#27272a">
              {headCircle}
              {bodyPath}
            </g>
          </g>
        )

      case 'luminescence':
        return (
          <g>
            <defs>
              <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {/* Outer glow stroke */}
            <g fill="none" stroke={strokeColor} strokeWidth="3" filter={`url(#${filterId})`}>
              {headCircle}
              {bodyPath}
            </g>
            <g fill="#18181b">
              {headCircle}
              {bodyPath}
            </g>
          </g>
        )

      default:
        return null
    }
  }

  const label = t(`clipProperties.removeBg.strokeStyles.${style}`) || style

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex flex-col items-center justify-between p-1.5 rounded-lg border transition-all text-center select-none ${
        selected
          ? 'border-cyan-400 ring-1 ring-cyan-400 bg-cyan-950/20'
          : 'border-zinc-800/80 bg-[#141416] hover:border-zinc-700 hover:bg-[#1a1a1d]'
      }`}
      title={label}
    >
      <div className="w-full aspect-square flex items-center justify-center overflow-hidden">
        <svg viewBox="0 0 48 48" className="w-full h-full max-w-[42px] max-h-[42px]">
          {renderStrokeSvg()}
        </svg>
      </div>
      <span
        className={`w-full text-[10px] leading-tight truncate mt-1 ${
          selected ? 'text-cyan-300 font-semibold' : 'text-zinc-400 group-hover:text-zinc-200'
        }`}
      >
        {label}
      </span>
    </button>
  )
}
