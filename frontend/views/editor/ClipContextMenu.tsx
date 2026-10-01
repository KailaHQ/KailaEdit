import React from 'react'
import { clipSourceTimeAt } from '@core/speed-curve'
import {
  Clipboard, Copy, Scissors, Trash2, Layers, Type, X,
  Eye, FolderOpen, RotateCcw, Volume2, VolumeX,
  FlipHorizontal2, FlipVertical2, Link2, Unlink2, Music, Snowflake, Replace,
} from 'lucide-react'
import { isReplaceableClip } from '@core/clip-replace'
import { useEditorActions } from './editor-store'
import type { Asset, TimelineClip, Track, TextOverlayStyle } from '../../types/project-model'
import { TEXT_PRESETS } from '../../types/project'
import { MAX_CLIP_VOLUME } from '../../types/project-model'
import { COLOR_LABELS } from './video-editor-utils'

export type ClipContextMenuState =
  | { kind: 'background'; x: number; y: number }
  | { kind: 'clip'; clipId: string; x: number; y: number }

export interface ClipContextMenuProps {
  clipContextMenu: ClipContextMenuState
  contextClip: TimelineClip | null
  clipContextMenuRef: React.RefObject<HTMLDivElement>
  clips: TimelineClip[]
  tracks: Track[]
  selectedClipIds: Set<string>
  setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>
  currentTime: number
  hasClipboard: boolean
  currentProjectId: string | null
  updateAsset: (projectId: string, assetId: string, updates: Partial<Asset>) => void
  handleCopy: () => void
  handleCut: () => void
  handlePaste: () => void
  setClipContextMenu: React.Dispatch<React.SetStateAction<ClipContextMenuState | null>>
  addTextClip: (style?: Partial<TextOverlayStyle>, startTime?: number) => void
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  duplicateClip: (clipId: string) => void
  splitClipAtPlayhead: (clipId: string, atTime?: number, batchClipIds?: string[]) => void
  removeClip: (clipId: string) => void
  updateClip: (clipId: string, updates: Partial<TimelineClip>) => void
  setClipSpeed: (clipId: string, speed: number, duration?: number) => void
  getLiveAsset: (clip: TimelineClip) => Asset | null | undefined
  getMaxClipDuration: (clip: TimelineClip) => number
  onRevealAsset: (assetId: string) => void
  /** Open the picker that swaps this clip's media (Replace clip). */
  onReplaceClip: (clipId: string) => void
}

// Reusable menu item component
function MenuItem({ icon: Icon, iconClass, label, shortcut, badge, badgeClass, disabled, danger, title, onClick }: {
  icon: any; iconClass?: string; label: string; shortcut?: string; badge?: string; badgeClass?: string
  disabled?: boolean; danger?: boolean; title?: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-full text-left px-3 py-1.5 flex items-center gap-3 transition-colors ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-zinc-700'
      } ${danger ? 'text-red-400' : 'text-zinc-300'}`}
    >
      <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${iconClass || (danger ? '' : 'text-zinc-500')}`} />
      <span className="flex-1 truncate">{label}</span>
      {badge && <span className={`text-[10px] font-medium flex-shrink-0 ${badgeClass || 'text-zinc-500'}`}>{badge}</span>}
      {shortcut && <span className="text-zinc-600 text-[10px] flex-shrink-0">{shortcut}</span>}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-1.5 pb-0.5 text-[9px] text-zinc-500 font-semibold uppercase tracking-widest select-none">
      {children}
    </div>
  )
}

function Divider() {
  return <div className="h-px bg-zinc-700 my-1" />
}

