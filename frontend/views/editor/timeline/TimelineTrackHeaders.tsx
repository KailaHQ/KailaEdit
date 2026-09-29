import React from 'react'
import { trackRowHeight } from '@core/timeline-rows'
import {
  Plus, Trash2,
  Volume2, VolumeX,
  Layers,
  Lock, Unlock, Film,
  Palette,
  Eye, EyeOff,
  MessageSquare,
  Music,
  Type,
  Image as ImageIcon,
  Sticker,
} from 'lucide-react'
import { Tooltip } from '../../../components/ui/tooltip'
import type { Track, SubtitleClip, TimelineClip } from '../../../types/project-model'
import { useTranslation } from '../../../i18n/I18nContext'
import { useEditorStore } from '../editor-store'
import { selectClips } from '../editor-selectors'

export type TrackContentType = 'subtitle' | 'audio' | 'sticker' | 'text' | 'adjustment' | 'image' | 'video'

export function getTrackContentType(track: Track, realIndex: number, clips: TimelineClip[]): TrackContentType {
  if (track.type === 'subtitle') return 'subtitle'
  if (track.kind === 'audio') return 'audio'
  // Read the kind, not the clips on it: a sticker clip is an image clip, so
  // inspecting contents would show a sticker row the same picture icon a photo
  // row gets, which is exactly the confusion the separate kind removes.
  if (track.kind === 'sticker') return 'sticker'

  const trackClips = clips.filter(c => c.trackIndex === realIndex)
  if (trackClips.length > 0) {
    const textCount = trackClips.filter(c => c.type === 'text').length
    const adjCount = trackClips.filter(c => c.type === 'adjustment').length
    const imageCount = trackClips.filter(c => c.type === 'image').length
    const videoCount = trackClips.filter(c => c.type === 'video').length

    if (textCount > 0 && videoCount === 0 && imageCount === 0 && adjCount === 0) {
      return 'text'
    }
    if (adjCount > 0 && videoCount === 0 && imageCount === 0 && textCount === 0) {
      return 'adjustment'
    }
    if (imageCount > 0 && videoCount === 0 && textCount === 0 && adjCount === 0) {
      return 'image'
    }
    if (textCount > videoCount && textCount > imageCount && textCount > adjCount) {
      return 'text'
    }
    if (adjCount > videoCount && adjCount > imageCount) {
      return 'adjustment'
    }
    if (imageCount > videoCount) {
      return 'image'
    }
    return 'video'
  }

  // Fallback by name if track is empty
  const lowerName = track.name.toLowerCase()
  if (lowerName.includes('text') || lowerName.includes('chữ') || lowerName.includes('title')) {
    return 'text'
  }
  if (lowerName.includes('adj')) {
    return 'adjustment'
  }
  if (lowerName.includes('image') || lowerName.includes('ảnh') || lowerName.includes('photo')) {
    return 'image'
  }

  return 'video'
}

export const typeLabelMap: Record<TrackContentType, string> = {
  subtitle: 'Subtitles',
  audio: 'Audio',
  text: 'Text',
  adjustment: 'Adjustment',
  sticker: 'Sticker',
  image: 'Image',
  video: 'Video',
}

export function getTrackTypeLabel(contentType: TrackContentType, t: (key: string) => string): string {
  switch (contentType) {
    case 'subtitle': return t('timeline.trackTypes.subtitle')
    case 'audio': return t('timeline.trackTypes.audio')
    case 'text': return t('timeline.trackTypes.text')
    case 'adjustment': return t('timeline.trackTypes.adjustment')
    case 'sticker': return t('timeline.trackTypes.sticker')
    case 'image': return t('timeline.trackTypes.image')
    case 'video':
    default:
      return t('timeline.trackTypes.video')
  }
}

