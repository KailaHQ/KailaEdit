import React from 'react'
import { Image as ImageIcon } from 'lucide-react'
import type {
  CoverElement,
  TextCoverElement,
  ImageCoverElement,
  ShapeCoverElement,
} from './types'
import { ShapeSvgRenderer } from './cover-shapes'
import { CoverTransformBox } from './CoverTransformBox'
import { isCoverBackground } from './cover-to-overlay'

export interface CoverCanvasStageProps {
  containerRef: React.RefObject<HTMLDivElement>
  renderedCanvasWidth: number
  renderedCanvasHeight: number
  zoom: number
  elements: CoverElement[]
  selectedElement: CoverElement | null
  selectedElementId: string | null
  inlineEditingId: string | null
  marquee: { left: number; top: number; width: number; height: number } | null
  copyNotice: string | null
  multiSelectedIds: string[]
  frameMouseDownTargetRef: React.MutableRefObject<EventTarget | null>
  onSelectElementId: (id: string | null) => void
  onSetInlineEditingId: (id: string | null) => void
  onSetMultiSelectedIds: (ids: string[]) => void
  onStartMarquee: (e: React.MouseEvent) => void
  onStartMoveElement: (e: React.MouseEvent, el: CoverElement) => void
  onUpdateElement: (id: string, updates: Partial<CoverElement>) => void
  onStartTransform: () => void
  onCommitTransform: () => void
  onDuplicateElement: () => void
  onDeleteElement: () => void
  onLockToggle: () => void
  onBringForward: () => void
  onSendBackward: () => void
  onBringToFront: () => void
  onSendToBack: () => void
}

