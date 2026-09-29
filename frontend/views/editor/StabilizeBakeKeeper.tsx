import { useStabilizeBakeKeeper } from '../../hooks/useStabilizeBake'

/**
 * Renders nothing; keeps stabilized clips supplied with bakes.
 *
 * A component of its own rather than a hook in VideoEditor: the keeper subscribes to the
 * clip list, and in here a clip edit re-renders only this, not the whole editor shell.
 */
export function StabilizeBakeKeeper({ projectId }: { projectId?: string }) {
  useStabilizeBakeKeeper(projectId)
  return null
}
