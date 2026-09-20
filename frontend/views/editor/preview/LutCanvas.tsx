import React from 'react'
import { loadLut } from '../../../lib/lut-cache'
import { pathToFileUrl } from '../../../lib/file-url'
import type { CubeLut } from '@core/lut'
import type { ChromaKey, AutoMatte, ClipStroke, CustomMatte } from '@core/project-model'
import { matteEngine } from './MatteEngine'
import { matteTimeForSourceTime } from '@core/auto-matte'
import { decideBakeMatteSync, STALE_MATTE_SECONDS } from '@core/matte-preview-policy'
import { matteAlphaBand, matteFeatherSigma } from '@core/matte-edge'
import { rasterizeStrokes, computeStrokesHash } from '@core/custom-matte'
import { WebCodecsPlayer } from './webcodecs/WebCodecsPlayer'

export interface LutCanvasRef {
  renderNow: (overrideSource?: HTMLVideoElement | HTMLImageElement | VideoFrame | null) => void
  getCanvas: () => HTMLCanvasElement | null
  clear: () => void
  /**
   * Whether there is a drawn frame on the canvas right now.
   *
   * The caller hides the raw <video> underneath a clip whose background is removed, or
   * the removed background shows through the cut-out. That makes this canvas the only
   * picture on screen, so when it has nothing, the monitor is black — which is what
   * happened: `draw` clears and bails whenever `sourceElement` is null, and that prop
   * comes from a ref (`activePoolPathRef`) that React does not re-render on, so it is
   * null on some frames. Before the raw video was hidden this was invisible.
   *
   * So the source stays visible until this says there is something to cover it with. The
   * worst case degrades to "picture, not cut out" instead of "no picture".
   */
  hasContent: () => boolean
}

export interface LutCanvasProps {
  sourceElement: HTMLVideoElement | HTMLImageElement | VideoFrame | null
  filterId?: string
  intensity?: number // 0..100
  chromaKey?: ChromaKey
  autoMatte?: AutoMatte
  customMatte?: CustomMatte
  stroke?: ClipStroke
  clipId?: string
  playbackResolution?: 1 | 0.5 | 0.25
  bakeVideoPath?: string
  /** Clip trim/speed, needed to line the baked matte up with the picture. */
  trimStart?: number
  speed?: number
  isPlaying?: boolean
  className?: string
  style?: React.CSSProperties
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = (a_position + 1.0) * 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_image;
uniform sampler3D u_lut;
uniform float u_intensity;
uniform float u_lut_size;
uniform bool u_lut_enabled;

uniform bool u_chroma_enabled;
uniform vec3 u_chroma_color;
uniform float u_chroma_similarity;
uniform float u_chroma_smoothness;
uniform float u_chroma_spill;
uniform float u_chroma_clean;
uniform float u_chroma_feather;

uniform bool u_matte_enabled;
uniform sampler2D u_matte;
// Alpha band from matteAlphaBand() in core — everything below lo is background.
uniform float u_matte_lo;
uniform float u_matte_hi;
// Blur radius for featherEdge, in matte pixels, from matteFeatherSigma() in core.
uniform float u_matte_sigma;
// One matte texel in UV, so the blur above can be expressed in pixels.
uniform vec2 u_matte_texel;

uniform bool u_custom_matte_enabled;
uniform sampler2D u_custom_matte;

uniform bool u_stroke_enabled;
uniform int u_stroke_style;
uniform vec3 u_stroke_color;
uniform float u_stroke_width;
uniform float u_stroke_opacity;
uniform vec2 u_stroke_offset;
uniform float u_stroke_glow;
uniform float u_stroke_roughness;
uniform float u_stroke_gap;
uniform float u_stroke_seed;
uniform vec2 u_resolution;

// The matte alpha at uv, with featherEdge softening and cleanEdge tightening applied.
//
// Mirrors the export filtergraph: blur first (gblur), then the alpha remap (lut). Both
// numbers come from core/src/matte-edge.ts so the two cannot drift apart again.
//
// The blur is a 5x5 Gaussian sampled in units of sigma rather than in texels: taps at
// 0, +/-1 and +/-2 sigma with weights exp(-d*d/2). That spans the +/-2 sigma where the
// bulk of a Gaussian lives and gives an effective sigma of 0.96 of the real one, so it
// tracks ffmpeg's gblur to within a few percent at any slider position, at a fixed 25
// fetches instead of the 61 per axis a literal kernel would need at the top of the range.
//
// Sampling in texels was the first attempt and was wrong by 4x at sigma 5 - the preview
// showed a 5px transition where the export produced 20px. Same direction, but nobody can
// set a slider by eye against a four-fold error.
float matteAlphaAt(vec2 uv) {
  float a;
  if (u_matte_sigma > 0.0) {
    // One tap-step IS one sigma, so the kernel scales with the slider.
    vec2 sigmaStep = u_matte_texel * u_matte_sigma;
    float total = 0.0;
    float wsum = 0.0;
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 off = vec2(float(x), float(y)) * sigmaStep;
        float d2 = float(x * x + y * y);
        float w = exp(-d2 * 0.5);
        total += texture(u_matte, uv + off).r * w;
        wsum += w;
      }
    }
    a = total / max(1e-6, wsum);
  } else {
    a = texture(u_matte, uv).r;
  }

  float span = max(1e-6, u_matte_hi - u_matte_lo);
  return clamp((a - u_matte_lo) / span, 0.0, 1.0);
}

