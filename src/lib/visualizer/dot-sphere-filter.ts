/**
 * Dot Sphere filter — the whole picture re-materializes as a 3D LED ball:
 * a latitude/longitude grid of glowing dots wrapped over a sphere drawn in
 * perspective (round dots face-on, squeezed vertical ellipses rounding the
 * limb), with the dots streaming horizontally around the ball through a
 * wave field fixed to the viewer, which weaves the rows into wavy neon
 * bands — the classic LED-sphere music look.
 *
 * Geometry (pure canvas math — no GL, no per-pixel reads on the main frame):
 *   · the ball is a lat/long grid: `rows` latitude circles, each carrying
 *     the same longitude count, so the dots crowd together toward the poles
 *     exactly like a real dot-matrix sphere
 *   · every dot sits at (latitude φ, longitude θ); the ball's spin adds to
 *     θ over time (the "flow" dial), so dots travel horizontally across the
 *     face, swell coming toward the viewer (perspective divide) and squeeze
 *     into vertical ellipses as they round the limb — the 3D manner
 *   · one wave field — sin(longitude · waveScale + latitude · bandTwist −
 *     styleTime · waveSpeed) — displaces each row vertically and drives the
 *     dot brightness, so bright wavy bands weave over the ball while the
 *     dots stream through them; a second, slower wave of the same
 *     ingredients drives the hue between the two neon poles
 *
 * Colors: 'neon' mode paints the reference pink/blue LED palette from a
 * color LUT built once at load (zero per-frame pixel reads, zero string
 * allocations in the hot loop); 'picture' mode samples the finished frame
 * (one small downscaled getImageData — the phosphor pattern) so the dots
 * carry the picture's own colors.
 *
 * Composite: the print builds on its own offscreen canvas (backdrop +
 * additive dots) and lands on the frame in the house blend order — print
 * full, the untouched frame fades back over it below 100% mix.
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

  const size = Math.max(0.2, cfg.size ?? 1.9)
  const rows = Math.max(2, Math.round(cfg.rows ?? 56))
  const dotSize = Math.max(0.05, cfg.dotSize ?? 1)
  const flow = cfg.flowSpeed ?? 0.6
  const waveScale = Math.max(0.1, cfg.waveScale ?? 5)
  const waveSpeed = cfg.waveSpeed ?? 0.9
  const bandTwist = Math.max(0, cfg.bandTwist ?? 0.9)
  const ripple = clamp01(cfg.ripple ?? 0.35)
  const glow = clamp01(cfg.glow ?? 0.55)
  const backdrop = clamp01(cfg.backdrop ?? 1)
  const picture = cfg.colorMode === 'picture'

  const R = (Math.min(W, H) / 2) * size
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
  if (backdrop > 0.001) {
    octx.globalAlpha = backdrop
    octx.fillStyle = '#050109'
    octx.fillRect(0, 0, W, H)
    octx.globalAlpha = 1
  }
  octx.globalCompositeOperation = 'lighter'

  const cx = W / 2
  const cy = H / 2
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
      const w1 = Math.sin(theta0 * waveScale + rowPhase - t * waveSpeed)
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
