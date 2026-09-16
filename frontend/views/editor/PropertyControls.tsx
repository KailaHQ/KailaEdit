import React, { useState, useRef, useEffect } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

// ── 1. Number Stepper Input ──
export interface PropertyNumberInputProps {
  value: number
  onChange: (val: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  prefix?: string
  precision?: number
  className?: string
}

export const PropertyNumberInput: React.FC<PropertyNumberInputProps> = ({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  suffix = '',
  prefix = '',
  precision = 0,
  className = '',
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const [typedValue, setTypedValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!isEditing) {
      setTypedValue(precision > 0 ? value.toFixed(precision) : String(Math.round(value)))
    }
  }, [value, precision, isEditing])

  const handleCommit = () => {
    setIsEditing(false)
    const parsed = parseFloat(typedValue)
    if (!isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed))
      onChange(precision > 0 ? parseFloat(clamped.toFixed(precision)) : Math.round(clamped))
    }
  }

  const handleStep = (direction: 1 | -1, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const next = Math.max(min, Math.min(max, value + direction * step))
    onChange(precision > 0 ? parseFloat(next.toFixed(precision)) : Math.round(next))
  }

  return (
    <div
      className={`group/num relative flex items-center bg-[#19191c] hover:bg-[#232327] border border-zinc-800 hover:border-zinc-700 rounded h-6 px-1.5 text-[11px] text-zinc-100 transition-colors ${className}`}
    >
      {prefix && (
        <span className="text-[10px] text-zinc-500 mr-1 select-none font-semibold flex-shrink-0">
          {prefix}
        </span>
      )}

      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={typedValue}
          onChange={(e) => setTypedValue(e.target.value)}
          onBlur={handleCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCommit()
            if (e.key === 'Escape') setIsEditing(false)
          }}
          autoFocus
          className="w-full bg-transparent text-[11px] text-white outline-none tabular-nums text-right pr-0.5"
        />
      ) : (
        <span
          onClick={() => setIsEditing(true)}
          className="flex-1 cursor-text tabular-nums select-none truncate text-zinc-200 text-right pr-0.5"
        >
          {precision > 0 ? value.toFixed(precision) : Math.round(value)}{suffix}
        </span>
      )}

      {/* Up / Down stepper buttons */}
      <div className="flex flex-col -mr-0.5 ml-0.5 opacity-40 group-hover/num:opacity-100 transition-opacity flex-shrink-0">
        <button
          type="button"
          onClick={(e) => handleStep(1, e)}
          className="hover:text-cyan-400 text-zinc-400 flex items-center justify-center leading-none"
          title="Increase"
        >
          <ChevronUp className="w-2 h-2" />
        </button>
        <button
          type="button"
          onClick={(e) => handleStep(-1, e)}
          className="hover:text-cyan-400 text-zinc-400 flex items-center justify-center leading-none -mt-0.5"
          title="Decrease"
        >
          <ChevronDown className="w-2 h-2" />
        </button>
      </div>
    </div>
  )
}

// ── 2. Toggle Switch ──
export interface PropertyToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
}

