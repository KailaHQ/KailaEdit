/**
 * Where a clip is drawn inside the preview frame, in pixels of that frame.
 *
 * The preview fits the media into the frame (object-contain), then applies the
 * clip's transform. Both the on-screen bounding box and the hit test for
 * "which clip did the user just click" need that same rectangle, and computing
 * it twice is how the two drift apart.
 *
 * Rotation is deliberately ignored: this is the axis-aligned box, which is
 * what a click test wants and what the bounding box positions itself with
 * before applying its own rotation.
 */

/**
 * The size media takes inside the preview frame before any clip transform,
 * i.e. what `object-contain` produces.
 */
export function fitMediaInFrame(
  frame: { width: number; height: number },
  asset: { width?: number; height?: number } | null | undefined,
): { width: number; height: number } {
  const frameWidth = frame.width || 1
  const frameHeight = frame.height || 1
  const targetRatio = (asset?.width || frameWidth) / (asset?.height || frameHeight)
  const frameRatio = frameWidth / frameHeight

  // The media touches the frame on whichever axis runs out first.
  return frameRatio > targetRatio
    ? { width: frameHeight * targetRatio, height: frameHeight }
    : { width: frameWidth, height: frameWidth / targetRatio }
}

export function clipScreenBox(
  frame: { width: number; height: number },
  asset: { width?: number; height?: number } | null | undefined,
  transform: { scale?: number; scaleX?: number; scaleY?: number; positionX?: number; positionY?: number } | null | undefined,
): { left: number; top: number; width: number; height: number } {
  const frameWidth = frame.width || 1
  const frameHeight = frame.height || 1

  const fitted = fitMediaInFrame(frame, asset)
  const fittedWidth = fitted.width
  const fittedHeight = fitted.height

  const scaleX = Math.max(0, transform?.scaleX ?? transform?.scale ?? 100) / 100
  const scaleY = Math.max(0, transform?.scaleY ?? transform?.scale ?? 100) / 100
  const width = fittedWidth * scaleX
  const height = fittedHeight * scaleY

  // positionX / positionY are percentages of the frame, measured from centre.
  const centreX = frameWidth / 2 + (frameWidth * (transform?.positionX ?? 0)) / 100
  const centreY = frameHeight / 2 + (frameHeight * (transform?.positionY ?? 0)) / 100

  return {
    left: centreX - width / 2,
    top: centreY - height / 2,
    width,
    height,
  }
}
