/**
 * Camcorder filter — effect.app's "Backrooms" preset, ported 1:1 from its
 * ACTUAL shaders (captured verbatim off the live editor via a
 * WebGLRenderingContext.shaderSource hook while it compiled
 * ?effect=backrooms; the captured sources ship unmodified in
 * camcorder-shaders.ts).
 *
 * Backrooms is a three-layer preset stack, rendered here in their exact
 * layer order:
 *
 *   1. VHS           — an analog tape pipeline: the frame resamples onto a
 *                      lo-fi internal grid (the "resolution" dial), YIQ
 *                      encode/decode through a PAL-style quadrature carrier
 *                      (per-line phase jitter, PAL line alternation, gaussian
 *                      chroma taps, chroma delay), tape-wave wobble, a
 *                      tearing crease with sparkle, bottom head-switch
 *                      tracking noise, 29.97fps frame-quantized vertical
 *                      jumps, AC flicker, RGB grain, sharpening and a YIQ
 *                      color shift.
 *   2. Color grading — Oklab zone grading: the pixel's log2 exposure picks
 *                      five zone weights (black/shadow/light/highlight/
 *                      specular) through smoothstep pivots; each zone pushes
 *                      exposure (stops), an Oklab a/b tint and saturation.
 *                      The Backrooms preset's zone values (the yellow-green
 *                      tape cast) are baked in exactly as their preset
 *                      ships; the master Strength dial is exposed.
 *   3. Gaussian blur — two kernel passes (horizontal then vertical, smooth
 *                      ease falloff, radius = strength × 2.6412 px) blended
 *                      back over the graded frame at the blur-mix opacity
 *                      (the preset ships 0.05 — a faint haze).
 *
 * Every noise source is hash-based (hash12/valueNoise256), so the same song
 * second always renders the same pixels — the live preview, the MP4 export
 * and the PNG sequence agree frame-exactly. The tape clock is song time
 * (frame.time): pause the song, the tape pauses — the same media-artifact
 * contract as the VHS filter. Skipped on transparent backgrounds so alpha
 * recordings stay clean.
 *
 * GPU path: one WebGL2 context runs the five captured programs through
 * framebuffer ping-pong and composites the finished print back onto the
 * frame (one texture upload + five quads per frame). WebGL2 is required
 * because the original blur kernels loop to a data-dependent radius — legal
 * GLSL ES 3.00, impossible to unroll in ES 1.00. A full JS transcription of
 * the same math serves WebGL-less devices (float64 vs the GPU's float32 can
 * round ±1/255 differently, but the algorithm is identical).
 */
import type { AudioFrame, CamcorderFilterConfig, RenderContext } from './types'
import { beatAmount, clamp01, getWork, resetWork } from './filter-utils'
import {
  CAMCORDER_VERT,
  CAMCORDER_VHS_FRAG,
  CAMCORDER_GRADE_FRAG,
  CAMCORDER_BLUR_H_FRAG,
  CAMCORDER_BLUR_V_FRAG,
  CAMCORDER_BLUR_MIX_FRAG,
} from './camcorder-shaders'

/* --------------------------- the Backrooms grade --------------------------- */
/* The color-grading layer's zone values — captured from the live uniform
 * stream exactly as the Backrooms preset sets them. Tint is an Oklab a/b
 * push (the wheel dial), exposure is stops, pivots sit in log2 exposure
 * space. `tint_scale` is their hidden 0.15 constant. */
const GRADE_PRESET = {
  tintGlobal: [-0.06, -0.05],
  expGlobal: 0,
  satGlobal: 1,
  tintBlack: [0, 0],
  expBlack: -0.06,
  satBlack: 0.95,
  tintShadow: [-0.037, 0.213],
  expShadow: 0.32,
  satShadow: 1.07,
  tintLight: [0.087, 0.975],
  expLight: -0.13,
  satLight: 0.8,
  tintHighlight: [-0.176, 0.984],
  expHighlight: 0,
  satHighlight: 0.91,
  tintSpec: [-0.025, 0.325],
  expSpec: 0.06,
  satSpec: 0.89,
  pivotBlack: -4,
  pivotMid: 0,
  pivotHigh: 1.8,
  pivotSpec: 2,
  falloff: 1.98,
  tintScale: 0.15,
  showZones: 0,
} as const

/** Their composite's Normal blend (blendMode 0) — blurred over original. */
const BLEND_MODE_NORMAL = 0

/** The blur kernel's radius constant, straight from the captured shader. */
const BLUR_RADIUS_K = 2.6412

/* --------------------------------- params --------------------------------- */

interface CamcorderParams {
  /** Song time — the tape clock (iTime / iGlobalTime) */
  time: number
  /** Frame-quantized tape frame counter (iFrame) */
  vhsFrame: number
  resolution: number
  distortion: number
  colorFringing: number
  wobble: number
  tapeCrease: number
  tracking: number
  verticalJump: number
  sparkle: number
  flicker: number
  grain: number
  saturation: number
  colorShift: number
  colorBlend: number
  softness: number
  colorDelay: number
  sharpening: number
  blur: number
  blurMix: number
  gradeStrength: number
}

