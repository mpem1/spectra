/**
 * Cubify filter — effect.app's Cubify effect, PORTED 1:1 FROM ITS SHADER.
 *
 * The real GLSL was captured from effect.app's live editor (hooking
 * WebGLRenderingContext.shaderSource while the Cubify effect compiled) and
 * every constant below is theirs, not an interpretation:
 *
 *   distort(pos, m):
 *     1. rotate the coordinates by `angle` degrees
 *     2. scale onto an exponentially-sized grid: scxy = exp(scale ± aspect)
 *        (the "cube size" dial is logarithmic — +1 unit ≈ 2.7× bigger cubes)
 *     3. add the position offset + animation drift in GRID units
 *     4. take the fractional position inside each cell and WARP it:
 *        - "hard edges" on: step(0.5, f) — every cell snaps to its corners
 *        - off: apply smoothstep(0,1,f) `depth` whole times (fractional
 *          remainder blended) — pushes the sample toward the cell edges,
 *          which is what bends the picture around each cube's face
 *     5. undo the transform and resample the frame (linear, clamped)
 *   run(): three warps with per-channel strengths (R and B get
 *     (1.2 ∓ dispersion)/1.2 of the depth) for chromatic edge fringing.
 *
 * That is the whole effect — there is no bevel, light or grout in the
 * original; the 3D read comes entirely from the edge-pull warp. The port
 * runs the IDENTICAL math on the GPU: a tiny WebGL program renders the
 * effect into an offscreen GL canvas and the result is composited back over
 * the frame (one texture upload + one quad per frame). Where WebGL is
 * unavailable a per-pixel CPU fallback runs the same formulas with bilinear
 * sampling, so the look never silently disappears.
 *
 * Clock: the animation drift follows the decorative style clock (wall clock
 * live so the cubes keep drifting while paused; song time in exports), the
 * app-wide contract for ambient motion — deterministic files, alive previews.
 *
 * Beat pop (opt-in): on a detected low-end hit the depth distortion punches
 * deeper and the dispersion flares, driven by frame.bass through the shared
 * additive `beatAmount` gate — resting EXACTLY at the dialed look between
 * kicks.
 *
 * Deterministic: no Math.random, no time-hashed noise — same frame in, same
 * pixels out, so the live preview and offline exports agree frame-exactly.
 * Skipped on transparent backgrounds like every full-frame filter.
 */
import type { AudioFrame, CubifyFilterConfig, RenderContext } from './types'
import { beatAmount, clamp01, getWork, resetWork } from './filter-utils'

/* ------------------------------- GLSL (WebGL1) ------------------------------ */
/* Transcribed from the captured effect.app Cubify fragment shader — same
 * constants (baseIOR 1.2), same rotation matrices, same warp loop. */

const VERT_SRC = `
attribute vec2 aPos;
varying vec2 vPos;
void main() {
  vPos = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

const FRAG_SRC = `
precision highp float;
uniform sampler2D iChannel0;
uniform vec2 iResolution;
uniform float iTimelineTime;
uniform float uScale;
uniform float uAspect;
uniform float uDepth;
uniform float uHard;
uniform float uAngle;
uniform vec2 uPhase;
uniform vec2 uSpeed;
uniform float uDispersion;

vec2 toRel(vec2 fragPx) {
  float ar = iResolution.x / max(iResolution.y, 1e-6);
  vec2 inc = ar > 1.0 ? vec2(ar, 1.0) : vec2(1.0, 1.0 / ar);
  return (fragPx / iResolution * 2.0 - 1.0) * inc;
}

vec2 fromRel(vec2 rel) {
  float ar = iResolution.x / max(iResolution.y, 1e-6);
  vec2 inc = ar > 1.0 ? vec2(ar, 1.0) : vec2(1.0, 1.0 / ar);
  return (rel / inc + 1.0) / 2.0;
}

vec4 pixel(vec2 pos) {
  return texture2D(iChannel0, fromRel(pos));
}