export const PropertyToggle: React.FC<PropertyToggleProps> = ({ checked, onChange, label }) => {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      {label && <span className="text-xs text-zinc-400">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-in-out focus:outline-none ${
          checked ? 'bg-cyan-400' : 'bg-zinc-700'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow transition duration-150 ease-in-out ${
            checked ? 'translate-x-3' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  )
}

// ── 3. Alignment Toolbar ──
export interface PropertyAlignmentBarProps {
  onAlignLeft: () => void
  onAlignCenterH: () => void
  onAlignRight: () => void
  onAlignTop: () => void
  onAlignCenterV: () => void
  onAlignBottom: () => void
}

export const PropertyAlignmentBar: React.FC<PropertyAlignmentBarProps> = ({
  onAlignLeft,
  onAlignCenterH,
  onAlignRight,
  onAlignTop,
  onAlignCenterV,
  onAlignBottom,
}) => {
  return (
    <div className="flex items-center justify-between bg-[#19191c] border border-zinc-800/90 rounded px-1 h-7">
      <div className="flex items-center gap-0.5 flex-1 justify-around">
        {/* Align Left */}
        <button
          type="button"
          onClick={onAlignLeft}
          title="Align Left"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <rect x="1" y="2" width="2" height="12" rx="0.5" />
            <rect x="5" y="4" width="9" height="8" rx="1" fillOpacity="0.75" />
          </svg>
        </button>

        {/* Align Center H */}
        <button
          type="button"
          onClick={onAlignCenterH}
          title="Align Center Horizontal"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <rect x="7" y="2" width="2" height="12" rx="0.5" />
            <rect x="3" y="4" width="10" height="8" rx="1" fillOpacity="0.75" />
          </svg>
        </button>

        {/* Align Right */}
        <button
          type="button"
          onClick={onAlignRight}
          title="Align Right"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <rect x="13" y="2" width="2" height="12" rx="0.5" />
            <rect x="2" y="4" width="9" height="8" rx="1" fillOpacity="0.75" />
          </svg>
        </button>
      </div>

      <div className="w-px h-3.5 bg-zinc-800 mx-1" />

      <div className="flex items-center gap-0.5 flex-1 justify-around">
        {/* Align Top */}
        <button
          type="button"
          onClick={onAlignTop}
          title="Align Top"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <rect x="2" y="1" width="12" height="2" rx="0.5" />
            <rect x="4" y="5" width="8" height="9" rx="1" fillOpacity="0.75" />
          </svg>
        </button>

        {/* Align Center V */}
        <button
          type="button"
          onClick={onAlignCenterV}
          title="Align Center Vertical"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <rect x="2" y="7" width="12" height="2" rx="0.5" />
            <rect x="4" y="3" width="8" height="10" rx="1" fillOpacity="0.75" />
          </svg>
        </button>

        {/* Align Bottom */}
        <button
          type="button"
          onClick={onAlignBottom}
          title="Align Bottom"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <rect x="2" y="13" width="12" height="2" rx="0.5" />
            <rect x="4" y="2" width="8" height="9" rx="1" fillOpacity="0.75" />
          </svg>
        </button>
      </div>

      <div className="w-px h-3.5 bg-zinc-800 mx-1" />

      {/* Distribution Icons */}
      <div className="flex items-center gap-0.5 opacity-40">
        <span className="w-5 h-5 flex items-center justify-center text-zinc-500 cursor-default">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <rect x="2" y="3" width="2" height="10" rx="0.5" />
            <rect x="7" y="3" width="2" height="10" rx="0.5" />
            <rect x="12" y="3" width="2" height="10" rx="0.5" />
          </svg>
        </span>
        <span className="w-5 h-5 flex items-center justify-center text-zinc-500 cursor-default">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <rect x="3" y="2" width="10" height="2" rx="0.5" />
            <rect x="3" y="7" width="10" height="2" rx="0.5" />
            <rect x="3" y="12" width="10" height="2" rx="0.5" />
          </svg>
        </span>
      </div>
    </div>
  )
}

// ── 4. Rotation Dial Icon ──
export interface PropertyRotateDialProps {
  rotation: number
  onReset: () => void
}

export const PropertyRotateDial: React.FC<PropertyRotateDialProps> = ({ rotation, onReset }) => {
  return (
    <button
      type="button"
      onClick={onReset}
      title={`Rotate Dial (${Math.round(rotation)}°) - Click to reset`}
      className="relative flex items-center justify-center w-5 h-5 rounded-full bg-[#161619] hover:bg-zinc-800 border border-zinc-700/80 text-zinc-400 hover:text-cyan-400 transition-colors flex-shrink-0"
    >
      <div
        style={{ transform: `rotate(${rotation}deg)` }}
        className="w-2.5 h-[1.5px] bg-cyan-400 rounded-full transition-transform duration-75"
      />
    </button>
  )
}
