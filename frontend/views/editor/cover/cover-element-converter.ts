import type { TimelineCover, TimelineCoverTextItem } from '@core/project-model'
import { COVER_TEMPLATES, getCustomTemplates } from './cover-templates'
import type {
  CoverElement,
  TextCoverElement,
  ImageCoverElement,
} from './types'

export function initializeCoverElements(
  initialFrameDataUrl: string,
  currentCover?: TimelineCover,
  selectedTemplateId = 'bookish-weekend'
): CoverElement[] {
  const list: CoverElement[] = []

  // 1. Background image layer
  const effectiveBgSrc =
    initialFrameDataUrl ||
    currentCover?.customImagePath ||
    currentCover?.thumbnailDataUrl ||
    ''

  const bgElem: ImageCoverElement = {
    id: 'background-layer',
    type: 'image',
    name: 'Video Frame',
    src: effectiveBgSrc,
    x: 50,
    y: 50,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    isLocked: false,
    visible: true,
    aspectRatioLocked: false,
    crop: { x: 0, y: 0, width: 100, height: 100 },
  }
  list.push(bgElem)

  // 2. Restore saved elements
  if (currentCover?.elements && currentCover.elements.length > 0) {
    const cloned = currentCover.elements.map((el, idx) => ({
      ...JSON.parse(JSON.stringify(el)),
      zIndex: idx + 2,
    }))
    list.push(...cloned)
    return list
  }

  // 3. Otherwise text items from currentCover or default template
  const sourceTexts: TimelineCoverTextItem[] =
    currentCover?.texts && currentCover.texts.length > 0
      ? currentCover.texts
      : (() => {
          const allTpls = [...COVER_TEMPLATES, ...getCustomTemplates()]
          const initialTpl =
            allTpls.find(tpl => tpl.id === selectedTemplateId) || COVER_TEMPLATES[0]
          return JSON.parse(JSON.stringify(initialTpl.texts))
        })()

  sourceTexts.forEach((item, index) => {
    const textElem: TextCoverElement = {
      id: item.id || `text-${Date.now()}-${index}`,
      type: 'text',
      name: item.text || `Heading ${index + 1}`,
      text: item.text,
      fontFamily:
        item.fontFamily === 'serif'
          ? 'Playfair Display, serif'
          : item.fontFamily === 'cursive'
            ? 'Caveat, cursive'
            : 'Inter, sans-serif',
      fontSize: item.fontSize || 32,
      fontWeight: item.fontWeight || 'bold',
      fontStyle: (item.fontStyle as 'normal' | 'italic') || 'normal',
      color: item.color || '#ffffff',
      backgroundColor: item.backgroundColor || undefined,
      textAlign: item.textAlign || 'center',
      x: item.x ?? 50,
      y: item.y ?? 30 + index * 18,
      width: 70,
      height: 12,
      rotation: item.rotation || 0,
      opacity: 1,
      zIndex: index + 2,
      isLocked: false,
      visible: true,
      letterSpacing: item.letterSpacing,
      lineHeight: item.lineHeight,
      textTransform: item.textTransform,
      shadow: item.shadow
        ? { enabled: true, color: '#000000', blur: 10, offsetX: 0, offsetY: 4 }
        : undefined,
      stroke:
        item.stroke && item.strokeWidth
          ? { enabled: true, color: item.stroke, width: item.strokeWidth }
          : undefined,
    }
    list.push(textElem)
  })

  return list
}

export function buildTimelineCover(
  elements: CoverElement[],
  selectedTemplateId: string,
  selectedTime: number,
  isLocalImage: boolean,
  thumbUrl: string,
  initialFrameDataUrl: string,
  currentCover?: TimelineCover
): TimelineCover {
  const savedTexts: TimelineCoverTextItem[] = elements
    .filter(el => el.type === 'text')
    .map(el => {
      const tEl = el as TextCoverElement
      return {
        id: tEl.id,
        text: tEl.text,
        fontFamily: tEl.fontFamily,
        fontSize: tEl.fontSize,
        fontWeight: String(tEl.fontWeight),
        fontStyle: tEl.fontStyle,
        color: tEl.color,
        backgroundColor: tEl.backgroundBadge?.enabled
          ? tEl.backgroundBadge.color
          : tEl.backgroundColor,
        textAlign: tEl.textAlign,
        x: tEl.x,
        y: tEl.y,
        rotation: tEl.rotation,
        letterSpacing: tEl.letterSpacing,
        lineHeight: tEl.lineHeight,
        textTransform: tEl.textTransform,
        shadow: tEl.shadow?.enabled ? '0 4px 10px rgba(0,0,0,0.85)' : undefined,
        stroke: tEl.stroke?.enabled ? tEl.stroke.color : undefined,
        strokeWidth: tEl.stroke?.enabled ? tEl.stroke.width : undefined,
      }
    })

  const foregroundElements = elements.filter(
    el => el.id !== 'background-layer' && el.type !== 'background'
  )

  const bgLayer = elements.find(
    el => el.id === 'background-layer' || el.type === 'background'
  ) as ImageCoverElement | undefined

  const bgImageSrc =
    bgLayer?.src ||
    initialFrameDataUrl ||
    currentCover?.customImagePath ||
    currentCover?.thumbnailDataUrl

  return {
    type: isLocalImage ? 'custom_image' : 'video_frame',
    time: selectedTime,
    customImagePath: bgImageSrc,
    templateId: selectedTemplateId,
    texts: savedTexts,
    elements: foregroundElements,
    thumbnailDataUrl: thumbUrl,
    updatedAt: Date.now(),
  }
}
