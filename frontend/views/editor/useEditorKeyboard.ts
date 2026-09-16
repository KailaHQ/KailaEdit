import { useEffect, useRef } from 'react'
import { resolveAction, type ActionId } from '../../lib/keyboard-shortcuts'
import { sampleClipAt } from '@core/keyframes'
import type { EditorState } from './editor-state'
import {
  selectClips,
  selectContentDuration,
  selectKeyboardCommandContext,
  selectSelectedGap,
  selectSelectedSubtitleId,
  selectTracks,
} from './editor-selectors'
import { useEditorActions } from './editor-store'

// Frame duration at 24fps
const FRAME_DURATION = 1 / 24

interface KeyboardRefs {
  kbLayoutRef: React.MutableRefObject<any>
  isKbEditorOpenRef: React.MutableRefObject<boolean>
  getState: () => EditorState
  playbackTimeRef: React.MutableRefObject<number>
  centerOnPlayheadRef: React.MutableRefObject<boolean>
  getMinZoomRef: React.MutableRefObject<() => number>
  selectedGapRef: React.MutableRefObject<{ trackIndex: number; startTime: number; endTime: number } | null>
  clearSelectedGapRef: React.MutableRefObject<() => void>
  closeSelectedGapRef: React.MutableRefObject<() => void>
  fitToViewRef: React.MutableRefObject<() => void>
  toggleFullscreenRef: React.MutableRefObject<() => void>
  openSettingsRef?: React.MutableRefObject<() => void>
  /** Timeline position under the pointer, or null when it is elsewhere. */
  timelineHoverRef: React.MutableRefObject<{ time: number; trackIndex: number } | null>
}

interface KeyboardContext {
  deleteAssetActionRef: React.MutableRefObject<() => void>
}

export interface UseEditorKeyboardParams {
  refs: KeyboardRefs
  context: KeyboardContext
}

/**
 * Editor-wide key handling.
 *
 * There is one player and one timeline, so no command needs to ask which panel
 * has focus. Shuttle (JKL), in/out marking and three-point editing came from
 * the Premiere-style layout this editor used to have and were dropped along
 * with it — their action ids simply no longer resolve to anything.
 */
function isTypingInTextInput(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) {
    const textTypes = ['text', 'password', 'search', 'email', 'url', 'tel']
    return textTypes.includes(target.type)
  }
  return false
}