export function ClipContextMenu({
  clipContextMenu,
  contextClip,
  clipContextMenuRef,
  clips,
  selectedClipIds,
  setSelectedClipIds,
  currentTime,
  hasClipboard,
  currentProjectId,
  updateAsset,
  handleCopy,
  handleCut,
  handlePaste,
  setClipContextMenu,
  addTextClip,
  setClips,
  duplicateClip,
  splitClipAtPlayhead,
  removeClip,
  updateClip,
  setClipSpeed,
  getLiveAsset,
  getMaxClipDuration,
  onRevealAsset,
  onReplaceClip,
}: ClipContextMenuProps) {
  const close = () => setClipContextMenu(null)
  const isBackground = clipContextMenu.kind === 'background'

  // Check if all selected clips are in the same linked group — if so, treat as single selection
  const multiSelected = (() => {
    if (selectedClipIds.size <= 1) return false
    if (!contextClip) return clipContextMenu.kind === 'background'
    // Expand the linked group of the context clip
    const linkedGroup = new Set([contextClip.id])
    const queue = [contextClip.id]
    while (queue.length > 0) {
      const id = queue.pop()!
      const c = clips.find(cl => cl.id === id)
      if (c?.linkedClipIds) {
        for (const lid of c.linkedClipIds) {
          if (!linkedGroup.has(lid)) { linkedGroup.add(lid); queue.push(lid) }
        }
      }
    }
    // If every selected clip is in this linked group, it's a single logical selection
    for (const sid of selectedClipIds) {
      if (!linkedGroup.has(sid)) return true
    }
    return false
  })()

  return (
    <div
      ref={clipContextMenuRef}
      className="fixed bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl py-1.5 z-[60] min-w-[220px] max-w-[280px] text-xs"
      style={{ left: clipContextMenu.x, top: clipContextMenu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ════════════════════════════════════════════════
          BACKGROUND CONTEXT MENU (empty area right-click)
          ════════════════════════════════════════════════ */}
      {isBackground ? (
        <>
          <MenuItem icon={Clipboard} label="Paste" shortcut="Ctrl+V" disabled={!hasClipboard}
            onClick={() => { handlePaste(); close() }} />
          <Divider />
          <MenuItem icon={Type} iconClass="text-cyan-400" label="Add Text"
            onClick={() => { addTextClip(undefined, currentTime); close() }} />
          {TEXT_PRESETS.slice(0, 4).map(preset => (
            <button
              key={preset.id}
              onClick={() => { addTextClip(preset.style, currentTime); close() }}
              className="w-full text-left px-3 py-1.5 text-zinc-400 hover:bg-zinc-700 flex items-center gap-3 pl-9"
            >
              <span className="text-[10px] text-cyan-500/70 flex-shrink-0">T</span>
              <span className="flex-1 truncate">{preset.name}</span>
            </button>
          ))}
          <Divider />
          <MenuItem icon={Layers} label="Select All" shortcut="Ctrl+A"
            onClick={() => { setSelectedClipIds(new Set(clips.map(c => c.id))); close() }} />
        </>
      ) : multiSelected ? (
        /* ════════════════════════════════════════════════
           MULTI-CLIP CONTEXT MENU
           ════════════════════════════════════════════════ */
        <MultiClipMenu
          clips={clips}
          selectedClipIds={selectedClipIds} setSelectedClipIds={setSelectedClipIds}
          hasClipboard={hasClipboard}
          currentProjectId={currentProjectId}
          updateAsset={updateAsset}
          handleCopy={handleCopy} handleCut={handleCut} handlePaste={handlePaste}
          setClips={setClips}
          getMaxClipDuration={getMaxClipDuration}
          getLiveAsset={getLiveAsset}
          close={close}
        />
      ) : contextClip ? (
        /* ════════════════════════════════════════════════
           SINGLE CLIP CONTEXT MENU
           (For linked groups treated as single, prefer the video/image clip)
           ════════════════════════════════════════════════ */
        <SingleClipMenu
          contextClip={(() => {
            if (contextClip.type !== 'audio') return contextClip
            if (contextClip.linkedClipIds?.length) {
              const primary = clips.find(c => contextClip.linkedClipIds!.includes(c.id) && (c.type === 'video' || c.type === 'image'))
              if (primary) return primary
            }
            return contextClip
          })()}
          clips={clips}
          hasClipboard={hasClipboard}
          currentProjectId={currentProjectId}
          updateAsset={updateAsset}
          handleCopy={handleCopy} handleCut={handleCut} handlePaste={handlePaste}
          setClips={setClips}
          duplicateClip={duplicateClip}
          splitClipAtPlayhead={splitClipAtPlayhead}
          removeClip={removeClip}
          updateClip={updateClip}
          setClipSpeed={setClipSpeed}
          getLiveAsset={getLiveAsset}
          getMaxClipDuration={getMaxClipDuration}
          onRevealAsset={onRevealAsset}
          onReplaceClip={onReplaceClip}
          currentTime={currentTime}
          close={close}
        />
      ) : null}
    </div>
  )
}

/* ──────────────────────────────────────────────
   Single Clip Menu
   Layout:
   1. Clipboard        (Cut / Copy / Paste)
   2. Edit             (Duplicate / Split)
   3. Properties       (Speed / Reverse / Mute)
   4. Transform        (Flip H / Flip V)
   5. Structure        (Link / Move Track)
   7. Navigation       (Reveal in Assets / Explorer)
   8. Delete           (always last, red)
   ────────────────────────────────────────────── */
function SingleClipMenu({
  contextClip, clips, hasClipboard,
  currentProjectId, updateAsset,
  handleCopy, handleCut, handlePaste, setClips,
  duplicateClip, splitClipAtPlayhead, removeClip, updateClip, setClipSpeed,
  getLiveAsset, getMaxClipDuration,
  onRevealAsset,
  onReplaceClip,
  currentTime,
  close,
}: {
  contextClip: TimelineClip
  clips: TimelineClip[]
  hasClipboard: boolean
  currentProjectId: string | null
  updateAsset: (projectId: string, assetId: string, updates: Partial<Asset>) => void
  handleCopy: () => void; handleCut: () => void; handlePaste: () => void
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  duplicateClip: (clipId: string) => void
  splitClipAtPlayhead: (clipId: string, atTime?: number, batchClipIds?: string[]) => void
  removeClip: (clipId: string) => void
  updateClip: (clipId: string, updates: Partial<TimelineClip>) => void
  setClipSpeed: (clipId: string, speed: number, duration?: number) => void
  getLiveAsset: (clip: TimelineClip) => Asset | null | undefined
  getMaxClipDuration: (clip: TimelineClip) => number
  onRevealAsset: (assetId: string) => void
  onReplaceClip: (clipId: string) => void
  currentTime: number
  close: () => void
}) {
  const actions = useEditorActions()
  const liveAsset = getLiveAsset(contextClip)

  const handleFreezeFrame = async () => {
    if (!currentProjectId || !liveAsset?.path) return
    const splitPoint = currentTime - contextClip.startTime
    if (splitPoint <= 0.05 || splitPoint >= contextClip.duration - 0.05) return

    try {
      const seekTime = clipSourceTimeAt(contextClip, splitPoint, liveAsset.duration)
      const extractRes = await window.electronAPI?.extractVideoFrame({
        videoPath: liveAsset.path,
        seekTime,
      })
      if (!extractRes?.path) return

      const addAssetRes = await window.electronAPI?.addVisualAssetToProject({
        srcPath: extractRes.path,
        projectId: currentProjectId,
        type: 'image',
      })
      if (!addAssetRes?.success || !addAssetRes.path) return

      const newAsset: Asset = {
        id: `asset-freeze-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'image',
        path: addAssetRes.path,
        bigThumbnailPath: addAssetRes.bigThumbnailPath,
        smallThumbnailPath: addAssetRes.smallThumbnailPath,
        width: addAssetRes.width,
        height: addAssetRes.height,
        prompt: `Freeze frame of ${contextClip.id}`,
        resolution: addAssetRes.width && addAssetRes.height ? `${addAssetRes.width}x${addAssetRes.height}` : '',
        duration: 2.0,
        createdAt: Date.now(),
      }

      actions.freezeFrame({
        clipId: contextClip.id,
        time: currentTime,
        duration: 2.0,
        imageAsset: newAsset,
      })
    } catch (err) {
      console.error('[FreezeFrame] Failed to freeze frame:', err)
    }
  }

  return (
    <>
      {/* ── 1. Clipboard ── */}
      <MenuItem icon={Scissors} label="Cut" shortcut="Ctrl+X" onClick={() => { handleCut(); close() }} />
      <MenuItem icon={Copy} label="Copy" shortcut="Ctrl+C" onClick={() => { handleCopy(); close() }} />
      <MenuItem icon={Clipboard} label="Paste" shortcut="Ctrl+V" disabled={!hasClipboard} onClick={() => { handlePaste(); close() }} />

      <Divider />

      {/* ── 2. Edit ── */}
      <MenuItem icon={Copy} label="Duplicate" onClick={() => { duplicateClip(contextClip.id); close() }} />
      <MenuItem icon={Scissors} label="Split at Playhead" shortcut="B" onClick={() => { splitClipAtPlayhead(contextClip.id); close() }} />
      {(contextClip.type === 'video' || contextClip.type === 'image') && (
        <MenuItem
          icon={Snowflake}
          label="Freeze Frame"
          disabled={currentTime <= contextClip.startTime + 0.05 || currentTime >= contextClip.startTime + contextClip.duration - 0.05}
          onClick={() => { handleFreezeFrame(); close() }}
        />
      )}
      {isReplaceableClip(contextClip) && (
        <MenuItem
          icon={Replace}
          label="Replace Clip…"
          title="Swap in another video or image, keeping this clip's place, length and effects"
          onClick={() => { onReplaceClip(contextClip.id); close() }}
        />
      )}

      <Divider />

      {/* ── 3. Properties ── */}
      <SectionLabel>Speed</SectionLabel>
      <div className="flex items-center gap-1 px-3 py-1">
        {[0.25, 0.5, 1, 1.5, 2, 4].map(speed => (
          <button
            key={speed}
            onClick={() => {
              const oldSpeed = contextClip.speed || 1
              let newDuration = contextClip.duration * (oldSpeed / speed)
              const maxDur = getMaxClipDuration({ ...contextClip, speed })
              newDuration = Math.min(newDuration, maxDur)
              newDuration = Math.max(0.5, newDuration)
              // setClipSpeed, not updateClip: the shorter or longer clip has to
              // be packed back into V1 or the whole edit is refused.
              setClipSpeed(contextClip.id, speed, newDuration)
              close()
            }}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              contextClip.speed === speed
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white'
            }`}
          >
            {speed}x
          </button>
        ))}
      </div>
      <MenuItem icon={RotateCcw} label="Reverse"
        badge={contextClip.reversed ? 'ON' : undefined} badgeClass="text-blue-400"
        onClick={() => { updateClip(contextClip.id, { reversed: !contextClip.reversed }); close() }} />
      <MenuItem
        icon={contextClip.muted ? VolumeX : Volume2}
        label={contextClip.muted ? 'Unmute' : 'Mute'}
        badge={contextClip.muted ? 'MUTED' : undefined} badgeClass="text-red-400"
        onClick={() => { updateClip(contextClip.id, { muted: !contextClip.muted }); close() }} />

      {(contextClip.type === 'video' || contextClip.type === 'audio') && (() => {
        // Adding a video splits it into a video clip plus a linked audio clip, and
        // the linked clip is the one that actually carries the sound. Edit that,
        // or the change is invisible.
        const audioClip = contextClip.type === 'audio'
          ? contextClip
          : (contextClip.linkedClipIds ?? [])
              .map(id => clips.find(candidate => candidate.id === id))
              .find(candidate => candidate?.type === 'audio') ?? contextClip
        const volume = audioClip.muted ? 0 : (audioClip.volume ?? 1)
        const decibels = volume > 0 ? 20 * Math.log10(volume) : null
        const setVolume = (value: number) => {
          updateClip(audioClip.id, { volume: Math.max(0, Math.min(MAX_CLIP_VOLUME, value)), muted: false })
        }
        return (
          <>
            <SectionLabel>Volume</SectionLabel>
            <div className="px-3 pb-1.5">
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[10px] tabular-nums ${volume > 1 ? 'text-amber-400' : 'text-zinc-400'}`}>
                  {Math.round(volume * 100)}%
                </span>
                <span className="text-[9px] text-zinc-600 tabular-nums">
                  {decibels === null ? '-∞ dB' : `${decibels > 0 ? '+' : ''}${decibels.toFixed(1)} dB`}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={MAX_CLIP_VOLUME}
                step={0.05}
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                onClick={(e) => e.stopPropagation()}
                className={`w-full ${volume > 1 ? 'accent-amber-500' : 'accent-blue-500'}`}
              />
              <div className="flex items-center gap-1 mt-1">
                {[0.5, 1, 1.5, 2, 3, 4].map(preset => (
                  <button
                    key={preset}
                    onClick={() => setVolume(preset)}
                    className={`flex-1 px-1 py-0.5 rounded text-[9px] font-medium transition-colors ${
                      Math.abs(volume - preset) < 0.001
                        ? preset > 1 ? 'bg-amber-600 text-white' : 'bg-blue-600 text-white'
                        : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white'
                    }`}
                  >
                    {preset * 100}%
                  </button>
                ))}
              </div>
            </div>
            <MenuItem
              icon={Music}
              label="Normalize Audio (-14 LUFS)"
              onClick={async () => {
                const live = getLiveAsset(audioClip)
                const filePath = live?.path || audioClip.asset?.path
                if (filePath && window.electronAPI?.measureLoudness) {
                  try {
                    const res = await window.electronAPI.measureLoudness({
                      filePath,
                      startTime: audioClip.trimStart,
                      duration: audioClip.duration * audioClip.speed,
                    })
                    if (res && typeof res.integratedLufs === 'number' && isFinite(res.integratedLufs)) {
                      actions.normalizeClipAudio(audioClip.id, -14, res.integratedLufs)
                    }
                  } catch (err) {
                    console.error('[ClipContextMenu] Loudness measurement failed:', err)
                  }
                }
                close()
              }}
            />
          </>
        )
      })()}

      <Divider />

      {/* ── 4. Transform ── */}
      <MenuItem icon={FlipHorizontal2} label="Flip Horizontal"
        badge={contextClip.flipH ? 'ON' : undefined} badgeClass="text-cyan-400"
        onClick={() => { updateClip(contextClip.id, { flipH: !contextClip.flipH }); close() }} />
      <MenuItem icon={FlipVertical2} label="Flip Vertical"
        badge={contextClip.flipV ? 'ON' : undefined} badgeClass="text-cyan-400"
        onClick={() => { updateClip(contextClip.id, { flipV: !contextClip.flipV }); close() }} />

      <Divider />

      {/* ── 5. Structure (Link / Track) ── */}
      {contextClip.linkedClipIds?.length ? (
        <MenuItem icon={Unlink2} label="Unlink Audio" onClick={() => {
          const allLinked = new Set(contextClip.linkedClipIds!)
          setClips(prev => prev.map(c => {
            if (c.id === contextClip.id) return { ...c, linkedClipIds: undefined }
            if (allLinked.has(c.id)) {
              const remaining = (c.linkedClipIds || []).filter(lid => lid !== contextClip.id)
              return { ...c, linkedClipIds: remaining.length ? remaining : undefined }
            }
            return c
          }))
          close()
        }} />
      ) : null}
      {contextClip.type === 'video' && !contextClip.linkedClipIds?.some(id => clips.find(c => c.id === id)?.type === 'audio') && (
        <MenuItem
          icon={Music}
          label="Extract Audio"
          onClick={() => {
            actions.detachAudio(contextClip.id)
            close()
          }}
        />
      )}
      {!contextClip.linkedClipIds?.length && (contextClip.type === 'video' || contextClip.type === 'audio') && (() => {
        const oppositeType = contextClip.type === 'video' ? 'audio' : 'video'
        const candidates = clips.filter(c =>
          c.type === oppositeType && !c.linkedClipIds?.length &&
          c.assetId === contextClip.assetId && Math.abs(c.startTime - contextClip.startTime) < 0.05
        )
        if (!candidates.length) return null
        return (
          <MenuItem icon={Link2} label="Link Audio" onClick={() => {
            const candidateIds = candidates.map(c => c.id)
            setClips(prev => prev.map(c => {
              if (c.id === contextClip.id) return { ...c, linkedClipIds: candidateIds }
              if (candidateIds.includes(c.id)) return { ...c, linkedClipIds: [contextClip.id] }
              return c
            }))
            close()
          }} />
        )
      })()}

      {/* ── 6. Color Label ── */}
      <Divider />
      <SectionLabel>Label</SectionLabel>
      <div className="px-3 py-1.5 flex items-center gap-1 flex-wrap">
        <button
          onClick={() => {
            if (contextClip.assetId) {
              // Update ALL clips that share this asset
              setClips(prev => prev.map(c => c.assetId === contextClip.assetId ? { ...c, colorLabel: undefined } : c))
              if (currentProjectId) updateAsset(currentProjectId, contextClip.assetId, { colorLabel: undefined })
            } else {
              updateClip(contextClip.id, { colorLabel: undefined })
            }
            close()
          }}
          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${
            !contextClip.colorLabel ? 'border-white scale-110' : 'border-zinc-600 hover:border-zinc-400'
          }`}
          title="No label"
        >
          <X className="h-2 w-2 text-zinc-400" />
        </button>
        {COLOR_LABELS.map(cl => (
          <button
            key={cl.id}
            onClick={() => {
              if (contextClip.assetId) {
                // Update ALL clips that share this asset
                setClips(prev => prev.map(c => c.assetId === contextClip.assetId ? { ...c, colorLabel: cl.id } : c))
                if (currentProjectId) updateAsset(currentProjectId, contextClip.assetId, { colorLabel: cl.id })
              } else {
                updateClip(contextClip.id, { colorLabel: cl.id })
              }
              close()
            }}
            className={`w-4 h-4 rounded-full transition-all ${
              contextClip.colorLabel === cl.id ? 'ring-2 ring-white ring-offset-1 ring-offset-zinc-800 scale-110' : 'hover:scale-125'
            }`}
            style={{ backgroundColor: cl.color }}
            title={cl.label}
          />
        ))}
      </div>

      {/* ── 7. Navigation ── */}
      {(contextClip.assetId || getLiveAsset(contextClip)?.path) && (
        <>
          <Divider />
          {contextClip.assetId && (
            <MenuItem icon={Eye} label="Reveal in Assets" onClick={() => {
              onRevealAsset(contextClip.assetId!)
              close()
            }} />
          )}
          {(() => {
            if (!liveAsset) return null
            const filePath = liveAsset.path
            if (!filePath) return null
            const label = window.electronAPI?.platform === 'darwin' ? 'Reveal in Finder'
              : window.electronAPI?.platform === 'linux' ? 'Show in Files'
              : 'Show in Explorer'
            return <MenuItem icon={FolderOpen} label={label} onClick={() => { window.electronAPI?.showItemInFolder({ filePath }); close() }} />
          })()}
        </>
      )}

      {/* ── 8. Delete (always last, always red) ── */}
      <Divider />
      <MenuItem icon={Trash2} label="Delete" shortcut="Del" danger onClick={() => { removeClip(contextClip.id); close() }} />
    </>
  )
}

/* ──────────────────────────────────────────────
   Multi-Clip Menu
   Layout:
   1. Header           (N clips selected)
   2. Clipboard        (Cut / Copy / Paste)
   3. Properties       (Speed / Mute / Reverse)
   4. Transform        (Flip H / Flip V)
   5. Structure        (Link / Unlink / Move Track)
   6. Delete           (always last, red)
   ────────────────────────────────────────────── */
function MultiClipMenu({
  clips, selectedClipIds, setSelectedClipIds, hasClipboard,
  currentProjectId, updateAsset,
  handleCopy, handleCut, handlePaste, setClips, getMaxClipDuration, close,
  getLiveAsset,
}: {
  clips: TimelineClip[]
  selectedClipIds: Set<string>; setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>
  hasClipboard: boolean
  currentProjectId: string | null
  updateAsset: (projectId: string, assetId: string, updates: Partial<Asset>) => void
  handleCopy: () => void; handleCut: () => void; handlePaste: () => void
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  getMaxClipDuration: (clip: TimelineClip) => number
  close: () => void
  getLiveAsset?: (clip: TimelineClip) => Asset | null | undefined
}) {
  const actions = useEditorActions()
  const n = selectedClipIds.size
  const selectedClips = clips.filter(c => selectedClipIds.has(c.id))
  const allMuted = selectedClips.every(c => c.muted)
  const allReversed = selectedClips.every(c => c.reversed)
  const allFlipH = selectedClips.every(c => c.flipH)
  const allFlipV = selectedClips.every(c => c.flipV)
  const batchUpdate = (updates: Partial<TimelineClip>) => {
    setClips(prev => prev.map(c => selectedClipIds.has(c.id) ? { ...c, ...updates } : c))
    close()
  }

  const anyLinked = selectedClips.some(c => c.linkedClipIds?.length)
  const hasVideoAndAudio = selectedClips.some(c => c.type === 'video') && selectedClips.some(c => c.type === 'audio')
  const allFullyLinked = selectedClips.every(c => {
    const others = [...selectedClipIds].filter(id => id !== c.id)
    return others.every(oid => c.linkedClipIds?.includes(oid))
  })

  return (
    <>
      {/* ── Header ── */}
      <SectionLabel>{n} Clips Selected</SectionLabel>

      {/* ── 1. Clipboard ── */}
      <MenuItem icon={Scissors} label={`Cut ${n} Clips`} shortcut="Ctrl+X" onClick={() => { handleCut(); close() }} />
      <MenuItem icon={Copy} label={`Copy ${n} Clips`} shortcut="Ctrl+C" onClick={() => { handleCopy(); close() }} />
      <MenuItem icon={Clipboard} label="Paste" shortcut="Ctrl+V" disabled={!hasClipboard} onClick={() => { handlePaste(); close() }} />

      <Divider />

      {/* ── 2. Properties ── */}
      <SectionLabel>Speed</SectionLabel>
      <div className="flex items-center gap-1 px-3 py-1">
        {[0.25, 0.5, 1, 1.5, 2, 4].map(speed => (
          <button
            key={speed}
            onClick={() => {
              // One edit for the whole selection: applying it clip by clip
              // would leave a row of undo steps, and each intermediate
              // timeline would be rejected for not being seamless yet.
              actions.setClipsSpeed(selectedClipIds, speed, (c: TimelineClip) => {
                const wanted = c.duration * (c.speed / speed)
                return Math.max(0.5, Math.min(wanted, getMaxClipDuration({ ...c, speed })))
              })
              close()
            }}
            className="px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white"
          >
            {speed}x
          </button>
        ))}
      </div>
      <MenuItem icon={allMuted ? VolumeX : Volume2} label={allMuted ? 'Unmute All' : 'Mute All'}
        badge={allMuted ? 'ALL MUTED' : undefined} badgeClass="text-red-400"
        onClick={() => batchUpdate({ muted: !allMuted })} />
      {selectedClips.some(c => c.type === 'video' || c.type === 'audio') && (
        <div className="px-3 pb-1.5 pt-0.5">
          <div className="text-[9px] text-zinc-500 mb-1">Set volume for all</div>
          <div className="flex items-center gap-1">
            {[0.5, 1, 1.5, 2, 3, 4].map(preset => (
              <button
                key={preset}
                onClick={() => {
                  const targets = new Set<string>()
                  for (const c of selectedClips) {
                    if (c.type === 'audio') { targets.add(c.id); continue }
                    if (c.type !== 'video') continue
                    const linked = (c.linkedClipIds ?? [])
                      .map(id => clips.find(candidate => candidate.id === id))
                      .find(candidate => candidate?.type === 'audio')
                    targets.add(linked?.id ?? c.id)
                  }
                  setClips(prev => prev.map(c => (
                    targets.has(c.id) ? { ...c, volume: preset, muted: false } : c
                  )))
                  close()
                }}
                className={`flex-1 px-1 py-0.5 rounded text-[9px] font-medium transition-colors ${
                  preset > 1
                    ? 'bg-zinc-700 text-amber-300 hover:bg-amber-700 hover:text-white'
                    : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600 hover:text-white'
                }`}
              >
                {preset * 100}%
              </button>
            ))}
          </div>
          <button
            onClick={async () => {
              const targets = new Set<string>()
              for (const c of selectedClips) {
                if (c.type === 'audio') { targets.add(c.id); continue }
                if (c.type !== 'video') continue
                const linked = (c.linkedClipIds ?? [])
                  .map(id => clips.find(candidate => candidate.id === id))
                  .find(candidate => candidate?.type === 'audio')
                targets.add(linked?.id ?? c.id)
              }
              for (const targetId of targets) {
                const clip = clips.find(c => c.id === targetId)
                if (!clip) continue
                const live = getLiveAsset ? getLiveAsset(clip) : undefined
                const filePath = live?.path || clip.asset?.path
                if (filePath && window.electronAPI?.measureLoudness) {
                  try {
                    const res = await window.electronAPI.measureLoudness({
                      filePath,
                      startTime: clip.trimStart,
                      duration: clip.duration * clip.speed,
                    })
                    if (res && typeof res.integratedLufs === 'number' && isFinite(res.integratedLufs)) {
                      actions.normalizeClipAudio(clip.id, -14, res.integratedLufs)
                    }
                  } catch (err) {
                    console.error('[ClipContextMenu] Loudness measurement failed:', err)
                  }
                }
              }
              close()
            }}
            className="w-full mt-1.5 py-1 px-2 rounded bg-zinc-700/60 hover:bg-zinc-700 text-[10px] text-zinc-300 flex items-center justify-center gap-1.5 transition-colors"
          >
            <Music className="w-3 h-3 text-cyan-400" />
            <span>Normalize Audio (-14 LUFS)</span>
          </button>
        </div>
      )}
      <MenuItem icon={RotateCcw} label={allReversed ? 'Un-reverse All' : 'Reverse All'}
        badge={allReversed ? 'ALL ON' : undefined} badgeClass="text-blue-400"
        onClick={() => batchUpdate({ reversed: !allReversed })} />

      <Divider />

      {/* ── 3. Transform ── */}
      <MenuItem icon={FlipHorizontal2} label={allFlipH ? 'Un-flip All Horizontal' : 'Flip All Horizontal'}
        badge={allFlipH ? 'ALL ON' : undefined} badgeClass="text-cyan-400"
        onClick={() => batchUpdate({ flipH: !allFlipH })} />
      <MenuItem icon={FlipVertical2} label={allFlipV ? 'Un-flip All Vertical' : 'Flip All Vertical'}
        badge={allFlipV ? 'ALL ON' : undefined} badgeClass="text-cyan-400"
        onClick={() => batchUpdate({ flipV: !allFlipV })} />

      <Divider />

      {/* ── 4. Structure ── */}
      {anyLinked && (
        <MenuItem icon={Unlink2} label="Unlink" onClick={() => {
          const selIds = new Set(selectedClipIds)
          setClips(prev => prev.map(c => {
            if (!selIds.has(c.id)) return c
            const remaining = (c.linkedClipIds || []).filter(lid => !selIds.has(lid))
            return { ...c, linkedClipIds: remaining.length ? remaining : undefined }
          }))
          close()
        }} />
      )}
      {hasVideoAndAudio && !allFullyLinked && (
        <MenuItem icon={Link2} label="Link" onClick={() => {
          const selIds = [...selectedClipIds]
          setClips(prev => prev.map(c => {
            if (!selectedClipIds.has(c.id)) return c
            const otherIds = selIds.filter(id => id !== c.id)
            const existingLinks = new Set(c.linkedClipIds || [])
            otherIds.forEach(id => existingLinks.add(id))
            return { ...c, linkedClipIds: [...existingLinks] }
          }))
          close()
        }} />
      )}
      {selectedClips.some(c => c.type === 'video' && !c.linkedClipIds?.some(id => clips.find(x => x.id === id)?.type === 'audio')) && (
        <MenuItem
          icon={Music}
          label="Extract Audio"
          onClick={() => {
            for (const c of selectedClips) {
              if (c.type === 'video' && !c.linkedClipIds?.some(id => clips.find(x => x.id === id)?.type === 'audio')) {
                actions.detachAudio(c.id)
              }
            }
            close()
          }}
        />
      )}

      {/* ── 5. Color Label ── */}
      <Divider />
      <SectionLabel>Label</SectionLabel>
      <div className="px-3 py-1.5 flex items-center gap-1 flex-wrap">
        <button
          onClick={() => {
            const affectedAssetIds = new Set(selectedClips.map(c => c.assetId).filter(Boolean) as string[])
            // Update selected clips AND all other clips sharing the same assets
            setClips(prev => prev.map(c => {
              if (selectedClipIds.has(c.id) || (c.assetId && affectedAssetIds.has(c.assetId))) {
                return { ...c, colorLabel: undefined }
              }
              return c
            }))
            if (currentProjectId) {
              affectedAssetIds.forEach(id => updateAsset(currentProjectId!, id, { colorLabel: undefined }))
            }
            close()
          }}
          className="w-4 h-4 rounded-full border-2 border-zinc-600 hover:border-zinc-400 flex items-center justify-center transition-all"
          title="No label"
        >
          <X className="h-2 w-2 text-zinc-400" />
        </button>
        {COLOR_LABELS.map(cl => (
          <button
            key={cl.id}
            onClick={() => {
              const affectedAssetIds = new Set(selectedClips.map(c => c.assetId).filter(Boolean) as string[])
              // Update selected clips AND all other clips sharing the same assets
              setClips(prev => prev.map(c => {
                if (selectedClipIds.has(c.id) || (c.assetId && affectedAssetIds.has(c.assetId))) {
                  return { ...c, colorLabel: cl.id }
                }
                return c
              }))
              if (currentProjectId) {
                affectedAssetIds.forEach(id => updateAsset(currentProjectId!, id, { colorLabel: cl.id }))
              }
              close()
            }}
            className="w-4 h-4 rounded-full hover:scale-125 transition-all"
            style={{ backgroundColor: cl.color }}
            title={cl.label}
          />
        ))}
      </div>

      {/* ── 6. Delete ── */}
      <Divider />
      <MenuItem icon={Trash2} label={`Delete ${n} Clips`} shortcut="Del" danger onClick={() => {
        setClips(prev => prev.filter(c => !selectedClipIds.has(c.id)).map(c => {
          if (!c.linkedClipIds) return c
          const remaining = c.linkedClipIds.filter(lid => !selectedClipIds.has(lid))
          return { ...c, linkedClipIds: remaining.length ? remaining : undefined }
        }))
        setSelectedClipIds(new Set())
        close()
      }} />
    </>
  )
}
