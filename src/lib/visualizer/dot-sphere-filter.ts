/**
 * Dot Sphere filter — the reference look: the picture bends away and fades
 * toward the screen edges while a 3D LED ball floats in the center, a
 * latitude/longitude grid of glowing dots streaming horizontally around it
 * through a wave field fixed to the viewer, which weaves the rows into
 * wavy neon bands.
 *
 * The backdrop: the SCENE ITSELF — the background picture, the
 * visualizer and every layer drawn before this filter — fills the frame
 * behind the ball through a radial fisheye bulge: the center stays put,
 * straight lines curve and the picture compresses as it bends toward the
 * screen edges, then sinks into the dark through a vignette. This is a
 * filter over the live scene, not a replacement for it — the background
 * and the visualizer keep playing, bent, instead of being swallowed.
 * The bend is baked (the look is the filter's identity, tuned to the
 * reference, not a control to babysit); the "Backdrop" dial sets how far
 * the scene sinks toward the edges (100% = the full reference look).
 * One tiny WebGL pass (a fullscreen quad, one texture upload per frame,
 * zero per-pixel CPU reads); devices without WebGL draw the scene flat
 * under the same vignette (the bend needs the GPU pass). Sampling beyond
 * the frame's edges MIRRORS it, so the far corners the bulge reaches
 * never smear — and the vignette owns them anyway. A solid disk of the
 * backdrop's near-black sits under the ball so the LED face stays solid
 * against the bright scene behind it.
 *
 * Geometry (pure canvas math — no GL for the dots, no per-pixel reads):
 *   · the ball is a lat/long grid: `rows` latitude circles, each carrying
 *     the same longitude count, so the dots crowd together toward the poles
 *     exactly like a real dot-matrix sphere
 *   · every dot sits at (latitude φ, longitude θ); the ball's spin adds to
 *     θ over time (the "flow" dial), so dots travel horizontally across the
 *     face, swell coming toward the viewer (perspective divide) and squeeze
 *     into vertical ellipses as they round the limb — the 3D manner
 *   · one wave field — sin(longitude · cycles + latitude · bandTwist −
 *     styleTime · waveSpeed) — displaces each row vertically and drives the
 *     dot brightness, so bright wavy bands weave over the ball while the
 *     dots stream through them; a second, slower wave of the same
 *     ingredients drives the hue between the two neon poles
 *
 * The wave closes on itself: its spatial frequency is a WHOLE number of
 * cycles around the longitude circle (the renderer rounds the dial), so
 * the field is exactly 2π-periodic — a fractional cycle would tear at the
 * longitude origin and the tear would sweep around the ball on every
 * rotation (the seam this filter shipped with).
 *
 * Colors: 'neon' mode paints the reference pink/blue LED palette from a
 * color LUT built once at load (zero per-frame pixel reads, zero string
 * allocations in the hot loop); 'picture' mode samples the finished frame
 * (one small downscaled getImageData — the phosphor pattern) so the dots
 * carry the picture's own colors — with the bent backdrop behind them the
 * dots pick up its palette for free.
 *
 * Composite: the print builds on its own offscreen canvas (backdrop →
 * bent picture → solid ball disk → additive dots) and lands on the frame
 * in the house blend order — print full, the untouched frame fades back
 * over it below 100% mix.
 *
 * Music: each latitude row rides its own spectrum bin ("Music ripple" —
 * brightness + dot size), and the standard React-to-beat box makes the wave
 * swell and the dots flare on kicks (additive via the shared `beatAmount`
 * gate, resting exactly at the dialed look between kicks).
 *
 * Clock: the flow and waves follow the decorative style clock (wall clock
 * live so the ball keeps drifting while paused; song time in exports), the
 * app-wide contract for ambient motion — deterministic files, alive
 * previews. Deterministic: no Math.random, no time-hashed noise — same
 * frame in, same pixels out. Skipped on transparent backgrounds like every
 * full-frame filter.
 */
import type { AudioFrame, DotSphereFilterConfig, RenderContext } from './types'
import { beatAmount, clamp01, getWork, resetWork } from './filter-utils'

/* ------------------------------ neon color LUT ------------------------------ */

/* The two palette poles (the reference LED look): electric blue and hot
 * magenta-pink. At full brightness the color lifts toward a pale hot core,
 * so the densest dots whiten like real overdriven LEDs. */
