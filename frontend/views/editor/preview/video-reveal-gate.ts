type GatedVideo = HTMLVideoElement & {
  __awaitingPosition?: boolean
  __awaitingPositionHooked?: boolean
  __hadPicture?: boolean
}

/**
 * A freshly created monitor <video> paints the first frame of its FILE the moment it has
 * data, and only then is sent to where the playhead is. For the ~80–120 ms that seek takes
 * the picture is the wrong frame — frame 0 of the file, not the clip's in-point — and when
 * the right one lands the whole image jumps. With handheld footage that read as the picture
 * sliding down a little every time a project opened.
 *
 * So an element with no picture yet is held invisible until it has been positioned. The
 * monitor behind it is black, exactly as it was while the file was still loading.
 */
export function markAwaitingPosition(video: HTMLVideoElement): void {
  const el = video as GatedVideo
  // Only an element that has never had a picture: while playing, a video drops below
  // `readyState` 2 at every seek and every stall, and hiding it each time made the picture
  // flicker. A frame already on screen is better held than hidden.
  if (el.__hadPicture) return
  el.__awaitingPosition = true
}

/** Records that the element has shown a picture, so it is never gated again. */
export function noteHadPicture(video: HTMLVideoElement): void {
  if (video.readyState >= 2) (video as GatedVideo).__hadPicture = true
}

export function isAwaitingPosition(video: HTMLVideoElement): boolean {
  return (video as GatedVideo).__awaitingPosition === true
}

/**
 * Call after the element has been synced to the playhead. Returns true when it may be shown
 * now; otherwise waits for the seek in flight and calls `reveal` when it lands.
 */
export function openGateWhenPositioned(video: HTMLVideoElement, reveal: () => void): boolean {
  const el = video as GatedVideo
  if (!el.__awaitingPosition) return true

  const positioned = () => el.readyState >= 2 && !el.seeking
  if (positioned()) {
    el.__awaitingPosition = false
    el.__hadPicture = true
    return true
  }

  if (!el.__awaitingPositionHooked) {
    el.__awaitingPositionHooked = true
    const onSeeked = () => {
      // A queued seek may start from this very event; keep waiting through it.
      if (!positioned()) return
      el.removeEventListener('seeked', onSeeked)
      el.__awaitingPositionHooked = false
      el.__awaitingPosition = false
      el.__hadPicture = true
      reveal()
    }
    el.addEventListener('seeked', onSeeked)
  }
  return false
}
