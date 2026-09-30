import type { ChromaKey, AutoMatte, ClipStroke, CustomMatte } from '@core/project-model'
import { matteAlphaBand, matteFeatherSigma } from '@core/matte-edge'
import { rasterizeStrokes, computeStrokesHash, customMatteStartsEmpty } from '@core/custom-matte'
import { frameToReference, motionHash, strokeToReference } from '@core/matte-motion'
import { hexToRgb01 } from './lut-canvas-shaders'

export function bindChromaUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  chromaKey?: ChromaKey,
) {
  if (chromaKey && chromaKey.enabled) {
    gl.uniform1i(gl.getUniformLocation(program, 'u_chroma_enabled'), 1)
    const [cr, cg, cb] = hexToRgb01(chromaKey.color || '#00ff00')
    gl.uniform3f(gl.getUniformLocation(program, 'u_chroma_color'), cr, cg, cb)
    gl.uniform1f(gl.getUniformLocation(program, 'u_chroma_similarity'), Math.max(0, chromaKey.similarity) / 100)
    gl.uniform1f(gl.getUniformLocation(program, 'u_chroma_smoothness'), Math.max(0, chromaKey.smoothness) / 100)
    gl.uniform1f(gl.getUniformLocation(program, 'u_chroma_spill'), Math.max(0, chromaKey.spill) / 100)
    gl.uniform1f(gl.getUniformLocation(program, 'u_chroma_clean'), Math.max(0, chromaKey.cleanEdge ?? 0) / 100)
    gl.uniform1f(gl.getUniformLocation(program, 'u_chroma_feather'), Math.max(0, chromaKey.featherEdge ?? 0) / 100)
  } else {
    gl.uniform1i(gl.getUniformLocation(program, 'u_chroma_enabled'), 0)
  }
}

export function bindMatteEdgeUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  autoMatte: AutoMatte,
  hasValidMatte: boolean,
  matteTextureSize: { width: number; height: number },
) {
  gl.uniform1i(gl.getUniformLocation(program, 'u_matte_enabled'), hasValidMatte ? 1 : 0)
  gl.uniform1i(gl.getUniformLocation(program, 'u_matte'), 2)
  const band = matteAlphaBand(autoMatte.cleanEdge)
  gl.uniform1f(gl.getUniformLocation(program, 'u_matte_lo'), band.lo)
  gl.uniform1f(gl.getUniformLocation(program, 'u_matte_hi'), band.hi)
  gl.uniform1f(
    gl.getUniformLocation(program, 'u_matte_sigma'),
    matteFeatherSigma(autoMatte.featherEdge),
  )
  gl.uniform2f(
    gl.getUniformLocation(program, 'u_matte_texel'),
    1 / Math.max(1, matteTextureSize.width),
    1 / Math.max(1, matteTextureSize.height),
  )
}

