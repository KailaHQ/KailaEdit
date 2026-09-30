import React from 'react'
import type { TimelineClip } from '@core/project-model'
import { AutoRemovalCard } from './AutoRemovalCard'
import { CustomRemovalCard } from './CustomRemovalCard'
import { StrokePicker } from './StrokePicker'
import { ChromaKeyCard } from './ChromaKeyCard'

export interface RemoveBgTabProps {
  clip: TimelineClip
}

export const RemoveBgTab: React.FC<RemoveBgTabProps> = ({ clip }) => {
  // If clip is audio only, do not render Remove BG controls
  if (clip.type === 'audio') {
    return null
  }

  // Stroke outlines the subject that background removal cut out, so it only means
  // anything while that is on, where Stroke lives inside Auto removal.
  // Chroma key is a separate way of getting transparency and does not carry a stroke yet;
  // see the debt note in KE-1404.
  const isAutoRemovalEnabled = Boolean(clip.autoMatte?.enabled)

  return (
    <div className="space-y-4">
      {/* 1. Auto removal card */}
      <AutoRemovalCard clip={clip} />

      {/* 2. Stroke picker — only appears when Auto removal is enabled */}
      {isAutoRemovalEnabled && <StrokePicker clip={clip} />}

      {/* 3. Custom removal card (KE-1409) */}
      <CustomRemovalCard clip={clip} />

      {/* 4. Chroma key card */}
      <ChromaKeyCard clip={clip} />
    </div>
  )
}
