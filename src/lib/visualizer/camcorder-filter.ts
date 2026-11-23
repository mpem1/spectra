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
 * GLSL ES 3.00, impossible to unroll in ES 1.00. A JS transcription of the
 * same math serves WebGL-less devices (run at a capped working resolution
 * and upscaled — see drawCPU; float64 vs the GPU's float32 can round ±1/255
 * differently, but the algorithm is identical).
 *
 * THE TAPE ANCHORS TO THE PICTURE: effect.app's editor always renders the
 * effect with the media filling the frame — their canvas adopts the media's
 * aspect, so the pipeline's own edges ARE the picture's edges and the
 * captured shaders' vertical-edge artifacts (the colored chroma streaks
 * that seep in from the left/right frame edges — the clamped chroma-tap
 * decode at the grid boundary — plus the bottom head-switch smear and the
 * top tear) land ON the picture. Spectra composes a floating artwork
 * instead, so when an Image-visualizer artwork is on screen the whole
 * pipeline runs on the artwork's rect (recorded per frame in
 * RenderContext.imageVizRect): the artwork's rect is the tape frame, the
 * print composites back onto it, and every edge artifact hugs the picture's
 * own edges. Without an artwork the frame is the tape, exactly as their
 * engine renders a full-bleed media.
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

/** GL bundles keyed by canvas size — the preview and an offline export can
 *  render concurrently at different resolutions, so one singleton would
 *  reallocate its textures on every alternating frame. Kept tiny (3) and
 *  evicted contexts are explicitly lost to free GPU memory. */
const camGLCache = new Map<string, CamcorderGL>()
/** When WebGL2 / the captured programs fail, do not retry every frame —
 *  context creation + 5 shader compiles per frame would crush the fps on
 *  top of the CPU fallback. Retry at most this often. */
let camGLFailAt = -1e9
const CAM_GL_RETRY_MS = 3000
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

/** Build (or reuse) the offscreen GL bundle for this canvas size. Returns
 *  null when WebGL2 is unavailable or the captured programs fail — the
 *  caller falls back to the CPU path. Failures are memoized for a few
 *  seconds so a broken driver cannot trigger per-frame context churn. */
function getGL(w: number, h: number): CamcorderGL | null {
  const key = `${w}x${h}`
  const hit = camGLCache.get(key)
  if (hit) return hit
  if (performance.now() - camGLFailAt < CAM_GL_RETRY_MS) return null
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
    if (!gl) {
      camGLFailAt = performance.now()
      return null
    }

    const vhs = buildProgram(gl, CAMCORDER_VHS_FRAG, VHS_U)
    const grade = buildProgram(gl, CAMCORDER_GRADE_FRAG, GRADE_U)
    const blurH = buildProgram(gl, CAMCORDER_BLUR_H_FRAG, BLUR_U)
    const blurV = buildProgram(gl, CAMCORDER_BLUR_V_FRAG, BLUR_U)
    const mix = buildProgram(gl, CAMCORDER_BLUR_MIX_FRAG, MIX_U)
    if (!vhs || !grade || !blurH || !blurV || !mix) {
      camGLFailAt = performance.now()
      return null
    }

    // Fullscreen quad — positions + UVs interleaved [x, y, u, v] (16-byte
    // stride). aUV = (aPos+1)/2 so vUV0 * iResolution equals gl_FragCoord:
    // exactly the engine's coord=pixel convention that every captured
    // shader assumes. aUV's byte offset is 8 (after the two position
    // floats) — an offset of 12 would sample the next vertex's x and twist
    // the whole pipeline into abstract noise.
    const quad = gl.createBuffer()
    if (!quad) {
      camGLFailAt = performance.now()
      return null
    }
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
    if (!srcTex) {
      camGLFailAt = performance.now()
      return null
    }
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
    if (!a || !b || !c || !d) {
      camGLFailAt = performance.now()
      return null
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    const g: CamcorderGL = { canvas, gl, quad, srcTex, a, b, c, d, vhs, grade, blurH, blurV, mix, w: 0, h: 0 }
    camGLCache.set(key, g)
    if (camGLCache.size > 3) {
      const oldestKey = camGLCache.keys().next().value as string
      const oldest = camGLCache.get(oldestKey)
      camGLCache.delete(oldestKey)
      oldest?.gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    return g
  } catch {
    camGLFailAt = performance.now()
    return null
  }
}

function bindQuad(gl: WebGL2RenderingContext, prog: CamProg, quad: WebGLBuffer): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  const aPos = gl.getAttribLocation(prog.program, 'aPos')
  const aUV = gl.getAttribLocation(prog.program, 'aUV')
  if (aPos >= 0) {
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0)
  }
  if (aUV >= 0) {
    gl.enableVertexAttribArray(aUV)
    // [x, y, u, v] interleaved — the UVs start after the two position
    // floats: byte offset 8, not 12.
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8)
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
  bindQuad(gl, prog, g.quad)
  setCommonUniforms(gl, prog, W, H, p)
  bindInputs()
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