const NEON_BLUE = { r: 62, g: 84, b: 255 }
const NEON_PINK = { r: 255, g: 62, b: 214 }
const HOT_CORE = { r: 255, g: 208, b: 242 }

const LUT_HUES = 9
const LUT_LUMS = 13
const TAU = Math.PI * 2

/** Fill styles indexed [hue 0..8][lum 0..12] — built once at load, so the
 *  hot loop never allocates a color string in neon mode. */
const NEON_LUT: string[] = (() => {
  const lut: string[] = []
  for (let h = 0; h < LUT_HUES; h++) {
    const t = h / (LUT_HUES - 1)
    const br = NEON_BLUE.r + (NEON_PINK.r - NEON_BLUE.r) * t
    const bg = NEON_BLUE.g + (NEON_PINK.g - NEON_BLUE.g) * t
    const bb = NEON_BLUE.b + (NEON_PINK.b - NEON_BLUE.b) * t
    for (let l = 0; l < LUT_LUMS; l++) {
      const lum = l / (LUT_LUMS - 1)
      const k = 0.14 + 0.94 * lum
      let r = br * k
      let g = bg * k
      let b = bb * k
      const lift = lum * lum * lum * 0.38
      r += (HOT_CORE.r - r) * lift
      g += (HOT_CORE.g - g) * lift
      b += (HOT_CORE.b - b) * lift
      lut.push(
        `rgb(${Math.min(255, Math.round(r))},${Math.min(255, Math.round(g))},${Math.min(255, Math.round(b))})`,
      )
    }
  }
  return lut
})()

/* --------------------------------- the filter -------------------------------- */

/** Camera distance in sphere radii — the strength of the 3D bulge (the
 *  face-on dots render this much bigger than the limb dots). */
const PERSP = 3.0
/** cos(longitude) floor for the front hemisphere — a solid ball hides the
 *  back, and this trims the degenerate silhouette ring. */
const BACKFACE = 0.045
/** Horizontal squeeze floor at the limb — edge dots become vertical
 *  ellipses, never vanish. */
const SQUSH_MIN = 0.24
/** The backdrop color the vignette and the ball face sink into (#050109).
 *  Kept in one place so the GL pass, the CPU vignette and the disk agree. */
const BACKDROP_RGB = { r: 5, g: 1, b: 9 }
/** The baked backdrop bend — the reference curves the scene toward the
 *  screen edges. Deliberately NOT a dial: this is the look the filter
 *  promises, tuned once to the reference. */
const BG_BEND = 0.6
/** The baked edge fade at Backdrop 100% — how far the scene sinks into
 *  the dark toward the screen edges (the dial scales it). */
const BG_FADE = 0.85

