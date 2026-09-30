import type { CubeLut } from '@core/lut'
import { VERTEX_SHADER, FRAGMENT_SHADER } from './lut-canvas-shaders'

export interface LutWebglResources {
  program: WebGLProgram
  vbo: WebGLBuffer
  imgTex: WebGLTexture
  dummyTex: WebGLTexture
  matteTex: WebGLTexture
  bakeTex: WebGLTexture
  customTex: WebGLTexture
}

export function initLutWebgl(gl: WebGL2RenderingContext): LutWebglResources | null {
  // Compile shaders
  const vs = gl.createShader(gl.VERTEX_SHADER)
  if (!vs) return null
  gl.shaderSource(vs, VERTEX_SHADER)
  gl.compileShader(vs)

  const fs = gl.createShader(gl.FRAGMENT_SHADER)
  if (!fs) {
    gl.deleteShader(vs)
    return null
  }
  gl.shaderSource(fs, FRAGMENT_SHADER)
  gl.compileShader(fs)

  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    return null
  }
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[LutCanvas] Shader link error:', gl.getProgramInfoLog(program))
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    gl.deleteProgram(program)
    return null
  }

  // Fullscreen Quad geometry
  const quad = new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
     1,  1,
  ])
  const vbo = gl.createBuffer()
  if (!vbo) {
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    gl.deleteProgram(program)
    return null
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)

  const posLoc = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  // Image texture on Unit 0
  const imgTex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, imgTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  // 1x1x1 dummy 3D texture on Unit 1 fallback
  const dummyTex = gl.createTexture()!
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

  // Realtime matte texture on Unit 2 (1-channel R8)
  const matteTex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, matteTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]))

  // Baked video matte texture on Unit 2 (RGBA)
  const bakeTex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, bakeTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]))

  // Custom matte texture on Unit 3 (RGBA)
  const customTex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, customTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))

  return {
    program,
    vbo,
    imgTex,
    dummyTex,
    matteTex,
    bakeTex,
    customTex,
  }
}

export function create3DLutTexture(gl: WebGL2RenderingContext, lut: CubeLut): WebGLTexture | null {
  const tex = gl.createTexture()
  if (!tex) return null

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

  return tex
}