function resolveCamcorder(cfg: CamcorderFilterConfig, frame: Pick<AudioFrame, 'time' | 'bass'>): CamcorderParams {
  // Beat jolt — additive on kicks, resting exactly at the dialed look: the
  // tracking smear, the crease and the vertical jump punch past their dials.
  const beat = beatAmount(cfg, frame.bass)
  const time = frame.time
  return {
    time,
    vhsFrame: Math.floor(time * 29.97),
    resolution: cfg.resolution ?? 420,
    distortion: cfg.distortion ?? 0,
    colorFringing: cfg.colorFringing ?? 0,
    wobble: cfg.wobble ?? 0.59,
    tapeCrease: (cfg.tapeCrease ?? 0.37) + beat * 0.5,
    tracking: (cfg.trackingNoise ?? 2) + beat * 0.8,
    verticalJump: (cfg.verticalJump ?? 0.01) + beat * 0.15,
    sparkle: cfg.sparkle ?? 0.31,
    flicker: cfg.flicker ?? 0.06,
    grain: cfg.grain ?? 0.75,
    saturation: cfg.saturation ?? 1,
    colorShift: cfg.colorShift ?? 0.1,
    colorBlend: clamp01(cfg.colorBlend ?? 1),
    softness: cfg.softness ?? 0.4,
    colorDelay: cfg.colorDelay ?? 4.8,
    sharpening: cfg.sharpening ?? 1.14,
    blur: cfg.blur ?? 3.87,
    blurMix: clamp01(cfg.blurMix ?? 0.05),
    gradeStrength: clamp01(cfg.gradeStrength ?? 1),
  }
}

/* ------------------------------ GL plumbing -------------------------------- */

interface CamProg {
  program: WebGLProgram
  u: Record<string, WebGLUniformLocation | null>
}

interface CamLayer {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
}

interface CamcorderGL {
  canvas: HTMLCanvasElement
  gl: WebGL2RenderingContext
  quad: WebGLBuffer
  srcTex: WebGLTexture
  /** a: VHS out · b: graded out · c: blur-H out · d: blur-V out */
  a: CamLayer
  b: CamLayer
  c: CamLayer
  d: CamLayer
  vhs: CamProg
  grade: CamProg
  blurH: CamProg
  blurV: CamProg
  mix: CamProg
  w: number
  h: number
}

let camGL: CamcorderGL | null = null
/** One-time diagnostic: which path actually renders (logged once). */
let camPathLogged = false

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    if (typeof console !== 'undefined') console.error('[camcorder] shader compile failed:', log?.slice(0, 400))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

function buildProgram(gl: WebGL2RenderingContext, fragSrc: string, uNames: string[]): CamProg | null {
  const vs = compile(gl, gl.VERTEX_SHADER, CAMCORDER_VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc)
  const program = gl.createProgram()
  if (!vs || !fs || !program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (typeof console !== 'undefined') console.error('[camcorder] program link failed:', gl.getProgramInfoLog(program)?.slice(0, 400))
    return null
  }
  const u: Record<string, WebGLUniformLocation | null> = {}
  for (const name of uNames) u[name] = gl.getUniformLocation(program, name)
  return { program, u }
}

/** The captured shaders' uniform names — every location is looked up but
 *  unused/optimized-out ones stay null and are skipped by the setters. */
const COMMON_U = ['iResolution', 'iTime', 'iGlobalTime', 'iAspect', 'iFrame', 'iMouse', 'iSrcResolution', 'iWindowOffset', 'iWindowSize']

const VHS_U = [
  ...COMMON_U,
  'iChannel0',
  'internalWidth',
  'distortion',
  'colorBleed',
  'tapeWave',
  'tapeCrease',
  'tracking',
  'verticalJump',
  'creaseSparkle',
  'acBeat',
  'chromaNoise',
  'saturation',
  'yiqShift',
  'colorUnderMix',
  'lumaBandwidth',
  'chromaDelay',
  'sharpening',
]

const GRADE_U = [
  ...COMMON_U,
  'iChannel0',
  'tint_global',
  'exp_global',
  'sat_global',
  'tint_black',
  'exp_black',
  'sat_black',
  'tint_shadow',
  'exp_shadow',
  'sat_shadow',
  'tint_light',
  'exp_light',
  'sat_light',
  'tint_highlight',
  'exp_highlight',
  'sat_highlight',
  'tint_spec',
  'exp_spec',
  'sat_spec',
  'pivot_black',
  'pivot_mid',
  'pivot_high',
  'pivot_spec',
  'falloff',
  'tint_scale',
  'show_zones',
  'strength',
]

const BLUR_U = [...COMMON_U, 'iChannel0', 'strength', 'aspect']
const MIX_U = [...COMMON_U, 'iChannel0', 'iChannel7', 'opacity', 'blendMode']

function makeLayer(gl: WebGL2RenderingContext, w: number, h: number): CamLayer | null {
  const tex = gl.createTexture()
  const fbo = gl.createFramebuffer()
  if (!tex || !fbo) return null
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  return { tex, fbo }
}

/** Build (or rebuild) the offscreen GL bundle. Returns null when WebGL2 is
 *  unavailable or the captured programs fail — the caller falls back to the
 *  CPU path. */
function getGL(w: number, h: number): CamcorderGL | null {
  if (camGL) return camGL
  try {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null
    if (!gl) return null

    const vhs = buildProgram(gl, CAMCORDER_VHS_FRAG, VHS_U)
    const grade = buildProgram(gl, CAMCORDER_GRADE_FRAG, GRADE_U)
    const blurH = buildProgram(gl, CAMCORDER_BLUR_H_FRAG, BLUR_U)
    const blurV = buildProgram(gl, CAMCORDER_BLUR_V_FRAG, BLUR_U)
    const mix = buildProgram(gl, CAMCORDER_BLUR_MIX_FRAG, MIX_U)
    if (!vhs || !grade || !blurH || !blurV || !mix) return null

    // Fullscreen quad — positions + UVs. aUV = (aPos+1)/2 so vUV0 *
    // iResolution equals gl_FragCoord: exactly the engine's coord=pixel
    // convention that every captured shader assumes.
    const quad = gl.createBuffer()
    if (!quad) return null
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 0, 0,
        1, -1, 1, 0,
        -1, 1, 0, 1,
        1, 1, 1, 1,
      ]),
      gl.STATIC_DRAW,
    )

    // Source texture — the finished frame uploads here each draw. Row 0 of
    // the 2D canvas (its top) lands at v=1 so the y-up GL coordinates match
    // the captured shaders' gl_FragCoord convention.
    const srcTex = gl.createTexture()
    if (!srcTex) return null
    gl.bindTexture(gl.TEXTURE_2D, srcTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))

    const a = makeLayer(gl, w, h)
    const b = makeLayer(gl, w, h)
    const c = makeLayer(gl, w, h)
    const d = makeLayer(gl, w, h)
    if (!a || !b || !c || !d) return null
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    camGL = { canvas, gl, quad, srcTex, a, b, c, d, vhs, grade, blurH, blurV, mix, w: 0, h: 0 }
    return camGL
  } catch {
    return null
  }
}