/** The picture anchor — the Image-visualizer artwork's animated footprint
 *  plus its stable work size (see RenderContext.imageVizRect). When present
 *  the whole captured pipeline runs ON THE PICTURE: the source texture is
 *  the artwork's rect crop, the offscreen print is artwork-sized, and the
 *  composite lands back on the rect — so every edge artifact (the colored
 *  streaks seeping in from the left/right vertical edges, the bottom
 *  head-switch smear, the top tear) sits on the picture's own edges, the
 *  way effect.app's engine always renders the media filling the frame. */
type AnchorRect = NonNullable<RenderContext['imageVizRect']>

/** The anchor's crop region, clamped to the canvas — the rect already is
 *  (drawImageViz clamps it), but a defensive intersect keeps a motion spike
 *  from ever sampling outside the frame into transparent pixels. */
function anchorCrop(rc: RenderContext, a: AnchorRect): { x: number; y: number; w: number; h: number } {
  const x0 = Math.max(0, Math.min(a.x, rc.width - 1))
  const y0 = Math.max(0, Math.min(a.y, rc.height - 1))
  const x1 = Math.min(rc.width, a.x + a.w)
  const y1 = Math.min(rc.height, a.y + a.h)
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

function drawGL(g: CamcorderGL, rc: RenderContext, p: CamcorderParams, anchor: AnchorRect | null): void {
  const { gl } = g
  const { width: W, height: H, ctx } = rc
  // Anchored: the pipeline runs at the artwork's stable work size; the
  // animated crop resamples into it and the print stretches back out —
  // sub-percent scaling, invisible under the tape's own resample, and the
  // offscreen layers never churn with the beat motion.
  const PW = anchor ? anchor.workW : W
  const PH = anchor ? anchor.workH : H
  if (g.w !== PW || g.h !== PH) {
    g.canvas.width = PW
    g.canvas.height = PH
    g.w = PW
    g.h = PH
    for (const layer of [g.a, g.b, g.c, g.d]) {
      gl.bindTexture(gl.TEXTURE_2D, layer.tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PW, PH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    }
  }

  // The finished frame IS the source texture. Anchored: the artwork's rect
  // crop goes up instead of the whole frame — a smaller upload than the
  // full canvas.
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, g.srcTex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  if (anchor) {
    const crop = anchorCrop(rc, anchor)
    const srcCanvas = getWork('camcorder:src', PW, PH)
    const sctx = resetWork(srcCanvas.getContext('2d')!)
    sctx.imageSmoothingEnabled = true
    sctx.clearRect(0, 0, PW, PH)
    sctx.drawImage(ctx.canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, PW, PH)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas)
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas)
  }

  // Pass 1 — VHS pipeline → a
  runPass(g, g.vhs, g.a, PW, PH, p, () => {
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
  runPass(g, g.grade, g.b, PW, PH, p, () => {
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
  runPass(g, g.blurH, g.c, PW, PH, p, blurStrengthU(g.blurH, g.b.tex))
  runPass(g, g.blurV, g.d, PW, PH, p, blurStrengthU(g.blurV, g.c.tex))

  // Pass 5 — the composite: mix(graded, blurred, blurMix), Normal blend,
  // rendered straight into the offscreen canvas.
  runPass(g, g.mix, null, PW, PH, p, () => {
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

/** The captured hash12 — identical constants, identical order. vec3(p.xyx)
 *  spreads as (x, y, x). */
function hash12(px: number, py: number): number {
  let p3x = fract(px * 0.1031)
  let p3y = fract(py * 0.1031)
  let p3z = fract(px * 0.1031)
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

/* --------------------------- CPU fallback path ----------------------------- */

/** The GPU path is the exact, realtime path. This JS transcription exists
 *  for WebGL-less devices; it runs the same captured math at a capped
 *  working resolution (upscaled back over the frame afterwards) so a
 *  machine without WebGL2 gets the look at a usable frame rate instead of
 *  seconds per frame. The preview cap sits at the tape's native 420px
 *  internal grid (the effect's own resolution dial), exports render
 *  offline and get a higher cap. */
const CPU_PREVIEW_MAX_W = 420
const CPU_EXPORT_MAX_W = 960

/** Pooled CPU scratch — reallocated only when the work size or the internal
 *  tape grid actually changes (dials rarely move mid-song). */
let cpuPool: {
  key: string
  grid: Float32Array
  bufA: Float32Array
  bufB: Float32Array
  bufC: Float32Array
  bufD: Float32Array
  img: ImageData | null
} | null = null

/** sRGB→linear lookup — a fixed transform (no dial affects it); built once.
 *  Inputs are bufA values that went through clamp(…, 0, 1); quantized to
 *  14 bits (≤ 0.006% error, far below the ±1/255 rounding this path already
 *  carries vs the GPU). */
const SRGB_LUT_BITS = 14
const SRGB_LUT_N = 1 << SRGB_LUT_BITS
const SRGB_LUT = new Float32Array(SRGB_LUT_N)
for (let i = 0; i < SRGB_LUT_N; i++) {
  const c = i / (SRGB_LUT_N - 1)
  SRGB_LUT[i] = c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Full JS transcription of the five captured passes, in their render order.
 *  Float64 vs the GPU's float32 can round ±1/255 differently, but every
 *  transform, constant and tap is the original's. Anchored (an
 *  Image-visualizer artwork is on screen): the same transcription runs on
 *  the artwork's rect crop at its stable work size — the tape edge
 *  artifacts land on the picture's own edges — and the finished print
 *  composites back onto the animated rect. */
function drawCPU(rc: RenderContext, p: CamcorderParams, anchor: AnchorRect | null): void {
  const { ctx, width: W, height: H } = rc

  // Work size — the frame, or the artwork's stable box when anchored (the
  // animated crop resamples into it, the print stretches back out).
  const FW = anchor ? anchor.workW : W
  const FH = anchor ? anchor.workH : H

  // Cap the working resolution — every dial of this effect is computed
  // relative to a 420px-wide tape grid, so the upscaled result keeps the
  // character while the per-pixel JS cost stays sane.
  const maxW = rc.interactive ? CPU_PREVIEW_MAX_W : CPU_EXPORT_MAX_W
  const scale = Math.min(1, maxW / Math.max(FW, 1))
  const CW = Math.max(16, Math.round(FW * scale))
  const CH = Math.max(16, Math.round(FH * scale))

  const snap = getWork('camcorder:snap', CW, CH)
  const sctx = resetWork(snap.getContext('2d')!)
  sctx.imageSmoothingEnabled = true
  sctx.clearRect(0, 0, CW, CH)
  if (anchor) {
    const crop = anchorCrop(rc, anchor)
    sctx.drawImage(ctx.canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, CW, CH)
  } else {
    sctx.drawImage(ctx.canvas, 0, 0, CW, CH)
  }
  const src = sctx.getImageData(0, 0, CW, CH).data

  const aspect = CW / Math.max(CH, 1)
  const vhsW = Math.max(p.resolution, 1)
  const vhsH = Math.max(p.resolution / Math.max(aspect, 1e-5), 1)
  const t = p.time

  // Pooled buffers — keyed by work size × grid size.
  const TW = vhsW + 2
  const TH = vhsH + 2
  const poolKey = `${CW}x${CH}|${TW}x${TH}`
  if (!cpuPool || cpuPool.key !== poolKey) {
    cpuPool = {
      key: poolKey,
      grid: new Float32Array(TW * TH * 3),
      bufA: new Float32Array(CW * CH * 4),
      bufB: new Float32Array(CW * CH * 4),
      bufC: new Float32Array(CW * CH * 4),
      bufD: new Float32Array(CW * CH * 4),
      img: null,
    }
  }
  const { grid, bufA, bufB, bufC, bufD } = cpuPool

  // Continuous bilinear source sampler — the captured shader samples the
  // source texture with LINEAR filtering; used only for the grid bake now.
  function tex(u: number, v: number, ch: number): number {
    const px = u * CW - 0.5
    const py = v * CH - 0.5
    const x0 = Math.floor(px)
    const y0 = Math.floor(py)
    const fx = px - x0
    const fy = py - y0
    const x0c = clamp(x0, 0, CW - 1)
    const x1c = clamp(x0 + 1, 0, CW - 1)
    const y0c = clamp(y0, 0, CH - 1)
    const y1c = clamp(y0 + 1, 0, CH - 1)
    const i00 = (y0c * CW + x0c) * 4 + ch
    const i10 = (y0c * CW + x1c) * 4 + ch
    const i01 = (y1c * CW + x0c) * 4 + ch
    const i11 = (y1c * CW + x1c) * 4 + ch
    const a = src[i00] + (src[i10] - src[i00]) * fx
    const b = src[i01] + (src[i11] - src[i01]) * fx
    return (a + (b - a) * fy) / 255
  }

  // Precompute the source values at every tap position the shader's grid
  // resample can visit. sampleSourceInternal(uv) always bilinearly mixes
  // four taps at clamp((i ± .5)/vhsRes) texel centers — a fixed set of
  // positions per axis (size vhs+2, including the clamped edge samples at
  // 0 and 1). Baking them once turns millions of full-res bilinear reads
  // per frame into array lookups, bit-identical to the captured math.
  for (let a = 0; a < TW; a++) {
    const u = a === 0 ? 0 : a === TW - 1 ? 1 : (a - 1 + 0.5) / vhsW
    for (let b = 0; b < TH; b++) {
      const v = b === 0 ? 0 : b === TH - 1 ? 1 : (b - 1 + 0.5) / vhsH
      const gi = (b * TW + a) * 3
      grid[gi] = tex(u, v, 0)
      grid[gi + 1] = tex(u, v, 1)
      grid[gi + 2] = tex(u, v, 2)
    }
  }

  // sampleSourceInternal — the lo-fi grid resample (manual bilinear over
  // four baked grid taps, exactly the captured shader's positions). Batched:
  // one position computation feeds all three channels, writing into a shared
  // scratch triple — 3× fewer calls than a per-channel sampler.
  function sampleSourceRGB(u: number, v: number): void {
    u = clamp(u, 0, 1)
    v = clamp(v, 0, 1)
    const pu = u * vhsW - 0.5
    const pv = v * vhsH - 0.5
    const iu = Math.floor(pu)
    const iv = Math.floor(pv)
    const fu = pu - iu
    const fv = pv - iv
    const a0 = clamp(iu + 1, 0, TW - 1)
    const a1 = clamp(iu + 2, 0, TW - 1)
    const b0 = clamp(iv + 1, 0, TH - 1)
    const b1 = clamp(iv + 2, 0, TH - 1)
    const i00 = (b0 * TW + a0) * 3
    const i10 = (b0 * TW + a1) * 3
    const i01 = (b1 * TW + a0) * 3
    const i11 = (b1 * TW + a1) * 3
    for (let ch = 0; ch < 3; ch++) {
      const c00 = grid[i00 + ch]
      const c10 = grid[i10 + ch]
      const c01 = grid[i01 + ch]
      const c11 = grid[i11 + ch]
      const a = c00 + (c10 - c00) * fu
      const b = c01 + (c11 - c01) * fu
      smp[ch] = a + (b - a) * fv
    }
  }

  const smp = [0, 0, 0]

  // Per-frame precomputations — identical values to computing them inline,
  // just hoisted out of the per-pixel loops.
  // Luma LPF gaussian weights (softness dial).
  const lumaSigma = 2.2 + (0.6 - 2.2) * clamp((p.softness - 0.4) / 1.6, 0, 1)
  const lumaInvTwoSigma2 = 0.5 / Math.max(lumaSigma * lumaSigma, 1e-5)
  const lumaW: number[] = []
  let lumaWSum = 0
  for (let k = -2; k <= 2; k++) {
    const w = Math.exp(-k * k * lumaInvTwoSigma2)
    lumaW[k + 2] = w
    lumaWSum += w
  }
  // Chroma gaussian weights (CHROMA_BANDWIDTH is a baked 0.2 → sigma 9).
  const chromaInvTwoSigma2 = 0.5 / Math.max(9 * 9, 1e-5)
  const chromaW: number[] = []
  let chromaWSum = 0
  for (let k = -6; k <= 6; k++) {
    const w = Math.exp(-k * k * chromaInvTwoSigma2)
    chromaW[k + 6] = w
    chromaWSum += w
  }
  // Carrier rotation steps: taps sit fk/vhsW apart, so their phase offsets
  // are fk × (2π·40/vhsW) — 13 fixed angles per frame. Rotating the pixel's
  // base phase by these replaces 26 cos/sin per pixel with 2 (+ direct
  // trig only on the rare clamped edge taps).
  const CARRIER_CYCLES = 40
  const stepAngle = (2 * Math.PI * CARRIER_CYCLES) / vhsW
  const stepCos: number[] = []
  const stepSin: number[] = []
  for (let k = -6; k <= 6; k++) {
    stepCos[k + 6] = Math.cos(k * stepAngle)
    stepSin[k + 6] = Math.sin(k * stepAngle)
  }
  // Blur kernel weights (radius is fixed within a frame).
  const blurRadius = p.blur * BLUR_RADIUS_K
  const blurW: number[] = [0]
  for (let dist = 1; dist < blurRadius; dist += 1) {
    let w = 1 - dist / blurRadius
    w = 1 - w * w
    w = 1 - w * w
    blurW[dist] = w
  }

  function sampleLumaLPF(u: number, v: number): number {
    let acc = 0
    for (let k = -2; k <= 2; k++) {
      const tapU = clamp(u + k / vhsW, 0, 1)
      sampleSourceRGB(tapU, v)
      acc += (0.299 * smp[0] + 0.587 * smp[1] + 0.114 * smp[2]) * lumaW[k + 2]
    }
    return acc / Math.max(lumaWSum, 1e-6)
  }

  function sampleColorUnder(u: number, v: number): void {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      underOut[0] = 0.1
      underOut[1] = 0.1
      underOut[2] = 0.1
      return
    }
    sampleSourceRGB(u, v)
    const cr = smp[0]
    const cg = smp[1]
    const cb = smp[2]
    const centerY = 0.299 * cr + 0.587 * cg + 0.114 * cb
    const luma = sampleLumaLPF(u, v)

    const uvChromaU = clamp(u - p.colorDelay / Math.max(vhsW, 1), 0, 1)
    const uvChromaV = v
    const line = Math.floor(v * vhsH)
    const linePhase = hash12(line, p.vhsFrame * 0.73) * 2 * Math.PI * 0.5
    const palAlt = line % 2 > 0.5 ? -1 : 1

    // Base carrier phase for this pixel + its cos/sin; each tap's phase is
    // the base rotated by the precomputed per-k step (or direct trig when
    // the tap clamped to an edge, breaking the uniform step).
    const basePhase = 2 * Math.PI * (CARRIER_CYCLES * uvChromaU) + linePhase
    const baseCos = Math.cos(basePhase)
    const baseSin = Math.sin(basePhase)

    let iAcc = 0
    let qAcc = 0
    for (let k = -6; k <= 6; k++) {
      const ki = k + 6
      const idealU = uvChromaU + k / vhsW
      const tapU = clamp(idealU, 0, 1)
      const tapV = clamp(uvChromaV, 0, 1)
      sampleSourceRGB(tapU, tapV)
      const tr = smp[0]
      const tg = smp[1]
      const tb = smp[2]
      // rgb2yiq inlined — no per-tap allocations.
      const iSig = 0.596 * tr - 0.274 * tg - 0.322 * tb
      const qSig = (0.211 * tr - 0.523 * tg + 0.312 * tb) * palAlt
      let c: number
      let s: number
      if (tapU === idealU) {
        c = baseCos * stepCos[ki] - baseSin * stepSin[ki]
        s = baseSin * stepCos[ki] + baseCos * stepSin[ki]
      } else {
        const phase = 2 * Math.PI * (CARRIER_CYCLES * tapU) + linePhase
        c = Math.cos(phase)
        s = Math.sin(phase)
      }
      const w = chromaW[ki]
      const encoded = iSig * c + qSig * s
      iAcc += encoded * c * w
      qAcc += encoded * s * w
    }

    const iDec = (2 * iAcc) / Math.max(chromaWSum, 1e-6)
    const qDec = ((2 * qAcc) / Math.max(chromaWSum, 1e-6)) * palAlt
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

    const underY = centerY + (luma - centerY) * 0.75
    // yiq2rgb(underY, chromaU, chromaV) inlined — no per-pixel allocations.
    const decR = underY + 0.956 * chromaU + 0.621 * chromaV
    const decG = underY - 0.272 * chromaU - 0.647 * chromaV
    const decB = underY - 1.106 * chromaU + 1.703 * chromaV
    const mixK = clamp(p.colorBlend, 0, 1)
    underOut[0] = cr + (decR - cr) * mixK
    underOut[1] = cg + (decG - cg) * mixK
    underOut[2] = cb + (decB - cb) * mixK
  }

  /* ---------------------- pass 1: the VHS pipeline ---------------------- */
  // Per-frame constants — the jump/crease machinery depends on the tape
  // clock only, not on the pixel; hoisted out of the loop (identical math).
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
  const jumpOffset = jumpOffsetPrev + (jumpOffsetCurr - jumpOffsetPrev) * jumpLerp
  const creaseSeed = vhsNoise(t * 0.67, t * 0.59)
  const creasePhase = (t + 0.14 * creaseSeed) * Math.PI * 1.2
  const sharpStepU = 1 / vhsW
  const sharpStepV = 1 / vhsH
  const grainTU = t * 5.97
  const grainTV = t * 4.45
  const underOut = [0, 0, 0]

  for (let y = 0; y < CH; y++) {
    // Row-only flicker + tracking noise (uvOut terms depend on the row).
    const uvRowV = (y + 0.5) / CH
    const ac = smoothstepJs(0.4, 0.6, vhsNoise(0, 0.1 * (uvRowV + t * 0.2)))
    const acMul = 1 + 0.1 * p.flicker * ac
    const trackRowNoise = (vhsNoise(uvRowV * 100, t * 10) - 0.5) / vhsW * 24 * p.tracking
    for (let x = 0; x < CW; x++) {
      const uvOutU = (x + 0.5) / CW
      let uvnU = uvOutU
      let uvnV = fract(uvRowV + jumpOffset)

      uvnU += (vhsNoise(uvnV * 0.1, t * 0.1) - 0.5) / vhsW * p.distortion * p.wobble
      uvnU += (vhsNoise(uvnV, t * 10) - 0.5) / vhsW * p.distortion * p.wobble

      const tcPhase = smoothstepJs(0.9, 0.96, Math.sin(uvnV * 8 - creasePhase))
      const tcNoise = smoothstepJs(0.3, 1, vhsNoise(uvnV * 4.77, t))
      const tc = tcPhase * tcNoise * p.tapeCrease
      uvnU -= (tc / vhsW) * 8 * p.distortion

      const snPhase = smoothstepJs(6 / vhsH, 0, uvnV)
      uvnV += snPhase * 0.3 * p.tracking
      uvnU += snPhase * trackRowNoise

      sampleColorUnder(uvnU, uvnV)
      let colR = underOut[0]
      let colG = underOut[1]
      let colB = underOut[2]

      const cn = tcNoise * (0.3 + 0.7 * tcPhase) * p.sparkle
      if (cn > 0.29) {
        const shift = vhsNoise(uvnV, t)
        const uvtU = (uvnU + shift) * 0.1
        const uvtV = uvnV
        const n0 = vhsNoise(uvtU, uvtV)
        const n1 = vhsNoise(uvtU + 1 / vhsW, uvtV)
        if (n1 < n0) {
          const k = Math.pow(n0, 10)
          colR += (2 - colR) * k
          colG += (1 - colG) * k
          colB += (1 - colB) * k
        }
      }

      colR *= acMul
      colG *= acMul
      colB *= acMul

      const nR = valueNoise256(uvnU + grainTU, uvnV + grainTV, 17, 91)
      const nG = valueNoise256(uvnU + grainTU + 0.37, uvnV + grainTV + 0.11, 53, 13)
      const nB = valueNoise256(uvnU + grainTU + 0.79, uvnV + grainTV + 0.53, 29, 71)
      colR *= 0.9 + 0.1 * (1 + (nR - 1) * p.grain)
      colG *= 0.9 + 0.1 * (1 + (nG - 1) * p.grain)
      colB *= 0.9 + 0.1 * (1 + (nB - 1) * p.grain)

      if (p.sharpening > 1e-5) {
        const sharpK = 1.2 * p.sharpening
        // 5-tap cross: center + ±stepU along u + ±stepV along v — batched
        // RGB taps, sharpened per channel (identical to the captured shader).
        sampleSourceRGB(uvnU, uvnV)
        const cC = smp[0]
        const cC1 = smp[1]
        const cC2 = smp[2]
        sampleSourceRGB(uvnU - sharpStepU, uvnV)
        const cL = smp[0]
        const cL1 = smp[1]
        const cL2 = smp[2]
        sampleSourceRGB(uvnU + sharpStepU, uvnV)
        const cR = smp[0]
        const cR1 = smp[1]
        const cR2 = smp[2]
        sampleSourceRGB(uvnU, uvnV - sharpStepV)
        const cU = smp[0]
        const cU1 = smp[1]
        const cU2 = smp[2]
        sampleSourceRGB(uvnU, uvnV + sharpStepV)
        const cD = smp[0]
        const cD1 = smp[1]
        const cD2 = smp[2]
        colR = clamp(colR + (cC - 0.2 * (cL + cR + cU + cD + cC)) * sharpK, 0, 1)
        colG = clamp(colG + (cC1 - 0.2 * (cL1 + cR1 + cU1 + cD1 + cC1)) * sharpK, 0, 1)
        colB = clamp(colB + (cC2 - 0.2 * (cL2 + cR2 + cU2 + cD2 + cC2)) * sharpK, 0, 1)
      } else {
        colR = clamp(colR, 0, 1)
        colG = clamp(colG, 0, 1)
        colB = clamp(colB, 0, 1)
      }

      // rgb2yiq → color shift → saturation → yiq2rgb, all scalar (identical
      // matrix coefficients to the shared helpers).
      const yC = 0.299 * colR + 0.587 * colG + 0.114 * colB
      const iC = 0.596 * colR - 0.274 * colG - 0.322 * colB
      const qC = 0.211 * colR - 0.523 * colG + 0.312 * colB
      const shiftK = p.colorShift
      const y2 = yC + ((0.1 + 0.9 * yC) - yC) * shiftK
      const i2 = iC + ((-0.1 + 1.1 * iC) - iC) * shiftK
      const q2 = qC + ((0 + 1.5 * qC) - qC) * shiftK
      const iSat = i2 * p.saturation
      const qSat = q2 * p.saturation
      const outR = y2 + 0.956 * iSat + 0.621 * qSat
      const outG = y2 - 0.272 * iSat - 0.647 * qSat
      const outB = y2 - 1.106 * iSat + 1.703 * qSat
      const o = (y * CW + x) * 4
      bufA[o] = clamp(outR, 0, 1)
      bufA[o + 1] = clamp(outG, 0, 1)
      bufA[o + 2] = clamp(outB, 0, 1)
      bufA[o + 3] = 1
    }
  }

  /* ------------------ pass 2: the Backrooms zone grade ------------------ */
  const G = GRADE_PRESET
  const linOf = (c: number): number => SRGB_LUT[clamp(Math.round(c * (SRGB_LUT_N - 1)), 0, SRGB_LUT_N - 1)]
  // Zone constants (fixed per frame — the Backrooms preset bakes them).
  const p1 = G.pivotBlack
  const p2 = Math.max(G.pivotMid, p1 + 0.05)
  const p3 = Math.max(G.pivotHigh, p2 + 0.05)
  const p4 = Math.max(G.pivotSpec, p3 + 0.05)
  const f = Math.max(G.falloff, 1e-3)
  const gs = clamp(p.gradeStrength, 0, 1)
  // sRGB encode per output channel (identical to the captured shader).
  const toSrgb = (c: number): number => {
    const cc = Math.max(c, 0)
    return cc < 0.0031308 ? cc * 12.92 : 1.055 * Math.pow(cc, 1 / 2.4) - 0.055
  }
  for (let y = 0; y < CH; y++) {
    const dithY = y + 0.5
    for (let x = 0; x < CW; x++) {
      const o = (y * CW + x) * 4
      const lin0 = linOf(bufA[o])
      const lin1 = linOf(bufA[o + 1])
      const lin2 = linOf(bufA[o + 2])
      const lum = 0.2126729 * lin0 + 0.7151522 * lin1 + 0.072175 * lin2
      const e = Math.log2(Math.max(lum, 1e-6) / 0.18)

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
      const expo = Math.pow(2, stops)
      const le0 = lin0 * expo
      const le1 = lin1 * expo
      const le2 = lin2 * expo

      // linearToOklab
      const l0 = 0.4122214708 * le0 + 0.5363325363 * le1 + 0.0514459929 * le2
      const l1 = 0.2119034982 * le0 + 0.6806995451 * le1 + 0.1073969566 * le2
      const l2 = 0.0883024619 * le0 + 0.2817188376 * le1 + 0.6299787005 * le2
      const lc0 = Math.cbrt(l0)
      const lc1 = Math.cbrt(l1)
      const lc2 = Math.cbrt(l2)
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
      let ol0 = 4.0767416621 * ll0 - 3.3077115913 * ll1 + 0.2309699292 * ll2
      let ol1 = -1.2684380046 * ll0 + 2.6097574011 * ll1 - 0.3413193965 * ll2
      let ol2 = -0.0041960863 * ll0 - 0.7034186147 * ll1 + 1.707614701 * ll2

      const yy = Math.max(0.2126729 * ol0 + 0.7151522 * ol1 + 0.072175 * ol2, 1e-5)
      const mn = Math.min(ol0, ol1, ol2)
      if (mn < 0) {
        const fix = yy / (yy - mn)
        ol0 = yy + (ol0 - yy) * fix
        ol1 = yy + (ol1 - yy) * fix
        ol2 = yy + (ol2 - yy) * fix
      }
      ol0 = clamp(ol0, 0, 1)
      ol1 = clamp(ol1, 0, 1)
      ol2 = clamp(ol2, 0, 1)

      const dith = (hash12(x + 0.5, dithY) - 0.5) / 255
      bufB[o] = clamp(bufA[o] + (toSrgb(ol0) - bufA[o]) * gs + dith, 0, 1)
      bufB[o + 1] = clamp(bufA[o + 1] + (toSrgb(ol1) - bufA[o + 1]) * gs + dith, 0, 1)
      bufB[o + 2] = clamp(bufA[o + 2] + (toSrgb(ol2) - bufA[o + 2]) * gs + dith, 0, 1)
      bufB[o + 3] = 1
    }
  }

  /* ----------------- passes 3-5: blur H, blur V, composite --------------- */
  function blurPass(srcBuf: Float32Array, dst: Float32Array, dx: number, dy: number): void {
    // Texel reader — pixel(pos) samples at pixel centers; ± integer dist
    // along an axis stays on centers, so direct texel reads are exact.
    // Hoisted out of the pixel loops (no per-pixel closure allocation).
    const read = (px: number, py: number, ch: number): number => {
      const cx = clamp(Math.round(px - 0.5), 0, CW - 1)
      const cy = clamp(Math.round(py - 0.5), 0, CH - 1)
      return srcBuf[(cy * CW + cx) * 4 + ch]
    }
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        const px = x + 0.5
        const py = y + 0.5
        let r = read(px, py, 0)
        let g = read(px, py, 1)
        let b = read(px, py, 2)
        let wsum = 0.5
        for (let dist = 1; dist < blurRadius; dist += 1) {
          const w = blurW[dist]
          r += w * (read(px - dist * dx, py - dist * dy, 0) + read(px + dist * dx, py + dist * dy, 0))
          g += w * (read(px - dist * dx, py - dist * dy, 1) + read(px + dist * dx, py + dist * dy, 1))
          b += w * (read(px - dist * dx, py - dist * dy, 2) + read(px + dist * dx, py + dist * dy, 2))
          wsum += w
        }
        const o = (y * CW + x) * 4
        dst[o] = r / (wsum * 2)
        dst[o + 1] = g / (wsum * 2)
        dst[o + 2] = b / (wsum * 2)
        dst[o + 3] = 1
      }
    }
  }

  blurPass(bufB, bufC, 1, 0)
  blurPass(bufC, bufD, 0, 1)

  // Composite: mix(graded, blurred, blurMix) — Normal blend. Written at the
  // capped working resolution, then upscaled over the full frame.
  if (!cpuPool.img || cpuPool.img.width !== CW || cpuPool.img.height !== CH) {
    cpuPool.img = sctx.createImageData(CW, CH)
  }
  const out = cpuPool.img
  const od = out.data
  for (let i = 0; i < CW * CH * 4; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      od[i + ch] = Math.round(clamp(bufB[i + ch] + (bufD[i + ch] - bufB[i + ch]) * p.blurMix, 0, 1) * 255)
    }
    od[i + 3] = 255
  }
  sctx.putImageData(out, 0, 0)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  if (anchor) {
    // The print lands back on the picture, stretched to its animated rect
    // — the tape frame follows the artwork's swell/sway/bob exactly.
    ctx.drawImage(snap, anchor.x, anchor.y, anchor.w, anchor.h)
  } else {
    ctx.drawImage(snap, 0, 0, W, H)
  }
  ctx.restore()
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

  // Anchor to the picture: when an Image-visualizer artwork is on screen,
  // the whole captured pipeline runs ON THE ARTWORK — its rect is the tape
  // frame, so the colored chroma streaks seep in from the picture's own
  // left/right vertical edges (effect.app's engine always renders the
  // effect with the media filling the frame; a floating picture would
  // otherwise push those edge artifacts onto the empty margins where
  // nothing can show). Without an artwork (other styles, placeholder) the
  // frame IS the tape, exactly as before.
  const anchor = rc.imageVizRect && rc.imageVizRect.w >= 16 && rc.imageVizRect.h >= 16 ? rc.imageVizRect : null

  const g = getGL(anchor ? anchor.workW : W, anchor ? anchor.workH : H)
  if (!g) {
    if (!camPathLogged) {
      camPathLogged = true
      console.info('[camcorder] CPU fallback active (WebGL2 unavailable)')
    }
    drawCPU(rc, params, anchor)
    return
  }
  if (!camPathLogged) {
    camPathLogged = true
    console.info('[camcorder] GPU path active (WebGL2, 5 captured programs)')
  }

  drawGL(g, rc, params, anchor)

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  if (anchor) {
    // The finished print stretches over the artwork's animated rect — the
    // tape frame rides the picture's swell/sway/bob exactly.
    ctx.drawImage(g.canvas, anchor.x, anchor.y, anchor.w, anchor.h)
  } else {
    ctx.drawImage(g.canvas, 0, 0, W, H)
  }
  ctx.restore()
}