export function drawDotSphereFilter(
  rc: RenderContext,
  cfg: DotSphereFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass' | 'freq' | 'styleTime'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 16 || H < 16) return

  const blend = clamp01(cfg.blend ?? 1)
  if (blend <= 0.001) return

  const t = frame.styleTime

  // Beat — additive on kicks, resting at exactly 0 between them: the wave
  // swells a little and the dots flare. Nothing else reacts to the beat.
  const beat = beatAmount(cfg, frame.bass)
  const waveEff = clamp01((cfg.waveAmount ?? 0.6) + beat * 0.35)
  const flare = beat * 0.4

  const size = Math.max(0.3, cfg.size ?? 0.75)
  const rows = Math.max(2, Math.round(cfg.rows ?? 56))
  const dotSize = Math.max(0.05, cfg.dotSize ?? 1)
  const flow = cfg.flowSpeed ?? 0.6
  // The wave must close on itself around the ball: a fractional cycle
  // tears at the longitude origin and the tear sweeps around with the
  // rotation — the seam. Whole cycles only, old fractional saves heal.
  const waveCycles = Math.max(1, Math.round(cfg.waveScale ?? 5))
  const waveSpeed = cfg.waveSpeed ?? 0.9
  const bandTwist = Math.max(0, cfg.bandTwist ?? 0.9)
  const ripple = clamp01(cfg.ripple ?? 0.35)
  const glow = clamp01(cfg.glow ?? 0.55)
  const backdrop = clamp01(cfg.backdrop ?? 1)
  const picture = cfg.colorMode === 'picture'

  const cx = W / 2
  const cy = H / 2
  const R = (Math.min(W, H) / 2) * size
  // The ball's silhouette on screen: the tangent circle seen from the
  // camera projects to R · D/√(D²−1) — the solid face fills exactly this.
  const rs = (R * PERSP) / Math.sqrt(PERSP * PERSP - 1)
  const rowSpacing = (2 * R) / rows
  const baseDot = rowSpacing * 0.25 * dotSize
  const haloAlpha = glow * 0.2
  const scroll = flow * t
  const freq = frame.freq
  const binCount = freq?.length ?? 0

  // The untouched frame is snapshotted FIRST: it doubles as the mix base
  // and (in picture mode) the color source for the dots.
  const base = getWork('dotsphere:base', W, H)
  const bctx = resetWork(base.getContext('2d')!)
  bctx.drawImage(ctx.canvas, 0, 0)

  let srcData: Uint8ClampedArray | null = null
  let sw = 0
  let sh = 0
  if (picture) {
    // One small downscaled read of the finished frame (the phosphor
    // pattern): dot colors come from here — never a full-res readback.
    sw = Math.max(48, Math.min(320, Math.round(W / 3)))
    sh = Math.max(32, Math.round((sw * H) / W))
    const sm = getWork('dotsphere:sm', sw, sh)
    const smctx = resetWork(sm.getContext('2d', { willReadFrequently: true })!)
    smctx.drawImage(ctx.canvas, 0, 0, sw, sh)
    srcData = smctx.getImageData(0, 0, sw, sh).data
  }

  // The print builds on its own canvas so the additive ('lighter') dots sum
  // against the backdrop instead of the picture.
  const out = getWork('dotsphere:out', W, H)
  const octx = resetWork(out.getContext('2d')!)

  // The bent backdrop — the SCENE ITSELF (background, visualizer, every
  // layer drawn so far) fills the frame behind the ball, curving away and
  // fading toward the screen edges (the reference look), so the background
  // and the visualizer keep playing — bent — instead of being swallowed.
  // The Backdrop dial scales how far the scene sinks into the dark.
  const fadeEff = clamp01(BG_FADE * backdrop)
  const g = getBgGL(W, H)
  if (g) {
    uploadFrame(g, base)
    drawBgGL(g, W, H, BG_BEND, fadeEff)
    octx.drawImage(g.canvas, 0, 0, W, H)
  } else {
    // WebGL-less devices: the scene flat under the same vignette (the
    // bend needs the GPU pass — documented in the card copy).
    drawBentBgCPU(octx, base, W, H, fadeEff)
  }
  // The solid ball face — a disk of the backdrop's near-black so the LED
  // dots stay legible over the bright scene behind the ball.
  octx.globalAlpha = 1
  octx.beginPath()
  octx.arc(cx, cy, rs, 0, TAU)
  octx.fillStyle = '#050109'
  octx.fill()

  octx.globalCompositeOperation = 'lighter'

  const cols = Math.max(8, Math.round(Math.PI * rows))
  const colStep = TAU / cols
  const waveAmp = waveEff * rowSpacing * 2.6

  for (let i = 0; i < rows; i++) {
    const v = i / (rows - 1)
    const phi = v * Math.PI
    const sinPhi = Math.sin(phi)
    if (sinPhi < 0.05) continue // pole pinch — nothing legible lands there
    const yUp = Math.cos(phi)
    const rowPhase = phi * bandTwist
    // Each row rides its own spectrum bin — bottom rows get the low end.
    const bin = binCount > 0 ? Math.min(binCount - 1, Math.floor((1 - v) * binCount)) : -1
    const rippleV = bin >= 0 ? clamp01(freq![bin]) : 0
    const rippleK = 1 + 0.3 * rippleV * ripple
    const rippleLum = rippleV * ripple * 0.45

    for (let j = 0; j < cols; j++) {
      const theta0 = j * colStep // unscrolled longitude — the wave field is fixed to the viewer
      const thetaW = theta0 + scroll // the dot's actual position on the ball
      const cosW = Math.cos(thetaW)
      if (cosW < BACKFACE) continue // back hemisphere — a solid ball hides it
      const sinW = Math.sin(thetaW)

      // Displacement and brightness share one wave; the hue rides a slower,
      // slightly diagonal one so the pink/blue bands weave against it.
      // Both spatial frequencies are whole numbers (waveCycles / 2), so the
      // fields are exactly 2π-periodic — no seam as the ball rotates.
      const w1 = Math.sin(theta0 * waveCycles + rowPhase - t * waveSpeed)
      const w2 = Math.sin(theta0 * 2.0 + phi * 3.2 - t * waveSpeed * 0.6 + 2.4)
      const crest = 0.5 + 0.5 * w1

      const persp = PERSP / (PERSP - sinPhi * cosW)
      const sx = cx + sinPhi * sinW * R * persp
      const sy = cy - yUp * R * persp + waveAmp * w1

      const r = baseDot * persp * (0.78 + 0.4 * crest) * rippleK
      const rx = Math.max(r * SQUSH_MIN, r * cosW)
      const pad = r * 2.6 + 2
      if (sx < -pad || sx > W + pad || sy < -pad || sy > H + pad) continue

      let style: string
      let alpha: number
      if (picture && srcData) {
        // Sample the finished frame at the dot's own screen spot.
        const xi = Math.min(sw - 1, Math.max(0, Math.round((sx / W) * sw - 0.5)))
        const yi = Math.min(sh - 1, Math.max(0, Math.round((sy / H) * sh - 0.5)))
        const kk = (yi * sw + xi) * 4
        style = `rgb(${srcData[kk]},${srcData[kk + 1]},${srcData[kk + 2]})`
        alpha = Math.min(1, (0.38 + 0.62 * crest) * (0.5 + 0.5 * cosW) + flare)
      } else {
        const lum = Math.min(
          1,
          0.1 + 0.9 * (0.16 + 0.84 * crest) * (0.38 + 0.62 * cosW) + flare + rippleLum,
        )
        const hi = Math.round((0.5 + 0.5 * w2) * (LUT_HUES - 1))
        const li = Math.round(lum * (LUT_LUMS - 1))
        style = NEON_LUT[hi * LUT_LUMS + li]
        alpha = 1
      }

      octx.fillStyle = style
      if (haloAlpha > 0.002) {
        octx.globalAlpha = Math.min(1, alpha * haloAlpha)
        octx.beginPath()
        octx.ellipse(sx, sy, rx * 2.1, r * 2.1, 0, 0, TAU)
        octx.fill()
      }
      octx.globalAlpha = alpha
      octx.beginPath()
      octx.ellipse(sx, sy, rx, r, 0, 0, TAU)
      octx.fill()
    }
  }

  octx.globalAlpha = 1
  octx.globalCompositeOperation = 'source-over'

  // House blend order: the print lands full, and below 100% mix the
  // untouched frame fades back over it.
  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  ctx.drawImage(out, 0, 0, W, H)
  if (blend < 0.999) {
    ctx.globalAlpha = 1 - blend
    ctx.drawImage(base, 0, 0, W, H)
  }
  ctx.restore()
}