function bindQuad(gl: WebGL2RenderingContext, prog: CamProg): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, camGL!.quad)
  const aPos = gl.getAttribLocation(prog.program, 'aPos')
  const aUV = gl.getAttribLocation(prog.program, 'aUV')
  if (aPos >= 0) {
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0)
  }
  if (aUV >= 0) {
    gl.enableVertexAttribArray(aUV)
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 12)
  }
}

function setCommonUniforms(
  gl: WebGL2RenderingContext,
  prog: CamProg,
  W: number,
  H: number,
  p: CamcorderParams,
): void {
  const { u } = prog
  if (u.iResolution) gl.uniform2f(u.iResolution, W, H)
  if (u.iSrcResolution) gl.uniform2f(u.iSrcResolution, W, H)
  if (u.iWindowOffset) gl.uniform2f(u.iWindowOffset, 0, 0)
  if (u.iWindowSize) gl.uniform2f(u.iWindowSize, W, H)
  if (u.iTime) gl.uniform1f(u.iTime, p.time)
  if (u.iGlobalTime) gl.uniform1f(u.iGlobalTime, p.time)
  if (u.iAspect) gl.uniform1f(u.iAspect, W / Math.max(H, 1))
  if (u.iFrame) gl.uniform1i(u.iFrame, p.vhsFrame)
  if (u.iMouse) gl.uniform4f(u.iMouse, 0, 0, 0, 0)
}

/** Run one captured program into `target` (null = the composite target). */
function runPass(
  g: CamcorderGL,
  prog: CamProg,
  target: CamLayer | null,
  W: number,
  H: number,
  p: CamcorderParams,
  bindInputs: () => void,
): void {
  const { gl } = g
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null)
  gl.viewport(0, 0, W, H)
  gl.useProgram(prog.program)
  bindQuad(gl, prog)
  setCommonUniforms(gl, prog, W, H, p)
  bindInputs()
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