void main() {
  vec4 color = texture(u_image, v_uv);

  if (u_lut_enabled) {
    vec3 scale = (u_lut_size - 1.0) / u_lut_size * color.rgb + 0.5 / u_lut_size;
    vec3 graded = texture(u_lut, scale).rgb;
    color.rgb = mix(color.rgb, graded, u_intensity);
  }

  if (u_chroma_enabled) {
    vec3 diffVec = abs(color.rgb - u_chroma_color);
    float diff = max(diffVec.r, max(diffVec.g, diffVec.b));
    float sim = u_chroma_similarity;
    float blend = max(0.0001, u_chroma_smoothness);
    float alphaFactor;
    if (diff > sim) {
      alphaFactor = 1.0;
    } else if (diff > (sim - blend)) {
      alphaFactor = (diff - (sim - blend)) / blend;
    } else {
      alphaFactor = 0.0;
    }

    if (u_chroma_clean > 0.0 || u_chroma_feather > 0.0) {
      float edge0 = clamp(u_chroma_clean, 0.0, 0.999);
      float edge1 = clamp(1.0 - u_chroma_feather, edge0 + 0.001, 1.0);
      alphaFactor = smoothstep(edge0, edge1, alphaFactor);
    }

    color.a *= alphaFactor;

    if (u_chroma_spill > 0.0) {
      if (u_chroma_color.g > u_chroma_color.r && u_chroma_color.g > u_chroma_color.b) {
        float maxOther = max(color.r, color.b);
        if (color.g > maxOther) {
          color.g = mix(color.g, maxOther, u_chroma_spill);
        }
      } else if (u_chroma_color.b > u_chroma_color.r && u_chroma_color.b > u_chroma_color.g) {
        float maxOther = max(color.r, color.g);
        if (color.b > maxOther) {
          color.b = mix(color.b, maxOther, u_chroma_spill);
        }
      }
    }
  }

  if (u_matte_enabled) {
    color.a *= matteAlphaAt(v_uv);
  }

  if (u_custom_matte_enabled) {
    vec2 customMod = texture(u_custom_matte, v_uv).rg;
    color.a = clamp(color.a + customMod.r - customMod.g, 0.0, 1.0);
  }

  float subjectAlpha = color.a;

  // A subjectAlpha above 0.999 short-circuits the whole stroke block, and the result is
  // identical by construction: the compositing below is
  //   finalAlpha = subjectAlpha + strokeAlpha * (1 - subjectAlpha)
  //   mixedRgb   = (rgb * subjectAlpha + strokeColor * strokeAlpha * (1 - subjectAlpha)) / finalAlpha
  // so at subjectAlpha = 1 both collapse to the pixel that is already there, whatever
  // strokeAlpha turns out to be. Every pixel inside the subject was paying for 36 texture
  // fetches to arrive back at itself — on a portrait clip where the subject fills the
  // frame that is most of the frame, ~74 million fetches a frame at 1080x1920, which is
  // what made the preview stall once a stroke was switched on.
  if (u_stroke_enabled && u_stroke_style > 0 && u_stroke_width > 0.0 && subjectAlpha < 0.999) {
    // -------------------------------------------------------------------------
    // GLSL Realtime Stroke Shader Preview
    //
    // NOTE: In GLSL realtime preview, distance transform (SDF) is approximated
    // using multi-tap concentric circle sampling (16-32 taps).
    // Styles solid, straight, offset, and dotted provide high-fidelity approximations.
    // Complex organic styles (hand-drawn, paper, luminescence) are fast procedural
    // GLSL approximations based on value noise and exponential falloff.
    // The definitive, bit-exact render is produced by core/src/stroke-style.ts
    // during video export and render-cache bake.
    // See section 4 of _private/17-tach-nen-tu-dong-va-vien-stroke.md.
    // -------------------------------------------------------------------------

    float minDim = min(u_resolution.x, u_resolution.y);
    vec2 strokeUvW = vec2(u_stroke_width * minDim / max(1.0, u_resolution.x), u_stroke_width * minDim / max(1.0, u_resolution.y));

    vec2 centerUv = v_uv;
    if (u_stroke_style == 3) { // offset
      centerUv -= vec2(u_stroke_offset.x * minDim / max(1.0, u_resolution.x), u_stroke_offset.y * minDim / max(1.0, u_resolution.y));
    }

    float strokeAlpha = 0.0;
    float closestDist = 1.0;
    bool hitForeground = false;

    // 12 sampling directions with 3 concentric rings (total 36 taps)
    for (int ring = 1; ring <= 3; ring++) {
      float rFrac = float(ring) / 3.0;
      for (int tap = 0; tap < 12; tap++) {
        float angle = float(tap) * 0.52359877559; // 2 * PI / 12
        vec2 dir = vec2(cos(angle), sin(angle));

        if (u_stroke_style == 2) { // straight (Chebyshev box)
          dir = clamp(dir * 1.414, vec2(-1.0), vec2(1.0));
        }

        if (u_stroke_style == 5) { // hand-drawn procedural noise
          float n = sin(angle * 3.0 + u_stroke_seed) * 0.35 * u_stroke_roughness;
          dir *= (1.0 + n);
        } else if (u_stroke_style == 6) { // paper torn-edge noise
          float n = sin(angle * 2.0 + u_stroke_seed) * 0.25 * u_stroke_roughness;
          dir *= (1.15 + n);
        }

        vec2 samplePos = centerUv + dir * strokeUvW * rFrac;
        if (samplePos.x >= 0.0 && samplePos.x <= 1.0 && samplePos.y >= 0.0 && samplePos.y <= 1.0) {
          float sA = 0.0;
          if (u_matte_enabled) {
            sA = matteAlphaAt(samplePos);
          } else if (u_chroma_enabled) {
            vec3 sRgb = texture(u_image, samplePos).rgb;
            vec3 sDiffVec = abs(sRgb - u_chroma_color);
            float sDiff = max(sDiffVec.r, max(sDiffVec.g, sDiffVec.b));
            float sSim = u_chroma_similarity;
            float sBlend = max(0.0001, u_chroma_smoothness);
            if (sDiff > sSim) {
              sA = 1.0;
            } else if (sDiff > (sSim - sBlend)) {
              sA = (sDiff - (sSim - sBlend)) / sBlend;
            } else {
              sA = 0.0;
            }
            if (u_chroma_clean > 0.0 || u_chroma_feather > 0.0) {
              float edge0 = clamp(u_chroma_clean, 0.0, 0.999);
              float edge1 = clamp(1.0 - u_chroma_feather, edge0 + 0.001, 1.0);
              sA = smoothstep(edge0, edge1, sA);
            }
          } else {
            sA = texture(u_image, samplePos).a;
          }

          if (u_custom_matte_enabled) {
            vec2 cMod = texture(u_custom_matte, samplePos).rg;
            sA = clamp(sA + cMod.r - cMod.g, 0.0, 1.0);
          }

          if (sA > 0.5) {
            hitForeground = true;
            closestDist = min(closestDist, rFrac);
          }
        }
      }
    }

    if (hitForeground) {
      strokeAlpha = 1.0;

      if (u_stroke_style == 4) { // dotted
        float angle = atan(v_uv.y - 0.5, v_uv.x - 0.5);
        float freq = max(4.0, 40.0 * (1.0 - u_stroke_gap * 0.008));
        float dotMod = cos(angle * freq);
        strokeAlpha = smoothstep(0.0, 0.4, dotMod);
      } else if (u_stroke_style == 6) { // paper
        float grain = 1.0 + sin(gl_FragCoord.x * 0.5 + gl_FragCoord.y * 0.5) * 0.08;
        strokeAlpha *= grain;
      }
    }

    if (u_stroke_style == 7) { // luminescence glow
      float glowDist = closestDist;
      float glowRange = 1.0 + u_stroke_glow * 0.02;
      strokeAlpha = max(strokeAlpha, exp(-glowDist * 2.5) * clamp(1.0 - (glowDist / glowRange), 0.0, 1.0));
    }

    strokeAlpha *= u_stroke_opacity;

    // Stroke is drawn underneath the subject using Porter-Duff Over
    float finalAlpha = clamp(subjectAlpha + strokeAlpha * (1.0 - subjectAlpha), 0.0, 1.0);
    vec3 mixedRgb = (color.rgb * subjectAlpha + u_stroke_color * strokeAlpha * (1.0 - subjectAlpha)) / max(0.0001, finalAlpha);
    color = vec4(mixedRgb, finalAlpha);
  }

  fragColor = color;
}
`

function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, '')
  const r = parseInt(clean.substring(0, 2) || '0', 16) / 255
  const g = parseInt(clean.substring(2, 4) || '0', 16) / 255
  const b = parseInt(clean.substring(4, 6) || '0', 16) / 255
  return [r, g, b]
}

export const LutCanvas = React.forwardRef<LutCanvasRef, LutCanvasProps>(function LutCanvas(
  {
    sourceElement,
    filterId,
    intensity = 100,
    chromaKey,
    autoMatte,
    customMatte,
    stroke,
    clipId,
    playbackResolution = 1,
    bakeVideoPath,
    trimStart,
    speed,
    isPlaying = false,
    className,
    style,
  },
  ref,
) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const glRef = React.useRef<WebGL2RenderingContext | null>(null)
  const programRef = React.useRef<WebGLProgram | null>(null)
  const imageTextureRef = React.useRef<WebGLTexture | null>(null)
  const dummyLutTextureRef = React.useRef<WebGLTexture | null>(null)
  const matteTextureRef = React.useRef<WebGLTexture | null>(null)
  const bakeTextureRef = React.useRef<WebGLTexture | null>(null)
  const customMatteTextureRef = React.useRef<WebGLTexture | null>(null)
  const customMatteHashRef = React.useRef<string>('')
  const bakeVideoRef = React.useRef<HTMLVideoElement | null>(null)
  const lutTextureCacheRef = React.useRef<Map<string, { texture: WebGLTexture; size: number }>>(new Map())
  const activeLutRef = React.useRef<CubeLut | null>(null)
  const animFrameIdRef = React.useRef<number>(0)
  const isMountedRef = React.useRef(true)
  const hasValidMatteRef = React.useRef(false)
  const lastMatteStampRef = React.useRef<string | null>(null)
  const lastMatteSeekAtRef = React.useRef(0)
  const pendingMatteSeekRef = React.useRef<number | null>(null)
  const uploadedMatteTimeRef = React.useRef<number | null>(null)
  const sourceDecodedTimeRef = React.useRef<number>(0)
  const bakeDecodedTimeRef = React.useRef<number>(0)
  const lastSourceSeekAtRef = React.useRef<number>(0)
  const liveInferTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveInferringRef = React.useRef(false)
  const matteWebCodecsPlayerRef = React.useRef<WebCodecsPlayer | null>(null)
  const matteFrameRef = React.useRef<VideoFrame | null>(null)
  const lastMattePathRef = React.useRef<string>('')
  const isSeekingMatteRef = React.useRef(false)
  const pendingMatteTimeRef = React.useRef<number | null>(null)
  /**
   * Size of whatever is currently on texture unit 2.
   *
   * `featherEdge` is a blur measured in matte pixels, so the shader needs the matte's own
   * texel size. Unit 2 carries the bake video on one path and a live inference result on
   * another, and those differ from each other and from the canvas — so it is recorded at
   * every upload rather than guessed.
   */
  const matteTextureSizeRef = React.useRef<{ width: number; height: number }>({ width: 1, height: 1 })
  /** Set by a completed draw, cleared by clearCanvas. See LutCanvasRef.hasContent. */
  const hasContentRef = React.useRef(false)
  const lastClipIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (liveInferTimeoutRef.current !== null) {
        clearTimeout(liveInferTimeoutRef.current)
        liveInferTimeoutRef.current = null
      }
    }
  }, [])

  // Reset matte validation state when switching clips unless a cached matte exists
  React.useEffect(() => {
    if (lastClipIdRef.current !== (clipId ?? null)) {
      lastClipIdRef.current = clipId ?? null
      const activeId = clipId || 'clip-preview'
      const cached = matteEngine.getCachedResult(activeId)
      if (!cached) {
        hasValidMatteRef.current = false
        lastMatteStampRef.current = null
        uploadedMatteTimeRef.current = null
      }
      pendingMatteSeekRef.current = null
      matteFrameRef.current = null
    }
  }, [clipId])

  /**
   * The current `draw`, for listeners that must not re-subscribe when it changes.
   *
   * `draw` is a new function on nearly every render. An effect that took it as a
   * dependency and also owned the bake video would pause and blank that element every
   * time, so the listeners read it through here instead.
   */
  const drawRef = React.useRef<() => void>(() => {})
  const isPlayingRef = React.useRef(isPlaying)
  isPlayingRef.current = isPlaying

  const bakeFailedRef = React.useRef(false)

  // Manage WebCodecs player for baked matte video (instant hardware decoding)
  React.useEffect(() => {
    if (!bakeVideoPath || !autoMatte?.enabled || typeof VideoDecoder === 'undefined') {
      if (matteWebCodecsPlayerRef.current) {
        matteWebCodecsPlayerRef.current.destroy()
        matteWebCodecsPlayerRef.current = null
        matteFrameRef.current = null
        lastMattePathRef.current = ''
      }
      return
    }

    if (lastMattePathRef.current === bakeVideoPath && matteWebCodecsPlayerRef.current?.isReady()) {
      return
    }

    lastMattePathRef.current = bakeVideoPath
    const player = new WebCodecsPlayer()
    matteWebCodecsPlayerRef.current = player

    let cancelled = false
    player.load(bakeVideoPath).then((success) => {
      if (cancelled || !isMountedRef.current || matteWebCodecsPlayerRef.current !== player) return
      if (success) {
        const isVideo = sourceElement instanceof HTMLVideoElement
        const isFrame = typeof VideoFrame !== 'undefined' && sourceElement instanceof VideoFrame
        const currentSourceTime = isVideo
          ? sourceElement.currentTime
          : isFrame
            ? sourceElement.timestamp / 1_000_000
            : 0
        const wantTime = matteTimeForSourceTime(currentSourceTime, autoMatte.bake?.sourceStart ?? trimStart ?? 0, speed ?? 1)
        player.seek(wantTime).then((frame) => {
          if (cancelled || !isMountedRef.current || !frame) return
          matteFrameRef.current = frame
          bakeDecodedTimeRef.current = frame.timestamp / 1_000_000
          hasValidMatteRef.current = true
          if (!isPlayingRef.current) drawRef.current()
        }).catch(() => {})
      }
    }).catch(err => {
      console.warn('[LutCanvas] Failed to load matte with WebCodecsPlayer:', err)
    })

    return () => {
      cancelled = true
      if (matteWebCodecsPlayerRef.current === player) {
        player.destroy()
        matteWebCodecsPlayerRef.current = null
        matteFrameRef.current = null
        lastMattePathRef.current = ''
      }
    }
  }, [bakeVideoPath, autoMatte?.enabled])

  // Manage bake video element
  React.useEffect(() => {
    bakeFailedRef.current = false
    if (!bakeVideoPath || !autoMatte?.enabled) {
      if (bakeVideoRef.current) {
        bakeVideoRef.current.pause()
        if (!bakeVideoPath) {
          bakeVideoRef.current.src = ''
          bakeVideoRef.current = null
        }
      }
      if (!bakeVideoPath) return
    }

    let video = bakeVideoRef.current
    if (!video) {
      video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.preload = 'auto'
      bakeVideoRef.current = video
    }

    const videoUrl = pathToFileUrl(bakeVideoPath)
    if (video.src !== videoUrl) {
      video.src = videoUrl
      video.load()
    }

    /**
     * Decoding is asynchronous, and while paused nothing else comes back to the canvas.
     *
     * The draw that runs the moment a bake becomes available finds `readyState` still 0,
     * so the matte is skipped — correctly, there is no frame yet — and then no further
     * draw is ever scheduled. The cut-out only appeared once the user scrubbed or hit
     * play, which read as "background removal did nothing". A still already had this
     * treatment; the matte video needs the same, for the first frame and for every seek
     * made while paused.
     */
    const redrawWhenReady = () => {
      bakeFailedRef.current = false
      if (bakeVideoRef.current) {
        bakeDecodedTimeRef.current = bakeVideoRef.current.currentTime
      }
      lastMatteSeekAtRef.current = performance.now()
      if (!isPlayingRef.current) drawRef.current()
      if (pendingMatteSeekRef.current !== null && bakeVideoRef.current && !bakeVideoRef.current.seeking) {
        const nextTime = pendingMatteSeekRef.current
        pendingMatteSeekRef.current = null
        bakeVideoRef.current.currentTime = nextTime
        lastMatteSeekAtRef.current = performance.now()
      }
    }
    const onError = () => {
      console.warn('[LutCanvas] Bake video failed to load, falling back to live inference:', bakeVideoPath)
      bakeFailedRef.current = true
      if (!isPlayingRef.current) drawRef.current()
    }
    video.addEventListener('loadeddata', redrawWhenReady)
    video.addEventListener('seeked', redrawWhenReady)
    video.addEventListener('error', onError)

    return () => {
      if (video) {
        video.removeEventListener('loadeddata', redrawWhenReady)
        video.removeEventListener('seeked', redrawWhenReady)
        video.removeEventListener('error', onError)
        video.pause()
        video.src = ''
      }
    }
  }, [bakeVideoPath, autoMatte?.enabled])

  /**
   * A lost WebGL context is recoverable, but only if something asks for it back.
   *
   * The driver drops the context when the GPU is pushed too hard or the app sits in the
   * background, and until now nothing in here noticed: every later `draw` ran against a
   * dead context, silently produced nothing, and the preview froze on whatever frame was
   * last uploaded — which read as "it worked for a while, then broke". Preventing the
   * default on `webglcontextlost` is what makes the browser send `webglcontextrestored`
   * at all; re-running this effect then rebuilds the program and the textures.
   */
  const [glGeneration, setGlGeneration] = React.useState(0)
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onLost = (event: Event) => {
      event.preventDefault()
      console.warn('[LutCanvas] WebGL context lost; waiting for the browser to restore it.')
      glRef.current = null
      programRef.current = null
    }
    const onRestored = () => {
      console.warn('[LutCanvas] WebGL context restored, rebuilding.')
      setGlGeneration(n => n + 1)
    }

    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
    }
  }, [])

  // WebGL initialization
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    })
    if (!gl) {
      console.warn('[LutCanvas] WebGL2 is not supported on this device.')
      return
    }
    glRef.current = gl

    // Compile shaders
    const vs = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(vs, VERTEX_SHADER)
    gl.compileShader(vs)

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(fs, FRAGMENT_SHADER)
    gl.compileShader(fs)

    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[LutCanvas] Shader link error:', gl.getProgramInfoLog(program))
      return
    }
    programRef.current = program

    // Fullscreen Quad geometry
    const quad = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ])
    const vbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)

    const posLoc = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    // Image texture on Unit 0
    const imgTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, imgTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    imageTextureRef.current = imgTex

    // 1x1x1 dummy 3D texture on Unit 1 fallback
    const dummyTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_3D, dummyTex)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGBA8,
      1, 1, 1, 0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    )
    dummyLutTextureRef.current = dummyTex

    // Realtime matte texture on Unit 2 (1-channel R8)
    const matteTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, matteTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]))
    matteTextureRef.current = matteTex

    // Baked video matte texture on Unit 2 (RGBA)
    const bakeTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, bakeTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]))
    bakeTextureRef.current = bakeTex

    // Custom matte texture on Unit 3 (RGBA)
    const customTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, customTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
    customMatteTextureRef.current = customTex

    return () => {
      // Cleanup WebGL resources
      const cached = lutTextureCacheRef.current
      for (const { texture } of cached.values()) {
        gl.deleteTexture(texture)
      }
      cached.clear()

      if (imgTex) gl.deleteTexture(imgTex)
      if (dummyTex) gl.deleteTexture(dummyTex)
      if (matteTex) gl.deleteTexture(matteTex)
      if (bakeTex) gl.deleteTexture(bakeTex)
      if (customTex) gl.deleteTexture(customTex)
      if (program) gl.deleteProgram(program)
      if (vs) gl.deleteShader(vs)
      if (fs) gl.deleteShader(fs)
      if (vbo) gl.deleteBuffer(vbo)
      glRef.current = null
      programRef.current = null
      matteTextureRef.current = null
      bakeTextureRef.current = null
    }
  }, [glGeneration])

  // Load LUT data when filterId changes
  React.useEffect(() => {
    if (!filterId) {
      activeLutRef.current = null
      clearCanvas()
      return
    }

    let cancelled = false
    loadLut(filterId)
      .then(lut => {
        if (cancelled) return
        activeLutRef.current = lut
        ensureLutTexture(lut, filterId)
        draw()
      })
      .catch(err => {
        console.warn(`[LutCanvas] Failed to load LUT ${filterId}:`, err)
        activeLutRef.current = null
      })

    return () => {
      cancelled = true
    }
  }, [filterId])

  // Helper to upload 3D texture into WebGL context
  const ensureLutTexture = React.useCallback((lut: CubeLut, id: string) => {
    const gl = glRef.current
    if (!gl) return

    const cache = lutTextureCacheRef.current
    if (cache.has(id)) return

    const tex = gl.createTexture()
    if (!tex) return

    gl.bindTexture(gl.TEXTURE_3D, tex)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)

    const ext = gl.getExtension('OES_texture_float_linear')
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

    if (ext) {
      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        gl.RGB32F,
        lut.size,
        lut.size,
        lut.size,
        0,
        gl.RGB,
        gl.FLOAT,
        lut.data,
      )
    } else {
      // Fallback to RGB8 Uint8Array for guaranteed hardware filtering
      const uint8 = new Uint8Array(lut.data.length)
      for (let i = 0; i < lut.data.length; i++) {
        uint8[i] = Math.round(Math.max(0, Math.min(1, lut.data[i])) * 255)
      }
      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        gl.RGB8,
        lut.size,
        lut.size,
        lut.size,
        0,
        gl.RGB,
        gl.UNSIGNED_BYTE,
        uint8,
      )
    }

    cache.set(id, { texture: tex, size: lut.size })
  }, [])

  /** Wipes the canvas so nothing from a previous frame outlives its source. */
  const clearCanvas = React.useCallback(() => {
    const gl = glRef.current
    if (!gl) return
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    hasContentRef.current = false
  }, [])

  // Draw loop
  const draw = React.useCallback((overrideSource?: HTMLVideoElement | HTMLImageElement | VideoFrame | null) => {
    const gl = glRef.current
    const program = programRef.current
    const canvas = canvasRef.current
    const source = overrideSource ?? sourceElement
    const currentFilterId = filterId

    const hasLut = Boolean(currentFilterId && lutTextureCacheRef.current.has(currentFilterId))
    const hasChroma = Boolean(chromaKey && chromaKey.enabled)
    const hasMatte = Boolean(autoMatte && autoMatte.enabled)
    const hasCustomMatte = Boolean(customMatte && customMatte.enabled && customMatte.strokes && customMatte.strokes.length > 0)
    const hasStroke = Boolean(stroke && stroke.enabled && stroke.style !== 'none' && stroke.width > 0)

    if (!gl || !program || !canvas) return
    if (!source || (!hasLut && !hasChroma && !hasMatte && !hasCustomMatte && !hasStroke)) {
      clearCanvas()
      return
    }

    // Check if source element has visual data
    const isVideo = source instanceof HTMLVideoElement
    const isImage = source instanceof HTMLImageElement
    const isFrame = typeof VideoFrame !== 'undefined' && source instanceof VideoFrame && source.format !== null

    if (isVideo && source.readyState < 2) return
    if (isImage && !source.complete) {
      clearCanvas()
      return
    }
    if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame && source.format === null) {
      return
    }

    const isBakeUsable = Boolean(
      hasMatte &&
      autoMatte &&
      bakeVideoPath &&
      bakeVideoRef.current &&
      !bakeFailedRef.current &&
      !bakeVideoRef.current.error &&
      bakeVideoRef.current.networkState !== 3
    )

    const sourceW = isVideo ? source.videoWidth : isImage ? source.naturalWidth : isFrame ? source.displayWidth : 0
    const sourceH = isVideo ? source.videoHeight : isImage ? source.naturalHeight : isFrame ? source.displayHeight : 0
    if (!sourceW || !sourceH) return

    const currentSourceTime = isVideo ? source.currentTime : isFrame ? source.timestamp / 1_000_000 : 0
    const activeClipId = clipId || 'clip-preview'

    // Realtime ONNX inference helper for non-baked clips
    const runLiveInference = () => {
      if (liveInferringRef.current) return
      liveInferringRef.current = true
      matteEngine.processFrame(source, {
        clipId: activeClipId,
        timestamp: currentSourceTime,
        quality: autoMatte?.quality,
        isPlaying,
      }).then(res => {
        liveInferringRef.current = false
        if (!isMountedRef.current || !res) return

        const stamp = `${activeClipId}:${res.timestamp}`
        if (lastMatteStampRef.current === stamp) return
        lastMatteStampRef.current = stamp
        uploadedMatteTimeRef.current = res.timestamp

        const currentGl = glRef.current
        const mTex = matteTextureRef.current
        if (!currentGl || !mTex) return

        currentGl.activeTexture(currentGl.TEXTURE2)
        currentGl.bindTexture(currentGl.TEXTURE_2D, mTex)
        currentGl.pixelStorei(currentGl.UNPACK_ALIGNMENT, 1)
        currentGl.texImage2D(
          currentGl.TEXTURE_2D,
          0,
          currentGl.R8,
          res.width,
          res.height,
          0,
          currentGl.RED,
          currentGl.UNSIGNED_BYTE,
          res.alphaData,
        )
        matteTextureSizeRef.current = { width: res.width, height: res.height }
        hasValidMatteRef.current = true
        if (!isPlayingRef.current) {
          draw()
        }
      }).catch(err => {
        liveInferringRef.current = false
        console.warn('[LutCanvas] Matte inference error:', err)
      })
    }

    // --- LOCKSTEP FRAME GUARD (Paused / Scrubbing) ---
    // If background removal is active, request synchronization without blocking video display
    if (!isPlaying && hasMatte && autoMatte) {
      const wantMatteTime = matteTimeForSourceTime(
        currentSourceTime,
        autoMatte.bake?.sourceStart ?? trimStart ?? 0,
        speed ?? 1,
      )

      // 1. High-speed WebCodecs Matte Player path
      const mattePlayer = matteWebCodecsPlayerRef.current
      if (mattePlayer && mattePlayer.isReady() && bakeVideoPath) {
        const currentMatteTime = matteFrameRef.current && matteFrameRef.current.format !== null
          ? matteFrameRef.current.timestamp / 1_000_000
          : -1
        const matteDrift = Math.abs(currentMatteTime - wantMatteTime)

        if (matteDrift > 0.03) {
          if (!isSeekingMatteRef.current) {
            isSeekingMatteRef.current = true
            mattePlayer.seek(wantMatteTime).then((frame) => {
              isSeekingMatteRef.current = false
              if (!isMountedRef.current || !frame) return
              matteFrameRef.current = frame
              bakeDecodedTimeRef.current = frame.timestamp / 1_000_000
              hasValidMatteRef.current = true

              if (pendingMatteTimeRef.current !== null) {
                const nextT = pendingMatteTimeRef.current
                pendingMatteTimeRef.current = null
                isSeekingMatteRef.current = true
                mattePlayer.seek(nextT).then((nextF) => {
                  isSeekingMatteRef.current = false
                  if (!isMountedRef.current || !nextF) return
                  matteFrameRef.current = nextF
                  bakeDecodedTimeRef.current = nextF.timestamp / 1_000_000
                  if (!isPlayingRef.current) drawRef.current()
                }).catch(() => {
                  isSeekingMatteRef.current = false
                })
              } else if (!isPlayingRef.current) {
                drawRef.current()
              }
            }).catch(() => {
              isSeekingMatteRef.current = false
            })
          } else {
            pendingMatteTimeRef.current = wantMatteTime
          }
        }
      } else if (isBakeUsable && bakeVideoRef.current) {
        // 2. Fallback HTMLVideoElement Matte path
        const bakeVideo = bakeVideoRef.current
        const seekDrift = Math.abs(bakeVideo.currentTime - wantMatteTime)

        const isVideoSource = isVideo || isFrame
        if (isVideoSource) {
          const clipSpeed = speed && speed > 0 ? speed : 1
          if (bakeVideo.playbackRate !== clipSpeed) {
            bakeVideo.playbackRate = clipSpeed
          }
          if (seekDrift > 0.03) {
            if (!bakeVideo.seeking) {
              bakeVideo.currentTime = wantMatteTime
              lastMatteSeekAtRef.current = performance.now()
            } else {
              pendingMatteSeekRef.current = wantMatteTime
            }
          }
        }
      } else if (!bakeVideoPath || bakeFailedRef.current) {
        // 3. Live inference path
        const stamp = `${activeClipId}:${currentSourceTime}`
        if (lastMatteStampRef.current !== stamp) {
          runLiveInference()
        }
      }
    }

    const resScale = playbackResolution ?? 1
    const maxDim = 1280
    let targetW = Math.round(sourceW * resScale)
    let targetH = Math.round(sourceH * resScale)
    if (targetW > maxDim || targetH > maxDim) {
      const down = maxDim / Math.max(targetW, targetH)
      targetW = Math.round(targetW * down)
      targetH = Math.round(targetH * down)
    }
    targetW = Math.max(2, Math.round(targetW / 2) * 2)
    targetH = Math.max(2, Math.round(targetH / 2) * 2)

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }

    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(program)

    // Unit 0: Video frame
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, imageTextureRef.current)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    } catch (err) {
      console.warn('[LutCanvas] Failed to upload source frame:', err)
      return
    }
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0)

    // Unit 1: 3D LUT
    gl.activeTexture(gl.TEXTURE1)
    if (hasLut && currentFilterId) {
      const lutEntry = lutTextureCacheRef.current.get(currentFilterId)
      if (lutEntry) {
        gl.bindTexture(gl.TEXTURE_3D, lutEntry.texture)
        gl.uniform1i(gl.getUniformLocation(program, 'u_lut'), 1)
        gl.uniform1i(gl.getUniformLocation(program, 'u_lut_enabled'), 1)
        const normIntensity = Math.max(0, Math.min(100, intensity)) / 100
        gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), normIntensity)
        gl.uniform1f(gl.getUniformLocation(program, 'u_lut_size'), lutEntry.size)
      } else {
        gl.bindTexture(gl.TEXTURE_3D, dummyLutTextureRef.current)
        gl.uniform1i(gl.getUniformLocation(program, 'u_lut'), 1)
        gl.uniform1i(gl.getUniformLocation(program, 'u_lut_enabled'), 0)
      }
    } else {
      gl.bindTexture(gl.TEXTURE_3D, dummyLutTextureRef.current)
      gl.uniform1i(gl.getUniformLocation(program, 'u_lut'), 1)
      gl.uniform1i(gl.getUniformLocation(program, 'u_lut_enabled'), 0)
      gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), 0)
      gl.uniform1f(gl.getUniformLocation(program, 'u_lut_size'), 1)
    }

    // Chroma key uniforms
    if (hasChroma && chromaKey) {
      gl.uniform1i(gl.getUniformLocation(program, 'u_chroma_enabled'), 1)
      const [cr, cg, cb] = hexToRgb01(chromaKey.color)
      gl.uniform3f(gl.getUniformLocation(program, 'u_chroma_color'), cr, cg, cb)
      gl.uniform1f(gl.getUniformLocation(program, 'u_chroma_similarity'), Math.max(0.0001, (chromaKey.similarity ?? 30) / 100))
      gl.uniform1f(gl.getUniformLocation(program, 'u_chroma_smoothness'), Math.max(0.0001, (chromaKey.smoothness ?? 10) / 100))
      gl.uniform1f(gl.getUniformLocation(program, 'u_chroma_spill'), Math.max(0, (chromaKey.spill ?? 10) / 100))
      gl.uniform1f(gl.getUniformLocation(program, 'u_chroma_clean'), Math.max(0, (chromaKey.cleanEdge ?? 0) / 100))
      gl.uniform1f(gl.getUniformLocation(program, 'u_chroma_feather'), Math.max(0, (chromaKey.featherEdge ?? 0) / 100))
    } else {
      gl.uniform1i(gl.getUniformLocation(program, 'u_chroma_enabled'), 0)
    }

    // Unit 2: Auto Matte (WebCodecs VideoFrame, Bake HTMLVideoElement, or Realtime inference)
    gl.activeTexture(gl.TEXTURE2)
    if (hasMatte && autoMatte) {
      if (matteFrameRef.current && typeof VideoFrame !== 'undefined' && matteFrameRef.current instanceof VideoFrame) {
        const frame = matteFrameRef.current
        gl.bindTexture(gl.TEXTURE_2D, bakeTextureRef.current)
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame)
        matteTextureSizeRef.current = {
          width: frame.displayWidth || 1,
          height: frame.displayHeight || 1,
        }
        hasValidMatteRef.current = true
      } else if (isBakeUsable && bakeVideoRef.current) {
        const bakeVideo = bakeVideoRef.current
        const wantTime = matteTimeForSourceTime(currentSourceTime, autoMatte.bake?.sourceStart ?? trimStart ?? 0, speed ?? 1)
        const drift = Math.abs(bakeVideo.currentTime - wantTime)

        const sync = decideBakeMatteSync({
          drift,
          isPlaying,
          ready: bakeVideo.readyState >= 2,
          msSinceLastSeek: performance.now() - lastMatteSeekAtRef.current,
        })

        const isVideoSource = isVideo || isFrame
        if (isVideoSource) {
          const clipSpeed = speed && speed > 0 ? speed : 1
          if (bakeVideo.playbackRate !== clipSpeed) {
            bakeVideo.playbackRate = clipSpeed
          }
          if (sync.seek) {
            if (!bakeVideo.seeking) {
              bakeVideo.currentTime = wantTime
              lastMatteSeekAtRef.current = performance.now()
            } else {
              pendingMatteSeekRef.current = wantTime
            }
          }
          if (isPlaying && bakeVideo.paused) {
            bakeVideo.play().catch(() => {})
          } else if (!isPlaying && !bakeVideo.paused) {
            bakeVideo.pause()
          }
        } else {
          if (bakeVideo.currentTime !== 0 && !bakeVideo.seeking) {
            bakeVideo.currentTime = 0
          }
        }

        // CRITICAL: NEVER upload bakeVideo while bakeVideo.seeking is true!
        const shouldUploadBake =
          !bakeVideo.seeking &&
          bakeVideo.readyState >= 2 &&
          (sync.use || (!isPlaying && bakeVideo.readyState >= 2) || !hasValidMatteRef.current)

        if (shouldUploadBake) {
          gl.bindTexture(gl.TEXTURE_2D, bakeTextureRef.current)
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bakeVideo)
          matteTextureSizeRef.current = {
            width: bakeVideo.videoWidth || 1,
            height: bakeVideo.videoHeight || 1,
          }
          hasValidMatteRef.current = true
        } else if (sync.drop) {
          hasValidMatteRef.current = false
        } else if (!hasValidMatteRef.current) {
          const cachedRes = matteEngine.getCachedResult(activeClipId)
          if (cachedRes) {
            gl.bindTexture(gl.TEXTURE_2D, matteTextureRef.current)
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.R8,
              cachedRes.width,
              cachedRes.height,
              0,
              gl.RED,
              gl.UNSIGNED_BYTE,
              cachedRes.alphaData,
            )
            matteTextureSizeRef.current = { width: cachedRes.width, height: cachedRes.height }
            hasValidMatteRef.current = true
          }
        }

      } else if (!bakeVideoPath || bakeFailedRef.current) {
        // Fall through to live inference when there is genuinely no bake OR
        // when the bake file is gone from disk
        gl.bindTexture(gl.TEXTURE_2D, matteTextureRef.current)

        // If a cached matte exists (e.g. for static images), upload it immediately
        const cachedRes = matteEngine.getCachedResult(activeClipId)
        if (cachedRes && ((!isVideo && !isFrame) || lastMatteStampRef.current === null)) {
          const stamp = `${activeClipId}:${cachedRes.timestamp}`
          if (lastMatteStampRef.current !== stamp) {
            lastMatteStampRef.current = stamp
            uploadedMatteTimeRef.current = cachedRes.timestamp
            gl.activeTexture(gl.TEXTURE2)
            gl.bindTexture(gl.TEXTURE_2D, matteTextureRef.current)
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.R8,
              cachedRes.width,
              cachedRes.height,
              0,
              gl.RED,
              gl.UNSIGNED_BYTE,
              cachedRes.alphaData,
            )
            matteTextureSizeRef.current = { width: cachedRes.width, height: cachedRes.height }
            hasValidMatteRef.current = true
          }
        }

        const stamp = `${activeClipId}:${currentSourceTime}`
        if (lastMatteStampRef.current !== stamp) {
          runLiveInference()
        }
      }

      // One rule for both paths: never apply a matte that does not belong to this moment.
      // Live inference can fall behind — it is skipped outright during playback on CPU —
      // and a matte held from seconds ago is not a cut-out any more, it is a silhouette
      // pasted across a subject that has since moved. Show the frame uncut instead.
      // NOTE: This only applies to videos where the subject moves over time. Still images
      // never go out of date, so their matte stays valid across all timeline positions.
      let matteEnabled = hasValidMatteRef.current
      if (matteEnabled && (isVideo || isFrame) && isPlaying) {
        const currentSourceTime = isVideo ? source.currentTime : isFrame ? source.timestamp / 1_000_000 : 0
        if (bakeVideoPath && bakeVideoRef.current) {
          const wantTime = matteTimeForSourceTime(currentSourceTime, autoMatte?.bake?.sourceStart ?? trimStart ?? 0, speed ?? 1)
          const drift = Math.abs(bakeVideoRef.current.currentTime - wantTime)
          // Suppress matte only if the baked video genuinely drifts beyond STALE_MATTE_SECONDS.
          // Never suppress purely on bakeVideo.seeking: video seeking is asynchronous (20-40ms),
          // and dropping the matte during each seek step makes the background violently blink in/out.
          if (drift > STALE_MATTE_SECONDS) {
            matteEnabled = false
          }
        } else if (!bakeVideoPath && uploadedMatteTimeRef.current !== null) {
          if (Math.abs(currentSourceTime - uploadedMatteTimeRef.current) > STALE_MATTE_SECONDS) {
            matteEnabled = false
          }
        }
      }
      gl.uniform1i(gl.getUniformLocation(program, 'u_matte_enabled'), matteEnabled ? 1 : 0)
      gl.uniform1i(gl.getUniformLocation(program, 'u_matte'), 2)
      // Both numbers are defined in core and shared with the export filtergraph.
      const band = matteAlphaBand(autoMatte.cleanEdge)
      gl.uniform1f(gl.getUniformLocation(program, 'u_matte_lo'), band.lo)
      gl.uniform1f(gl.getUniformLocation(program, 'u_matte_hi'), band.hi)
      gl.uniform1f(
        gl.getUniformLocation(program, 'u_matte_sigma'),
        matteFeatherSigma(autoMatte.featherEdge),
      )
      // The blur is expressed in matte pixels, so it needs the size of whatever was last
      // uploaded to unit 2 — the bake video and a live inference result differ, and both
      // differ from the canvas.
      const matteSize = matteTextureSizeRef.current
      gl.uniform2f(
        gl.getUniformLocation(program, 'u_matte_texel'),
        1 / Math.max(1, matteSize.width),
        1 / Math.max(1, matteSize.height),
      )
    } else {
      gl.bindTexture(gl.TEXTURE_2D, matteTextureRef.current)
      gl.uniform1i(gl.getUniformLocation(program, 'u_matte_enabled'), 0)
    }

    // Unit 3: Custom Matte (additive in R, subtractive in G)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, customMatteTextureRef.current)
    if (hasCustomMatte && customMatte) {
      const strokesHash = computeStrokesHash(customMatte.strokes)
      if (customMatteHashRef.current !== strokesHash) {
        const maskW = 512
        const maskH = Math.max(1, Math.round(512 * (canvas.height / canvas.width)))
        const raster = rasterizeStrokes(customMatte.strokes, maskW, maskH)
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
      gl.uniform1i(gl.getUniformLocation(program, 'u_custom_matte'), 3)
    } else {
      gl.uniform1i(gl.getUniformLocation(program, 'u_custom_matte_enabled'), 0)
    }

    // Resolution uniform for stroke calculation
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), canvas.width, canvas.height)

    // Stroke uniforms
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
      gl.uniform1i(gl.getUniformLocation(program, 'u_stroke_enabled'), 1)
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
    } else {
      gl.uniform1i(gl.getUniformLocation(program, 'u_stroke_enabled'), 0)
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    hasContentRef.current = true
    // `currentTime` deliberately absent.
    //
    // Nothing in here reads it — the video's own `currentTime` is what the matte syncs to,
    // and a still reports timestamp 0 because its picture never changes. Taking the prop as
    // a dependency anyway gave `draw` a new identity on every playhead tick, and the three
    // effects below all depend on `draw`: dragging the playhead tore down and rebuilt the
    // rAF loop, re-bound the image load listener, and forced a full WebGL redraw — plus a
    // live matte inference per pointer move on any clip without a baked matte. Redraws come
    // from `renderNow()` on the frame-render path, which fires when the picture actually
    // changes.
  }, [clearCanvas, filterId, intensity, chromaKey, autoMatte, customMatte, stroke, clipId, playbackResolution, bakeVideoPath, isPlaying, sourceElement])

  drawRef.current = draw

  /**
   * A still is decoded asynchronously, so the first draw after it is mounted or
   * its src is swapped usually finds `complete === false`. Nothing else would
   * come back to it — the paused path only redraws when a prop changes — so the
   * element itself has to say when it is ready.
   */
  React.useEffect(() => {
    if (!(sourceElement instanceof HTMLImageElement)) return
    const image = sourceElement
    const onLoad = () => draw()
    image.addEventListener('load', onLoad)
    return () => image.removeEventListener('load', onLoad)
  }, [draw, sourceElement])

  /**
   * The same, for the source VIDEO — the half that was missing.
   *
   * `draw` bails on `readyState < 2` because there is genuinely no frame to sample yet,
   * and while paused nothing ever comes back: `renderNow()` fires once, from the frame
   * render path, at the moment the playhead moves. Opening a project calls it while the
   * pooled video is still at `readyState` 0, and dragging the playhead calls it while the
   * video is still seeking, so in both cases the canvas kept whatever it had — nothing.
   *
   * That was invisible for as long as the raw `<video>` showed through from underneath.
   * Once it is hidden (which it must be, or the removed background shows through the
   * cut-out) the canvas is the only picture there is, and a canvas that never redraws is
   * a black monitor. Pressing play papered over it because the rAF loop redraws every
   * frame regardless.
   *
   * `drawRef` rather than `draw` as a dependency: `draw` is a new function on nearly
   * every render, and re-binding three listeners that often is pure churn on a hot path.
   */
  React.useEffect(() => {
    if (!(sourceElement instanceof HTMLVideoElement)) return
    const video = sourceElement
    const redraw = () => {
      sourceDecodedTimeRef.current = video.currentTime
      lastSourceSeekAtRef.current = performance.now()
      // Playback has its own rAF loop; this is for the paused and scrubbing cases.
      if (!isPlayingRef.current) drawRef.current()
    }
    // A pooled video is shared and may already be decoded by the time this canvas is
    // handed it, in which case no further event is coming.
    if (video.readyState >= 2) redraw()
    video.addEventListener('loadeddata', redraw)
    video.addEventListener('seeked', redraw)
    video.addEventListener('canplay', redraw)
    return () => {
      video.removeEventListener('loadeddata', redraw)
      video.removeEventListener('seeked', redraw)
      video.removeEventListener('canplay', redraw)
    }
  }, [sourceElement])

  React.useEffect(() => {
    if (typeof VideoFrame !== 'undefined' && sourceElement instanceof VideoFrame) {
      sourceDecodedTimeRef.current = sourceElement.timestamp / 1_000_000
      lastSourceSeekAtRef.current = performance.now()
      if (!isPlayingRef.current) drawRef.current()
    }
  }, [sourceElement])

  // Playback requestAnimationFrame loop
  React.useEffect(() => {
    const shouldPlay = isPlaying && (
      (Boolean(filterId) && intensity > 0) ||
      Boolean(chromaKey?.enabled) ||
      Boolean(autoMatte?.enabled) ||
      Boolean(stroke?.enabled && stroke.style !== 'none' && stroke.width > 0)
    )
    if (!shouldPlay) {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current)
        animFrameIdRef.current = 0
      }
      return
    }

    const loop = () => {
      draw()
      animFrameIdRef.current = requestAnimationFrame(loop)
    }

    animFrameIdRef.current = requestAnimationFrame(loop)
    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current)
        animFrameIdRef.current = 0
      }
    }
  }, [draw, isPlaying, filterId, intensity, chromaKey, autoMatte, customMatte, stroke])

  // Redraw when source, filter, intensity, chromaKey, autoMatte, customMatte, or stroke changes while paused
  React.useEffect(() => {
    if (!isPlaying) {
      draw()
    }
  }, [draw, isPlaying, filterId, intensity, chromaKey, autoMatte, customMatte, stroke, playbackResolution, bakeVideoPath])

  React.useImperativeHandle(
    ref,
    () => ({
      renderNow: (overrideSource?: HTMLVideoElement | HTMLImageElement | VideoFrame | null) => draw(overrideSource),
      getCanvas: () => canvasRef.current,
      clear: clearCanvas,
      hasContent: () => hasContentRef.current,
    }),
    [clearCanvas, draw],
  )

  const isVisible = Boolean(
    (filterId && intensity > 0) ||
    (chromaKey && chromaKey.enabled) ||
    (autoMatte && autoMatte.enabled) ||
    (customMatte && customMatte.enabled && customMatte.strokes && customMatte.strokes.length > 0) ||
    (stroke && stroke.enabled && stroke.style !== 'none' && stroke.width > 0)
  )

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        ...style,
        display: isVisible ? style?.display ?? 'block' : 'none',
      }}
    />
  )
})
