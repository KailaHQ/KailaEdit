import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitForMonitorPicture } from '../useWebCodecsPreview'

function fakeVideo(readyState: number) {
  const target = new EventTarget() as EventTarget & { readyState: number }
  target.readyState = readyState
  return target as unknown as HTMLVideoElement
}

describe('waitForMonitorPicture', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('starts at once when the monitor already shows a frame', () => {
    const onReady = vi.fn()
    waitForMonitorPicture(() => fakeVideo(2), onReady)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('waits for the element to appear and decode its first frame', () => {
    const onReady = vi.fn()
    let video: HTMLVideoElement | undefined
    waitForMonitorPicture(() => video, onReady)
    vi.advanceTimersByTime(200)
    video = fakeVideo(0)
    vi.advanceTimersByTime(100)
    expect(onReady).not.toHaveBeenCalled()
    video.dispatchEvent(new Event('loadeddata'))
    vi.advanceTimersByTime(10_000)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('gives up waiting after the timeout', () => {
    const onReady = vi.fn()
    waitForMonitorPicture(() => fakeVideo(0), onReady)
    vi.advanceTimersByTime(4000)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('never starts once cancelled', () => {
    const onReady = vi.fn()
    const video = fakeVideo(0)
    const cancel = waitForMonitorPicture(() => video, onReady)
    cancel()
    video.dispatchEvent(new Event('loadeddata'))
    vi.advanceTimersByTime(10_000)
    expect(onReady).not.toHaveBeenCalled()
  })
})
