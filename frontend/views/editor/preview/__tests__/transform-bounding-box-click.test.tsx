// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_CLIP_TRANSFORM, timelineClipSchema } from '../../../../types/project-model'
import { TransformBoundingBox } from '../TransformBoundingBox'

const clip = timelineClipSchema.parse({
  id: 'shape-1', assetId: null, type: 'image', startTime: 0, duration: 5, trimStart: 0, trimEnd: 0,
  trackIndex: 1, asset: { id: 'a', type: 'image', path: 'x.png', width: 512, height: 512, createdAt: 0 },
  stickerId: 'shape-rounded-rect', transform: { ...DEFAULT_CLIP_TRANSFORM, scale: 30 },
})

let root: Root
let host: HTMLDivElement
const onUpdateTransform = vi.fn()
const onPreviewTransform = vi.fn()
const onInteractionStart = vi.fn()
const onInteractionEnd = vi.fn()

beforeEach(async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <TransformBoundingBox
        selectedClip={clip}
        assets={[]}
        videoFrameSize={{ width: 400, height: 400 }}
        currentTime={1}
        cropMode={false}
        onToggleCropMode={() => {}}
        onUpdateTransform={onUpdateTransform}
        onPreviewTransform={onPreviewTransform}
        onInteractionStart={onInteractionStart}
        onInteractionEnd={onInteractionEnd}
      />,
    )
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const outline = () => host.querySelector('.border-sky-400') as HTMLElement
const pointer = (type: string, x: number, y: number) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 })

it('reports a press that never moved as a click, and commits nothing', async () => {
  await act(async () => {
    outline().dispatchEvent(pointer('pointerdown', 200, 200))
    window.dispatchEvent(pointer('pointerup', 200, 200))
  })
  expect(onInteractionStart).toHaveBeenCalledTimes(1)
  expect(onInteractionEnd).toHaveBeenCalledWith(false)
  expect(onUpdateTransform).not.toHaveBeenCalled()
  expect(onPreviewTransform).toHaveBeenLastCalledWith(null)
})

it('reports a drag as moved, previews every step, and commits once', async () => {
  await act(async () => {
    outline().dispatchEvent(pointer('pointerdown', 200, 200))
    for (let i = 1; i <= 5; i++) window.dispatchEvent(pointer('pointermove', 200 + i * 8, 200))
    window.dispatchEvent(pointer('pointerup', 240, 200))
  })
  expect(onInteractionEnd).toHaveBeenCalledWith(true)
  // Five live previews, then the clear on release.
  expect(onPreviewTransform).toHaveBeenCalledTimes(6)
  expect(onPreviewTransform.mock.calls[4][0].positionX).toBe(10)
  expect(onPreviewTransform).toHaveBeenLastCalledWith(null)
  expect(onUpdateTransform).toHaveBeenCalledTimes(1)
  expect(onUpdateTransform.mock.calls[0][0].positionX).toBe(10)
})