vec2 distort(vec2 pos, float strengthVal) {
  float s = sin(radians(uAngle));
  float c = cos(radians(uAngle));
  pos *= mat2(c, s, -s, c);
  vec2 scxy = vec2(exp(uScale + uAspect), exp(uScale - uAspect));
  vec2 deltaPhase = uSpeed * iTimelineTime;
  pos = (pos * scxy) + (uPhase + deltaPhase);
  vec2 base = floor(pos);
  pos -= base;

  if (uHard > 0.5) {
    pos = step(0.5, pos);
  } else {
    // The original applies smoothstep(0,1,f) floor(m) whole times and mixes
    // the fractional remainder. GLSL ES 1.00 forbids data-dependent loops,
    // so the ≤5 iterations (the dial's max) unroll into chained mixes —
    // arithmetically identical: mix(a, b, clamp(k,0,1)) chains accumulate
    // exactly one smoothstep per whole unit of k.
    float k = clamp(strengthVal, 0.0, 5.0);
    vec2 s1v = smoothstep(0.0, 1.0, pos);
    vec2 s2v = smoothstep(0.0, 1.0, s1v);
    vec2 s3v = smoothstep(0.0, 1.0, s2v);
    vec2 s4v = smoothstep(0.0, 1.0, s3v);
    vec2 s5v = smoothstep(0.0, 1.0, s4v);
    vec2 wv = mix(pos, s1v, clamp(k, 0.0, 1.0));
    wv = mix(wv, s2v, clamp(k - 1.0, 0.0, 1.0));
    wv = mix(wv, s3v, clamp(k - 2.0, 0.0, 1.0));
    wv = mix(wv, s4v, clamp(k - 3.0, 0.0, 1.0));
    wv = mix(wv, s5v, clamp(k - 4.0, 0.0, 1.0));
    pos = wv;
  }

  pos = (pos + base - (uPhase + deltaPhase)) / scxy;
  pos *= mat2(c, -s, s, c);
  return pos;
}

