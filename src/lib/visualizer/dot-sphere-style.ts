/**
 * Dot Sphere STYLE — a 3D LED ball of glowing dots floating in the center
 * of the frame, over the user's background EXACTLY as they picked it: the
 * picture or gradient behind the ball is never repainted by this style —
 * no bending, no fading, no dimming — the ball simply floats over it.
 * (The history: the old filter version repainted the whole frame through
 * a fisheye+bend pass, which flipped the background upside down, dimmed
 * it toward near-black, and bent the user's gradient into radial rings
 * around the ball — all reported by the user. The style now leaves the
 * scene behind untouched and owns only the ball.)
 *
 * The ball: a latitude/longitude grid of dots streaming horizontally
 * around the sphere through a wave field fixed to the viewer, which
 * weaves the rows into wavy neon bands. The solid near-black disk under
 * the dots is the LED face — it keeps the dots legible over a bright
 * picture; on transparent backgrounds only the dots render so alpha
 * recordings stay clean.
 *
 * Geometry (pure canvas math — no GL, no per-pixel reads):
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
 * LUT built once at load; 'palette' paints the user's OWN gradient across
 * the ball BY POSITION — the GRADIENT editor's Shape decides where each
 * palette color lands (linear: a sweep across the ball at the editor's
 * Angle; radial: stop 1 at the core, last stop at the rim) and Cycle
 * colors ping-pongs the whole paint through the palette over time (the
 * same phase + reflection fold as sampleGradient, so colors never leave
 * the palette). The paint field is fixed to the viewer — the same
 * convention as the neon hue wave — so the dots stream THROUGH their
 * colors as the ball rotates (a second LUT rebuilt only when the palette
 * edits; the hot loop stays on table lookups, zero per-dot strings);
 * 'picture' samples the scene behind the ball (one small downscaled
 * getImageData) so the dots carry the picture's own colors.
 *
 * The ball's FACE — the solid disk the dots sit on — is a dial: 'dark'
 * keeps the near-black LED space (and rests entirely on transparent
 * backgrounds so alpha recordings stay clean), 'color' paints any picked
 * color, 'image' cover-fits the user's picture inside the circular face
 * (rounded exactly like the orb, never stretched). Color and image faces
 * are explicit choices, so they render on transparent backgrounds too.
 * A flat disk reads flat, so the SOLID faces are painted as a lit 3D
 * ball — light from the upper left, a soft specular glint and a form
 * shadow sinking around the limb — with the strength following the base
 * color's luminance (the near-black LED space only gains a gentle sheen).
 * The picture face is the user's own artwork and stays untouched.
 *
 * Music: the ball reacts like the other visualizers, and the shared
 * Sensitivity dial drives the WHOLE reaction, not one axis: every
 * latitude row rides its own spectrum bin ("Music ripple": bottom rows =
 * low end) and its band's energy PUSHES the surface outward along the
 * radius — concentrated at the wave crests, so the bulge rolls around
 * the ball like a traveling waveform (the same language as the Sphere
 * style's quills); the row's energy also DEEPENS its own wave-band
 * swing, so the wavy bands pump harder while the music plays; and the
 * whole ball — face and dots together — BREATHES with the bass the way
 * the Sphere style's shell does (1 + bass*0.16 at full drive). Per-row
 * brightness and dot-size lift ride the same energy. All of it is gated
 * by Music ripple (0 = the ball rests silent at the dialed look). The
 * React-to-beat box adds the shared gated beat punch: the wave swells
 * and the dots flare on kicks, resting exactly at the dialed look
 * between kicks.
 *
 * Clock: the flow and waves follow the decorative style clock (wall clock
 * live so the ball keeps drifting while paused; song time in exports), the
 * app-wide contract for ambient motion — deterministic files, alive
 * previews. Deterministic: no Math.random, no time-hashed noise — same
 * frame in, same pixels out.
 */