function drawGL(g: CamcorderGL, rc: RenderContext, p: CamcorderParams): void {
  const { gl } = g
  const { width: W, height: H, ctx } = rc
  if (g.w !== W || g.h !== H) {
    g.canvas.width = W
    g.canvas.height = H
    g.w = W
    g.h = H
    for (const layer of [g.a, g.b, g.c, g.d]) {
      gl.bindTexture(gl.TEXTURE_2D, layer.tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    }
  }

  // The finished frame IS the source texture.
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, g.srcTex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas)

  // Pass 1 — VHS pipeline → a
  runPass(g, g.vhs, g.a, W, H, p, () => {
    const { u } = g.vhs
    if (u.iChannel0) gl.uniform1i(u.iChannel0, 0)
    if (u.internalWidth) gl.uniform1f(u.internalWidth, p.resolution)
    if (u.distortion) gl.uniform1f(u.distortion, p.distortion)
    if (u.colorBleed) gl.uniform1f(u.colorBleed, p.colorFringing)
    if (u.tapeWave) gl.uniform1f(u.tapeWave, p.wobble)
    if (u.tapeCrease) gl.uniform1f(u.tapeCrease, p.tapeCrease)
    if (u.tracking) gl.uniform1f(u.tracking, p.tracking)
    if (u.verticalJump) gl.uniform1f(u.verticalJump, p.verticalJump)
    if (u.creaseSparkle) gl.uniform1f(u.creaseSparkle, p.sparkle)
    if (u.acBeat) gl.uniform1f(u.acBeat, p.flicker)
    if (u.chromaNoise) gl.uniform1f(u.chromaNoise, p.grain)
    if (u.saturation) gl.uniform1f(u.saturation, p.saturation)
    if (u.yiqShift) gl.uniform1f(u.yiqShift, p.colorShift)
    if (u.colorUnderMix) gl.uniform1f(u.colorUnderMix, p.colorBlend)
    if (u.lumaBandwidth) gl.uniform1f(u.lumaBandwidth, p.softness)
    if (u.chromaDelay) gl.uniform1f(u.chromaDelay, p.colorDelay)
    if (u.sharpening) gl.uniform1f(u.sharpening, p.sharpening)
  })

  // Pass 2 — Oklab zone grade (the Backrooms preset values) → b
  runPass(g, g.grade, g.b, W, H, p, () => {
    const { u } = g.grade
    if (u.iChannel0) gl.uniform1i(u.iChannel0, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, g.a.tex)
    if (u.tint_global) gl.uniform2f(u.tint_global, GRADE_PRESET.tintGlobal[0], GRADE_PRESET.tintGlobal[1])
    if (u.exp_global) gl.uniform1f(u.exp_global, GRADE_PRESET.expGlobal)
    if (u.sat_global) gl.uniform1f(u.sat_global, GRADE_PRESET.satGlobal)
    if (u.tint_black) gl.uniform2f(u.tint_black, GRADE_PRESET.tintBlack[0], GRADE_PRESET.tintBlack[1])
    if (u.exp_black) gl.uniform1f(u.exp_black, GRADE_PRESET.expBlack)
    if (u.sat_black) gl.uniform1f(u.sat_black, GRADE_PRESET.satBlack)
    if (u.tint_shadow) gl.uniform2f(u.tint_shadow, GRADE_PRESET.tintShadow[0], GRADE_PRESET.tintShadow[1])
    if (u.exp_shadow) gl.uniform1f(u.exp_shadow, GRADE_PRESET.expShadow)
    if (u.sat_shadow) gl.uniform1f(u.sat_shadow, GRADE_PRESET.satShadow)
    if (u.tint_light) gl.uniform2f(u.tint_light, GRADE_PRESET.tintLight[0], GRADE_PRESET.tintLight[1])
    if (u.exp_light) gl.uniform1f(u.exp_light, GRADE_PRESET.expLight)
    if (u.sat_light) gl.uniform1f(u.sat_light, GRADE_PRESET.satLight)
    if (u.tint_highlight) gl.uniform2f(u.tint_highlight, GRADE_PRESET.tintHighlight[0], GRADE_PRESET.tintHighlight[1])
    if (u.exp_highlight) gl.uniform1f(u.exp_highlight, GRADE_PRESET.expHighlight)
    if (u.sat_highlight) gl.uniform1f(u.sat_highlight, GRADE_PRESET.satHighlight)
    if (u.tint_spec) gl.uniform2f(u.tint_spec, GRADE_PRESET.tintSpec[0], GRADE_PRESET.tintSpec[1])
    if (u.exp_spec) gl.uniform1f(u.exp_spec, GRADE_PRESET.expSpec)
    if (u.sat_spec) gl.uniform1f(u.sat_spec, GRADE_PRESET.satSpec)
    if (u.pivot_black) gl.uniform1f(u.pivot_black, GRADE_PRESET.pivotBlack)
    if (u.pivot_mid) gl.uniform1f(u.pivot_mid, GRADE_PRESET.pivotMid)
    if (u.pivot_high) gl.uniform1f(u.pivot_high, GRADE_PRESET.pivotHigh)
    if (u.pivot_spec) gl.uniform1f(u.pivot_spec, GRADE_PRESET.pivotSpec)
    if (u.falloff) gl.uniform1f(u.falloff, GRADE_PRESET.falloff)
    if (u.tint_scale) gl.uniform1f(u.tint_scale, GRADE_PRESET.tintScale)
    if (u.show_zones) gl.uniform1f(u.show_zones, GRADE_PRESET.showZones)
    if (u.strength) gl.uniform1f(u.strength, p.gradeStrength)
  })

  // Passes 3+4 — the two blur kernels (horizontal then vertical). The
  // captured run() scales the radius by exp(±aspect); the preset's aspect
  // dial sits at 0, so both passes share the base radius. The radius itself
  // (strength × 2.6412) is computed inside the captured shader.
  const blurStrengthU = (prog: CamProg, tex: WebGLTexture) => () => {
    const { u } = prog
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    if (u.iChannel0) gl.uniform1i(u.iChannel0, 0)
    if (u.strength) gl.uniform1f(u.strength, p.blur)
    if (u.aspect) gl.uniform1f(u.aspect, 0)
  }
  runPass(g, g.blurH, g.c, W, H, p, blurStrengthU(g.blurH, g.b.tex))
  runPass(g, g.blurV, g.d, W, H, p, blurStrengthU(g.blurV, g.c.tex))

  // Pass 5 — the composite: mix(graded, blurred, blurMix), Normal blend,
  // rendered straight into the offscreen canvas.
  runPass(g, g.mix, null, W, H, p, () => {
    const { u } = g.mix
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, g.d.tex)
    gl.activeTexture(gl.TEXTURE7)
    gl.bindTexture(gl.TEXTURE_2D, g.b.tex)
    if (u.iChannel0) gl.uniform1i(u.iChannel0, 0)
    if (u.iChannel7) gl.uniform1i(u.iChannel7, 7)
    if (u.opacity) gl.uniform1f(u.opacity, p.blurMix)
    if (u.blendMode) gl.uniform1i(u.blendMode, BLEND_MODE_NORMAL)
  })
}

/* ---------------------- shared math (CPU fallback) ------------------------- */

const VHS_FPS = 29.97

