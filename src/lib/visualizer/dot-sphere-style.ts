/**
 * Dot Sphere STYLE — the reference look, living in the Style tab where it
 * belongs: the background picture bends away and fades toward the screen
 * edges while a 3D LED ball floats in the center, a latitude/longitude
 * grid of glowing dots streaming horizontally around it through a wave
 * field fixed to the viewer, which weaves the rows into wavy neon bands.
 *
 * Why a style (the history): this shipped as a full-frame filter first,
 * and a filter that repaints the whole frame behind the ball is a style
 * wearing a filter's name — nothing outside the ball survived it. Moved
 * into the visualizer styles, it owns the frame honestly: it IS the
 * visualizer, drawn over whatever background the user picked, alongside
 * Sphere / Bars / Wave — one style selected at a time, every other style
 * still one click away.
 *
 * The backdrop: the SCENE BEHIND THE BALL — the background picture and
 * every layer drawn below the visualizer — fills the frame through a
 * radial fisheye bulge: the center stays put, straight lines curve and
 * the picture compresses as it bends toward the screen edges, then sinks
 * into the dark through a vignette. The bend is baked (the look is the
 * style's identity, tuned to the reference, not a control to babysit);
 * the "Backdrop" dial sets how far the picture sinks toward the edges
 * (100% = the full reference look). One tiny WebGL pass (a fullscreen
 * quad, one texture upload per frame, zero per-pixel CPU reads); devices
 * without WebGL draw the scene flat under the same vignette (the bend
 * needs the GPU pass). Sampling beyond the frame's edges MIRRORS it, so
 * the far corners the bulge reaches never smear — and the vignette owns
 * them anyway. A solid disk of the backdrop's near-black sits under the
 * ball so the LED face stays solid against the bright picture behind it.
 *
 * Layer contract: the bent backdrop is a FULL-FRAME pass (drawn with the
 * layer transform temporarily reset — it is the world, not an object in
 * it), while the ball itself draws INSIDE the Style tab's layer transform,
 * so Position X/Y and Size still move and scale the ball exactly like any
 * other style. The Transparency dial fades the whole print (backdrop and
 * ball alike) back toward the flat scene behind it.
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
 * rotation (the seam this look originally shipped with).
 *
 * Colors: 'neon' paints the reference pink/blue LED palette from a color
 * LUT built once at load (zero per-frame pixel reads, zero string
 * allocations in the hot loop); 'picture' samples the scene behind the
 * ball (one small downscaled getImageData) so the dots carry the
 * picture's own colors — with the bent backdrop behind them the dots pick
 * up its palette for free.
 *
 * Music: each latitude row rides its own spectrum bin ("Music ripple" —
 * brightness + dot size), and the React-to-beat box makes the wave swell
 * and the dots flare on kicks (additive via the shared beat gate, resting
 * exactly at the dialed look between kicks).
 *
 * Clock: the flow and waves follow the decorative style clock (wall clock
 * live so the ball keeps drifting while paused; song time in exports), the
 * app-wide contract for ambient motion — deterministic files, alive
 * previews. Deterministic: no Math.random, no time-hashed noise — same
 * frame in, same pixels out. On transparent backgrounds the bent backdrop
 * takes a rest (there is no picture to bend) and only the ball's dots
 * render, so alpha recordings stay clean.
 */
import type { AudioFrame, RenderContext, VisualizerConfig } from './types'
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

/* --------------------------------- the style -------------------------------- */

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
/** The baked backdrop bend — the reference curves the picture toward the
 *  screen edges. Deliberately NOT a dial: this is the look the style
 *  promises, tuned once to the reference. */
const BG_BEND = 0.6
/** The baked edge fade at Backdrop 100% — how far the picture sinks into
 *  the dark toward the screen edges (the dial scales it). */
const BG_FADE = 0.85

