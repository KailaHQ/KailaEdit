// ── Constants ────────────────────────────────────────────────────────

/** Debounce delay for auto-saving timeline changes to context (ms) */
export const AUTOSAVE_DELAY = 500

/** Tolerance in seconds for detecting adjacent clips (cut points) */
export const CUT_POINT_TOLERANCE = 0.05

/** Default cross-dissolve duration in seconds */
export const DEFAULT_DISSOLVE_DURATION = 0.5

// ── Resizable layout constants ───────────────────────────────────────

export const LAYOUT_STORAGE_KEY = 'komfyedit-video-editor-layout'

export interface EditorLayout {
  leftPanelWidth: number   // px
  rightPanelWidth: number  // px
  timelineHeight: number   // px
  assetsHeight: number     // px – height of assets section in left panel (timelines gets the rest)
}

// The left panel holds the sub-nav column (122px) *and* the library beside it,
// so it needs roughly twice the width the old assets-only panel did.
export const DEFAULT_LAYOUT: EditorLayout = {
  leftPanelWidth: 470,
  rightPanelWidth: 366,
  timelineHeight: 300,
  assetsHeight: 0,        // unused since the timelines list was removed
}

export const LAYOUT_LIMITS = {
  leftPanelWidth:  { min: 300, max: 700 },
  rightPanelWidth: { min: 260, max: 520 },
  timelineHeight:  { min: 120, max: 700 },
  assetsHeight:    { min: 120, max: 800 },
}

export function clampVal(val: number, limits: { min: number; max: number }): number {
  return Math.max(limits.min, Math.min(limits.max, val))
}
