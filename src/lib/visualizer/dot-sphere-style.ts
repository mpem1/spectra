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
 * LUT built once at load; 'palette' sweeps the user's OWN gradient palette
 * across the dot hues (a second LUT, rebuilt only when the palette edits);
 * 'picture' samples the scene behind the ball (one small downscaled
 * getImageData) so the dots carry the picture's own colors. Every path
 * keeps the hot loop on table lookups — zero per-dot string allocation.
 *
 * The ball's FACE — the solid disk the dots sit on — is a dial: 'dark'
 * keeps the near-black LED space (and rests entirely on transparent
 * backgrounds so alpha recordings stay clean), 'color' paints any picked
 * color, 'image' cover-fits the user's picture inside the circular face
 * (rounded exactly like the orb, never stretched). Color and image faces
 * are explicit choices, so they render on transparent backgrounds too.
 *
 * Music: the ball reacts like the other visualizers — every latitude row
 * rides its own spectrum bin ("Music ripple": bottom rows = low end)
 * SCALED BY THE SHARED SENSITIVITY DIAL, and the band's energy PUSHES the
 * row outward along the ball's radius, so the surface ripples like a
 * waveform — the same reactivity the Sphere style's quills give — on top
 * of the per-row brightness and dot-size lift. The React-to-beat box adds
 * the shared gated beat punch: the wave swells and the dots flare on
 * kicks, resting exactly at the dialed look between kicks.
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
import { parseColor, sampleGradient } from './gradients'

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
/** The default LED face color (the near-black the ball shipped with). */
const FACE_DEFAULT = '#050109'

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
  // Sphere style's quills and every other visualizer: it scales how hard
  // the spectrum bands drive the shape (the radial ripple) and the
  // motion/brightness lift.
  const sens = Math.min(3, Math.max(0, cfg.sensitivity ?? 1))
  const glow = clamp01(cfg.dotSphereGlow ?? 0.55)
  // The Style tab's shared Glow switch gates the halo entirely (the same
  // role it plays for the Sphere style's atmosphere); the card's Glow dial
  // sets how strong it is when the switch is on.
  const haloAlpha = (cfg.glow ? glow : 0) * 0.2
  // Picture mode needs a picture to sample; on a transparent background
  // there is none, so the dots fall back to the neon palette (alpha
  // recordings stay legible instead of fading to nothing).
  const picture = !transparent && cfg.dotSphereColors === 'picture'
  // 'palette' mode: the dots ride the user's own gradient palette. Falls
  // back to neon when the palette has no stops (an edge that can only
  // happen before the store's defaults land).
  const lut =
    !picture && cfg.dotSphereColors === 'palette' && cfg.gradient?.stops?.length
      ? paletteLutFor(cfg.gradient.stops)
      : NEON_LUT
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
  // camera projects to R · D/√(D²−1) — the solid face fills exactly this.
  const rs = (R * PERSP) / Math.sqrt(PERSP * PERSP - 1)
  const rowSpacing = (2 * R) / rows
  const baseDot = rowSpacing * 0.25 * dotSize
  const scroll = flow * t
  const freq = frame.freq
  const binCount = freq?.length ?? 0

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
    ctx.fillStyle = face === 'dark' ? FACE_DEFAULT : faceColor
    ctx.fill()
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
    // The band's energy PUSHES the row outward along the ball's radius —
    // the surface ripples like a waveform (low rows surge on the kick
    // drum), the same reactivity the Sphere style's quills give. Rests at
    // the dialed sphere in silence.
    const surf = R + rippleV * ripple * R * RIPPLE_DEPTH

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
      const sx = cx + sinPhi * sinW * surf * persp
      const sy = cy - yUp * surf * persp + waveAmp * w1

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