export function drawDotSphereStyle(
  rc: RenderContext,
  frame: Pick<AudioFrame, 'bass' | 'freq' | 'styleTime'>,
  cfg: VisualizerConfig,
  transparent: boolean,
): void {
  const { ctx, width: W, height: H } = rc
  if (W < 16 || H < 16) return

  const t = frame.styleTime

  // Beat — additive on kicks, resting at exactly 0 between them: the wave
  // swells a little and the dots flare. Nothing else reacts to the beat.
  const beat = beatAmount(
    { beatReactive: cfg.dotSphereBeat, beatStrength: cfg.dotSphereBeatStrength },
    frame.bass,
  )
  const waveEff = clamp01((cfg.dotSphereWave ?? 0.6) + beat * 0.35)
  const flare = beat * 0.4

  const size = Math.max(0.3, cfg.dotSphereSize ?? 0.75)
  const rows = Math.max(2, Math.round(cfg.dotSphereRows ?? 56))
  const dotSize = Math.max(0.05, cfg.dotSphereDotSize ?? 1)
  const flow = cfg.dotSphereFlow ?? 0.6
  // The wave must close on itself around the ball: a fractional cycle
  // tears at the longitude origin and the tear sweeps around with the
  // rotation — the seam. Whole cycles only, old fractional saves heal.
  const waveCycles = Math.max(1, Math.round(cfg.dotSphereWaveScale ?? 5))
  const waveSpeed = cfg.dotSphereWaveSpeed ?? 0.9
  const bandTwist = Math.max(0, cfg.dotSphereTwist ?? 0.9)
  const ripple = clamp01(cfg.dotSphereRipple ?? 0.35)
  const glow = clamp01(cfg.dotSphereGlow ?? 0.55)
  // The Style tab's shared Glow switch gates the halo entirely (the same
  // role it plays for the Sphere style's atmosphere); the card's Glow dial
  // sets how strong it is when the switch is on.
  const haloAlpha = (cfg.glow ? glow : 0) * 0.2
  const backdrop = clamp01(cfg.dotSphereBackdrop ?? 1)
  // Picture mode needs a picture to sample; on a transparent background
  // there is none, so the dots fall back to the neon palette (alpha
  // recordings stay legible instead of fading to nothing).
  const picture = !transparent && cfg.dotSphereColors === 'picture'
  // Whole-layer alpha — the Style tab's Transparency dial scales every
  // pass below (same contract as every other style draw).
  const la = 1 - clamp01(cfg.transparency ?? 0)

  const cx = W / 2
  const cy = H / 2
  const R = (Math.min(W, H) / 2) * size
  // The ball's silhouette on screen: the tangent circle seen from the
  // camera projects to R · D/√(D²−1) — the solid face fills exactly this.
  const rs = (R * PERSP) / Math.sqrt(PERSP * PERSP - 1)
  const rowSpacing = (2 * R) / rows
  const baseDot = rowSpacing * 0.25 * dotSize
  const scroll = flow * t
  const freq = frame.freq
  const binCount = freq?.length ?? 0

  // The scene behind the ball — the background picture (and any layer
  // drawn below the visualizer) — snapshotted BEFORE anything draws: it
  // is the bent backdrop's texture and (in picture mode) the dot colors.
  let base: HTMLCanvasElement | null = null
  if (!transparent) {
    base = getWork('dotsphere:base', W, H)
    const bctx = resetWork(base.getContext('2d')!)
    bctx.drawImage(ctx.canvas, 0, 0)
  }

  let srcData: Uint8ClampedArray | null = null
  let sw = 0
  let sh = 0
  if (picture && base) {
    // One small downscaled read of the scene (the phosphor pattern): dot
    // colors come from here — never a full-res readback.
    sw = Math.max(48, Math.min(320, Math.round(W / 3)))
    sh = Math.max(32, Math.round((sw * H) / W))
    const sm = getWork('dotsphere:sm', sw, sh)
    const smctx = resetWork(sm.getContext('2d', { willReadFrequently: true })!)
    smctx.drawImage(base, 0, 0, sw, sh)
    srcData = smctx.getImageData(0, 0, sw, sh).data
  }

  if (!transparent && base) {
    // The bent backdrop — a FULL-FRAME pass: the layer transform is reset
    // for this one draw (the bent picture is the world the ball floats
    // in, not an object inside it), then restored so the ball itself
    // keeps answering the Style tab's Position/Size dials. The Backdrop
    // dial scales how far the picture sinks into the dark.
    const fadeEff = clamp01(BG_FADE * backdrop)
    const g = getBgGL(W, H)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = la
    ctx.globalCompositeOperation = 'source-over'
    ctx.shadowBlur = 0
    if (g) {
      uploadFrame(g, base)
      drawBgGL(g, W, H, BG_BEND, fadeEff)
      ctx.drawImage(g.canvas, 0, 0, W, H)
    } else {
      // WebGL-less devices: the scene flat under the same vignette (the
      // bend needs the GPU pass — documented in the card copy).
      drawBentBgCPU(ctx, base, W, H, fadeEff)
    }
    ctx.restore()

    // The solid ball face — a disk of the backdrop's near-black so the LED
    // dots stay legible over the bright picture behind the ball. Drawn in
    // the layer transform, so it moves with the layer too.
    ctx.globalAlpha = la
    ctx.beginPath()
    ctx.arc(cx, cy, rs, 0, TAU)
    ctx.fillStyle = '#050109'
    ctx.fill()
  }

  // The dots add up against the bent backdrop on a real scene (the glowy
  // LED read). On a transparent background there is nothing to add onto —
  // additive would stack the dense face into a blown-out white disk — so
  // the dots land one by one at their own alpha and the ball reads as a
  // clean dotted sphere in alpha recordings.
  ctx.globalCompositeOperation = transparent ? 'source-over' : 'lighter'

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
        // Sample the scene behind the ball at the dot's own screen spot.
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

      ctx.fillStyle = style
      if (haloAlpha > 0.002) {
        ctx.globalAlpha = Math.min(1, alpha * haloAlpha * la)
        ctx.beginPath()
        ctx.ellipse(sx, sy, rx * 2.1, r * 2.1, 0, 0, TAU)
        ctx.fill()
      }
      ctx.globalAlpha = Math.min(1, alpha * la)
      ctx.beginPath()
      ctx.ellipse(sx, sy, rx, r, 0, 0, TAU)
      ctx.fill()
    }
  }

  ctx.globalAlpha = la
  ctx.globalCompositeOperation = 'source-over'
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
 * the backdrop dark. The texture is the scene behind the ball (uploaded
 * once per frame), so the background picture stays alive under the bulge. */
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
