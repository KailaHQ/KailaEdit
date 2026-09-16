import React, { useRef, useState, useCallback } from 'react'
import {
  clampClipSpeed,
  piecewisePositionForSpeed,
  speedForPiecewisePosition,
  PIECEWISE_LANDMARK_POSITIONS,
  PIECEWISE_SPEED_LANDMARKS,
  MIN_CLIP_SPEED,
  MAX_CLIP_SPEED,
} from '@core/clip-speed'
import { ChevronUp, ChevronDown } from 'lucide-react'

export interface SpeedSliderProps {
  speed: number
  onChange: (speed: number) => void
  disabled?: boolean
}

export const SpeedSlider: React.FC<SpeedSliderProps> = ({
  speed,
  onChange,
  disabled = false,
}) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [typedValue, setTypedValue] = useState('')

  const currentPos = piecewisePositionForSpeed(speed)
  const percent = Math.max(0, Math.min(100, currentPos * 100))

  const handlePointer = useCallback(
    (clientX: number, snap = true) => {
      if (!trackRef.current || disabled) return
      const rect = trackRef.current.getBoundingClientRect()
      if (rect.width <= 0) return
      const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const newSpeed = speedForPiecewisePosition(pos, snap)
      onChange(newSpeed)
    },
    [disabled, onChange]
  )

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    handlePointer(e.clientX, true)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || disabled) return
    handlePointer(e.clientX, true)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    setIsDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Ignore if pointer capture already released
    }
  }

  const stepSpeed = (direction: 1 | -1) => {
    if (disabled) return
    // Smart stepping based on current speed tier
    let step = 0.1
    if (speed >= 10) step = 1.0
    else if (speed >= 2) step = 0.5
    else if (speed < 1) step = 0.1

    const nextSpeed = clampClipSpeed(Math.round((speed + direction * step) * 100) / 100)
    onChange(nextSpeed)
  }

  const commitTypedValue = () => {
    setIsEditing(false)
    const parsed = parseFloat(typedValue.replace(/[^0-9.]/g, ''))
    if (Number.isFinite(parsed)) {
      onChange(clampClipSpeed(parsed))
    }
  }

  const formattedDisplay = `${speed.toFixed(2)}x`

  return (
    <div className="flex items-center gap-3 w-full select-none py-1">
      {/* Slider Track Area */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative flex-1 h-6 flex items-center cursor-pointer ${
          disabled ? 'opacity-40 cursor-not-allowed' : ''
        }`}
        title="Drag or click to adjust speed (snaps to landmarks)"
      >
        {/* Track Line (2px) */}
        <div className="w-full h-[2px] bg-zinc-600 relative">
          {/* Active / Highlighted Portion (White) */}
          <div
            className="absolute left-0 top-0 bottom-0 bg-white transition-none"
            style={{ width: `${percent}%` }}
          />

          {/* 6 Vertical Landmark Tick Marks */}
          {PIECEWISE_LANDMARK_POSITIONS.map((pos, idx) => {
            const tickPercent = pos * 100
            const isPassed = percent >= tickPercent - 0.5
            const landmarkSpeed = PIECEWISE_SPEED_LANDMARKS[idx]
            return (
              <div
                key={pos}
                className={`absolute top-1/2 -translate-y-1/2 w-[2px] h-[8px] transition-colors pointer-events-none ${
                  isPassed ? 'bg-white' : 'bg-zinc-500'
                }`}
                style={{ left: `${tickPercent}%` }}
                title={`${landmarkSpeed}x`}
              />
            )
          })}

          {/* Capsule / Pill Thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-[9px] h-[16px] rounded-full bg-white shadow-md cursor-grab active:cursor-grabbing transition-none"
            style={{ left: `calc(${percent}% - 4.5px)` }}
          />
        </div>
      </div>

      {/* Value Stepper Box */}
      <div className="flex items-center bg-[#1f1f23] hover:bg-zinc-800 border border-zinc-700/80 rounded px-1.5 py-0.5 min-w-[76px] justify-between transition-colors">
        {isEditing ? (
          <input
            type="text"
            autoFocus
            value={typedValue}
            onChange={(e) => setTypedValue(e.target.value)}
            onBlur={commitTypedValue}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTypedValue()
              if (e.key === 'Escape') setIsEditing(false)
            }}
            className="w-11 bg-transparent text-sky-400 text-xs font-mono font-medium outline-none text-left"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              if (disabled) return
              setTypedValue(speed.toFixed(2))
              setIsEditing(true)
            }}
            className="text-sky-400 hover:text-sky-300 text-xs font-mono font-medium tracking-tight text-left cursor-text select-text"
            title="Click to type exact speed"
          >
            {formattedDisplay}
          </button>
        )}

        {/* Vertical Stepper Chevrons */}
        <div className="flex flex-col ml-1 pl-1 border-l border-zinc-700/60 -space-y-0.5">
          <button
            type="button"
            disabled={disabled || speed >= MAX_CLIP_SPEED}
            onClick={() => stepSpeed(1)}
            className="text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 p-0.5 transition-colors"
            title="Increase speed"
          >
            <ChevronUp className="h-2.5 w-2.5 stroke-[2.5]" />
          </button>
          <button
            type="button"
            disabled={disabled || speed <= MIN_CLIP_SPEED}
            onClick={() => stepSpeed(-1)}
            className="text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 p-0.5 transition-colors"
            title="Decrease speed"
          >
            <ChevronDown className="h-2.5 w-2.5 stroke-[2.5]" />
          </button>
        </div>
      </div>
    </div>
  )
}
