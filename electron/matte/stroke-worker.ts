import { parentPort } from 'worker_threads'
import { renderStroke } from '../../core/src/stroke-style'
import type { ClipStroke } from '../../core/src/project-model'

export interface StrokeWorkerTask {
  frameIndex: number
  alpha: ArrayBuffer
  width: number
  height: number
  stroke: ClipStroke
}

export interface StrokeWorkerSuccessResult {
  frameIndex: number
  rgba: ArrayBuffer
}

export interface StrokeWorkerErrorResult {
  frameIndex: number
  error: string
}

export type StrokeWorkerResult = StrokeWorkerSuccessResult | StrokeWorkerErrorResult

if (parentPort) {
  parentPort.on('message', (task: StrokeWorkerTask) => {
    try {
      const { frameIndex, alpha, width, height, stroke } = task
      const alphaArray = new Uint8Array(alpha)
      const rgbaClamped = renderStroke(alphaArray, width, height, stroke)
      const rgbaBuffer = rgbaClamped.buffer as ArrayBuffer

      parentPort!.postMessage(
        {
          frameIndex,
          rgba: rgbaBuffer,
        } satisfies StrokeWorkerSuccessResult,
        [rgbaBuffer],
      )
    } catch (err: any) {
      parentPort!.postMessage({
        frameIndex: task?.frameIndex ?? -1,
        error: err?.message || String(err),
      } satisfies StrokeWorkerErrorResult)
    }
  })
}
