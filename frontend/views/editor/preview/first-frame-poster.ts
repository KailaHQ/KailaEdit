import type { TimelineClip } from '../../../types/project-model'
import { getClipTargetTime } from './preview-frame-engine'
import { getFirstFrameSource, type FirstFrameSource } from './webcodecs/FirstFrameSource'
import { getPreparedFrame } from './first-frame-prefetch'

export interface PosterRequest {
  path: string
  clip: TimelineClip
  /** Timeline time of the playhead. */
  atTime: number
}

/** The canvas is never drawn larger than this on its longest side. */
const MAX_POSTER_SIDE = 1920

/**
 * The picture a monitor shows while its <video> is still getting ready.
 *
 * A <video> needs its file loaded, its position found and a seek finished before it can show
 * the frame the playhead is on; at the moment a project opens that queues behind the editor's
 * own first render and the monitor sits black for over a second. The poster decodes just that
 * one frame straight from the file (see FirstFrameSource) and draws it where the video will
 * appear, inside the same container, so it takes on the same transform and effects.
 *
 * It is hidden the moment the video can show the same frame itself.
 */
export class FirstFramePoster {
  private canvas: HTMLCanvasElement | null = null
  private key = ''
  private generation = 0

  constructor(private readonly sourceFor: (path: string) => FirstFrameSource = getFirstFrameSource) {}

  /** Shows the frame for a request, in `container`. Asking again for the same frame does nothing. */
  show(container: HTMLElement, request: PosterRequest): void {
    const key = `${request.path}|${request.clip.id}|${request.atTime}`
    if (key === this.key) return
    this.key = key
    const generation = ++this.generation
    this.render(container, request, generation).catch(() => {
      // No poster is not a failure: the video shows the frame once it is ready.
    })
  }

  hide(): void {
    if (!this.key && (!this.canvas || this.canvas.style.display === 'none')) return
    this.generation++
    this.key = ''
    if (this.canvas) this.canvas.style.display = 'none'
  }

  destroy(): void {
    this.hide()
    this.canvas?.remove()
    this.canvas = null
  }

  private async render(container: HTMLElement, request: PosterRequest, generation: number): Promise<void> {
    // Already decoding (or decoded) since the project was opened, if it was the one predicted.
    let frame = await getPreparedFrame(request.path, request.clip.id, request.atTime) ?? null
    if (!frame) {
      const source = this.sourceFor(request.path)
      const index = await source.open()
      if (generation !== this.generation) return
      const target = getClipTargetTime(request.clip, index.duration, request.atTime)
      frame = await source.frameAt(target)
    }
    if (!frame) return
    try {
      // Hidden, or asked for another frame, while this one was being decoded.
      if (generation !== this.generation) return
      this.paint(container, frame)
    } finally {
      frame.close()
    }
  }

  private paint(container: HTMLElement, frame: VideoFrame): void {
    if (!this.canvas) {
      const canvas = document.createElement('canvas')
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;z-index:2;display:none;'
      this.canvas = canvas
    }
    const canvas = this.canvas
    if (canvas.parentElement !== container) container.appendChild(canvas)

    const scale = Math.min(1, MAX_POSTER_SIDE / Math.max(frame.displayWidth, frame.displayHeight))
    canvas.width = Math.max(1, Math.round(frame.displayWidth * scale))
    canvas.height = Math.max(1, Math.round(frame.displayHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height)
    canvas.style.display = ''
  }
}
