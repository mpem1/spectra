/**
 * GPU depth-parallax warp — the engine behind the 3D Glasses filter's
 * 'foreground' (Pop-out 3D) depth perspective.
 *
 * The finished frame is re-projected twice (once per eye) on a tiny WebGL
 * pass: every pixel samples the picture horizontally offset by ITS OWN
 * depth amount, read from a small luminance-derived depth map (see
 * buildDepthField in anaglyph-filter.ts). Near pixels get crossed
 * parallax — the left-eye view lands right of the right-eye view — so
 * they pop OUT toward the camera; far pixels get uncrossed parallax and
 * recede behind the screen plane. Because the warp is per-pixel the
 * subject detaches from its backdrop in every direction: no strips, no
 * bands, no sliding, no renormalization jitter — a still picture with a
 * steady amp renders byte-identical frames.
 *
 * Determinism: the GL path runs on the same device for the live preview
 * and every export, and the same (frame, config) always feeds the same
 * textures and uniforms — frame-exact on a given machine (sub-precision
 * rounding may differ across GPU models, imperceptibly). If WebGL is
 * unavailable or the context dies, warpDepthViews returns false and the
 * filter falls back to a uniform left/right spread for that frame.
 */

interface WarpEntry {
  canvas: HTMLCanvasElement
  gl: WebGLRenderingContext
  program: WebGLProgram
  quad: WebGLBuffer
  snapTex: WebGLTexture
  depthTex: WebGLTexture
  uSnap: WebGLUniformLocation
  uDepth: WebGLUniformLocation
  uAmp: WebGLUniformLocation
  uEye: WebGLUniformLocation
  uTexel: WebGLUniformLocation
}

const VERT_SRC = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG_SRC = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uSnap;
uniform sampler2D uDepth;
uniform float uAmp;
uniform float uEye;
uniform vec2 uTexel;
void main() {
  float d = texture2D(uDepth, vUv).r;
  float s = uAmp * (2.0 * d - 0.75);
  vec2 uv = vec2(vUv.x + uEye * s * uTexel.x, vUv.y);
  gl_FragColor = vec4(texture2D(uSnap, uv).rgb, 1.0);
}`

/** One GL context per canvas size (preview + export can differ), capped —
 *  browsers only keep a handful of live contexts per page. */
const warps = new Map<string, WarpEntry>()
const MAX_WARP_CONTEXTS = 4

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile failed')
  }
  return sh
}

function makeWarp(w: number, h: number, key: string): WarpEntry | null {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
  }) as WebGLRenderingContext | null
  if (!gl) return null

  // A lost context invalidates everything cached on it — drop the entry so
  // the next call rebuilds (and the filter falls back until then).
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    warps.delete(key)
  })

  const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
  const program = gl.createProgram()!
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed')
  }
  gl.useProgram(program)

  // Fullscreen quad. vUv = pos * 0.5 + 0.5 puts v = 1 at the top of the
  // drawing buffer; both textures are uploaded with UNPACK_FLIP_Y_WEBGL so
  // v = 1 is the canvas' top row — snap and depth stay in perfect register.
  const quad = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(program, 'aPos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  const makeTex = (): WebGLTexture => {
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    // NPOT-safe sampling: linear, clamp — no mipmaps.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }
  const snapTex = makeTex()
  const depthTex = makeTex()
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)

  return {
    canvas,
    gl,
    program,
    quad,
    snapTex,
    depthTex,
    uSnap: gl.getUniformLocation(program, 'uSnap')!,
    uDepth: gl.getUniformLocation(program, 'uDepth')!,
    uAmp: gl.getUniformLocation(program, 'uAmp')!,
    uEye: gl.getUniformLocation(program, 'uEye')!,
    uTexel: gl.getUniformLocation(program, 'uTexel')!,
  }
}

/** Evict the oldest entry when the cache overflows (keep the one just used). */
function evictWarps(keepKey: string): void {
  for (const key of warps.keys()) {
    if (warps.size <= MAX_WARP_CONTEXTS) break
    if (key === keepKey) continue
    const entry = warps.get(key)
    entry?.gl.getExtension('WEBGL_lose_context')?.loseContext()
    warps.delete(key)
  }
}

/**
 * Re-project `snap` into the two per-eye views `vl` / `vr` using the depth
 * map in `depth` (R channel, 0..1, same orientation). `ampPx` is the signed
 * warp amount in pixels: depth 1 samples ±1.25·amp per eye (crossed — pops
 * out), depth 0 samples ∓0.75·amp (recessed), depth 0.375 stays on the
 * screen plane. Returns false when WebGL is unavailable — the caller falls
 * back to a uniform spread.
 */
export function warpDepthViews(
  snap: HTMLCanvasElement,
  depth: HTMLCanvasElement,
  vl: HTMLCanvasElement,
  vr: HTMLCanvasElement,
  ampPx: number,
): boolean {
  const w = snap.width
  const h = snap.height
  const key = `${w}x${h}`
  let entry = warps.get(key)
  if (!entry) {
    try {
      entry = makeWarp(w, h, key)
    } catch {
      entry = null
    }
    if (!entry) return false
    warps.set(key, entry)
    evictWarps(key)
  }
  const { gl } = entry
  if (gl.isContextLost()) return false

  try {
    gl.useProgram(entry.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, entry.snapTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, snap)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, entry.depthTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, depth)
    gl.viewport(0, 0, w, h)
    gl.uniform1i(entry.uSnap, 0)
    gl.uniform1i(entry.uDepth, 1)
    gl.uniform1f(entry.uAmp, ampPx)
    gl.uniform2f(entry.uTexel, 1 / w, 1 / h)

    // Left eye first, copy out, then the right eye. The GL canvas is opaque
    // and fully overwritten each draw, so each drawImage blits a complete
    // view — no gaps, no other-lens patching needed downstream.
    gl.uniform1f(entry.uEye, -1)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    vl.getContext('2d')!.drawImage(entry.canvas, 0, 0)
    gl.uniform1f(entry.uEye, 1)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    vr.getContext('2d')!.drawImage(entry.canvas, 0, 0)
    return true
  } catch {
    return false
  }
}