export function renderTrackIcon(contentType: TrackContentType, muted?: boolean) {
  switch (contentType) {
    case 'subtitle':
      return <MessageSquare className={`h-3.5 w-3.5 flex-shrink-0 ${muted ? 'text-zinc-600' : 'text-amber-400/80'}`} />
    case 'audio':
      return <Music className={`h-3.5 w-3.5 flex-shrink-0 ${muted ? 'text-zinc-600' : 'text-emerald-400/80'}`} />
    case 'text':
      return <Type className="h-3.5 w-3.5 flex-shrink-0 text-cyan-400/90" />
    case 'adjustment':
      return <Layers className="h-3.5 w-3.5 flex-shrink-0 text-blue-400/90" />
    case 'sticker':
      return <Sticker className="h-3.5 w-3.5 flex-shrink-0 text-orange-400/90" />
    case 'image':
      return <ImageIcon className="h-3.5 w-3.5 flex-shrink-0 text-purple-400/90" />
    case 'video':
    default:
      return <Film className="h-3.5 w-3.5 flex-shrink-0 text-zinc-400" />
  }
}

export interface TimelineTrackHeadersProps {
  trackHeadersRef: React.RefObject<HTMLDivElement>
  orderedTracks: { track: Track; realIndex: number; displayRow: number }[]
  tracks: Track[]
  clips?: TimelineClip[]
  setTracks: (tracks: Track[]) => void
  addTrack: (kind: 'video' | 'audio') => void
  addSubtitleTrack: () => void
  createAdjustmentLayerAsset: () => void
  deleteTrack: (realIndex: number) => void
  subtitleTrackStyleIdx: number | null | undefined
  setSubtitleTrackStyleIdx: (idx: number | null) => void
  addSubtitleClip: (trackIndex: number) => void
  setSubtitles: React.Dispatch<React.SetStateAction<SubtitleClip[]>>
  videoTrackHeight: number
  audioTrackHeight: number
  subtitleTrackHeight: number
  stickerTrackHeight: number
  setVideoTrackHeight: (height: number) => void
  setAudioTrackHeight: (height: number) => void
  setSubtitleTrackHeight: (height: number) => void
}