import type { AudioFrame, ColorStop, RenderContext, VisualizerConfig } from './types'
import { beatAmount, clamp01, getWork, resetWork } from './filter-utils'
import { getBackgroundImage } from './image-cache'
import { cyclePhase, parseColor, reflect01, sampleGradient } from './gradients'

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

/** Fill styles indexed [hue 0..8][lum 0..12] — built once, so the
 *  hot loop never allocates a color string in neon/palette mode. */
function buildLut(hueColors: { r: number; g: number; b: number }[]): string[] {
  const lut: string[] = []
  for (let h = 0; h < LUT_HUES; h++) {
    const { r: br, g: bg, b: bb } = hueColors[h]
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
}

const NEON_LUT: string[] = buildLut(
  Array.from({ length: LUT_HUES }, (_, h) => {
    const t = h / (LUT_HUES - 1)
    return {
      r: NEON_BLUE.r + (NEON_PINK.r - NEON_BLUE.r) * t,
      g: NEON_BLUE.g + (NEON_PINK.g - NEON_BLUE.g) * t,
      b: NEON_BLUE.b + (NEON_PINK.b - NEON_BLUE.b) * t,
    }
  }),
)

/* --------------------------- palette color LUT --------------------------- */

/* The user's own gradient palette swept across the dot hues. Rebuilt only
 * when the palette edits (a signature on the stop list), so the hot loop
 * stays on table lookups. Static sweep: the cycleColors ping-pong is not
 * baked into the LUT (it would rebuild every frame). */
let palLut: string[] | null = null
let palSig = ''
function paletteLutFor(stops: ColorStop[]): string[] {
  const sig = stops.map((s) => `${s.color}@${s.position}`).join('|')
  if (palLut && sig === palSig) return palLut
  const lut = buildLut(
    Array.from({ length: LUT_HUES }, (_, h) => {
      const c = parseColor(sampleGradient(stops, h / (LUT_HUES - 1), 0, false, 0))
      return { r: c?.r ?? 255, g: c?.g ?? 255, b: c?.b ?? 255 }
    }),
  )
  palLut = lut
  palSig = sig
  return lut
}

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
/** How far a full-energy spectrum bin pushes its row outward along the
 *  ball's radius (as a fraction of R) at Music ripple 100% — the surface
 *  waveform. The Ripple dial scales it. */
const RIPPLE_DEPTH = 0.22
/** Whole-ball bass-breathing ceiling — the same the Sphere style's shell
 *  reaches (`1 + bass * 0.16`) at full drive. */
const BREATH_MAX = 0.16
/** How much of a row's own band energy pours into its wave-band swing
 *  (in row spacings at Music ripple 100%) — the bands pump with the
 *  music. The Ripple dial scales it. */
const AUDIO_WAVE_SWING = 1.6
/** The default LED face color (the near-black the ball shipped with). */
const FACE_DEFAULT = '#050109'

/* ------------------------------- face lighting ------------------------------- */

/* The light source sits at the upper left of the face (offsets in face
 * radii from the disk center) — the same convention as the Sphere style's
 * top-lit shading. */
const LIGHT_X = -0.4
const LIGHT_Y = -0.45

/** Paint the lit-3D-ball shading over the solid face disk: one radial
 *  gradient keyed to the upper-left light (highlight → base → form shadow
 *  sinking around the far limb), a soft specular glint and a thin
 *  ambient-occlusion ring hugging the edge. The highlight and glint scale
 *  with the base color's luminance, so the near-black LED space only gains
 *  a gentle sheen while a picked color reads as a fully lit sphere. Must
 *  be called while the canvas composite is 'source-over' (it is — the
 *  dots switch to additive after the face is done). */
function paintFaceLight(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rs: number,
  base: { r: number; g: number; b: number },
): void {
  const lum = (0.2126 * base.r + 0.7152 * base.g + 0.0722 * base.b) / 255
  const css = (c: { r: number; g: number; b: number }) =>
    `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`
  const mix = (to: { r: number; g: number; b: number }, k: number) => ({
    r: base.r + (to.r - base.r) * k,
    g: base.g + (to.g - base.g) * k,
    b: base.b + (to.b - base.b) * k,
  })
  const WHITE = { r: 255, g: 255, b: 255 }
  const BLACK = { r: 0, g: 0, b: 0 }

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, rs, 0, TAU)
  ctx.clip()

  // Form shading — bright toward the light, the picked color through the
  // midtones, sinking into shadow around the lower-right limb. The end
  // radius (1.62·rs from the light) lands the far rim at the gradient's
  // full shadow, the near rim rides the highlight.
  const lx = cx + LIGHT_X * rs
  const ly = cy + LIGHT_Y * rs
  const g = ctx.createRadialGradient(lx, ly, rs * 0.05, lx, ly, rs * 1.62)
  g.addColorStop(0, css(mix(WHITE, 0.12 + 0.3 * lum)))
  g.addColorStop(0.42, css(base))
  g.addColorStop(1, css(mix(BLACK, 0.55)))
  ctx.fillStyle = g
  ctx.fillRect(cx - rs, cy - rs, rs * 2, rs * 2)

  // Specular glint — the glossy spot the light leaves on the surface.
  const gx = cx + LIGHT_X * 1.3 * rs
  const gy = cy + LIGHT_Y * 1.3 * rs
  const s = ctx.createRadialGradient(gx, gy, 0, gx, gy, rs * 0.4)
  s.addColorStop(0, `rgba(255,255,255,${(0.14 + 0.2 * lum).toFixed(3)})`)
  s.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = s
  ctx.fillRect(cx - rs, cy - rs, rs * 2, rs * 2)

  // Ambient occlusion — a thin dark ring hugging the limb so the edge
  // reads as a sphere curving away, not a cut-out circle.
  const ao = ctx.createRadialGradient(cx, cy, rs * 0.78, cx, cy, rs)
  ao.addColorStop(0, 'rgba(0,0,0,0)')
  ao.addColorStop(1, 'rgba(0,0,0,0.22)')
  ctx.fillStyle = ao
  ctx.fillRect(cx - rs, cy - rs, rs * 2, rs * 2)

  ctx.restore()
}

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
  // The shared Style-tab Sensitivity dial — the same role it plays for the
  // Sphere style and every other visualizer: it scales the WHOLE audio
  // reaction, not one axis — the radial ripple, the bass breathing and
  // the wave-band pump all ride it.
  const sens = Math.min(3, Math.max(0, cfg.sensitivity ?? 1))
  // Whole-ball breathing with the low end — the same reactivity the
  // Sphere style's shell gives (BREATH_MAX at full drive). Scaled by the
  // shared Sensitivity dial like every band, gated by Music ripple (0 =
  // the ball rests silent at the dialed look). Rides the whole ball:
  // the face disk and the dot shell pulse together.
  const breath = Math.min(BREATH_MAX, clamp01(frame.bass * sens) * ripple * 0.45)
  const ballScale = 1 + breath
  const glow = clamp01(cfg.dotSphereGlow ?? 0.55)
  // The Style tab's shared Glow switch gates the halo entirely (the same
  // role it plays for the Sphere style's atmosphere); the card's Glow dial
  // sets how strong it is when the switch is on.
  const haloAlpha = (cfg.glow ? glow : 0) * 0.2
  // Picture mode needs a picture to sample; on a transparent background
  // there is none, so the dots fall back to the neon palette (alpha
  // recordings stay legible instead of fading to nothing).
  const picture = !transparent && cfg.dotSphereColors === 'picture'
  // 'palette' mode: the dots paint the user's own gradient palette. Falls
  // back to neon when the palette has no stops (an edge that can only
  // happen before the store's defaults land).
  const gradStops = cfg.gradient?.stops
  const palettePaint = !picture && cfg.dotSphereColors === 'palette' && !!gradStops?.length
  const lut = palettePaint && gradStops ? paletteLutFor(gradStops) : NEON_LUT
  // The ball's face: 'dark' = the near-black LED space, 'color' = any
  // picked color, 'image' = the user's picture cover-fitted inside the
  // circular face. Dark rests on transparent backgrounds; the other two
  // are explicit choices and render even there.
  const face = cfg.dotSphereFace ?? 'dark'
  const faceColor = cfg.dotSphereFaceColor || FACE_DEFAULT
  const faceSrc = cfg.dotSphereFaceSrc || ''
  const faceImg = face === 'image' && faceSrc ? getBackgroundImage(faceSrc) : null
  // Whole-layer alpha — the Style tab's Transparency dial scales every
  // pass below (same contract as every other style draw).
  const la = 1 - clamp01(cfg.transparency ?? 0)

  const cx = W / 2
  const cy = H / 2
  const R = (Math.min(W, H) / 2) * size
  // The ball's silhouette on screen: the tangent circle seen from the
  // camera projects to R · D/√(D²−1) — the solid face fills exactly this
  // (scaled by the bass breathing, so face and dots pulse together).
  const rs = ((R * PERSP) / Math.sqrt(PERSP * PERSP - 1)) * ballScale
  const rowSpacing = (2 * R) / rows
  const baseDot = rowSpacing * 0.25 * dotSize
  const scroll = flow * t
  const freq = frame.freq
  const binCount = freq?.length ?? 0
  // The palette paint's geometry and clock (palette mode) — the GRADIENT
  // editor's Shape / Angle / Cycle controls, which style the ball exactly
  // like they style a fill elsewhere: LINEAR sweeps across the ball's own
  // bounding box at the editor's angle (the same direction math as
  // gradientLine), RADIAL radiates from the ball's core to its rim (stop 1
  // at the core, last stop at the rim — the editor's own description), and
  // Cycle colors ping-pongs the whole paint through the palette over time
  // (the same phase + reflection fold as sampleGradient). The paint field
  // is fixed to the viewer, like the neon hue wave: the dots stream
  // THROUGH their colors as the ball rotates.
  const palRadial = cfg.gradient?.shape === 'radial'
  const palCycle = !!cfg.gradient?.cycleColors
  const palPhase = palCycle ? cyclePhase(t, cfg.gradient?.cycleSpeed ?? 0.25) : 0
  let palDirX = 0
  let palDirY = -1
  let palLen = 2 * R
  if (!palRadial) {
    const rad = ((cfg.gradient?.angle ?? 48) * Math.PI) / 180
    palDirX = Math.sin(rad)
    palDirY = -Math.cos(rad)
    palLen = 2 * R * (Math.abs(palDirX) + Math.abs(palDirY))
  }

  let srcData: Uint8ClampedArray | null = null
  let sw = 0
  let sh = 0
  if (picture) {
    // The scene behind the ball, snapshotted BEFORE anything draws here
    // (the user's background picture stays untouched on the frame — this
    // copy is only the dot-color sampler). One small downscaled read: dot
    // colors come from here — never a full-res readback.
    const base = getWork('dotsphere:base', W, H)
    const bctx = resetWork(base.getContext('2d')!)
    bctx.drawImage(ctx.canvas, 0, 0)
    sw = Math.max(48, Math.min(320, Math.round(W / 3)))
    sh = Math.max(32, Math.round((sw * H) / W))
    const sm = getWork('dotsphere:sm', sw, sh)
    const smctx = resetWork(sm.getContext('2d', { willReadFrequently: true })!)
    smctx.drawImage(base, 0, 0, sw, sh)
    srcData = smctx.getImageData(0, 0, sw, sh).data
  }

  if (!transparent || face !== 'dark') {
    // The solid ball face — the LED backdrop the dots sit on, keeping them
    // legible over whatever the user placed behind the ball. Drawn in the
    // layer transform, so it moves with the layer.
    ctx.save()
    ctx.globalAlpha = la
    ctx.beginPath()
    ctx.arc(cx, cy, rs, 0, TAU)
    const faceFill = face === 'dark' ? FACE_DEFAULT : faceColor
    ctx.fillStyle = faceFill
    ctx.fill()
    if (face !== 'image') {
      // The solid face is painted as a lit 3D ball — highlight toward the
      // upper-left light, form shadow around the far limb — instead of a
      // flat disk. (The picture face is the user's own artwork: untouched.)
      paintFaceLight(ctx, cx, cy, rs, parseColor(faceFill) ?? { r: 5, g: 1, b: 9 })
    }
    if (faceImg) {
      // The picture rounds with the orb: clipped to the face circle and
      // cover-fitted (cropped, never stretched). While it decodes the
      // picked face color shows through.
      ctx.clip()
      const s = Math.max((rs * 2) / faceImg.naturalWidth, (rs * 2) / faceImg.naturalHeight)
      const w = faceImg.naturalWidth * s
      const h = faceImg.naturalHeight * s
      ctx.drawImage(faceImg, cx - w / 2, cy - h / 2, w, h)
    }
    ctx.restore()
  }

  // The dots add up against the ball face on a real scene (the glowy LED
  // read). On a transparent background there is nothing to add onto —
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
    // Each row rides its own spectrum bin — bottom rows get the low end —
    // scaled by the shared Sensitivity dial like every other style.
    const bin = binCount > 0 ? Math.min(binCount - 1, Math.floor((1 - v) * binCount)) : -1
    const rippleV = bin >= 0 ? clamp01(freq![bin] * sens) : 0
    const rippleK = 1 + 0.3 * rippleV * ripple
    const rippleLum = rippleV * ripple * 0.45
    // The row's own band energy also DEEPENS its wave-band swing — the
    // wavy bands pump harder while the music plays (the bass rows swing
    // hardest) and rest at the dialed amount in silence.
    const rowWaveAmp = waveAmp + rippleV * ripple * rowSpacing * AUDIO_WAVE_SWING

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

      // The band's energy PUSHES the surface outward along the ball's
      // radius — concentrated at the wave crests, so the bulge rolls
      // around the ball like a traveling waveform (low rows surge on the
      // kick drum) — and the whole ball rides the bass breathing. The
      // same reactivity language as the Sphere style's quills + shell.
      // Rests at the dialed sphere in silence.
      const surf =
        R * ballScale + rippleV * ripple * R * RIPPLE_DEPTH * (0.35 + 0.65 * crest)

      const persp = PERSP / (PERSP - sinPhi * cosW)
      const sx = cx + sinPhi * sinW * surf * persp
      const sy = cy - yUp * surf * persp + rowWaveAmp * w1

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
        // Palette mode paints by POSITION — where the dot sits on the ball
        // under the editor's Shape/Angle, folded by the Cycle phase — so
        // the whole GRADIENT section styles the ball, not just its stop
        // colors. Neon keeps its weave: the hue rides the slow diagonal
        // wave between the two poles.
        let hi: number
        if (palettePaint) {
          let p = palRadial
            ? Math.sqrt((sx - cx) * (sx - cx) + (sy - cy) * (sy - cy)) / R
            : ((sx - cx) * palDirX + (sy - cy) * palDirY) / palLen + 0.5
          p = p < 0 ? 0 : p > 1 ? 1 : p
          if (palCycle) p = reflect01(p + palPhase)
          hi = Math.round(p * (LUT_HUES - 1))
        } else {
          hi = Math.round((0.5 + 0.5 * w2) * (LUT_HUES - 1))
        }
        const li = Math.round(lum * (LUT_LUMS - 1))
        style = lut[hi * LUT_LUMS + li]
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