export const CoverCanvasStage: React.FC<CoverCanvasStageProps> = ({
  containerRef,
  renderedCanvasWidth,
  renderedCanvasHeight,
  zoom,
  elements,
  selectedElement,
  selectedElementId,
  inlineEditingId,
  marquee,
  copyNotice,
  multiSelectedIds,
  frameMouseDownTargetRef,
  onSelectElementId,
  onSetInlineEditingId,
  onSetMultiSelectedIds,
  onStartMarquee,
  onStartMoveElement,
  onUpdateElement,
  onStartTransform,
  onCommitTransform,
  onDuplicateElement,
  onDeleteElement,
  onLockToggle,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
}) => {
  const multiSelectOutline = (id: string): React.CSSProperties => {
    if (!multiSelectedIds.includes(id)) return {}
    return {
      outline: '1.5px dashed #38bdf8',
      outlineOffset: '2px',
    }
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center relative overflow-auto p-16 select-none"
      onMouseDown={e => {
        if (e.target === containerRef.current) {
          onSelectElementId(null)
          onSetMultiSelectedIds([])
          onStartMarquee(e)
        }
      }}
      onClick={e => {
        if (e.target === containerRef.current) onSelectElementId(null)
      }}
    >
      {/* Outer Artboard Wrapper */}
      <div
        className="relative select-none flex-shrink-0"
        style={{
          width: `${renderedCanvasWidth}px`,
          height: `${renderedCanvasHeight}px`,
        }}
      >
        {/* Interactive Cover Canvas Frame (Clipped) */}
        <div
          className="absolute inset-0 rounded-lg overflow-hidden bg-black border border-zinc-800 shadow-2xl transition-all"
          onMouseDown={e => {
            frameMouseDownTargetRef.current = e.target
            if (e.target === e.currentTarget) {
              onSelectElementId(null)
              onSetInlineEditingId(null)
              onSetMultiSelectedIds([])
              onStartMarquee(e)
            }
          }}
          onClick={e => {
            if (e.target === e.currentTarget && frameMouseDownTargetRef.current === e.currentTarget) {
              onSelectElementId(null)
              onSetInlineEditingId(null)
            }
            frameMouseDownTargetRef.current = null
          }}
        >
          {/* Render sorted elements */}
          {elements
            .filter(el => el.visible !== false)
            .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
            .map(el => {
              const pxX = (el.x / 100) * renderedCanvasWidth
              const pxY = (el.y / 100) * renderedCanvasHeight
              const pxW = (el.width / 100) * renderedCanvasWidth
              const pxH = (el.height / 100) * renderedCanvasHeight

              if (el.type === 'image' || el.type === 'background') {
                const imgEl = el as ImageCoverElement
                const crop = imgEl.crop || { x: 0, y: 0, width: 100, height: 100 }
                const cropW = Math.max(1, crop.width || 100)
                const cropH = Math.max(1, crop.height || 100)
                const cropX = crop.x || 0
                const cropY = crop.y || 0

                const innerW = (100 / cropW) * 100
                const innerH = (100 / cropH) * 100
                const innerLeft = -(cropX / cropW) * 100
                const innerTop = -(cropY / cropH) * 100

                return (
                  <div
                    key={el.id}
                    id={`cover-el-${el.id}`}
                    onMouseDown={e => {
                      e.stopPropagation()
                      if (isCoverBackground(el) && selectedElementId !== el.id) {
                        onSetMultiSelectedIds([])
                        onStartMarquee(e)
                        return
                      }
                      onStartMoveElement(e, el)
                    }}
                    onClick={e => {
                      e.stopPropagation()
                      onSelectElementId(el.id)
                    }}
                    className="absolute cursor-move transition-opacity select-none"
                    style={{
                      left: `${pxX}px`,
                      top: `${pxY}px`,
                      width: `${pxW}px`,
                      height: `${pxH}px`,
                      transform: `translate(-50%, -50%) rotate(${el.rotation || 0}deg)`,
                      zIndex: el.zIndex,
                      opacity: el.opacity ?? 1,
                      overflow: 'hidden',
                      ...multiSelectOutline(el.id),
                      borderRadius: imgEl.borderRadius ? `${imgEl.borderRadius}px` : undefined,
                    }}
                  >
                    <div className="relative w-full h-full overflow-hidden">
                      {imgEl.src ? (
                        <img
                          src={imgEl.src}
                          alt={imgEl.name || 'Image'}
                          className="absolute select-none pointer-events-none max-w-none"
                          style={{
                            width: `${innerW}%`,
                            height: `${innerH}%`,
                            left: `${innerLeft}%`,
                            top: `${innerTop}%`,
                            transform: `scale(${imgEl.flipH ? -1 : 1}, ${imgEl.flipV ? -1 : 1})`,
                            filter: imgEl.filters
                              ? `brightness(${imgEl.filters.brightness}%) contrast(${imgEl.filters.contrast}%) saturate(${imgEl.filters.saturation}%) blur(${imgEl.filters.blur}px)`
                              : undefined,
                          }}
                        />
                      ) : (
                        <div className="w-full h-full bg-zinc-950 flex items-center justify-center">
                          <ImageIcon className="h-12 w-12 text-zinc-700" />
                        </div>
                      )}
                    </div>
                  </div>
                )
              }

              if (el.type === 'shape') {
                const sEl = el as ShapeCoverElement
                return (
                  <div
                    key={el.id}
                    id={`cover-el-${el.id}`}
                    onMouseDown={e => {
                      e.stopPropagation()
                      onStartMoveElement(e, el)
                    }}
                    onClick={e => {
                      e.stopPropagation()
                      onSelectElementId(el.id)
                    }}
                    className="absolute cursor-move transition-opacity select-none"
                    style={{
                      left: `${pxX}px`,
                      top: `${pxY}px`,
                      width: `${pxW}px`,
                      height: `${pxH}px`,
                      transform: `translate(-50%, -50%) rotate(${el.rotation || 0}deg)`,
                      zIndex: el.zIndex,
                      opacity: el.opacity ?? 1,
                      overflow: 'visible',
                      ...multiSelectOutline(el.id),
                    }}
                  >
                    <ShapeSvgRenderer shape={sEl} widthPx={pxW} heightPx={pxH} />
                  </div>
                )
              }

              if (el.type === 'text') {
                const tEl = el as TextCoverElement
                const isInline = inlineEditingId === el.id

                return (
                  <div
                    key={el.id}
                    id={`cover-el-${el.id}`}
                    onMouseDown={e => {
                      e.stopPropagation()
                      if (!isInline) {
                        onStartMoveElement(e, el)
                      }
                    }}
                    onClick={e => {
                      e.stopPropagation()
                      onSelectElementId(el.id)
                    }}
                    onDoubleClick={e => {
                      e.stopPropagation()
                      onSelectElementId(el.id)
                      onSetInlineEditingId(el.id)
                    }}
                    className={`absolute select-none ${isInline ? 'cursor-text' : 'cursor-move'}`}
                    style={{
                      left: `${pxX}px`,
                      top: `${pxY}px`,
                      width: `${pxW}px`,
                      transform: `translate(-50%, -50%) rotate(${el.rotation || 0}deg)`,
                      zIndex: isInline ? el.zIndex + 20 : el.zIndex,
                      opacity: el.opacity ?? 1,
                      ...multiSelectOutline(el.id),
                    }}
                  >
                    {isInline ? (
                      <div className="relative w-full">
                        <textarea
                          autoFocus
                          ref={textarea => {
                            if (textarea) {
                              textarea.style.height = 'auto'
                              textarea.style.height = `${Math.max(textarea.scrollHeight, 24)}px`
                              if (document.activeElement !== textarea) {
                                textarea.focus()
                                textarea.select()
                              }
                            }
                          }}
                          value={tEl.text}
                          onChange={e => {
                            onUpdateElement(el.id, { text: e.target.value })
                            e.target.style.height = 'auto'
                            e.target.style.height = `${Math.max(e.target.scrollHeight, 24)}px`
                          }}
                          onMouseDown={e => e.stopPropagation()}
                          onClick={e => e.stopPropagation()}
                          onDoubleClick={e => e.stopPropagation()}
                          onBlur={() => onSetInlineEditingId(null)}
                          onKeyDown={e => {
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              onSetInlineEditingId(null)
                            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                              e.preventDefault()
                              onSetInlineEditingId(null)
                            }
                          }}
                          className="w-full outline-none resize-none overflow-hidden block border-2 border-sky-400 rounded cursor-text"
                          style={{
                            width: '100%',
                            color: tEl.color || '#ffffff',
                            fontSize: `${(tEl.fontSize || 28) * (zoom / 0.65)}px`,
                            fontFamily: tEl.fontFamily || 'Inter, sans-serif',
                            fontWeight: tEl.fontWeight || 'bold',
                            fontStyle: tEl.fontStyle || 'normal',
                            textDecoration: tEl.textDecoration || 'none',
                            textTransform: tEl.textTransform || 'none',
                            textAlign: tEl.textAlign || 'center',
                            letterSpacing: tEl.letterSpacing ? `${tEl.letterSpacing * (zoom / 0.65)}px` : undefined,
                            lineHeight: tEl.lineHeight || 1.2,
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                            backgroundColor: tEl.backgroundBadge?.enabled
                              ? tEl.backgroundBadge.color
                              : tEl.backgroundColor && tEl.backgroundColor !== 'transparent'
                                ? tEl.backgroundColor
                                : 'transparent',
                            padding: tEl.backgroundBadge?.enabled
                              ? `${tEl.backgroundBadge.paddingY}px ${tEl.backgroundBadge.paddingX}px`
                              : '0px',
                            borderRadius: tEl.backgroundBadge?.enabled
                              ? `${tEl.backgroundBadge.borderRadius}px`
                              : '4px',
                            textShadow: tEl.shadow?.enabled
                              ? `${tEl.shadow.offsetX * (zoom / 0.65)}px ${tEl.shadow.offsetY * (zoom / 0.65)}px ${tEl.shadow.blur * (zoom / 0.65)}px ${tEl.shadow.color}`
                              : undefined,
                            WebkitTextStroke: tEl.stroke?.enabled
                              ? `${tEl.stroke.width * (zoom / 0.65)}px ${tEl.stroke.color}`
                              : undefined,
                            paintOrder: 'stroke fill',
                            caretColor: '#38bdf8',
                            boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.25)',
                          }}
                        />

                        {/* Corner handles & edge pills */}
                        <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-sky-500 rounded-full shadow pointer-events-none" />
                        <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-sky-500 rounded-full shadow pointer-events-none" />
                        <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-sky-500 rounded-full shadow pointer-events-none" />
                        <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-sky-500 rounded-full shadow pointer-events-none" />
                        <div className="absolute top-1/2 -left-1 -translate-y-1/2 w-1.5 h-3.5 bg-white border border-sky-500 rounded-full shadow pointer-events-none" />
                        <div className="absolute top-1/2 -right-1 -translate-y-1/2 w-1.5 h-3.5 bg-white border border-sky-500 rounded-full shadow pointer-events-none" />

                        {/* Dimension badge at bottom-right */}
                        <div className="absolute -bottom-6 right-0 px-1.5 py-0.5 bg-zinc-900/90 border border-zinc-700/80 rounded text-[10px] text-zinc-300 font-mono shadow pointer-events-none whitespace-nowrap">
                          {Math.round(pxW)} × {Math.round(pxH || 54)} px
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          color: tEl.color || '#ffffff',
                          fontSize: `${(tEl.fontSize || 28) * (zoom / 0.65)}px`,
                          fontFamily: tEl.fontFamily || 'Inter, sans-serif',
                          fontWeight: tEl.fontWeight || 'bold',
                          fontStyle: tEl.fontStyle || 'normal',
                          textDecoration: tEl.textDecoration || 'none',
                          textTransform: tEl.textTransform || 'none',
                          textAlign: tEl.textAlign || 'center',
                          letterSpacing: tEl.letterSpacing ? `${tEl.letterSpacing * (zoom / 0.65)}px` : undefined,
                          lineHeight: tEl.lineHeight || 1.2,
                          wordBreak: 'break-word',
                          whiteSpace: 'pre-wrap',
                          backgroundColor: tEl.backgroundBadge?.enabled
                            ? tEl.backgroundBadge.color
                            : tEl.backgroundColor || 'transparent',
                          padding: tEl.backgroundBadge?.enabled
                            ? `${tEl.backgroundBadge.paddingY}px ${tEl.backgroundBadge.paddingX}px`
                            : undefined,
                          borderRadius: tEl.backgroundBadge?.enabled
                            ? `${tEl.backgroundBadge.borderRadius}px`
                            : undefined,
                          textShadow: tEl.shadow?.enabled
                            ? `${tEl.shadow.offsetX * (zoom / 0.65)}px ${tEl.shadow.offsetY * (zoom / 0.65)}px ${tEl.shadow.blur * (zoom / 0.65)}px ${tEl.shadow.color}`
                            : undefined,
                          WebkitTextStroke: tEl.stroke?.enabled
                            ? `${tEl.stroke.width * (zoom / 0.65)}px ${tEl.stroke.color}`
                            : undefined,
                          paintOrder: 'stroke fill',
                        }}
                      >
                        {tEl.text}
                      </div>
                    )}
                  </div>
                )
              }

              return null
            })}
        </div>

        {/* 2. Selection Transform Box Overlay */}
        {selectedElement && inlineEditingId !== selectedElement.id && (
          <div className="absolute inset-0 overflow-visible pointer-events-none z-30">
            <div className="pointer-events-auto">
              <CoverTransformBox
                element={selectedElement}
                canvasWidth={renderedCanvasWidth}
                canvasHeight={renderedCanvasHeight}
                onChange={updates => onUpdateElement(selectedElement.id, updates)}
                onStartTransform={onStartTransform}
                onCommit={onCommitTransform}
                onDuplicate={onDuplicateElement}
                onDelete={onDeleteElement}
                onLockToggle={onLockToggle}
                onBringForward={onBringForward}
                onSendBackward={onSendBackward}
                onBringToFront={onBringToFront}
                onSendToBack={onSendToBack}
                onDoubleClick={() => {
                  if (selectedElement.type === 'text') {
                    onSetInlineEditingId(selectedElement.id)
                  }
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Selection box being dragged */}
      {marquee && (
        <div
          data-cover-marquee
          className="absolute z-40 pointer-events-none border border-sky-400 bg-sky-400/10 rounded-sm"
          style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
        />
      )}

      {/* What Ctrl+C just did */}
      {copyNotice && (
        <div
          data-cover-copy-notice
          className="absolute top-4 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-lg bg-zinc-900/95 border border-sky-500/50 text-xs text-zinc-100 shadow-xl pointer-events-none whitespace-nowrap"
        >
          {copyNotice}
        </div>
      )}
    </div>
  )
}