/* ------------------------ bent picture backdrop (WebGL) ------------------------ */

const BG_VERT = `
attribute vec2 aPos;
varying vec2 vPos;
void main() {
  vPos = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/* The fisheye bulge: a pixel at screen radius r samples the SCENE at
 * f(r) = tan(r·A)/tan(A) — the identity at A=0, and for A>0 the tangent's
 * convexity keeps f(r) < r on (0,1), so the center stays put, straight
 * lines curve and the scene compresses as it bends toward the screen
 * edges. Beyond the screen's short side (r > 1, the corners) the sample
 * radius is capped at 2.0 so tan never crosses its pole, and the sample
 * coordinates MIRROR past the frame's edges — no clamped smear. The
 * vignette then sinks everything past ~30% of the half-short side into
 * the backdrop dark. The texture is the finished frame so far (uploaded
 * once per frame), so the background and the visualizer stay alive under
 * the bulge. */
const BG_FRAG = `
precision highp float;
varying vec2 vPos;
uniform vec2 uRes;
uniform float uBend;
uniform float uFade;
uniform sampler2D uTex;

void main() {
  vec2 px = (vPos * 0.5 + 0.5) * uRes;
  float hm = 0.5 * min(uRes.x, uRes.y);
  vec2 rel = (px - uRes * 0.5) / hm;
  float r = length(rel);
  vec2 dir = r > 0.0001 ? rel / r : vec2(0.0);
  float A = uBend * 0.9;
  float rc = min(r, 2.0);
  float f = A > 0.001 ? tan(rc * A) / tan(A) : rc;
  vec2 uv = (uRes * 0.5 + dir * (f * hm)) / uRes;
  vec2 m = 1.0 - abs(1.0 - mod(uv, 2.0));
  vec3 img = texture2D(uTex, m).rgb;
  float vig = smoothstep(0.30, 1.15, r) * uFade;
  vec3 col = mix(img, vec3(0.0196, 0.0039, 0.0353), vig);
  gl_FragColor = vec4(col, 1.0);
}
`

interface BgGL {
  canvas: HTMLCanvasElement
  gl: WebGLRenderingContext
  program: WebGLProgram
  tex: WebGLTexture
  loc: Partial<
    Record<'uRes' | 'uBend' | 'uFade' | 'uTex', WebGLUniformLocation | null>
  >
  w: number
  h: number
}

/** One GL context is enough: the preview and the offline export never
 *  interleave frames, so the bundle resizes to whoever renders next. */
let bgGL: BgGL | null = null

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
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

/** Build (or reuse) the offscreen GL bundle. Returns null when WebGL is
 *  unavailable — the caller falls back to the flat picture + vignette. */
function getBgGL(w: number, h: number): BgGL | null {
  if (bgGL) return bgGL
  try {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const gl = (canvas.getContext('webgl', {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    }) ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) return null

    const vs = compileShader(gl, gl.VERTEX_SHADER, BG_VERT)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, BG_FRAG)
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

    // Scene texture: LINEAR + CLAMP_TO_EDGE (NPOT-legal) — the shader's
    // mirror wrap keeps every sample inside [0,1] anyway.
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))

    bgGL = {
      canvas,
      gl,
      program,
      tex,
      loc: {
        uRes: gl.getUniformLocation(program, 'uRes'),
        uBend: gl.getUniformLocation(program, 'uBend'),
        uFade: gl.getUniformLocation(program, 'uFade'),
        uTex: gl.getUniformLocation(program, 'uTex'),
      },
      w: 0,
      h: 0,
    }
    return bgGL
  } catch {
    return null
  }
}

/** Upload the current scene into the texture — the frame changes every
 *  frame, so this runs once per frame (one texture upload, no other GL
 *  churn; the same cost shape as the Cubify pass). */
function uploadFrame(g: BgGL, src: HTMLCanvasElement): void {
  const { gl } = g
  try {
    gl.bindTexture(gl.TEXTURE_2D, g.tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
  } catch {
    // A failed upload keeps the previous frame's texture in place — the
    // next frame tries again; nothing else in the pipeline is affected.
  }
}

function drawBgGL(
  g: BgGL,
  w: number,
  h: number,
  bend: number,
  fade: number,
): void {
  const { gl, loc } = g
  if (g.w !== w || g.h !== h) {
    g.canvas.width = w
    g.canvas.height = h
    g.w = w
    g.h = h
  }
  gl.viewport(0, 0, w, h)
  gl.useProgram(g.program)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, g.tex)
  gl.uniform2f(loc.uRes!, w, h)
  gl.uniform1f(loc.uBend!, bend)
  gl.uniform1f(loc.uFade!, fade)
  if (loc.uTex) gl.uniform1i(loc.uTex, 0)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

/* --------------------- bent scene backdrop (CPU fallback) --------------------- */

/** WebGL-less devices: the scene drawn flat under the same vignette (the
 *  bend needs the GPU pass — documented in the card copy). Zero per-pixel
 *  reads: one drawImage + one radial gradient. */
function drawBentBgCPU(
  octx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  W: number,
  H: number,
  fade: number,
): void {
  octx.drawImage(src, 0, 0, W, H)
  if (fade > 0.001) {
    const hm = Math.min(W, H) / 2
    const g = octx.createRadialGradient(W / 2, H / 2, hm * 0.3, W / 2, H / 2, hm * 1.15)
    g.addColorStop(0, `rgba(${BACKDROP_RGB.r},${BACKDROP_RGB.g},${BACKDROP_RGB.b},0)`)
    g.addColorStop(1, `rgba(${BACKDROP_RGB.r},${BACKDROP_RGB.g},${BACKDROP_RGB.b},${fade.toFixed(3)})`)
    octx.fillStyle = g
    octx.fillRect(0, 0, W, H)
  }
}
