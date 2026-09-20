import {
  createInitialEditorState,
  DEFAULT_CLIP_TRANSITION,
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_CLIP_TRANSFORM,
  type Timeline,
  type TimelineClip,
  type Track,
} from '../src'

export const createMockClip = (overrides: Partial<TimelineClip> = {}): TimelineClip => ({
  id: `clip-${Math.random().toString(36).slice(2, 8)}`,
  assetId: 'asset-1',
  type: 'video',
  startTime: 0,
  duration: 60,
  trimStart: 0,
  trimEnd: 0,
  speed: 1,
  reversed: false,
  muted: false,
  trackIndex: 0,
  volume: 1,
  asset: null,
  flipH: false,
  flipV: false,
  transitionIn: DEFAULT_CLIP_TRANSITION,
  transitionOut: DEFAULT_CLIP_TRANSITION,
  colorCorrection: DEFAULT_COLOR_CORRECTION,
  transform: DEFAULT_CLIP_TRANSFORM,
  opacity: 100,
  ...overrides,
})

export const createMockTimeline = (
  clips: TimelineClip[] = [],
  tracks?: Track[],
): Timeline => ({
  id: 'timeline-1',
  name: 'Main Timeline',
  createdAt: Date.now(),
  tracks: tracks ?? [
    { id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false },
    { id: 'v2', kind: 'video', name: 'V2', locked: false, muted: false },
  ],
  clips,
  subtitles: [],
})

export function makeTestState(clipDuration = 60) {
  const clip = createMockClip({ id: 'clip-1', trackIndex: 0, startTime: 0, duration: clipDuration })
  const timeline = createMockTimeline([clip])
  return createInitialEditorState({
    assets: [],
    bins: {},
    timelines: [timeline],
    activeTimelineId: timeline.id,
  })
}
