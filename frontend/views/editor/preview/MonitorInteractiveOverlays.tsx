import React from 'react'
import type { TimelineClip, Asset, ClipTransform, ClipMask } from '../../../types/project-model'
import { TextBoundingBox } from './TextBoundingBox'
import { TransformBoundingBox } from './TransformBoundingBox'
import { MaskBoundingBox } from './MaskBoundingBox'
import { BrushOverlay } from './BrushOverlay'
import { MonitorSafeZoneGuide } from './MonitorSafeZoneGuide'

export interface MonitorInteractiveOverlaysProps {
  activeTextClips: TimelineClip[]
  selectedClipIds: Set<string>
  currentTime: number
  isPlaying: boolean
  playbackTimeRef: React.MutableRefObject<number>
  frameElement: HTMLDivElement | null
  selectedClip: TimelineClip | null
  assets: Asset[]
  videoFrameSize: { width: number; height: number }
  cropMode: boolean
  maskMode: boolean
  showSafeZoneGuide: boolean
  activeImageEl: HTMLImageElement | null
  videoPoolRef: React.MutableRefObject<Map<string, HTMLVideoElement>>
  activePoolPathRef: React.MutableRefObject<string>
  onSelectClip: (clipId: string) => void
  onShowPropertiesPanel: () => void
  onUpdateTextPosition: (clipId: string, posX: number, posY: number) => void
  onUpdateTextFontSize: (clipId: string, fontSize: number) => void
  onUpdateTextMaxWidth: (clipId: string, maxWidth: number) => void
  onUpdateTextRotation: (clipId: string, rotation: number) => void
  onDeleteClips: (clipIds: string[]) => void
  onClickedTextOverlay: (flag: boolean) => void
  onTransformInteractionStart: () => void
  onTransformInteractionEnd: (moved: boolean) => void
  onToggleCropMode: () => void
  onUpdateTransform: (patch: Partial<ClipTransform>, options?: { recordKeyframeAt?: number }) => void
  onPreviewTransform: (transform: ClipTransform | null) => void
  onUpdateMask: (patch: Partial<ClipMask>) => void
}

export const MonitorInteractiveOverlays: React.FC<MonitorInteractiveOverlaysProps> = ({
  activeTextClips,
  selectedClipIds,
  currentTime,
  isPlaying,
  playbackTimeRef,
  frameElement,
  selectedClip,
  assets,
  videoFrameSize,
  cropMode,
  maskMode,
  showSafeZoneGuide,
  activeImageEl,
  videoPoolRef,
  activePoolPathRef,
  onSelectClip,
  onShowPropertiesPanel,
  onUpdateTextPosition,
  onUpdateTextFontSize,
  onUpdateTextMaxWidth,
  onUpdateTextRotation,
  onDeleteClips,
  onClickedTextOverlay,
  onTransformInteractionStart,
  onTransformInteractionEnd,
  onToggleCropMode,
  onUpdateTransform,
  onPreviewTransform,
  onUpdateMask,
}) => {
  return (
    <>
      {/* Text overlay clips with bounding box & resize/scale/width/rotate handles */}
      {activeTextClips.map(tc => {
        const isSelected = selectedClipIds.has(tc.id)
        return (
          <TextBoundingBox
            key={`text-${tc.id}`}
            clip={tc}
            isSelected={isSelected}
            currentTime={currentTime}
            isPlaying={isPlaying}
            playbackTimeRef={playbackTimeRef}
            frameElement={frameElement}
            onSelect={() => {
              onClickedTextOverlay(true)
              onSelectClip(tc.id)
            }}
            onDoubleClick={() => {
              onSelectClip(tc.id)
              onShowPropertiesPanel()
            }}
            onUpdatePosition={(posX, posY) => {
              onUpdateTextPosition(tc.id, posX, posY)
            }}
            onUpdateFontSize={(fontSize) => {
              onUpdateTextFontSize(tc.id, fontSize)
            }}
            onUpdateMaxWidth={(maxWidth) => {
              onUpdateTextMaxWidth(tc.id, maxWidth)
            }}
            onUpdateRotation={(rotation) => {
              onUpdateTextRotation(tc.id, rotation)
            }}
            onDelete={() => {
              onDeleteClips([tc.id])
            }}
            onInteractionStart={() => {
              onClickedTextOverlay(true)
            }}
            onInteractionEnd={() => {
              requestAnimationFrame(() => {
                onClickedTextOverlay(false)
              })
            }}
          />
        )
      })}

      {/* Transform Bounding Box for active selected visual clip */}
      <TransformBoundingBox
        selectedClip={selectedClip}
        onInteractionStart={onTransformInteractionStart}
        onInteractionEnd={onTransformInteractionEnd}
        assets={assets}
        videoFrameSize={videoFrameSize}
        currentTime={currentTime}
        cropMode={cropMode}
        onToggleCropMode={onToggleCropMode}
        onUpdateTransform={onUpdateTransform}
        onPreviewTransform={onPreviewTransform}
      />

      {/* Mask Bounding Box for on-screen mask editing */}
      <MaskBoundingBox
        selectedClip={selectedClip}
        assets={assets}
        videoFrameSize={videoFrameSize}
        currentTime={currentTime}
        maskMode={maskMode}
        onUpdateMask={onUpdateMask}
      />

      {/* Painting for Custom removal: only present while a brush tool is picked */}
      <BrushOverlay
        selectedClip={selectedClip}
        videoFrameSize={videoFrameSize}
        sourceElement={
          selectedClip?.asset?.type === 'video'
            ? videoPoolRef.current.get(activePoolPathRef.current) ?? null
            : selectedClip?.asset?.type === 'image'
              ? activeImageEl
              : null
        }
      />

      {/* Safe Zone Guide overlay for 9:16 Shorts/Reels */}
      <MonitorSafeZoneGuide show={Boolean(showSafeZoneGuide)} />
    </>
  )
}
