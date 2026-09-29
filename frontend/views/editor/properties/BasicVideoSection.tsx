import { useState } from 'react'
import {
  FlipHorizontal2,
  FlipVertical2,
  ChevronDown,
  ChevronRight,
  RotateCcw,
} from 'lucide-react'
import type { TimelineClip } from '../../../types/project-model'
import { DEFAULT_CLIP_TRANSFORM } from '../../../types/project-model'
import { BLEND_MODES, type ClipBlendMode } from '@core/blend-modes'
import { useTranslation } from '../../../i18n/I18nContext'
import { useEditorActions } from '../editor-store'
import { KeyframeDiamondButton } from '../KeyframeDiamondButton'
import { hasKeyframesForProperty } from '@core/keyframes'
import {
  PropertyNumberInput,
  PropertyToggle,
  PropertyAlignmentBar,
  PropertyRotateDial,
} from '../PropertyControls'
import { isTimelineShapeClip } from '../timeline-shape-utils'
import { ShapePropertiesSection } from './ShapePropertiesSection'

import type { SampledClipProperties } from '@core/keyframes'

interface BasicVideoSectionProps {
  selectedClip: TimelineClip
  sampledClip?: SampledClipProperties | null
  timeInClip: number
  hasVisualTransformControls: boolean
}