export function bindCustomMatteUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  customMatte: CustomMatte | undefined,
  canvas: HTMLCanvasElement,
  autoMatteEnabled: boolean,
  currentSourceTime: number,
  trimStart: number | undefined,
  speed: number | undefined,
  customMatteTexture: WebGLTexture | null,
  customMatteHashRef: React.MutableRefObject<string>,
) {
  const hasCustomMatte = Boolean(customMatte && customMatte.enabled && customMatte.strokes && customMatte.strokes.length > 0)
  gl.activeTexture(gl.TEXTURE3)
  gl.bindTexture(gl.TEXTURE_2D, customMatteTexture)

  if (hasCustomMatte && customMatte) {
    const matteMotion = customMatte.motion
    const motionKey = matteMotion ? `${motionHash(matteMotion)}:${(trimStart ?? 0).toFixed(3)}:${(speed ?? 1).toFixed(3)}` : ''
    const strokesHash = computeStrokesHash(customMatte.strokes, motionKey)
    if (customMatteHashRef.current !== strokesHash) {
      const maskW = 512
      const maskH = Math.max(1, Math.round(512 * (canvas.height / canvas.width)))
      const raster = rasterizeStrokes(customMatte.strokes, maskW, maskH, {
        toReference: matteMotion
          ? paintedAt => strokeToReference(matteMotion, paintedAt, trimStart ?? 0, speed ?? 1)
          : undefined,
      })
      const rgba = new Uint8Array(maskW * maskH * 4)
      for (let i = 0; i < maskW * maskH; i++) {
        rgba[i * 4 + 0] = raster.brushMask[i]
        rgba[i * 4 + 1] = raster.eraserMask[i]
        rgba[i * 4 + 2] = 0
        rgba[i * 4 + 3] = 255
      }
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, maskW, maskH, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
      customMatteHashRef.current = strokesHash
    }
    gl.uniform1i(gl.getUniformLocation(program, 'u_custom_matte_enabled'), 1)
    gl.uniform1i(
      gl.getUniformLocation(program, 'u_custom_matte_from_empty'),
      customMatteStartsEmpty(customMatte.strokes, autoMatteEnabled) ? 1 : 0,
    )
    gl.uniform1i(gl.getUniformLocation(program, 'u_custom_matte'), 3)
    const toRef = frameToReference(customMatte.motion, currentSourceTime)
    gl.uniform3f(gl.getUniformLocation(program, 'u_custom_matte_row0'), toRef[0], toRef[1], toRef[2])
    gl.uniform3f(gl.getUniformLocation(program, 'u_custom_matte_row1'), toRef[3], toRef[4], toRef[5])
  } else {
    gl.uniform1i(gl.getUniformLocation(program, 'u_custom_matte_enabled'), 0)
  }
}

export function bindStrokeUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  stroke: ClipStroke | undefined,
  canvas: HTMLCanvasElement,
) {
  gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), canvas.width, canvas.height)

  const hasStroke = Boolean(stroke && stroke.enabled && stroke.style !== 'none' && stroke.width > 0)
  if (hasStroke && stroke) {
    const STROKE_STYLE_MAP: Record<string, number> = {
      none: 0,
      solid: 1,
      straight: 2,
      offset: 3,
      dotted: 4,
      'hand-drawn': 5,
      paper: 6,
      luminescence: 7,
    }
    const styleInt = STROKE_STYLE_MAP[stroke.style] ?? 1
    gl.uniform1i(gl.getUniformLocation(program, 'u_stroke_style'), styleInt)
    const [sr, sg, sb] = hexToRgb01(stroke.color || '#FFFFFF')
    gl.uniform3f(gl.getUniformLocation(program, 'u_stroke_color'), sr, sg, sb)
    gl.uniform1f(gl.getUniformLocation(program, 'u_stroke_width'), Math.max(0, stroke.width) / 100)
    gl.uniform1f(gl.getUniformLocation(program, 'u_stroke_opacity'), Math.max(0, Math.min(100, stroke.opacity ?? 100)) / 100)

    const rawX = stroke.offsetX ?? 0
    const rawY = stroke.offsetY ?? 0
    const effX = rawX === 0 && rawY === 0 && stroke.style === 'offset' ? 5 : rawX
    const effY = rawX === 0 && rawY === 0 && stroke.style === 'offset' ? 5 : rawY
    gl.uniform2f(gl.getUniformLocation(program, 'u_stroke_offset'), effX / 100, effY / 100)

    gl.uniform1f(gl.getUniformLocation(program, 'u_stroke_glow'), Math.max(0, stroke.glow ?? 50))
    gl.uniform1f(gl.getUniformLocation(program, 'u_stroke_roughness'), (stroke.roughness ?? 50) / 100)
    gl.uniform1f(gl.getUniformLocation(program, 'u_stroke_gap'), stroke.gap ?? 50)
    gl.uniform1f(gl.getUniformLocation(program, 'u_stroke_seed'), stroke.seed ?? 0)
    gl.uniform1i(gl.getUniformLocation(program, 'u_stroke_enabled'), 1)
  } else {
    gl.uniform1i(gl.getUniformLocation(program, 'u_stroke_enabled'), 0)
  }
}
