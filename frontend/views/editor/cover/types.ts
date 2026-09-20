export type CoverElementType = 'text' | 'image' | 'background' | 'shape'

export interface BaseCoverElement {
  id: string
  type: CoverElementType
  name: string
  x: number // percent 0-100 (relative to canvas width)
  y: number // percent 0-100 (relative to canvas height)
  width: number // percent 0-100 of canvas width
  height: number // percent 0-100 of canvas height
  rotation: number // degrees -180 to 180
  opacity: number // 0 to 1
  zIndex: number
  isLocked?: boolean
  aspectRatioLocked?: boolean
  visible?: boolean
}

export interface TextCoverElement extends BaseCoverElement {
  type: 'text'
  text: string
  fontFamily: string
  fontSize: number // in px relative to base canvas (e.g. 720px width)
  fontWeight?: string | number
  fontStyle?: 'normal' | 'italic'
  textDecoration?: 'none' | 'underline' | 'line-through'
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  color: string
  backgroundColor?: string
  textAlign: 'left' | 'center' | 'right'
  letterSpacing?: number
  lineHeight?: number
  shadow?: {
    enabled: boolean
    color: string
    blur: number
    offsetX: number
    offsetY: number
  }
  stroke?: {
    enabled: boolean
    color: string
    width: number
  }
  backgroundBadge?: {
    enabled: boolean
    color: string
    paddingX: number
    paddingY: number
    borderRadius: number
  }
}

export interface ImageCoverElement extends BaseCoverElement {
  type: 'image'
  src: string
  flipH?: boolean
  flipV?: boolean
  filters?: {
    brightness: number // 0 to 200, default 100
    contrast: number // 0 to 200, default 100
    saturation: number // 0 to 200, default 100
    blur: number // 0 to 20 px, default 0
    hue: number // -180 to 180, default 0
  }
  bgRemoved?: boolean
  originalSrc?: string
  maskDataUrl?: string
  borderRadius?: number
  crop?: {
    x: number // percent 0-100 of uncropped image width
    y: number // percent 0-100 of uncropped image height
    width: number // percent 0-100 of uncropped image width
    height: number // percent 0-100 of uncropped image height
  }
}

export interface BackgroundCoverElement extends BaseCoverElement {
  type: 'background'
  src: string
  color?: string
  hasLetterbox?: boolean
  filters?: {
    brightness: number
    contrast: number
    saturation: number
    blur: number
    hue: number
  }
}

export interface ShapeCoverElement extends BaseCoverElement {
  type: 'shape'
  shapeType: string
  fillColor: string
  strokeColor?: string
  strokeWidth?: number
  strokeDasharray?: string
  borderRadius?: number
  sides?: number // number of polygon sides (3 to 12)
  cornerRounding?: number // corner rounding percent (0 to 100)
}

export type CoverElement =
  | TextCoverElement
  | ImageCoverElement
  | BackgroundCoverElement
  | ShapeCoverElement

export type CoverDrawerTab =
  | 'templates'
  | 'position'
  | 'effects'
  | 'edit'
  | 'bg-remover'
  | 'layers'
  | 'text'
  | 'stickers'
  | 'images'
  | 'shapes'

export type PositionSubTab = 'arrange' | 'layers'

export interface UploadedCoverImage {
  id: string
  src: string
  name: string
  addedAt: number
  width?: number
  height?: number
}
