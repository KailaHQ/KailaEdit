import { describe, it, expect } from 'vitest'
import {
  createDefaultTimeline,
  timelineSchema,
  timelineCoverSchema,
  type TimelineCover,
} from '../src/project-model'
import { createInitialEditorState } from '../src/editor-state'
import { setTimelineCover } from '../src/editor-actions'
import { selectTimelineCover } from '../src/editor-selectors'
import { validateEditPatch, describePatch, applyEditPatchToState } from '../src/edit-patch'

function makeTestState() {
  const timeline = createDefaultTimeline('Timeline 1')
  return createInitialEditorState({
    assets: [],
    bins: {},
    timelines: [timeline],
    activeTimelineId: timeline.id,
  })
}

describe('Timeline Cover Feature', () => {
  it('parses valid timelineCoverSchema correctly', () => {
    const coverData: TimelineCover = {
      type: 'video_frame',
      time: 12.5,
      templateId: 'bookish-weekend',
      texts: [
        {
          id: 'txt-1',
          text: 'MY COVER TITLE',
          fontSize: 32,
          color: '#ffffff',
          x: 50,
          y: 30,
        },
      ],
      thumbnailDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    }

    const parsed = timelineCoverSchema.parse(coverData)
    expect(parsed.type).toBe('video_frame')
    expect(parsed.time).toBe(12.5)
    expect(parsed.templateId).toBe('bookish-weekend')
    expect(parsed.texts).toHaveLength(1)
    expect(parsed.texts[0].text).toBe('MY COVER TITLE')
  })

  it('allows timelineSchema with optional cover field', () => {
    const timeline = createDefaultTimeline('Test Timeline')
    const withCover = {
      ...timeline,
      cover: {
        type: 'custom_image' as const,
        time: 0,
        customImagePath: '/path/to/my-cover.jpg',
        texts: [],
      },
    }

    const validated = timelineSchema.parse(withCover)
    expect(validated.cover?.type).toBe('custom_image')
    expect(validated.cover?.customImagePath).toBe('/path/to/my-cover.jpg')
  })

  it('setTimelineCover action sets and selectTimelineCover retrieves cover from active timeline', () => {
    const state = makeTestState()
    const cover: TimelineCover = {
      type: 'video_frame',
      time: 4.2,
      templateId: 'studio-days',
      texts: [{ id: 't1', text: 'HELLO WORLD', x: 50, y: 50 }],
    }

    const nextState = setTimelineCover(state, cover)
    const result = selectTimelineCover(nextState)

    expect(result).toBeDefined()
    expect(result?.templateId).toBe('studio-days')
    expect(result?.time).toBe(4.2)
    expect(result?.texts[0].text).toBe('HELLO WORLD')
  })

  it('supports set_cover operation via edit-patch', () => {
    const state = makeTestState()
    const cover: TimelineCover = {
      type: 'video_frame',
      time: 8.0,
      templateId: 'another-vlog',
      texts: [],
    }

    const patch = {
      version: 1 as const,
      operations: [
        {
          op: 'set_cover' as const,
          cover,
        },
      ],
    }

    const validation = validateEditPatch(state, patch)
    expect(validation.valid).toBe(true)

    const description = describePatch(state, patch)
    expect(description).toContain('set timeline cover [video_frame]')

    const appliedState = applyEditPatchToState(state, patch)
    const activeCover = selectTimelineCover(appliedState)
    expect(activeCover?.time).toBe(8.0)
    expect(activeCover?.templateId).toBe('another-vlog')
  })
})