export function useEditorKeyboard(params: UseEditorKeyboardParams) {
  const { refs, context } = params
  const actions = useEditorActions()
  const contextRef = useRef(context)
  const actionsRef = useRef(actions)
  contextRef.current = context
  actionsRef.current = actions

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only suppress shortcuts when user is actively typing in text fields
      if (isTypingInTextInput(e.target)) return
      if (refs.isKbEditorOpenRef.current) return

      const context = contextRef.current
      const state = refs.getState()
      const commandContext = selectKeyboardCommandContext(state)
      const sel = commandContext.selectedClipIds
      const td = commandContext.totalDuration

      let action: ActionId | null = resolveAction(refs.kbLayoutRef.current, e)
      // Space is always guaranteed to trigger transport.playPause when not in a text field
      if (!action && (e.code === 'Space' || e.key === ' ')) {
        action = 'transport.playPause'
      }
      if (!action) return

      e.preventDefault()

      // When Space or transport play/pause is triggered, release focus from whatever slider or button
      // was active so controls don't retain focus, outline or swallow keys.
      if (action === 'transport.playPause') {
        if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
          document.activeElement.blur()
        }
      }

      const editorActions = actionsRef.current

      switch (action) {
        // Tools
        case 'tool.select':       editorActions.setActiveTool('select'); break
        case 'tool.blade':        editorActions.setActiveTool('blade'); break
        case 'tool.ripple':       editorActions.setActiveTool('ripple'); editorActions.setLastTrimTool('ripple'); break
        case 'tool.roll':         editorActions.setActiveTool('roll'); editorActions.setLastTrimTool('roll'); break
        case 'tool.slide':        editorActions.setActiveTool('slide'); editorActions.setLastTrimTool('slide'); break
        case 'tool.slip':         editorActions.setActiveTool('slip'); editorActions.setLastTrimTool('slip'); break
        case 'tool.trackForward': editorActions.setActiveTool('trackForward'); break

        // Transport
        case 'transport.playPause':
          if (state.session.ui.previewAssetId) {
            window.dispatchEvent(new CustomEvent('komfyedit:toggle-asset-preview-playback'))
            break
          }
          if (state.session.transport.isPlaying) {
            editorActions.pause()
          } else {
            const cd = selectContentDuration(state)
            if (cd > 0 && (commandContext.currentTime >= cd - 0.04 || refs.playbackTimeRef.current >= cd - 0.04)) {
              refs.playbackTimeRef.current = 0
              editorActions.setCurrentTime(0)
            }
            editorActions.play()
          }
          break

        case 'transport.stepBackward':
          editorActions.stepCurrentTime(-FRAME_DURATION)
          break

        case 'transport.stepForward': {
          const cd = selectContentDuration(state)
          const limit = cd > 0 ? cd : td
          editorActions.setCurrentTime(Math.min(limit, commandContext.currentTime + FRAME_DURATION))
          break
        }

        case 'transport.jumpBackward':
          editorActions.stepCurrentTime(-1)
          break

        case 'transport.jumpForward': {
          const cd = selectContentDuration(state)
          const limit = cd > 0 ? cd : td
          editorActions.setCurrentTime(Math.min(limit, commandContext.currentTime + 1))
          break
        }

        case 'transport.goToStart':
          editorActions.pause()
          editorActions.setCurrentTime(0)
          break
        case 'transport.goToEnd':
          editorActions.pause()
          editorActions.setCurrentTime(td)
          break

        // Editing
        case 'edit.undo':    editorActions.undo(); break
        case 'edit.redo':    editorActions.redo(); break
        case 'edit.cut':     editorActions.cutSelection(); break
        case 'edit.copy':    editorActions.copySelection(); break
        case 'edit.paste':   editorActions.pasteSelection(); break
        case 'edit.selectAll':
          editorActions.selectAllClips()
          break
        case 'edit.deselect':
          if (state.session.selection.selectedKeyframe) {
            editorActions.clearSelectedKeyframe()
          }
          if (refs.selectedGapRef.current) {
            refs.clearSelectedGapRef.current()
          } else {
            editorActions.clearClipSelection()
          }
          break
        case 'edit.split': {
          // Always cut at the playhead — the red line is what the user is
          // aiming at, never the pointer. While playing the store's
          // currentTime lags the drawn playhead, so read the live ref.
          const hover = refs.timelineHoverRef.current
          const allClips = selectClips(state)
          const time = state.session.transport.isPlaying
            ? refs.playbackTimeRef.current
            : commandContext.currentTime
          const spans = (clip: (typeof allClips)[number]) =>
            clip.startTime < time && clip.startTime + clip.duration > time

          // The pointer still picks *which* track to cut, but only when the
          // user has not selected clips explicitly.
          const selected = allClips.filter(c => sel.has(c.id) && spans(c))
          let targets: string[]
          if (selected.length > 0) {
            targets = selected.map(c => c.id)
          } else if (hover) {
            targets = allClips.filter(c => c.trackIndex === hover.trackIndex && spans(c)).map(c => c.id)
          } else {
            targets = allClips.filter(spans).map(c => c.id)
          }
          // splitClipsAtTime skips locked tracks and cuts too close to an edge.
          if (targets.length > 0) editorActions.splitClipsAtTime(targets, time)
          break
        }

        case 'keyframe.toggle': {
          const allClips = selectClips(state)
          const tracks = selectTracks(state)
          const time = commandContext.currentTime
          const spans = (c: (typeof allClips)[number]) =>
            time >= c.startTime && time <= c.startTime + c.duration

          const candidate = (sel.size > 0
            ? allClips.find(c => sel.has(c.id) && spans(c))
            : allClips.find(spans))
          if (!candidate || tracks[candidate.trackIndex]?.locked) break

          const timeInClip = Math.max(0, Math.min(candidate.duration, time - candidate.startTime))
          const existingPoints = (candidate.keyframes ?? []).flatMap(k =>
            k.points.filter(p => Math.abs(p.t - timeInClip) <= 0.08).map(p => ({ property: k.property, t: p.t })),
          )

          if (existingPoints.length > 0) {
            for (const ep of existingPoints) {
              editorActions.removeKeyframeAt(candidate.id, ep.property, ep.t)
            }
          } else {
            if (candidate.keyframes && candidate.keyframes.length > 0) {
              const sampled = sampleClipAt(candidate, timeInClip)
              for (const k of candidate.keyframes) {
                const val = k.property === 'transform.scale' ? sampled.scale
                  : k.property === 'transform.positionX' ? sampled.positionX
                  : k.property === 'transform.positionY' ? sampled.positionY
                  : k.property === 'transform.rotation' ? sampled.rotation
                  : k.property === 'opacity' ? sampled.opacity
                  : k.property === 'volume' ? sampled.volume
                  : sampled.filterIntensity
                editorActions.setKeyframe(candidate.id, k.property, timeInClip, val)
              }
            } else {
              if (candidate.type === 'audio') {
                editorActions.setKeyframe(candidate.id, 'volume', timeInClip, candidate.volume ?? 1)
              } else {
                editorActions.setKeyframe(candidate.id, 'transform.scale', timeInClip, candidate.transform?.scale ?? 100)
              }
            }
          }
          break
        }

        case 'keyframe.delete': {
          const allClips = selectClips(state)
          const tracks = selectTracks(state)
          const time = commandContext.currentTime
          const spans = (c: (typeof allClips)[number]) =>
            time >= c.startTime && time <= c.startTime + c.duration

          const candidate = (sel.size > 0
            ? allClips.find(c => sel.has(c.id) && spans(c))
            : allClips.find(spans))
          if (!candidate || tracks[candidate.trackIndex]?.locked || !candidate.keyframes) break

          const timeInClip = Math.max(0, Math.min(candidate.duration, time - candidate.startTime))
          for (const k of candidate.keyframes) {
            editorActions.removeKeyframeAt(candidate.id, k.property, timeInClip)
          }
          break
        }

        case 'keyframe.prev':
        case 'keyframe.next': {
          const allClips = selectClips(state)
          const time = commandContext.currentTime
          const spans = (c: (typeof allClips)[number]) =>
            time >= c.startTime && time <= c.startTime + c.duration

          const candidate = (sel.size > 0
            ? allClips.find(c => sel.has(c.id) && spans(c)) ?? allClips.find(c => sel.has(c.id))
            : allClips.find(spans))

          if (!candidate || !candidate.keyframes || candidate.keyframes.length === 0) break

          const times = Array.from(
            new Set(candidate.keyframes.flatMap(k => k.points.map(p => candidate.startTime + p.t)))
          ).sort((a, b) => a - b)

          if (times.length === 0) break

          const EPSILON = 0.04
          if (action === 'keyframe.prev') {
            const prevTimes = times.filter(t => t < time - EPSILON)
            if (prevTimes.length > 0) {
              editorActions.setCurrentTime(prevTimes[prevTimes.length - 1])
            }
          } else {
            const nextTimes = times.filter(t => t > time + EPSILON)
            if (nextTimes.length > 0) {
              editorActions.setCurrentTime(nextTimes[0])
            }
          }
          break
        }

        case 'edit.delete': {
          const selectedKf = state.session.selection.selectedKeyframe
          if (selectedKf) {
            editorActions.removeKeyframeGroupAt(selectedKf.clipId, selectedKf.t)
            editorActions.clearSelectedKeyframe()
            break
          }
          if (sel.size > 0) {
            const deleteIds = new Set<string>()
            for (const id of sel) {
              const clip = selectClips(state).find(cl => cl.id === id)
              if (clip && selectTracks(state)[clip.trackIndex]?.locked) continue
              deleteIds.add(id)
              if (clip?.linkedClipIds) {
                const allLinkedSelected = clip.linkedClipIds.every(lid => sel.has(lid))
                if (allLinkedSelected) clip.linkedClipIds.forEach(lid => deleteIds.add(lid))
              }
            }
            editorActions.deleteClips([...deleteIds])
          } else if (selectSelectedGap(state)) {
            refs.closeSelectedGapRef.current()
          } else if (selectSelectedSubtitleId(state)) {
            editorActions.deleteSubtitle(selectSelectedSubtitleId(state)!)
          } else {
            context.deleteAssetActionRef.current()
          }
          break
        }

        // Timeline
        case 'timeline.zoomIn':
          refs.centerOnPlayheadRef.current = true
          editorActions.setZoom(Math.min(4, +(state.session.tools.zoom + 0.25).toFixed(2)))
          break
        case 'timeline.zoomOut':
          refs.centerOnPlayheadRef.current = true
          editorActions.setZoom(Math.max(refs.getMinZoomRef.current(), +(state.session.tools.zoom - 0.25).toFixed(2)))
          break
        case 'timeline.fitToView':
          refs.fitToViewRef.current()
          break
        case 'timeline.toggleSnap':
          editorActions.toggleSnap()
          break
        case 'nav.prevEdit':
          editorActions.pause()
          editorActions.goToPrevEdit(state.session.transport.isPlaying ? refs.playbackTimeRef.current : state.session.transport.currentTime)
          break
        case 'nav.nextEdit':
          editorActions.pause()
          editorActions.goToNextEdit(state.session.transport.isPlaying ? refs.playbackTimeRef.current : state.session.transport.currentTime)
          break
        case 'marker.add': {
          const t = state.session.transport.isPlaying ? refs.playbackTimeRef.current : commandContext.currentTime
          editorActions.addMarker({ time: t })
          break
        }
        case 'marker.prev': {
          editorActions.pause()
          const t = state.session.transport.isPlaying ? refs.playbackTimeRef.current : commandContext.currentTime
          editorActions.goToPrevMarker(t)
          break
        }
        case 'marker.next': {
          editorActions.pause()
          const t = state.session.transport.isPlaying ? refs.playbackTimeRef.current : commandContext.currentTime
          editorActions.goToNextMarker(t)
          break
        }
        case 'view.fullscreen':
          refs.toggleFullscreenRef.current()
          break
        case 'app.settings':
          refs.openSettingsRef?.current()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, []) // stable - uses refs for latest state
}