function fract(x: number): number {
  return x - Math.floor(x)
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

function smoothstepJs(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** The captured hash12 — identical constants, identical order. */
function hash12(px: number, py: number): number {
  let p3x = fract(px * 0.1031)
  let p3y = fract(px * 0.1031)
  let p3z = fract(py * 0.1031)
  // vec3(p.xyx) — x, x, y. dot(p3, p3.yzx + 33.33)
  const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33)
  p3x += d
  p3y += d
  p3z += d
  return fract((p3x + p3y) * p3z)
}

function valueNoise256(u: number, v: number, seedU: number, seedV: number): number {
  const pu = fract(u) * 256
  const pv = fract(v) * 256
  const iu = Math.floor(pu)
  const iv = Math.floor(pv)
  let fu = fract(pu)
  let fv = fract(pv)
  fu = fu * fu * (3 - 2 * fu)
  fv = fv * fv * (3 - 2 * fv)
  const n00 = hash12(iu + seedU, iv + seedV)
  const n10 = hash12(iu + 1 + seedU, iv + seedV)
  const n01 = hash12(iu + seedU, iv + 1 + seedV)
  const n11 = hash12(iu + 1 + seedU, iv + 1 + seedV)
  const a = n00 + (n10 - n00) * fu
  const b = n01 + (n11 - n01) * fu
  return a + (b - a) * fv
}

function vhsNoise(u: number, v: number): number {
  return valueNoise256(u, v, 17, 91)
}

function rgb2yiq(r: number, g: number, b: number): [number, number, number] {
  return [0.299 * r + 0.587 * g + 0.114 * b, 0.596 * r - 0.274 * g - 0.322 * b, 0.211 * r - 0.523 * g + 0.312 * b]
}

function yiq2rgb(y: number, i: number, q: number): [number, number, number] {
  return [y + 0.956 * i + 0.621 * q, y - 0.272 * i - 0.647 * q, y - 1.106 * i + 1.703 * q]
}

/* --------------------------- CPU fallback path ----------------------------- */

/** Full JS transcription of the five captured passes, in their render order.
 *  Float64 vs the GPU's float32 can round ±1/255 differently, but every
 *  transform, constant and tap is the original's. */
function drawCPU(rc: RenderContext, p: CamcorderParams): void {
  const { ctx, width: W, height: H } = rc

  const snap = getWork('camcorder:snap', W, H)
  const sctx = resetWork(snap.getContext('2d')!)
  sctx.clearRect(0, 0, W, H)
  sctx.drawImage(ctx.canvas, 0, 0)
  const src = sctx.getImageData(0, 0, W, H).data

  const aspect = W / Math.max(H, 1)
  const vhsW = Math.max(p.resolution, 1)
  const vhsH = Math.max(p.resolution / Math.max(aspect, 1e-5), 1)
  const t = p.time

  // Continuous bilinear source sampler — the captured shader samples the
  // source texture with LINEAR filtering; uv00..uv11 land on texel centers.
  function tex(u: number, v: number, ch: number): number {
    const px = u * W - 0.5
    const py = v * H - 0.5
    const x0 = Math.floor(px)
    const y0 = Math.floor(py)
    const fx = px - x0
    const fy = py - y0
    const x0c = clamp(x0, 0, W - 1)
    const x1c = clamp(x0 + 1, 0, W - 1)
    const y0c = clamp(y0, 0, H - 1)
    const y1c = clamp(y0 + 1, 0, H - 1)
    const i00 = (y0c * W + x0c) * 4 + ch
    const i10 = (y0c * W + x1c) * 4 + ch
    const i01 = (y1c * W + x0c) * 4 + ch
    const i11 = (y1c * W + x1c) * 4 + ch
    const a = src[i00] + (src[i10] - src[i00]) * fx
    const b = src[i01] + (src[i11] - src[i01]) * fx
    return (a + (b - a) * fy) / 255
  }

  // sampleSourceInternal — the lo-fi grid resample (manual bilinear over
  // four texel-center taps at vhsRes).
  function sampleSourceInternal(u: number, v: number, ch: number): number {
    u = clamp(u, 0, 1)
    v = clamp(v, 0, 1)
    const pu = u * vhsW - 0.5
    const pv = v * vhsH - 0.5
    const iu = Math.floor(pu)
    const iv = Math.floor(pv)
    const fu = pu - iu
    const fv = pv - iv
    const uv00u = clamp((iu + 0.5) / vhsW, 0, 1)
    const uv00v = clamp((iv + 0.5) / vhsH, 0, 1)
    const uv10u = clamp((iu + 1.5) / vhsW, 0, 1)
    const uv01v = clamp((iv + 1.5) / vhsH, 0, 1)
    const c00 = tex(uv00u, uv00v, ch)
    const c10 = tex(uv10u, uv00v, ch)
    const c01 = tex(uv00u, uv01v, ch)
    const c11 = tex(uv10u, uv01v, ch)
    const a = c00 + (c10 - c00) * fu
    const b = c01 + (c11 - c01) * fu
    return a + (b - a) * fv
  }

  function sampleLumaLPF(u: number, v: number): number {
    const sigma = 2.2 + (0.6 - 2.2) * clamp((p.softness - 0.4) / 1.6, 0, 1)
    const invTwoSigma2 = 0.5 / Math.max(sigma * sigma, 1e-5)
    let acc = 0
    let wSum = 0
    for (let k = -2; k <= 2; k++) {
      const fk = k
      const tapU = clamp(u + fk / vhsW, 0, 1)
      const y = rgb2yiq(sampleSourceInternal(tapU, v, 0), sampleSourceInternal(tapU, v, 1), sampleSourceInternal(tapU, v, 2))[0]
      const w = Math.exp(-fk * fk * invTwoSigma2)
      acc += y * w
      wSum += w
    }
    return acc / Math.max(wSum, 1e-6)
  }

  function sampleColorUnder(u: number, v: number): [number, number, number] {
    if (u < 0 || u > 1 || v < 0 || v > 1) return [0.1, 0.1, 0.1]
    const cr = sampleSourceInternal(u, v, 0)
    const cg = sampleSourceInternal(u, v, 1)
    const cb = sampleSourceInternal(u, v, 2)
    const centerYiq = rgb2yiq(cr, cg, cb)
    const luma = sampleLumaLPF(u, v)

    const uvChromaU = clamp(u - p.colorDelay / Math.max(vhsW, 1), 0, 1)
    const uvChromaV = v
    const line = Math.floor(v * vhsH)
    const cyclesPerLine = 40
    const linePhase = hash12(line, p.vhsFrame * 0.73) * 2 * Math.PI * 0.5
    const palAlt = line % 2 > 0.5 ? -1 : 1

    const sigma = 9 // CHROMA_BANDWIDTH is a baked 0.2 in the captured shader
    const invTwoSigma2 = 0.5 / Math.max(sigma * sigma, 1e-5)

    let iAcc = 0
    let qAcc = 0
    let wSum = 0
    for (let k = -6; k <= 6; k++) {
      const fk = k
      const tapU = clamp(uvChromaU + fk / vhsW, 0, 1)
      const tapV = clamp(uvChromaV, 0, 1)
      const tr = sampleSourceInternal(tapU, tapV, 0)
      const tg = sampleSourceInternal(tapU, tapV, 1)
      const tb = sampleSourceInternal(tapU, tapV, 2)
      const tapYiq = rgb2yiq(tr, tg, tb)
      const iSig = tapYiq[1]
      const qSig = tapYiq[2] * palAlt
      const phase = 2 * Math.PI * (cyclesPerLine * tapU) + linePhase
      const c = Math.cos(phase)
      const s = Math.sin(phase)
      const encoded = iSig * c + qSig * s
      const w = Math.exp(-fk * fk * invTwoSigma2)
      iAcc += encoded * c * w
      qAcc += encoded * s * w
      wSum += w
    }

    const iDec = (2 * iAcc) / Math.max(wSum, 1e-6)
    const qDec = ((2 * qAcc) / Math.max(wSum, 1e-6)) * palAlt
    let chromaU = iDec
    let chromaV = qDec
    if (Math.abs(p.colorFringing) > 1e-5) {
      const ang = p.colorFringing * 0.12
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      const nu = c * chromaU - s * chromaV
      const nv = s * chromaU + c * chromaV
      chromaU = nu
      chromaV = nv
    }

    const underY = centerYiq[0] + (luma - centerYiq[0]) * 0.75
    const dec = yiq2rgb(underY, chromaU, chromaV)
    const mixK = clamp(p.colorBlend, 0, 1)
    return [cr + (dec[0] - cr) * mixK, cg + (dec[1] - cg) * mixK, cb + (dec[2] - cb) * mixK]
  }

  /* ---------------------- pass 1: the VHS pipeline ---------------------- */
  const bufA = new Float32Array(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const fx = x + 0.5
      const fy = y + 0.5
      const uvOutU = fx / W
      const uvOutV = fy / H
      let uvnU = uvOutU
      let uvnV = uvOutV

      const vhsFrame = Math.floor(t * VHS_FPS)
      const framePhase = fract(t * VHS_FPS)
      const jumpEventPrev = smoothstepJs(0.92, 0.995, vhsNoise(Math.floor((vhsFrame - 1) * 0.8), 37))
      const jumpEventCurr = smoothstepJs(0.92, 0.995, vhsNoise(Math.floor(vhsFrame * 0.8), 37))
      const jumpSizePrev = (0.03 + 0.17 * vhsNoise(Math.floor((vhsFrame - 1) * 1.7), 51)) * jumpEventPrev
      const jumpSizeCurr = (0.03 + 0.17 * vhsNoise(Math.floor(vhsFrame * 1.7), 51)) * jumpEventCurr
      const jumpDriftPrev = (vhsNoise((vhsFrame - 1) * 0.12, 9.4) - 0.5) * 0.02
      const jumpDriftCurr = (vhsNoise(vhsFrame * 0.12, 9.4) - 0.5) * 0.02
      const jumpOffsetPrev = (jumpSizePrev + jumpDriftPrev) * p.verticalJump
      const jumpOffsetCurr = (jumpSizeCurr + jumpDriftCurr) * p.verticalJump
      const jumpLerp = smoothstepJs(0.15, 0.85, framePhase)
      uvnV = fract(uvnV + (jumpOffsetPrev + (jumpOffsetCurr - jumpOffsetPrev) * jumpLerp))

      uvnU += (vhsNoise(uvnV * 0.1, t * 0.1) - 0.5) / vhsW * p.distortion * p.wobble
      uvnU += (vhsNoise(uvnV, t * 10) - 0.5) / vhsW * p.distortion * p.wobble

      const creaseSeed = vhsNoise(t * 0.67, t * 0.59)
      const tcPhase = smoothstepJs(0.9, 0.96, Math.sin(uvnV * 8 - (t + 0.14 * creaseSeed) * Math.PI * 1.2))
      const tcNoise = smoothstepJs(0.3, 1, vhsNoise(uvnV * 4.77, t))
      const tc = tcPhase * tcNoise * p.tapeCrease
      uvnU -= (tc / vhsW) * 8 * p.distortion

      const snPhase = smoothstepJs(6 / vhsH, 0, uvnV)
      uvnV += snPhase * 0.3 * p.tracking
      uvnU += snPhase * ((vhsNoise(uvOutV * 100, t * 10) - 0.5) / vhsW * 24 * p.tracking)

      let col = sampleColorUnder(uvnU, uvnV)

      const cn = tcNoise * (0.3 + 0.7 * tcPhase) * p.sparkle
      if (cn > 0.29) {
        const shift = vhsNoise(uvnV, t)
        const uvtU = (uvnU + shift) * 0.1
        const uvtV = uvnV
        const n0 = vhsNoise(uvtU, uvtV)
        const n1 = vhsNoise(uvtU + 1 / vhsW, uvtV)
        if (n1 < n0) {
          const k = Math.pow(n0, 10)
          col = [col[0] + (2 - col[0]) * k, col[1] + (1 - col[1]) * k, col[2] + (1 - col[2]) * k]
        }
      }

      const ac = smoothstepJs(0.4, 0.6, vhsNoise(0, 0.1 * (uvOutV + t * 0.2)))
      const acMul = 1 + 0.1 * p.flicker * ac
      col = [col[0] * acMul, col[1] * acMul, col[2] * acMul]

      const nR = valueNoise256(uvnU + t * 5.97, uvnV + t * 4.45, 17, 91)
      const nG = valueNoise256(uvnU + t * 5.97 + 0.37, uvnV + t * 4.45 + 0.11, 53, 13)
      const nB = valueNoise256(uvnU + t * 5.97 + 0.79, uvnV + t * 4.45 + 0.53, 29, 71)
      col = [
        col[0] * (0.9 + 0.1 * (1 + (nR - 1) * p.grain)),
        col[1] * (0.9 + 0.1 * (1 + (nG - 1) * p.grain)),
        col[2] * (0.9 + 0.1 * (1 + (nB - 1) * p.grain)),
      ]

      if (p.sharpening > 1e-5) {
        const stepU = 1 / vhsW
        const stepV = 1 / vhsH
        const sC = [sampleSourceInternal(uvnU, uvnV, 0), sampleSourceInternal(uvnU, uvnV, 1), sampleSourceInternal(uvnU, uvnV, 2)]
        const sL = [sampleSourceInternal(uvnU - stepU, uvnV, 0), sampleSourceInternal(uvnU - stepU, uvnV, 1), sampleSourceInternal(uvnU - stepU, uvnV, 2)]
        const sR = [sampleSourceInternal(uvnU + stepU, uvnV, 0), sampleSourceInternal(uvnU + stepU, uvnV, 1), sampleSourceInternal(uvnU + stepU, uvnV, 2)]
        const sU = [sampleSourceInternal(uvnU, uvnV - stepV, 0), sampleSourceInternal(uvnU, uvnV - stepV, 1), sampleSourceInternal(uvnU, uvnV - stepV, 2)]
        const sD = [sampleSourceInternal(uvnU, uvnV + stepV, 0), sampleSourceInternal(uvnU, uvnV + stepV, 1), sampleSourceInternal(uvnU, uvnV + stepV, 2)]
        for (let ch = 0; ch < 3; ch++) {
          const sBlur = 0.2 * (sL[ch] + sR[ch] + sU[ch] + sD[ch] + sC[ch])
          const detail = sC[ch] - sBlur
          col[ch] = clamp(col[ch] + detail * (1.2 * p.sharpening), 0, 1)
        }
      }

      const yiq = rgb2yiq(clamp(col[0], 0, 1), clamp(col[1], 0, 1), clamp(col[2], 0, 1))
      const shiftK = p.colorShift
      const y2 = yiq[0] + ((0.1 + 0.9 * yiq[0]) - yiq[0]) * shiftK
      const i2 = yiq[1] + ((-0.1 + 1.1 * yiq[1]) - yiq[1]) * shiftK
      const q2 = yiq[2] + ((0 + 1.5 * yiq[2]) - yiq[2]) * shiftK
      const rgb = yiq2rgb(y2, i2 * p.saturation, q2 * p.saturation)
      const o = (y * W + x) * 4
      bufA[o] = clamp(rgb[0], 0, 1)
      bufA[o + 1] = clamp(rgb[1], 0, 1)
      bufA[o + 2] = clamp(rgb[2], 0, 1)
      bufA[o + 3] = 1
    }
  }

  /* ------------------ pass 2: the Backrooms zone grade ------------------ */
  const G = GRADE_PRESET
  const bufB = new Float32Array(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      const lin = [0, 0, 0]
      for (let ch = 0; ch < 3; ch++) {
        const c = bufA[o + ch]
        lin[ch] = c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
      }
      const lum = 0.2126729 * lin[0] + 0.7151522 * lin[1] + 0.072175 * lin[2]
      const e = Math.log2(Math.max(lum, 1e-6) / 0.18)

      const p1 = G.pivotBlack
      const p2 = Math.max(G.pivotMid, p1 + 0.05)
      const p3 = Math.max(G.pivotHigh, p2 + 0.05)
      const p4 = Math.max(G.pivotSpec, p3 + 0.05)
      const f = Math.max(G.falloff, 1e-3)
      const c1 = smoothstepJs(p1 - f, p1 + f, e)
      const c2 = smoothstepJs(p2 - f, p2 + f, e)
      const c3 = smoothstepJs(p3 - f, p3 + f, e)
      const c4 = smoothstepJs(p4 - f, p4 + f, e)
      const wBlack = 1 - c1
      const wShad = c1 - c2
      const wLight = c2 - c3
      const wHigh = c3 - c4
      const wSpec = c4

      const stops =
        G.expGlobal + G.expBlack * wBlack + G.expShadow * wShad + G.expLight * wLight + G.expHighlight * wHigh + G.expSpec * wSpec
      const linExp = [lin[0] * Math.pow(2, stops), lin[1] * Math.pow(2, stops), lin[2] * Math.pow(2, stops)]

      // linearToOklab
      const l0 = 0.4122214708 * linExp[0] + 0.5363325363 * linExp[1] + 0.0514459929 * linExp[2]
      const l1 = 0.2119034982 * linExp[0] + 0.6806995451 * linExp[1] + 0.1073969566 * linExp[2]
      const l2 = 0.0883024619 * linExp[0] + 0.2817188376 * linExp[1] + 0.6299787005 * linExp[2]
      const lc0 = Math.sign(l0) * Math.pow(Math.abs(l0), 1 / 3)
      const lc1 = Math.sign(l1) * Math.pow(Math.abs(l1), 1 / 3)
      const lc2 = Math.sign(l2) * Math.pow(Math.abs(l2), 1 / 3)
      const labL = 0.2104542553 * lc0 + 0.793617785 * lc1 - 0.0040720468 * lc2
      let labA = 1.9779984951 * lc0 - 2.428592205 * lc1 + 0.4505937099 * lc2
      let labB = 0.0259040371 * lc0 + 0.7827717662 * lc1 - 0.808675766 * lc2

      const pushA =
        G.tintGlobal[0] + G.tintBlack[0] * wBlack + G.tintShadow[0] * wShad + G.tintLight[0] * wLight + G.tintHighlight[0] * wHigh + G.tintSpec[0] * wSpec
      const pushB =
        G.tintGlobal[1] + G.tintBlack[1] * wBlack + G.tintShadow[1] * wShad + G.tintLight[1] * wLight + G.tintHighlight[1] * wHigh + G.tintSpec[1] * wSpec
      labA += pushA * G.tintScale
      labB += pushB * G.tintScale

      const sat =
        G.satBlack * wBlack + G.satShadow * wShad + G.satLight * wLight + G.satHighlight * wHigh + G.satSpec * wSpec
      const satMul = sat * G.satGlobal
      labA *= satMul
      labB *= satMul

      // oklabToLinear
      const lc0b = labL + 0.3963377774 * labA + 0.2158037573 * labB
      const lc1b = labL - 0.1055613458 * labA - 0.0638541728 * labB
      const lc2b = labL - 0.0894841775 * labA - 1.291485548 * labB
      const ll0 = lc0b * lc0b * lc0b
      const ll1 = lc1b * lc1b * lc1b
      const ll2 = lc2b * lc2b * lc2b
      let outLin = [
        4.0767416621 * ll0 - 3.3077115913 * ll1 + 0.2309699292 * ll2,
        -1.2684380046 * ll0 + 2.6097574011 * ll1 - 0.3413193965 * ll2,
        -0.0041960863 * ll0 - 0.7034186147 * ll1 + 1.707614701 * ll2,
      ]

      const yy = Math.max(0.2126729 * outLin[0] + 0.7151522 * outLin[1] + 0.072175 * outLin[2], 1e-5)
      const mn = Math.min(outLin[0], outLin[1], outLin[2])
      if (mn < 0) {
        const fix = yy / (yy - mn)
        outLin = [yy + (outLin[0] - yy) * fix, yy + (outLin[1] - yy) * fix, yy + (outLin[2] - yy) * fix]
      }
      outLin = [clamp(outLin[0], 0, 1), clamp(outLin[1], 0, 1), clamp(outLin[2], 0, 1)]

      const gs = clamp(p.gradeStrength, 0, 1)
      const toSrgb = (c: number) => {
        const cc = Math.max(c, 0)
        return cc < 0.0031308 ? cc * 12.92 : 1.055 * Math.pow(cc, 1 / 2.4) - 0.055
      }
      for (let ch = 0; ch < 3; ch++) {
        const corrected = toSrgb(outLin[ch])
        const mixed = bufA[o + ch] + (corrected - bufA[o + ch]) * gs
        bufB[o + ch] = clamp(mixed + (hash12(x + 0.5, y + 0.5) - 0.5) / 255, 0, 1)
      }
      bufB[o + 3] = 1
    }
  }

  /* ----------------- passes 3-5: blur H, blur V, composite --------------- */
  const radius = p.blur * BLUR_RADIUS_K
  const bufC = new Float32Array(W * H * 4)
  const bufD = new Float32Array(W * H * 4)

  function blurPass(srcBuf: Float32Array, dst: Float32Array, dx: number, dy: number): void {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // pixel(pos) samples at pixel centers; ± integer dist along an axis
        // stays on centers, so direct texel reads are exact.
        const read = (px: number, py: number, ch: number): number => {
          const cx = clamp(Math.round(px - 0.5), 0, W - 1)
          const cy = clamp(Math.round(py - 0.5), 0, H - 1)
          return srcBuf[(cy * W + cx) * 4 + ch]
        }
        const px = x + 0.5
        const py = y + 0.5
        let r = read(px, py, 0)
        let g = read(px, py, 1)
        let b = read(px, py, 2)
        let wsum = 0.5
        const rad = radius // alpha is 1 — max(1, a) leaves it unchanged
        for (let dist = 1; dist < rad; dist += 1) {
          let w = 1 - dist / rad
          w = 1 - w * w
          w = 1 - w * w
          r += w * (read(px - dist * dx, py - dist * dy, 0) + read(px + dist * dx, py + dist * dy, 0))
          g += w * (read(px - dist * dx, py - dist * dy, 1) + read(px + dist * dx, py + dist * dy, 1))
          b += w * (read(px - dist * dx, py - dist * dy, 2) + read(px + dist * dx, py + dist * dy, 2))
          wsum += w
        }
        const o = (y * W + x) * 4
        dst[o] = r / (wsum * 2)
        dst[o + 1] = g / (wsum * 2)
        dst[o + 2] = b / (wsum * 2)
        dst[o + 3] = 1
      }
    }
  }

  blurPass(bufB, bufC, 1, 0)
  blurPass(bufC, bufD, 0, 1)

  // Composite: mix(graded, blurred, blurMix) — Normal blend.
  const out = sctx.createImageData(W, H)
  const od = out.data
  for (let i = 0; i < W * H * 4; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      od[i + ch] = Math.round(clamp(bufB[i + ch] + (bufD[i + ch] - bufB[i + ch]) * p.blurMix, 0, 1) * 255)
    }
    od[i + 3] = 255
  }
  sctx.putImageData(out, 0, 0)
  ctx.drawImage(snap, 0, 0)
}

/* --------------------------------- entry ----------------------------------- */

export function drawCamcorderFilter(
  rc: RenderContext,
  cfg: CamcorderFilterConfig | undefined,
  frame: Pick<AudioFrame, 'time' | 'bass'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 16 || H < 16) return

  const params = resolveCamcorder(cfg, frame)

  const g = getGL(W, H)
  if (!g) {
    if (!camPathLogged) {
      camPathLogged = true
      console.info('[camcorder] CPU fallback active (WebGL2 unavailable)')
    }
    drawCPU(rc, params)
    return
  }
  if (!camPathLogged) {
    camPathLogged = true
    console.info('[camcorder] GPU path active (WebGL2, 5 captured programs)')
  }

  drawGL(g, rc, params)

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  ctx.drawImage(g.canvas, 0, 0, W, H)
  ctx.restore()
}
