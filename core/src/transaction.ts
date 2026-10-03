import type { EditorState, EditorTransactionState } from './editor-state'
import { getUndoSnapshot, equalUndoSnapshot, MAX_UNDO_HISTORY } from './editor-state'
import { validateTimeline, type ValidationError } from './validator'
import { makeId } from './id-generator'
import { pruneOrphanTransitions } from './timeline-transitions'

export interface TransactionCommitSuccess {
  success: true
  state: EditorState
}

export interface TransactionCommitFailure {
  success: false
  state: EditorState
  error: string
  validationErrors: ValidationError[]
}

export type TransactionCommitResult = TransactionCommitSuccess | TransactionCommitFailure

/**
 * Checks if an editor transaction is currently in progress.
 */
export function isTransactionActive(state: EditorState): boolean {
  return state.transaction != null
}

/**
 * Begins an editing transaction on the editor state.
 *
 * All operations applied during the transaction operate on temporary state.
 * Intermediate actions do not generate individual undo steps.
 * Nested transactions are explicitly rejected with an Error.
 */
export function beginTransaction(state: EditorState): EditorState {
  if (state.transaction != null) {
    throw new Error('Transaction already in progress: nested transactions are not supported')
  }

  const transactionState: EditorTransactionState = {
    id: makeId('tx'),
    baseState: state,
    baseSnapshot: getUndoSnapshot(state),
    startedAt: Date.now(),
  }

  return {
    ...state,
    transaction: transactionState,
  }
}

/**
 * Rolls back an active transaction, discarding all uncommitted changes.
 * Returns the exact base state from before beginTransaction was called.
 */
export function rollbackTransaction(state: EditorState): EditorState {
  if (!state.transaction) {
    throw new Error('No active transaction to rollback')
  }

  return state.transaction.baseState
}

/**
 * Commits an active transaction.
 *
 * 1. Validates the resulting active timeline against base timeline invariants.
 * 2. If validation fails, automatically rolls back to the base state and returns a failure result.
 * 3. If validation succeeds, pushes exactly ONE undo snapshot (from base state) to undoStack
 *    and clears the transaction.
 */
export function commitTransaction(uncommitted: EditorState): TransactionCommitResult {
  if (!uncommitted.transaction) {
    throw new Error('No active transaction to commit')
  }
  const { baseState, baseSnapshot } = uncommitted.transaction

  // Edits inside a transaction do not drop transitions their clips no longer support (see
  // replaceActiveTimeline); whatever is still dangling when it commits goes now.
  let reconciled = false
  const timelines = uncommitted.editorModel.timelines.map(timeline => {
    const pruned = pruneOrphanTransitions(timeline)
    if (pruned !== timeline) reconciled = true
    return pruned
  })
  const state: EditorState = reconciled
    ? { ...uncommitted, editorModel: { ...uncommitted.editorModel, timelines } }
    : uncommitted

  // Validate active timeline (and any modified timelines)
  const activeTimeline = state.editorModel.timelines.find(
    t => t.id === state.editorModel.activeTimelineId,
  )
  const baseActiveTimeline = baseState.editorModel.timelines.find(
    t => t.id === baseState.editorModel.activeTimelineId,
  )

  if (activeTimeline) {
    const validation = validateTimeline(activeTimeline, baseActiveTimeline)
    if (!validation.valid) {
      return {
        success: false,
        state: baseState,
        error: 'Commit rejected: timeline validation failed',
        validationErrors: validation.errors,
      }
    }
  }

  // Also validate any other timelines in the model
  for (const timeline of state.editorModel.timelines) {
    if (timeline.id === activeTimeline?.id) continue
    const baseTimeline = baseState.editorModel.timelines.find(t => t.id === timeline.id)
    const validation = validateTimeline(timeline, baseTimeline)
    if (!validation.valid) {
      return {
        success: false,
        state: baseState,
        error: `Commit rejected: timeline "${timeline.name}" validation failed`,
        validationErrors: validation.errors,
      }
    }
  }

  // Build committed state
  const currentSnapshot = getUndoSnapshot(state)
  const hasChanged = !equalUndoSnapshot(baseSnapshot, currentSnapshot)

  const committedHistory = hasChanged
    ? {
        undoStack: [
          ...baseState.history.undoStack.slice(-(MAX_UNDO_HISTORY - 1)),
          baseSnapshot,
        ],
        redoStack: [],
      }
    : baseState.history

  const committedState: EditorState = {
    ...state,
    transaction: null,
    history: committedHistory,
    projectSync: hasChanged ? { dirty: true } : baseState.projectSync,
  }

  return {
    success: true,
    state: committedState,
  }
}

/**
 * Convenience helper: commits the transaction or throws an error if validation fails.
 */
export function commitTransactionOrThrow(state: EditorState): EditorState {
  const result = commitTransaction(state)
  if (!result.success) {
    throw new Error(`${result.error}: ${result.validationErrors.map(e => e.message).join('; ')}`)
  }
  return result.state
}

/**
 * Executes a function inside a transaction block, automatically committing on success
 * and rolling back on exception or validation failure.
 */
export function runInTransaction(
  state: EditorState,
  fn: (txState: EditorState) => EditorState,
): TransactionCommitResult {
  const tx = beginTransaction(state)
  try {
    const modified = fn(tx)
    return commitTransaction(modified)
  } catch (err) {
    return {
      success: false,
      state: rollbackTransaction(tx),
      error: err instanceof Error ? err.message : String(err),
      validationErrors: [],
    }
  }
}