export const TimelineTrackHeaders: React.FC<TimelineTrackHeadersProps> = ({
  trackHeadersRef,
  orderedTracks,
  tracks,
  clips,
  setTracks,
  addTrack,
  addSubtitleTrack,
  createAdjustmentLayerAsset,
  deleteTrack,
  subtitleTrackStyleIdx,
  setSubtitleTrackStyleIdx,
  addSubtitleClip,
  setSubtitles,
  videoTrackHeight,
  audioTrackHeight,
  subtitleTrackHeight,
  stickerTrackHeight,
  setVideoTrackHeight,
  setAudioTrackHeight,
  setSubtitleTrackHeight,
}) => {
  const { t } = useTranslation()
  const storeClips = useEditorStore(selectClips)
  const allClips = clips ?? storeClips

  return (
    <div className="w-32 flex-shrink-0 border-r border-zinc-800 bg-zinc-900 flex flex-col overflow-hidden">
      {/* Add track buttons - pinned above scrollable area */}
      <div className="flex-shrink-0 h-7 flex items-center px-2 gap-1.5 border-b border-zinc-700/50 bg-zinc-900">
        <button
          onClick={() => addTrack('video')}
          className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-0.5"
          title={t('timeline.addVideoTrack')}
        >
          <Plus className="h-3 w-3" />
          V
        </button>
        <button
          onClick={() => addTrack('audio')}
          className="text-[10px] text-emerald-500/70 hover:text-emerald-400 flex items-center gap-0.5"
          title={t('timeline.addAudioTrack')}
        >
          <Plus className="h-3 w-3" />
          A
        </button>
        <div className="w-px h-3 bg-zinc-700" />
        <button
          onClick={addSubtitleTrack}
          className="text-[10px] text-amber-500/70 hover:text-amber-400 flex items-center gap-0.5"
          title={t('timeline.addSubtitleTrack')}
        >
          <MessageSquare className="h-3 w-3" />
          Subs
        </button>
        <div className="w-px h-3 bg-zinc-700" />
        <button
          onClick={createAdjustmentLayerAsset}
          className="text-[10px] text-blue-400/70 hover:text-blue-300 flex items-center gap-0.5"
          title={t('timeline.createAdjustmentLayerAsset')}
        >
          <Layers className="h-3 w-3" />
          Adj
        </button>
      </div>

      {/* Scrollable track headers - synced with vertical scroll */}
      <div ref={trackHeadersRef} className="flex flex-1 flex-col overflow-hidden select-none">
        <div className="my-auto">
          {orderedTracks.map(({ track, realIndex }) => {
            const contentType = getTrackContentType(track, realIndex, allClips)
            const trackClips = allClips.filter(c => c.trackIndex === realIndex)
            const hasAudioClips = trackClips.some(c => c.type === 'video' || c.type === 'audio')
            const contentLabel = getTrackTypeLabel(contentType, t)

            return (
              <React.Fragment key={track.id}>
                <div
                  className="group flex-shrink-0 border-b border-zinc-800/60 text-xs relative flex items-stretch"
                  style={{ height: trackRowHeight(track, { video: videoTrackHeight, audio: audioTrackHeight, subtitle: subtitleTrackHeight, sticker: stickerTrackHeight }) }}
                >
                  {/* Track Controls */}
                  <div className={`w-full flex-shrink-0 bg-zinc-900 flex ${
                    track.type === 'subtitle'
                      ? 'px-1.5 flex-col justify-center gap-0'
                      : 'px-2 items-center justify-between'
                  }`}>
                    {track.type === 'subtitle' ? (
                      <>
                        {/* Row 1: track type */}
                        <Tooltip content={track.name} side="right">
                          <div className="flex items-center">
                            <MessageSquare className={`h-3.5 w-3.5 flex-shrink-0 ${track.muted ? 'text-zinc-600' : 'text-amber-400/80'}`} />
                          </div>
                        </Tooltip>
                        {/* Row 2: tools */}
                        <div className="flex items-center gap-0">
                          <Tooltip content="Track style settings" side="right">
                            <button
                              onClick={() => setSubtitleTrackStyleIdx(subtitleTrackStyleIdx === realIndex ? null : realIndex)}
                              className={`p-0.5 rounded ${subtitleTrackStyleIdx === realIndex ? 'text-amber-400 bg-amber-900/30' : 'text-amber-500/60 hover:text-amber-400'}`}
                            >
                              <Palette className="h-3 w-3" />
                            </button>
                          </Tooltip>
                          <Tooltip content="Add subtitle" side="right">
                            <button
                              onClick={() => addSubtitleClip(realIndex)}
                              className="p-0.5 rounded text-amber-500/60 hover:text-amber-400"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </Tooltip>
                          <Tooltip content={track.locked ? 'Unlock' : 'Lock'} side="right">
                            <button
                              onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? { ...t, locked: !t.locked } : t))}
                              className={`p-0.5 rounded ${track.locked ? 'text-yellow-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                              {track.locked ? <Lock className="h-2.5 w-2.5" /> : <Unlock className="h-2.5 w-2.5" />}
                            </button>
                          </Tooltip>
                          <Tooltip content={track.muted ? 'Show subtitles' : 'Hide subtitles'} side="right">
                            <button
                              onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? { ...t, muted: !t.muted } : t))}
                              className={`p-0.5 rounded ${track.muted ? 'text-red-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                              {track.muted ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
                            </button>
                          </Tooltip>
                          <Tooltip content="Delete track" side="right">
                            <button
                              onClick={() => {
                                if (confirm(`Delete subtitle track "${track.name}"?`)) {
                                  setTracks(tracks.filter((_, i) => i !== realIndex))
                                  setSubtitles(prev => prev.filter(s => s.trackIndex !== realIndex))
                                }
                              }}
                              className="p-0.5 rounded text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
                          </Tooltip>
                        </div>
                      </>
                    ) : (
                      <>
                        <Tooltip content={`${track.name} (${contentLabel})`} side="right">
                          <div className="flex flex-shrink-0 items-center">
                            {renderTrackIcon(contentType, track.muted)}
                          </div>
                        </Tooltip>
                        <div className="flex items-center gap-0 flex-shrink-0">
                          <Tooltip content={track.locked ? 'Unlock' : 'Lock'} side="right">
                            <button
                              onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? { ...t, locked: !t.locked } : t))}
                              className={`p-0.5 rounded ${track.locked ? 'text-yellow-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                              {track.locked ? <Lock className="h-2.5 w-2.5" /> : <Unlock className="h-2.5 w-2.5" />}
                            </button>
                          </Tooltip>
                          {track.kind !== 'audio' && (
                            <Tooltip content={track.enabled === false ? 'Enable track output' : 'Disable track output'} side="right">
                              <button
                                onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? { ...t, enabled: !(t.enabled !== false) } : t))}
                                className={`p-0.5 rounded ${track.enabled === false ? 'text-zinc-600' : 'text-zinc-500 hover:text-zinc-300'}`}
                              >
                                {track.enabled === false ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
                              </button>
                            </Tooltip>
                          )}
                          {track.kind !== 'audio' && (hasAudioClips || (contentType !== 'text' && contentType !== 'adjustment')) && (
                            <Tooltip content={track.muted ? 'Unmute' : 'Mute'} side="right">
                              <button
                                onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? { ...t, muted: !t.muted } : t))}
                                className={`p-0.5 rounded ${track.muted ? 'text-red-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                              >
                                {track.muted ? <VolumeX className="h-2.5 w-2.5" /> : <Volume2 className="h-2.5 w-2.5" />}
                              </button>
                            </Tooltip>
                          )}
                          {track.kind === 'audio' && (
                            <button
                              onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? { ...t, muted: !t.muted } : t))}
                              className={`px-1 py-0.5 rounded text-[10px] font-bold leading-none ${
                                track.muted ? 'bg-red-500/80 text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
                              }`}
                              title={track.muted ? 'Unmute track' : 'Mute track'}
                            >
                              M
                            </button>
                          )}
                          {track.kind === 'audio' && (
                            <button
                              onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? { ...t, solo: !t.solo } : t))}
                              className={`px-1 py-0.5 rounded text-[10px] font-bold leading-none ${
                                track.solo ? 'bg-yellow-500/80 text-black' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
                              }`}
                              title={track.solo ? 'Unsolo track' : 'Solo track'}
                            >
                              S
                            </button>
                          )}
                          {tracks.length > 1 && !(track.kind === 'video' && (track.name === 'V1' || realIndex === tracks.findIndex(t => t.kind === 'video'))) && (
                            <Tooltip content="Delete track" side="right">
                              <button
                                onClick={() => deleteTrack(realIndex)}
                                className="p-0.5 rounded text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Trash2 className="h-2.5 w-2.5" />
                              </button>
                            </Tooltip>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                {/* Track height resize handle */}
                <div
                  className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize z-10 group/resize hover:bg-blue-500/40 transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const isSubtitle = track.type === 'subtitle'
                    const isAudio = track.kind === 'audio'
                    const startY = e.clientY
                    const startH = isSubtitle ? subtitleTrackHeight : isAudio ? audioTrackHeight : videoTrackHeight
                    const onMove = (ev: MouseEvent) => {
                      const delta = ev.clientY - startY
                      const newH = Math.max(24, Math.min(200, startH + delta))
                      if (isSubtitle) setSubtitleTrackHeight(newH)
                      else if (isAudio) setAudioTrackHeight(newH)
                      else setVideoTrackHeight(newH)
                    }
                    const onUp = () => {
                      window.removeEventListener('mousemove', onMove)
                      window.removeEventListener('mouseup', onUp)
                    }
                    window.addEventListener('mousemove', onMove)
                    window.addEventListener('mouseup', onUp)
                  }}
                >
                  <div className="mx-auto w-6 h-0.5 bg-zinc-600 rounded-full mt-0.5 group-hover/resize:bg-blue-400 transition-colors" />
                </div>
              </div>
            </React.Fragment>
          )})}
        </div>
      </div>
    </div>
  )
}
