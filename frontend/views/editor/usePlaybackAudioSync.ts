import { useCallback, useEffect, useRef } from 'react'
import { playbackDriveModeForSpeed } from '@core/clip-speed'
import { clipHasSpeedCurve, clipSourceTimeAt, clipSpeedAtTime } from '@core/speed-curve'
import type { TimelineClip } from '../../types/project-model'
import { sampleClipAt, hasKeyframesForProperty } from '@core/keyframes'
import { pathToFileUrl } from '../../lib/file-url'
import { applyPlaybackGain, resumePlaybackAudioContext } from './audio-boost'
import {
  selectAssets,
  selectClipPathFromAssets,
  selectClips,
  selectCurrentTime,
  selectIsPlaying,
  selectLiveAssetForClipFromAssets,
  selectTracks,
} from './editor-selectors'
import { useEditorGetState, useEditorStore, useEditorSubscribeToSlice } from './editor-store'

interface UsePlaybackAudioSyncParams {
  playbackTimeRef: React.MutableRefObject<number>
}

type AudioEl = HTMLAudioElement & {
  __audioPlaying?: boolean
  __lastPlayRetry?: number
  __intendedPath?: string
  __awaitingCanplay?: boolean
}

const PLAYING_LOOKAHEAD_SECONDS = 5
const PLAYING_LOOKBEHIND_SECONDS = 0.5
const PAUSED_LOOKAHEAD_SECONDS = 1
const PAUSED_LOOKBEHIND_SECONDS = 0.25
const PLAYING_PRELOAD_LOOKAHEAD_SECONDS = 3
const PAUSED_PRELOAD_LOOKAHEAD_SECONDS = 0.5
const ACTIVATION_SEEK_TOLERANCE_SECONDS = 0.12

/**
 * Clips whose audio this hook schedules.
 *
 * Adding a video to the timeline splits it into a video clip plus a linked audio
 * clip, and that audio clip is what plays the sound — the monitor's <video>
 * elements stay muted so seeking and compositing never produce artefacts. A
 * video clip therefore only needs its own audio element when it has no linked
 * audio clip (no free audio track at insert time, or the user deleted it);
 * scheduling one otherwise would play the same file twice.
 */
function isAudioSourceClip(clip: TimelineClip, clips: TimelineClip[]): boolean {
  if (clip.type === 'audio') return true
  if (clip.type !== 'video') return false
  return !(clip.linkedClipIds ?? []).some(
    id => clips.find(candidate => candidate.id === id)?.type === 'audio',
  )
}

function clipOverlapsWindow(
  clip: TimelineClip,
  time: number,
  lookBehindSeconds: number,
  lookAheadSeconds: number,
): boolean {
  const clipStart = clip.startTime
  const clipEnd = clip.startTime + clip.duration
  return clipEnd >= time - lookBehindSeconds && clipStart <= time + lookAheadSeconds
}

function getClipStartTargetTime(clip: TimelineClip, mediaDuration: number): number {
  return clip.reversed
    ? Math.max(0, mediaDuration - clip.trimEnd)
    : Math.max(0, clip.trimStart)
}