export function BasicVideoSection({
  selectedClip,
  sampledClip,
  timeInClip,
  hasVisualTransformControls,
}: BasicVideoSectionProps) {
  const { t } = useTranslation()
  const {
    updateClip,
    setKeyframe,
    setClipBlendMode,
  } = useEditorActions()

  const [uniformScale, setUniformScale] = useState(true)
  const [showBlend, setShowBlend] = useState(true)
  const [showTransform, setShowTransform] = useState(true)

  const tf = selectedClip.transform ?? DEFAULT_CLIP_TRANSFORM
  const setTransform = (patch: Partial<typeof tf>) =>
    updateClip(selectedClip.id, { transform: { ...tf, ...patch } })
  const isDefault = (Object.keys(DEFAULT_CLIP_TRANSFORM) as Array<keyof typeof tf>)
    .every(key => tf[key] === DEFAULT_CLIP_TRANSFORM[key])

  const hasScaleKf = hasKeyframesForProperty(selectedClip, 'transform.scale')
  const currentScale = hasScaleKf && sampledClip ? (sampledClip.scale ?? tf.scale) : tf.scale

  const hasPosXKf = hasKeyframesForProperty(selectedClip, 'transform.positionX')
  const currentPosX = hasPosXKf && sampledClip ? (sampledClip.positionX ?? tf.positionX) : tf.positionX

  const hasPosYKf = hasKeyframesForProperty(selectedClip, 'transform.positionY')
  const currentPosY = hasPosYKf && sampledClip ? (sampledClip.positionY ?? tf.positionY) : tf.positionY

  const hasRotKf = hasKeyframesForProperty(selectedClip, 'transform.rotation')
  const currentRot = hasRotKf && sampledClip ? (sampledClip.rotation ?? tf.rotation) : tf.rotation

  const hasOpacityKf = hasKeyframesForProperty(selectedClip, 'opacity')
  const currentOpacity = hasOpacityKf && sampledClip ? (sampledClip.opacity ?? (selectedClip.opacity ?? 100)) : (selectedClip.opacity ?? 100)

  const isShape = isTimelineShapeClip(selectedClip)

  return (
    <div className="space-y-4">
      {/* Shape Properties */}
      {isShape && (
        <ShapePropertiesSection selectedClip={selectedClip} />
      )}

      {/* Transform */}
      {hasVisualTransformControls && (
        <div className="space-y-2">
          {/* Section Header */}
          <div className="flex items-center justify-between h-6">
            <span className="text-xs font-semibold text-zinc-200">Transform</span>
            <div className="flex items-center gap-1.5">
              {!isDefault && (
                <button
                  type="button"
                  onClick={() => updateClip(selectedClip.id, { transform: { ...DEFAULT_CLIP_TRANSFORM } })}
                  className="text-zinc-400 hover:text-cyan-400 transition-colors p-0.5"
                  title="Reset Transform"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
              <KeyframeDiamondButton
                clip={selectedClip}
                property="transform.scale"
                currentValue={currentScale}
              />
            </div>
          </div>

          {/* 1. Scale Row */}
          <div className="flex items-center justify-between gap-2 h-7">
            <span className="text-xs text-zinc-300 w-14 flex-shrink-0">Scale</span>
            <input
              type="range"
              min={1}
              max={400}
              step={1}
              value={currentScale}
              onChange={(e) => {
                const val = parseFloat(e.target.value)
                if (hasScaleKf) {
                  setKeyframe(selectedClip.id, 'transform.scale', timeInClip, val)
                }
                setTransform({ scale: val })
              }}
              className="flex-1 h-1 accent-cyan-400 cursor-pointer min-w-0"
            />
            <PropertyNumberInput
              value={currentScale}
              min={1}
              max={400}
              step={1}
              suffix="%"
              className="w-16 flex-shrink-0"
              onChange={(val) => {
                if (hasScaleKf) {
                  setKeyframe(selectedClip.id, 'transform.scale', timeInClip, val)
                }
                setTransform({ scale: val })
              }}
            />
            <KeyframeDiamondButton
              clip={selectedClip}
              property="transform.scale"
              currentValue={currentScale}
              className="flex-shrink-0"
            />
          </div>

          {/* 2. Uniform scale Row */}
          <div className="flex items-center justify-between h-6">
            <span className="text-xs text-zinc-300">Uniform scale</span>
            <PropertyToggle
              checked={uniformScale}
              onChange={setUniformScale}
            />
          </div>

          {/* 3. Position Row */}
          <div className="flex items-center justify-between gap-2 h-7">
            <span className="text-xs text-zinc-300 w-14 flex-shrink-0">Position</span>
            <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
              <PropertyNumberInput
                prefix="X"
                value={Math.round(currentPosX)}
                min={-1920}
                max={1920}
                step={1}
                className="flex-1 max-w-[76px]"
                onChange={(val) => {
                  if (hasPosXKf) {
                    setKeyframe(selectedClip.id, 'transform.positionX', timeInClip, val)
                  }
                  setTransform({ positionX: val })
                }}
              />
              <PropertyNumberInput
                prefix="Y"
                value={Math.round(currentPosY)}
                min={-1080}
                max={1080}
                step={1}
                className="flex-1 max-w-[76px]"
                onChange={(val) => {
                  if (hasPosYKf) {
                    setKeyframe(selectedClip.id, 'transform.positionY', timeInClip, val)
                  }
                  setTransform({ positionY: val })
                }}
              />
            </div>
            <KeyframeDiamondButton
              clip={selectedClip}
              property="transform.positionX"
              currentValue={currentPosX}
              className="flex-shrink-0"
            />
          </div>

          {/* 4. Rotate Row */}
          <div className="flex items-center justify-between gap-2 h-7">
            <span className="text-xs text-zinc-300 w-14 flex-shrink-0">Rotate</span>
            <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
              <PropertyNumberInput
                value={currentRot}
                min={-360}
                max={360}
                step={1}
                precision={2}
                suffix="°"
                className="w-20"
                onChange={(val) => {
                  if (hasRotKf) setKeyframe(selectedClip.id, 'transform.rotation', timeInClip, val)
                  setTransform({ rotation: val })
                }}
              />
              <PropertyRotateDial
                rotation={currentRot}
                onReset={() => {
                  if (hasRotKf) setKeyframe(selectedClip.id, 'transform.rotation', timeInClip, 0)
                  setTransform({ rotation: 0 })
                }}
              />
            </div>
            <KeyframeDiamondButton
              clip={selectedClip}
              property="transform.rotation"
              currentValue={currentRot}
              className="flex-shrink-0"
            />
          </div>

          {/* Alignment Toolbar */}
          <div className="pt-1">
            <PropertyAlignmentBar
              onAlignLeft={() => {
                const newX = -(50 - 50 * (tf.scale / 100))
                if (hasPosXKf) setKeyframe(selectedClip.id, 'transform.positionX', timeInClip, newX)
                setTransform({ positionX: newX })
              }}
              onAlignCenterH={() => {
                if (hasPosXKf) setKeyframe(selectedClip.id, 'transform.positionX', timeInClip, 0)
                setTransform({ positionX: 0 })
              }}
              onAlignRight={() => {
                const newX = (50 - 50 * (tf.scale / 100))
                if (hasPosXKf) setKeyframe(selectedClip.id, 'transform.positionX', timeInClip, newX)
                setTransform({ positionX: newX })
              }}
              onAlignTop={() => {
                const newY = -(50 - 50 * (tf.scale / 100))
                if (hasPosYKf) setKeyframe(selectedClip.id, 'transform.positionY', timeInClip, newY)
                setTransform({ positionY: newY })
              }}
              onAlignCenterV={() => {
                if (hasPosYKf) setKeyframe(selectedClip.id, 'transform.positionY', timeInClip, 0)
                setTransform({ positionY: 0 })
              }}
              onAlignBottom={() => {
                const newY = (50 - 50 * (tf.scale / 100))
                if (hasPosYKf) setKeyframe(selectedClip.id, 'transform.positionY', timeInClip, newY)
                setTransform({ positionY: newY })
              }}
            />
          </div>

          {/* Flip & Crop */}
          <div className="pt-2 border-t border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">Flip</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => updateClip(selectedClip.id, { flipH: !selectedClip.flipH })}
                  className={`p-1.5 rounded text-xs border transition-colors ${
                    selectedClip.flipH
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700/60 hover:text-white'
                  }`}
                  title="Flip Horizontal"
                >
                  <FlipHorizontal2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => updateClip(selectedClip.id, { flipV: !selectedClip.flipV })}
                  className={`p-1.5 rounded text-xs border transition-colors ${
                    selectedClip.flipV
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700/60 hover:text-white'
                  }`}
                  title="Flip Vertical"
                >
                  <FlipVertical2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Crop Collapsible */}
            <div>
              <button
                type="button"
                onClick={() => setShowTransform(!showTransform)}
                className="flex items-center justify-between w-full py-1 text-xs text-zinc-400 hover:text-zinc-200"
              >
                <span>Crop Edges</span>
                {showTransform ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
              {showTransform && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <PropertyNumberInput
                    prefix="Top"
                    value={tf.cropTop || 0}
                    min={0}
                    max={90}
                    suffix="%"
                    onChange={(v) => setTransform({ cropTop: v })}
                  />
                  <PropertyNumberInput
                    prefix="Bottom"
                    value={tf.cropBottom || 0}
                    min={0}
                    max={90}
                    suffix="%"
                    onChange={(v) => setTransform({ cropBottom: v })}
                  />
                  <PropertyNumberInput
                    prefix="Left"
                    value={tf.cropLeft || 0}
                    min={0}
                    max={90}
                    suffix="%"
                    onChange={(v) => setTransform({ cropLeft: v })}
                  />
                  <PropertyNumberInput
                    prefix="Right"
                    value={tf.cropRight || 0}
                    min={0}
                    max={90}
                    suffix="%"
                    onChange={(v) => setTransform({ cropRight: v })}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Blend */}
      <div className="pt-2 border-t border-zinc-800/80 space-y-2">
        <div className="flex items-center justify-between h-6">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="blend-toggle"
              checked={showBlend}
              onChange={(e) => setShowBlend(e.target.checked)}
              className="rounded bg-zinc-800 border-zinc-700 accent-cyan-400"
            />
            <label htmlFor="blend-toggle" className="text-xs font-semibold text-zinc-300 cursor-pointer flex items-center gap-1">
              Blend
              <ChevronDown className="w-3 h-3 text-zinc-400" />
            </label>
          </div>
          <div className="flex items-center gap-1.5">
            {selectedClip.blendMode && selectedClip.blendMode !== 'normal' && (
              <button
                type="button"
                onClick={() => setClipBlendMode(selectedClip.id, 'normal')}
                className="text-zinc-400 hover:text-cyan-400 transition-colors p-0.5"
                title="Reset Blend Mode"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
            <KeyframeDiamondButton
              clip={selectedClip}
              property="opacity"
              currentValue={currentOpacity}
            />
          </div>
        </div>

        {showBlend && (
          <div className="space-y-1.5 pl-0.5">
            {/* Opacity Row */}
            <div className="flex items-center justify-between gap-2 h-7">
              <span className="text-xs text-zinc-300 w-14 flex-shrink-0">Opacity</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={currentOpacity}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (hasOpacityKf) {
                    setKeyframe(selectedClip.id, 'opacity', timeInClip, val)
                  }
                  updateClip(selectedClip.id, { opacity: val })
                }}
                className="flex-1 h-1 accent-cyan-400 cursor-pointer min-w-0"
              />
              <PropertyNumberInput
                value={Math.round(currentOpacity)}
                min={0}
                max={100}
                step={1}
                suffix="%"
                className="w-16 flex-shrink-0"
                onChange={(val) => {
                  if (hasOpacityKf) {
                    setKeyframe(selectedClip.id, 'opacity', timeInClip, val)
                  }
                  updateClip(selectedClip.id, { opacity: val })
                }}
              />
              <KeyframeDiamondButton
                clip={selectedClip}
                property="opacity"
                currentValue={currentOpacity}
                className="flex-shrink-0"
              />
            </div>

            {/* Mode Row */}
            <div className="flex items-center justify-between gap-2 h-7">
              <span className="text-xs text-zinc-300 w-14 flex-shrink-0">Mode</span>
              <select
                value={selectedClip.blendMode ?? 'normal'}
                onChange={(e) => setClipBlendMode(selectedClip.id, e.target.value as ClipBlendMode)}
                className="flex-1 bg-[#19191c] hover:bg-[#232327] border border-zinc-800 hover:border-zinc-700 rounded h-6 px-2 text-[11px] text-zinc-200 focus:outline-none focus:border-cyan-400 transition-colors"
              >
                {BLEND_MODES.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {t(`clipProperties.blendModes.${mode.id}`) || mode.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
