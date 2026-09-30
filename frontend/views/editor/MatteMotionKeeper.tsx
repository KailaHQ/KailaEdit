import { useMatteMotionKeeper } from '../../hooks/useMatteMotionKeeper'

/** Renders nothing; keeps video clips with custom-matte strokes supplied with camera motion. */
export function MatteMotionKeeper() {
  useMatteMotionKeeper()
  return null
}