void main() {
  const float baseIOR = 1.2;
  vec2 pos = toRel(gl_FragCoord.xy);

  float sG = uDepth * (baseIOR / baseIOR);
  float sR = uDepth * ((baseIOR - uDispersion) / baseIOR);
  float sB = uDepth * ((baseIOR + uDispersion) / baseIOR);

  float r = pixel(distort(pos, sR)).r;
  float g = pixel(distort(pos, sG)).g;
  float b = pixel(distort(pos, sB)).b;

  gl_FragColor = vec4(r, g, b, 1.0);
}
`

/* ------------------------------ GL plumbing --------------------------------- */

interface CubifyGL {
  canvas: HTMLCanvasElement
  gl: WebGLRenderingContext
  program: WebGLProgram
  tex: WebGLTexture
  loc: Partial<
    Record<
      'iResolution' | 'iTimelineTime' | 'uScale' | 'uAspect' | 'uDepth' | 'uHard' | 'uAngle' | 'uPhase' | 'uSpeed' | 'uDispersion' | 'iChannel0',
      WebGLUniformLocation | null
    >
  >
  w: number
  h: number
}

/** One GL context is enough: the preview and the offline export never
 *  interleave frames, so the bundle resizes to whoever renders next. */
let cubifyGL: CubifyGL | null = null

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh)
    return null
  }
  return sh
}

/** Build (or rebuild) the offscreen GL bundle. Returns null when WebGL is
 *  unavailable — the caller falls back to the CPU path. */
function getGL(w: number, h: number): CubifyGL | null {
  if (cubifyGL) return cubifyGL
  try {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const gl = (canvas.getContext('webgl', {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    }) ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) return null

    const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
    const program = gl.createProgram()
    if (!vs || !fs || !program) return null
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
    gl.useProgram(program)

    // Fullscreen quad: one strip covering [-1,1]².
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    // Source texture: LINEAR + CLAMP_TO_EDGE (the only legal combo for
    // NPOT in WebGL1 — and exactly how the original resamples).
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    // Row 0 of the 2D canvas (its top) must land at v=1 so the y-up GL
    // coordinates match the original's gl_FragCoord convention.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))

    cubifyGL = {
      canvas,
      gl,
      program,
      tex,
      loc: {
        iResolution: gl.getUniformLocation(program, 'iResolution'),
        iTimelineTime: gl.getUniformLocation(program, 'iTimelineTime'),
        uScale: gl.getUniformLocation(program, 'uScale'),
        uAspect: gl.getUniformLocation(program, 'uAspect'),
        uDepth: gl.getUniformLocation(program, 'uDepth'),
        uHard: gl.getUniformLocation(program, 'uHard'),
        uAngle: gl.getUniformLocation(program, 'uAngle'),
        uPhase: gl.getUniformLocation(program, 'uPhase'),
        uSpeed: gl.getUniformLocation(program, 'uSpeed'),
        uDispersion: gl.getUniformLocation(program, 'uDispersion'),
        iChannel0: gl.getUniformLocation(program, 'iChannel0'),
      },
      w: 0,
      h: 0,
    }
    return cubifyGL
  } catch {
    return null
  }
}

function drawGL(g: CubifyGL, rc: RenderContext, p: CubifyParams): void {
  const { gl, loc } = g
  const { width: W, height: H, ctx } = rc
  if (g.w !== W || g.h !== H) {
    g.canvas.width = W
    g.canvas.height = H
    g.w = W
    g.h = H
  }
  gl.viewport(0, 0, W, H)
  gl.useProgram(g.program)

  // The finished frame IS the source texture (the filter sits at the end of
  // the chain, exactly like the original's global-input iChannel0).
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, g.tex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas)

  gl.uniform2f(loc.iResolution!, W, H)
  gl.uniform1f(loc.iTimelineTime!, p.time)
  gl.uniform1f(loc.uScale!, p.scale)
  gl.uniform1f(loc.uAspect!, p.stretch)
  gl.uniform1f(loc.uDepth!, p.depth)
  gl.uniform1f(loc.uHard!, p.hard ? 1 : 0)
  gl.uniform1f(loc.uAngle!, p.angle)
  gl.uniform2f(loc.uPhase!, p.offsetX, p.offsetY)
  gl.uniform2f(loc.uSpeed!, p.speedX, p.speedY)
  gl.uniform1f(loc.uDispersion!, p.dispersion)
  if (loc.iChannel0) gl.uniform1i(loc.iChannel0, 0)

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

/* ------------------------------- warp math (CPU fallback) ------------------- */

function smoothstep01(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x
  return t * t * (3 - 2 * t)
}

/** The captured distort() — identical transforms, same order. */
function distortX(
  x: number,
  y: number,
  m: number,
  cosA: number,
  sinA: number,
  scx: number,
  scy: number,
  phaseX: number,
  phaseY: number,
  hard: boolean,
): [number, number] {
  // rotate by +angle (mat2(c,s,-s,c) in GLSL column-major)
  let px = cosA * x - sinA * y
  let py = sinA * x + cosA * y
  px = px * scx + phaseX
  py = py * scy + phaseY
  const bx = Math.floor(px)
  const by = Math.floor(py)
  let fx = px - bx
  let fy = py - by
  if (hard) {
    fx = fx >= 0.5 ? 1 : 0
    fy = fy >= 0.5 ? 1 : 0
  } else {
    let k = m
    while (k > 1.0) {
      fx = smoothstep01(fx)
      fy = smoothstep01(fy)
      k -= 1.0
    }
    fx = fx + (smoothstep01(fx) - fx) * k
    fy = fy + (smoothstep01(fy) - fy) * k
  }
  px = (fx + bx - phaseX) / scx
  py = (fy + by - phaseY) / scy
  // rotate back (mat2(c,-s,s,c))
  return [cosA * px + sinA * py, -sinA * px + cosA * py]
}

interface CubifyParams {
  time: number
  scale: number
  stretch: number
  depth: number
  hard: boolean
  angle: number
  offsetX: number
  offsetY: number
  speedX: number
  speedY: number
  dispersion: number
}

/** Per-pixel port of the shader for environments without WebGL: same math,
 *  bilinear clamped sampling, ~one to three samples per pixel. */
function drawCPU(rc: RenderContext, p: CubifyParams, blend: number): void {
  const { ctx, width: W, height: H } = rc
  const src = getWork('cubify:src', W, H)
  const sctx = resetWork(src.getContext('2d', { willReadFrequently: true })!)
  sctx.drawImage(ctx.canvas, 0, 0)
  const data = sctx.getImageData(0, 0, W, H).data
  const out = getWork('cubify:out', W, H)
  const octx = resetWork(out.getContext('2d', { willReadFrequently: true })!)
  const img = octx.createImageData(W, H)
  const d8 = img.data

  const ar = W / Math.max(H, 1e-6)
  const incX = ar > 1 ? ar : 1
  const incY = ar > 1 ? 1 : 1 / ar
  const rad = (p.angle * Math.PI) / 180
  const cosA = Math.cos(rad)
  const sinA = Math.sin(rad)
  const scx = Math.exp(p.scale + p.stretch)
  const scy = Math.exp(p.scale - p.stretch)
  const phaseX = p.offsetX + p.speedX * p.time
  const phaseY = p.offsetY + p.speedY * p.time
  const ior = 1.2
  const mG = p.depth
  const mR = (p.depth * (ior - p.dispersion)) / ior
  const mB = (p.depth * (ior + p.dispersion)) / ior
  const split = p.dispersion > 0.0005

  const sample = (u: number, v: number): [number, number, number] => {
    // uv 0..1 y-up (GL convention) → ImageData row 0 is the TOP row
    const fx = Math.min(Math.max(u, 0), 1) * W - 0.5
    const fy = (1 - Math.min(Math.max(v, 0), 1)) * H - 0.5
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    let acc = [0, 0, 0]
    for (let sy = 0; sy < 2; sy++) {
      const yy = Math.min(Math.max(y0 + sy, 0), H - 1)
      const wy = sy === 0 ? 1 - ty : ty
      for (let sx = 0; sx < 2; sx++) {
        const xx = Math.min(Math.max(x0 + sx, 0), W - 1)
        const w = wy * (sx === 0 ? 1 - tx : tx)
        const kk = (yy * W + xx) * 4
        acc[0] += data[kk] * w
        acc[1] += data[kk + 1] * w
        acc[2] += data[kk + 2] * w
      }
    }
    return acc as [number, number, number]
  }

  for (let py = 0; py < H; py++) {
    // gl_FragCoord.y is y-up from the bottom
    const fragY = H - 0.5 - py
    for (let px = 0; px < W; px++) {
      const fragX = px + 0.5
      const relX = ((fragX / W) * 2 - 1) * incX
      const relY = ((fragY / H) * 2 - 1) * incY
      let r: number
      let g: number
      let b: number
      if (split) {
        const uvR = distortX(relX, relY, mR, cosA, sinA, scx, scy, phaseX, phaseY, p.hard)
        const uvG = distortX(relX, relY, mG, cosA, sinA, scx, scy, phaseX, phaseY, p.hard)
        const uvB = distortX(relX, relY, mB, cosA, sinA, scx, scy, phaseX, phaseY, p.hard)
        const cR = sample((uvR[0] / incX + 1) / 2, (uvR[1] / incY + 1) / 2)
        const cG = sample((uvG[0] / incX + 1) / 2, (uvG[1] / incY + 1) / 2)
        const cB = sample((uvB[0] / incX + 1) / 2, (uvB[1] / incY + 1) / 2)
        r = cR[0]
        g = cG[1]
        b = cB[2]
      } else {
        const uv = distortX(relX, relY, mG, cosA, sinA, scx, scy, phaseX, phaseY, p.hard)
        const c = sample((uv[0] / incX + 1) / 2, (uv[1] / incY + 1) / 2)
        r = c[0]
        g = c[1]
        b = c[2]
      }
      const o = (py * W + px) * 4
      d8[o] = r
      d8[o + 1] = g
      d8[o + 2] = b
      d8[o + 3] = 255
    }
  }
  octx.putImageData(img, 0, 0)

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  ctx.drawImage(out, 0, 0, W, H)
  if (blend < 0.999) {
    ctx.globalAlpha = 1 - blend
    ctx.drawImage(src, 0, 0, W, H)
  }
  ctx.restore()
}

/* --------------------------------- the filter -------------------------------- */

export function drawCubifyFilter(
  rc: RenderContext,
  cfg: CubifyFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass' | 'styleTime'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 16 || H < 16) return

  const blend = clamp01(cfg.blend ?? 1)
  if (blend <= 0.001) return

  // Beat pop — additive on kicks, resting at exactly 0 between them: the
  // depth distortion punches deeper and the dispersion flares.
  const beat = beatAmount(cfg, frame.bass)
  const depthEff = (cfg.depth ?? 1.8) + beat * 1.5
  const dispEff = Math.min(1, (cfg.dispersion ?? 0.75) + beat * 0.35)

  const params: CubifyParams = {
    time: frame.styleTime,
    scale: cfg.scale ?? 0.6,
    stretch: cfg.stretch ?? -0.21,
    depth: depthEff,
    hard: !!cfg.hard,
    angle: cfg.angle ?? 35,
    offsetX: cfg.offsetX ?? 0,
    offsetY: cfg.offsetY ?? 0,
    speedX: cfg.speedX ?? -0.34,
    speedY: cfg.speedY ?? 0.34,
    dispersion: dispEff,
  }

  const g = getGL(W, H)
  if (!g) {
    drawCPU(rc, params, blend)
    return
  }

  let base: HTMLCanvasElement | null = null
  if (blend < 0.999) {
    base = getWork('cubify:base', W, H)
    const bctx = resetWork(base.getContext('2d')!)
    bctx.drawImage(ctx.canvas, 0, 0)
  }

  drawGL(g, rc, params)

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  ctx.drawImage(g.canvas, 0, 0, W, H)
  if (base) {
    ctx.globalAlpha = 1 - blend
    ctx.drawImage(base, 0, 0, W, H)
  }
  ctx.restore()
}
