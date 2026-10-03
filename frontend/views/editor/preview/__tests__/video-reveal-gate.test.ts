// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { isAwaitingPosition, markAwaitingPosition, noteHadPicture, openGateWhenPositioned } from '../video-reveal-gate'

function fakeVideo(state: { readyState: number; seeking: boolean }) {
  const video = document.createElement('video')
  Object.defineProperty(video, 'readyState', { get: () => state.readyState, configurable: true })
  Object.defineProperty(video, 'seeking', { get: () => state.seeking, configurable: true })
  return video
}

describe('video reveal gate', () => {
  it('lets an element that was never gated straight through', () => {
    const video = fakeVideo({ readyState: 4, seeking: false })
    const reveal = vi.fn()
    expect(isAwaitingPosition(video)).toBe(false)
    expect(openGateWhenPositioned(video, reveal)).toBe(true)
    expect(reveal).not.toHaveBeenCalled()
  })

  it('keeps the first frame of the file hidden while the seek to the playhead is in flight', () => {
    const state = { readyState: 4, seeking: true }
    const video = fakeVideo(state)
    const reveal = vi.fn()
    markAwaitingPosition(video)

    expect(openGateWhenPositioned(video, reveal)).toBe(false)
    expect(isAwaitingPosition(video)).toBe(true)
    expect(reveal).not.toHaveBeenCalled()

    state.seeking = false
    video.dispatchEvent(new Event('seeked'))
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(isAwaitingPosition(video)).toBe(false)
  })

  it('waits through a second seek that starts as the first one ends', () => {
    const state = { readyState: 4, seeking: true }
    const video = fakeVideo(state)
    const reveal = vi.fn()
    markAwaitingPosition(video)
    openGateWhenPositioned(video, reveal)

    // The pool queued a newer target; it starts from the seeked event itself.
    video.dispatchEvent(new Event('seeked'))
    expect(reveal).not.toHaveBeenCalled()

    state.seeking = false
    video.dispatchEvent(new Event('seeked'))
    expect(reveal).toHaveBeenCalledTimes(1)
  })

  it('stays closed while the file has no picture at all', () => {
    const state = { readyState: 0, seeking: false }
    const video = fakeVideo(state)
    markAwaitingPosition(video)
    expect(openGateWhenPositioned(video, vi.fn())).toBe(false)
  })

  it('opens at once when the element is already positioned and nothing is in flight', () => {
    const video = fakeVideo({ readyState: 4, seeking: false })
    markAwaitingPosition(video)
    expect(openGateWhenPositioned(video, vi.fn())).toBe(true)
    expect(isAwaitingPosition(video)).toBe(false)
  })

  it('hooks the seeked event only once however often it is asked', () => {
    const state = { readyState: 4, seeking: true }
    const video = fakeVideo(state)
    const reveal = vi.fn()
    markAwaitingPosition(video)
    openGateWhenPositioned(video, reveal)
    openGateWhenPositioned(video, reveal)
    openGateWhenPositioned(video, reveal)

    state.seeking = false
    video.dispatchEvent(new Event('seeked'))
    expect(reveal).toHaveBeenCalledTimes(1)
  })

  it('never gates an element that has already shown a picture, whatever its readyState does', () => {
    const state = { readyState: 4, seeking: false }
    const video = fakeVideo(state)
    noteHadPicture(video)

    // Playing: every seek and stall drops the element below readyState 2.
    state.readyState = 1
    state.seeking = true
    markAwaitingPosition(video)
    expect(isAwaitingPosition(video)).toBe(false)
    expect(openGateWhenPositioned(video, vi.fn())).toBe(true)
  })

  it('keeps holding an element whose picture arrived while it was still gated', () => {
    const state = { readyState: 0, seeking: false }
    const video = fakeVideo(state)
    markAwaitingPosition(video)

    // The file loads: a picture now exists, but it is frame 0 of the file, not the playhead's.
    state.readyState = 4
    noteHadPicture(video)
    state.seeking = true
    expect(isAwaitingPosition(video)).toBe(true)
    expect(openGateWhenPositioned(video, vi.fn())).toBe(false)
  })

  it('does not count a frame that is not there as a picture', () => {
    const video = fakeVideo({ readyState: 1, seeking: false })
    noteHadPicture(video)
    markAwaitingPosition(video)
    expect(isAwaitingPosition(video)).toBe(true)
  })
})
