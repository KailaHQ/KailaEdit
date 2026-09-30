// ── Tool types & definitions ────────────────────────────────────────

export type ToolType = 'select' | 'trackForward' | 'blade' | 'slip' | 'slide' | 'ripple' | 'roll'

export type ToolDef = { id: ToolType; label: string; actionId: string }

// ── Color Labels (Premiere-style) ────────────────────────────────────

export interface ColorLabelDef {
  id: string
  label: string
  color: string      // Tailwind-friendly hex for rendering
  bg: string         // Background class for timeline clips
  border: string     // Border class for timeline clips
  dot: string        // Dot color class for menus
}

export const COLOR_LABELS: ColorLabelDef[] = [
  { id: 'violet',    label: 'Violet',    color: '#8b5cf6', bg: 'bg-violet-700/50',  border: 'border-violet-500', dot: 'bg-violet-500' },
  { id: 'blue',      label: 'Blue',      color: '#3b82f6', bg: 'bg-blue-700/50',      border: 'border-blue-500',   dot: 'bg-blue-500' },
  { id: 'cyan',      label: 'Cyan',      color: '#06b6d4', bg: 'bg-cyan-700/50',      border: 'border-cyan-500',   dot: 'bg-cyan-500' },
  { id: 'teal',      label: 'Teal',      color: '#14b8a6', bg: 'bg-teal-700/50',      border: 'border-teal-500',   dot: 'bg-teal-500' },
  { id: 'green',     label: 'Green',     color: '#22c55e', bg: 'bg-green-700/50',     border: 'border-green-500',  dot: 'bg-green-500' },
  { id: 'yellow',    label: 'Yellow',    color: '#eab308', bg: 'bg-yellow-700/50',    border: 'border-yellow-500', dot: 'bg-yellow-500' },
  { id: 'orange',    label: 'Orange',    color: '#f97316', bg: 'bg-orange-700/50',    border: 'border-orange-500', dot: 'bg-orange-500' },
  { id: 'red',       label: 'Red',       color: '#ef4444', bg: 'bg-red-700/50',       border: 'border-red-500',    dot: 'bg-red-500' },
  { id: 'rose',      label: 'Rose',      color: '#f43f5e', bg: 'bg-rose-700/50',      border: 'border-rose-500',   dot: 'bg-rose-500' },
  { id: 'pink',      label: 'Pink',      color: '#ec4899', bg: 'bg-pink-700/50',      border: 'border-pink-500',   dot: 'bg-pink-500' },
]

export function getColorLabel(id: string | undefined): ColorLabelDef | undefined {
  if (!id) return undefined
  return COLOR_LABELS.find(c => c.id === id)
}