export function usePlaybackAudioSync(params: UsePlaybackAudioSyncParams) {
  const { playbackTimeRef } = params
  const isPlaying = useEditorStore(selectIsPlaying)
  const subscribeToSlice = useEditorSubscribeToSlice()
  const assets = useEditorStore(selectAssets)
  const clips = useEditorStore(selectClips)
  const tracks = useEditorStore(selectTracks)
  const getEditorState = useEditorGetState()

  const audioElementsRef = useRef<Map<string, AudioEl>>(new Map())

  useEffect(() => {
    if (!isPlaying) return

    // The AudioContext starts suspended until a gesture; playback is that gesture.
    resumePlaybackAudioContext()

    let lastTimestamp: number | null = null
    let animFrameId = 0

    const tick = (timestamp: number) => {
      const editorState = getEditorState()
      const allClips = selectClips(editorState)
      const currentTracks = selectTracks(editorState)
      const currentAssets = selectAssets(editorState)
      const atTime = playbackTimeRef.current
      const audioMap = audioElementsRef.current

      if (lastTimestamp === null) {
        lastTimestamp = timestamp
      }

      const activeAudioIds = new Set<string>()
      const retainedAudioIds = new Set<string>()
      const retainedAudioPaths = new Map<string, string>()
      const preloadedAudioIds = new Set<string>()
      const anySoloed = currentTracks.some(track => track.solo)

      for (const clip of allClips) {
        if (!isAudioSourceClip(clip, allClips)) continue
        if (currentTracks[clip.trackIndex]?.enabled === false) continue
        const audioPath = selectClipPathFromAssets(currentAssets, clip)
        if (!audioPath) continue
        if (clipOverlapsWindow(clip, atTime, PLAYING_LOOKBEHIND_SECONDS, PLAYING_LOOKAHEAD_SECONDS)) {
          retainedAudioIds.add(clip.id)
          retainedAudioPaths.set(clip.id, audioPath)
        }
        if (atTime >= clip.startTime && atTime < clip.startTime + clip.duration) {
          activeAudioIds.add(clip.id)
        }
        if (clipOverlapsWindow(clip, atTime, 0, PLAYING_PRELOAD_LOOKAHEAD_SECONDS)) {
          preloadedAudioIds.add(clip.id)
        }
      }

      for (const [id, el] of audioMap) {
        if (!retainedAudioIds.has(id)) {
          el.pause()
          el.src = ''
          audioMap.delete(id)
          continue
        }
        if (!activeAudioIds.has(id)) {
          if (!el.paused) el.pause()
          el.__audioPlaying = false
          el.preload = preloadedAudioIds.has(id) ? 'auto' : 'metadata'
        }
      }

      for (const clip of allClips) {
        if (!retainedAudioIds.has(clip.id)) continue
        const audioPath = retainedAudioPaths.get(clip.id)
        if (!audioPath) continue

        let el = audioMap.get(clip.id)
        let isNewElement = false
        if (!el) {
          el = document.createElement('audio') as AudioEl
          el.src = pathToFileUrl(audioPath)
          el.__intendedPath = audioPath
          el.preload = preloadedAudioIds.has(clip.id) ? 'auto' : 'metadata'
          audioMap.set(clip.id, el)
          isNewElement = true
        } else if (el.__intendedPath !== audioPath) {
          el.src = pathToFileUrl(audioPath)
          el.__intendedPath = audioPath
          el.__audioPlaying = false
          el.preload = preloadedAudioIds.has(clip.id) ? 'auto' : 'metadata'
          isNewElement = true
        } else {
          el.preload = preloadedAudioIds.has(clip.id) ? 'auto' : 'metadata'
        }

        const computeTarget = (audioEl: AudioEl, time: number): number => {
          const assetDur = audioEl.duration || clip.duration
          return clipSourceTimeAt(clip, time - clip.startTime, assetDur)
        }

        // A speed curve changes the rate every frame; the element follows it
        // and, like tape, its pitch follows the speed. That is what the export
        // renders, so the preview has to sound the same.
        const hasCurve = clipHasSpeedCurve(clip)
        const instantSpeed = clipSpeedAtTime(clip, Math.max(0, atTime - clip.startTime))
        el.preservesPitch = !hasCurve

        // Above the element's rate ceiling there is no usable audio: the
        // element cannot play that fast, so it would drift behind the picture
        // and play the wrong moment. Silence is the honest answer.
        const drive = playbackDriveModeForSpeed(instantSpeed)
        const desiredRate = clip.reversed || drive.seekDriven ? 1 : drive.rate

        if (el.readyState >= 2) {
          if (!activeAudioIds.has(clip.id)) {
            if (preloadedAudioIds.has(clip.id)) {
              const preloadTarget = getClipStartTargetTime(clip, el.duration || clip.duration)
              if (Math.abs(el.currentTime - preloadTarget) > 0.05) {
                el.currentTime = preloadTarget
              }
            }
            continue
          }

          const track = currentTracks[clip.trackIndex]
          const isSoloMuted = anySoloed && !track?.solo
          const isHighSpeedAudio = instantSpeed > 4 || instantSpeed < 0.25
          el.muted = clip.muted || track?.muted || isSoloMuted || isHighSpeedAudio || false
          const timeInClip = Math.max(0, atTime - clip.startTime)
          const effectiveVolume = hasKeyframesForProperty(clip, 'volume')
            ? sampleClipAt(clip, timeInClip).volume
            : clip.volume
          applyPlaybackGain(el, effectiveVolume)

          const shouldPauseAudio = clip.reversed || drive.seekDriven || isHighSpeedAudio

          if (!el.__audioPlaying || isNewElement) {
            const target = computeTarget(el, atTime)
            if (isNewElement || Math.abs(el.currentTime - target) > ACTIVATION_SEEK_TOLERANCE_SECONDS) {
              el.currentTime = target
            }
            if (el.playbackRate !== desiredRate) el.playbackRate = desiredRate
            if (shouldPauseAudio) {
              el.pause()
              el.__audioPlaying = false
            } else {
              el.play().catch(() => {})
              el.__audioPlaying = true
              el.__lastPlayRetry = 0
            }
          } else {
            if (el.playbackRate !== desiredRate) el.playbackRate = desiredRate
            if (shouldPauseAudio) {
              if (!el.paused) el.pause()
              el.__audioPlaying = false
            } else {
              const target = computeTarget(el, atTime)
              const drift = Math.abs(el.currentTime - target)
              if (drift > 1.5) {
                el.currentTime = target
              }
              if (el.paused) {
                const lastRetry = el.__lastPlayRetry || 0
                if (timestamp - lastRetry > 500) {
                  el.__lastPlayRetry = timestamp
                  el.play().catch(() => {})
                }
              }
            }
          }
        } else if (!el.__awaitingCanplay) {
          el.__awaitingCanplay = true
          const expectedPath = audioPath
          const onCanPlay = () => {
            el!.removeEventListener('canplay', onCanPlay)
            el!.__awaitingCanplay = false
            if (audioElementsRef.current.get(clip.id) !== el) return
            if (el!.__intendedPath !== expectedPath) return
            const freshTime = playbackTimeRef.current
            const activeNow = freshTime >= clip.startTime && freshTime < clip.startTime + clip.duration
            const shouldPreload = clipOverlapsWindow(clip, freshTime, 0, PLAYING_PRELOAD_LOOKAHEAD_SECONDS)
            if (!selectIsPlaying(getEditorState()) || !activeNow) {
              if (shouldPreload) {
                const preloadTarget = getClipStartTargetTime(clip, el!.duration || clip.duration)
                el!.currentTime = preloadTarget
              }
              return
            }
            const target = computeTarget(el!, freshTime)
            if (Math.abs(el!.currentTime - target) > ACTIVATION_SEEK_TOLERANCE_SECONDS) {
              el!.currentTime = target
            }
            el!.playbackRate = desiredRate
            if (clip.reversed) {
              el!.pause()
              el!.__audioPlaying = false
            } else {
              el!.play().catch(() => {})
              el!.__audioPlaying = true
              el!.__lastPlayRetry = 0
            }
          }
          el.addEventListener('canplay', onCanPlay)
        }
      }

      animFrameId = requestAnimationFrame(tick)
    }

    animFrameId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(animFrameId)
      for (const [, el] of audioElementsRef.current) {
        if (!el.paused) el.pause()
        el.__audioPlaying = false
      }
    }
  }, [getEditorState, isPlaying, playbackTimeRef])

  const syncPausedAudio = useCallback((currentTime: number) => {
    for (const [, el] of audioElementsRef.current) {
      if (!el.paused) el.pause()
      el.__audioPlaying = false
    }

    const retainedAudioClips = clips.filter(clip => {
      if (!isAudioSourceClip(clip, clips)) return false
      if (tracks[clip.trackIndex]?.enabled === false) return false
      if (!selectClipPathFromAssets(assets, clip)) return false
      return clipOverlapsWindow(clip, currentTime, PAUSED_LOOKBEHIND_SECONDS, PAUSED_LOOKAHEAD_SECONDS)
    })
    const retainedAudioIds = new Set(retainedAudioClips.map(clip => clip.id))
    const preloadedAudioIds = new Set(
      retainedAudioClips
        .filter(clip => clipOverlapsWindow(clip, currentTime, 0, PAUSED_PRELOAD_LOOKAHEAD_SECONDS))
        .map(clip => clip.id),
    )

    for (const [id, el] of audioElementsRef.current) {
      if (!retainedAudioIds.has(id)) {
        el.pause()
        el.src = ''
        audioElementsRef.current.delete(id)
      }
    }

    for (const clip of retainedAudioClips) {
      const clipPath = selectClipPathFromAssets(assets, clip)
      if (!clipPath) continue

      let el = audioElementsRef.current.get(clip.id)
      if (!el) {
        el = document.createElement('audio') as AudioEl
        el.src = pathToFileUrl(clipPath)
        el.__intendedPath = clipPath
        el.preload = preloadedAudioIds.has(clip.id) ? 'auto' : 'metadata'
        audioElementsRef.current.set(clip.id, el)
      } else if (el.__intendedPath !== clipPath) {
        el.src = pathToFileUrl(clipPath)
        el.__intendedPath = clipPath
        el.preload = preloadedAudioIds.has(clip.id) ? 'auto' : 'metadata'
      } else {
        el.preload = preloadedAudioIds.has(clip.id) ? 'auto' : 'metadata'
      }

      const isAtPlayhead = currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration
      const liveAsset = selectLiveAssetForClipFromAssets(assets, clip)
      const assetDuration = liveAsset?.duration || clip.asset?.duration || clip.duration

      const anySoloed = tracks.some(track => track.solo)
      const track = tracks[clip.trackIndex]
      const isSoloMuted = anySoloed && !track?.solo
      el.muted = clip.muted || track?.muted || isSoloMuted || false
      const timeInClip = Math.max(0, currentTime - clip.startTime)
      const effectiveVolume = hasKeyframesForProperty(clip, 'volume')
        ? sampleClipAt(clip, timeInClip).volume
        : clip.volume
      applyPlaybackGain(el, effectiveVolume)

      if (el.readyState < 2) continue

      if (!isAtPlayhead) {
        if (preloadedAudioIds.has(clip.id)) {
          const preloadTarget = getClipStartTargetTime(clip, assetDuration)
          if (Math.abs(el.currentTime - preloadTarget) > 0.05) {
            el.currentTime = preloadTarget
          }
        }
        continue
      }

      const targetTime = clipSourceTimeAt(clip, timeInClip, assetDuration)

      if (Math.abs(el.currentTime - targetTime) > 0.05) {
        el.currentTime = targetTime
      }
    }
  }, [assets, clips, tracks])

  useEffect(() => {
    if (isPlaying) return
    // Subscribe outside the render cycle: this hook runs inside VideoEditor, so
    // re-rendering it on every playhead move would re-render the whole editor,
    // clip list included.
    syncPausedAudio(selectCurrentTime(getEditorState()))
    return subscribeToSlice(selectCurrentTime, syncPausedAudio)
  }, [getEditorState, isPlaying, subscribeToSlice, syncPausedAudio])

  useEffect(() => {
    return () => {
      for (const [, el] of audioElementsRef.current) {
        el.pause()
        el.src = ''
      }
      audioElementsRef.current.clear()
    }
  }, [])
}
