/**
 * Halation filter — the film highlight-bleed glow over the whole finished
 * picture: bright spots bloom a halo in the picked tint color the way
 * light bleeds through film emulsion into the base and reflects back (the
 * Kodak look, in whatever stock color the picker dials in).
 *
 * The math is effect.app's own Halation effect, ported from its decrypted
 * shaders (see halation-gl.ts for the four passes and the verbatim GLSL).
 * The dials are the shaders' own uniforms at their published defaults, so
 * no 0.5-centering is needed — the dial value IS the uniform value, clamped
 * to the shader's declared min/max.
 *
 * On WebGL2 the four-pass chain runs on the GPU (halation-gl.ts), pixel-
 * faithful and fast; without GL (or after a context loss), a CPU path runs
 * the same math: the bright pass per pixel, the two-radius separable blur
 * as row/column sweeps with the exact capped-80-tap quadratic weights, and
 * the composite per pixel. Both deterministic — same frame in, same pixels
 * out — and both skipped on transparent backgrounds (alpha stays clean).
 *
 * React to beat (opt-in, default off) — TWO flares ride the one Beat flare
 * dial through the shared beatBoost helper while the song's low end
 * (frame.bass) hits: the bright-pass energy multiplies up to strength × 1.6
 * (the fringe of mid-bright pixels grows into the glow) and the FINISHED
 * halo in the composite multiplies up to strength × 2 (the visible bloom —
 * hot core included — which is where the reaction actually READS: the old
 * energy-only flare saturated at the hot cores and moved nothing there).
 * Both rest at exactly 1 between kicks, so the dialed-in look is untouched
 * while the song is quiet — the live preview and the offline export flare
 * on the exact same frames.
 *
 * Flip on kick (opt-in, default off) — the same flip the 3D glasses card
 * runs (the shared flipGate onset detector, per-filter state, Kick
 * sensitivity + Flip hold dials): on a bass ONSET on the clean sub-band
 * channel the whole look swaps for the hold time, then falls back over a
 * short release, in the direction beatFlipTo chooses — 'around' swings the
 * tint to its linear-light complement (the halo changes color and swings
 * back, the halation answer to the glasses' stack mirror), 'picture' rests
 * the halo on the frame and lifts it clean off on the kick so the untouched
 * picture flashes through, 'print' rests as the untouched picture (early
 * return, zero cost — but the detector still advances) and stamps the
 * halation in on the kick.
 *
 * Infrastructure mirrors neon-split.ts: one GL instance per source canvas
 * (the live preview and an export each own one, so they can't thrash a
 * shared instance's framebuffers between two resolutions), lost contexts
 * dispose and retry on a cooldown, and the live preview may drop the
 * chain's internal resolution when the GPU can't keep up. Exports always
 * render at full scale.
 */
import type { AudioFrame, HalationFilterConfig, RenderContext } from './types'
import { beatBoost, clamp01, getWork, resetWork } from './filter-utils'
import { flipGate } from './halftone-filter'
import { HalationGL } from './halation-gl'

/* --------------------------------- halo tint --------------------------------- */

/** The default halo tint (the Kodak look) — also the fallback when a saved
 *  config carries a color the parser cannot read. */
const DEFAULT_TINT = '#ff4d21'

/** "Beat flare" ceiling on the bright-pass energy: at strength 1 the glow
 *  energy multiplies up to 2.6× on a full low-end hit (the cap handed to
 *  the shared beatBoost helper — the fringe of mid-bright pixels grows
 *  into the glow). */
const HALATION_BEAT_KICK = 1.6

/** "Beat flare" ceiling on the FINISHED halo (the composite pass): at
 *  strength 1 the visible glow — hot core included — multiplies up to 3×
 *  on a full kick. This is where the beat reaction actually reads: the
 *  bright-pass energy saturates at the hot cores (multiplier does nothing
 *  there), while multiplying the composited halo brightens every lit
 *  pixel of the bloom in the picked tint. Rests at exactly 1. */
const HALATION_BEAT_HALO = 2.0

/** "#rrggbb" / "#rgb" → linear-light RGB triplet for the tint uniform.
 *  Unparseable input falls back to the Kodak default, never to black. */
function hexToLinearTint(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(typeof hex === 'string' ? hex.trim() : '')
  let r = 255
  let g = 77
  let b = 33
  if (m) {
    const s = m[1]
    if (s.length === 3) {
      r = parseInt(s[0] + s[0], 16)
      g = parseInt(s[1] + s[1], 16)
      b = parseInt(s[2] + s[2], 16)
    } else {
      r = parseInt(s.slice(0, 2), 16)
      g = parseInt(s.slice(2, 4), 16)
      b = parseInt(s.slice(4, 6), 16)
    }
  }
  return [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)]
}

/* --------------------------- config dial mapping --------------------------- */

/** The dials are the shaders' own 0..1 uniforms — direct, clamped to each
 *  uniform's declared range (the ranges the site's own editor exposes). */
function mapThreshold(dial: number): number {
  return Math.min(1, Math.max(0, clamp01(dial)))
}

function mapKnee(dial: number): number {
  return Math.min(0.8, Math.max(0.01, clamp01(dial)))
}

function mapBoost(dial: number): number {
  return clamp01(dial)
}

function mapLocalDiffusion(dial: number): number {
  return Math.min(0.2, Math.max(0.005, clamp01(dial)))
}

function mapGlobalDiffusion(dial: number): number {
  return Math.min(0.4, Math.max(0, clamp01(dial)))
}

/* ------------------------------ GL instances ------------------------------ */

/** One GL chain per source canvas — the preview canvas and the exporter's
 *  canvas each own an instance, so rendering an export can't resize a shared
 *  instance's framebuffers back and forth between two resolutions. */
type GlEntry = {
  inst: HalationGL
  /** Internal render scale (1 = full res; the live preview may drop it) */
  scale: number
  /** EMA of render+composite cost, ms */
  ema: number
  /** Consecutive cheap frames (scale-up hysteresis) */
  cool: number
}
const glEntries = new WeakMap<HTMLCanvasElement, GlEntry>()
let glBroken = false
/** performance.now() of the last context loss / construction failure — new
 *  instances wait this out so a dead GPU can't spin a recreate-storm. */
let lastGlFailAt = -Infinity
const GL_FAIL_COOLDOWN_MS = 4000

function getGlEntry(source: HTMLCanvasElement): GlEntry | null {
  if (glBroken) return null
  let entry = glEntries.get(source)
  if (entry && entry.inst.isLost) {
    // The GPU dropped this context. Dispose it and wait out the cooldown
    // before building a fresh one — the CPU path covers the gap.
    entry.inst.dispose()
    glEntries.delete(source)
    lastGlFailAt = performance.now()
    entry = undefined
  }
  if (!entry) {
    if (performance.now() - lastGlFailAt < GL_FAIL_COOLDOWN_MS) return null
    try {
      entry = { inst: new HalationGL(), scale: 1, ema: 0, cool: 0 }
      glEntries.set(source, entry)
    } catch {
      glBroken = true
      return null
    }
  }
  return entry
}

/* ------------------------------- CPU fallback ------------------------------ */

/** sRGB → linear (the IEC transfer, same constants as the shader). */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c: number): number {
  c = Math.max(0, c)
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

/** softKnee from the bright-pass shader. */
function softKnee(y: number, t: number, k: number): number {
  const x = Math.max(y - (t - k), 0)
  return Math.min(1, Math.max(0, (x * x) / (4 * k * x + 1e-6)))
}

/**
 * One direction of the capped-80-tap sweep (the shader's blurHorizontal /
 * blurVertical, verbatim weight math): step = max(1, radiusPx/80), weights
 * 1−t eased by two squarings, reads clamped at the frame edge (the GL chain
 * samples CLAMP_TO_EDGE) and bilinear between the two neighboring pixels —
 * the GL chain samples with LINEAR filtering, so fractional tap offsets
 * interpolate, and this sweep matches it. `disabled` mirrors the shader:
 * radius ≤ 0 fills with the center sample ('center') or 0 ('zero'); a
 * radius under 1px returns the input unchanged.
 */
function blurSweep(
  src: Float32Array,
  W: number,
  H: number,
  radiusN: number,
  horizontal: boolean,
  disabled: 'center' | 'zero',
): Float32Array {
  const out = new Float32Array(src.length)
  const span = horizontal ? W : H
  const radiusPx = radiusN * span
  if (radiusN <= 0) {
    if (disabled === 'center') {
      out.set(src)
    } else {
      out.fill(0)
    }
    return out
  }
  if (radiusPx < 1) {
    out.set(src)
    return out
  }
  const stepPx = Math.max(1, radiusPx / 80)
  const srcRes = horizontal ? W : H
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const center = src[y * W + x]
      let sum = center
      let wsum = 1
      for (let dist = stepPx; dist < radiusPx; dist += stepPx) {
        const t = dist / radiusPx
        let w = 1 - t
        w = 1 - w * w
        w = 1 - w * w
        // bilinear sample at (x ± dist, y ± dist) — LINEAR-filtered texture
        // reads in the GL chain interpolate the same way
        const sample = (pos: number): number => {
          const lo = Math.floor(pos)
          const frac = pos - lo
          const a = Math.min(span - 1, Math.max(0, lo))
          const b = Math.min(span - 1, Math.max(0, lo + 1))
          const va = horizontal ? src[y * W + a] : src[a * W + x]
          const vb = horizontal ? src[y * W + b] : src[b * W + x]
          return va + (vb - va) * frac
        }
        sum += w * (sample(x + dist) + sample(x - dist))
        wsum += w * 2
      }
      out[y * W + x] = sum / wsum
    }
  }
  return out
}

/**
 * The whole chain on the CPU: bright pass → horizontal two-radius blur →
 * vertical two-radius blur → composite. Identical math to the GL chain
 * (which runs the site's verbatim shaders) — deterministic, same pixels.
 */
function drawHalationCPU(
  rc: RenderContext,
  threshold: number,
  knee: number,
  boost: number,
  localDiffusion: number,
  globalDiffusion: number,
  intensity: number,
  tint: [number, number, number],
  backgroundGain: number,
  blueComp: number,
  beat: number,
  flare: number,
  /** The untouched pre-halation frame (picture/print flip dissolves) */
  snap: HTMLCanvasElement | null,
  flipToPicture: boolean,
  flipToPrint: boolean,
  flipT: number,
): void {
  const { ctx, width: W, height: H } = rc
  const work = getWork('halation:base', W, H)
  const wctx = resetWork(work.getContext('2d', { willReadFrequently: true })!)
  wctx.drawImage(ctx.canvas, 0, 0)
  const img = wctx.getImageData(0, 0, W, H)
  const d = img.data

  // PASS 1 — bright pass (linear-light luminance through the soft knee,
  // times the beat flare multiplier — exactly 1 when the flare is off)
  const bright = new Float32Array(W * H)
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = srgbToLinear(d[i] / 255)
    const g = srgbToLinear(d[i + 1] / 255)
    const b = srgbToLinear(d[i + 2] / 255)
    const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
    bright[p] = softKnee(y, threshold, Math.max(0.02, knee)) * (0.4 + boost * 1.8) * beat
  }

  // PASS 2 — horizontal diffusion (local + global, both from the energy)
  const localH = blurSweep(bright, W, H, localDiffusion, true, 'center')
  const globalH = blurSweep(bright, W, H, globalDiffusion, true, 'zero')

  // PASS 3 — vertical diffusion (local from R, global from G)
  const localHV = blurSweep(localH, W, H, localDiffusion, false, 'center')
  const globalHV = blurSweep(globalH, W, H, globalDiffusion, false, 'zero')

  // PASS 4 — composite (screen back over the original in linear light)
  const heat = Math.min(1, Math.max(0, 0.5 + boost * 0.4))
  const hotR = tint[0] + (1 - tint[0]) * 0.5
  const hotG = tint[1] + (1 - tint[1]) * 0.5
  const hotB = tint[2] + (1 - tint[2]) * 0.5
  const oneMinusBlueDampK = 1 - blueComp
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const glowL = Math.min(1, Math.max(0, localHV[p]))
    const glowG = Math.min(1, Math.max(0, globalHV[p]))
    const br = srgbToLinear(d[i] / 255)
    const bg = srgbToLinear(d[i + 1] / 255)
    const bb = srgbToLinear(d[i + 2] / 255)
    const bgY = 0.2126729 * br + 0.7151522 * bg + 0.072175 * bb

    const energy = Math.min(1, Math.max(0, glowL * 3))
    // toward the half-white-hot tint by how hot the glow burns
    const m = energy * heat
    const lr = tint[0] + (hotR - tint[0]) * m
    const lg = tint[1] + (hotG - tint[1]) * m
    const lb = tint[2] + (hotB - tint[2]) * m

    let haloR = lr * glowL + tint[0] * glowG * 0.5
    let haloG = lg * glowL + tint[1] * glowG * 0.5
    let haloB = lb * glowL + tint[2] * glowG * 0.5

    const darkOnly = 1 - smoothstep(0, 0.5, bgY)
    const bgGate = darkOnly * (1 - backgroundGain) + 1 * backgroundGain
    const blueBg = Math.max(0, bb - bgY)
    const blueDamp = 1 - blueBg * oneMinusBlueDampK

    const hk = bgGate * blueDamp * intensity * flare
    haloR *= hk
    haloG *= hk
    haloB *= hk

    const or = 1 - (1 - br) * (1 - haloR)
    const og = 1 - (1 - bg) * (1 - haloG)
    const ob = 1 - (1 - bb) * (1 - haloB)

    d[i] = Math.round(linearToSrgb(or) * 255)
    d[i + 1] = Math.round(linearToSrgb(og) * 255)
    d[i + 2] = Math.round(linearToSrgb(ob) * 255)
  }
  wctx.putImageData(img, 0, 0)
  ctx.drawImage(work, 0, 0)

  // The flip's picture/print directions dissolve the untouched frame over
  // the finished look as the kick lands and falls back — the GL path runs
  // the identical overlay on its snapshot.
  if (snap && flipToPicture && flipT > 0.001) {
    ctx.globalAlpha = flipT
    ctx.drawImage(snap, 0, 0)
    ctx.globalAlpha = 1
  }
  if (snap && flipToPrint && flipT < 0.999) {
    ctx.globalAlpha = 1 - flipT
    ctx.drawImage(snap, 0, 0)
    ctx.globalAlpha = 1
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/* --------------------------------- the filter -------------------------------- */

export function drawHalationFilter(
  rc: RenderContext,
  cfg: HalationFilterConfig | undefined,
  frame: Pick<AudioFrame, 'time' | 'styleTime' | 'bass' | 'sub'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 8 || H < 8) return

  // the dials — direct, clamped to the shaders' own published ranges
  const threshold = mapThreshold(cfg.threshold ?? 0.6)
  const knee = mapKnee(cfg.knee ?? 0.25)
  const boost = mapBoost(cfg.boost ?? 0.5)
  const localDiffusion = mapLocalDiffusion(cfg.localDiffusion ?? 0.04)
  const globalDiffusion = mapGlobalDiffusion(cfg.globalDiffusion ?? 0.12)
  const intensity = clamp01(cfg.intensity ?? 0.7)
  const backgroundGain = clamp01(cfg.backgroundGain ?? 0.85)
  const blueComp = clamp01(cfg.blueComp ?? 0.5)
  // the halo tint — config hex → linear-light triplet (Kodak fallback)
  const tint = hexToLinearTint(cfg.tint ?? DEFAULT_TINT)
  // the beat flares — rest at exactly 1 while React to beat is off or the
  // low end is quiet; on a full kick the bright-pass energy multiplies up
  // to strength × 1.6 (fringe growth) and the finished halo up to
  // strength × 2 (the visible bloom — hot core included — which is where
  // the reaction actually reads)
  const beat = beatBoost(cfg, frame.bass, HALATION_BEAT_KICK)
  const flare = beatBoost(cfg, frame.bass, HALATION_BEAT_HALO)
  if (intensity <= 0.001) return

  // Flip on kick — the same onset detector the halftone print's flip and
  // the 3D glasses' flip share: bass ONSETS on the clean sub-band channel
  // fire once per hit and pin the swap for the hold dial's time, then it
  // falls back over a short release. beatFlipTo chooses what the kick
  // reveals:
  //   'around'  — the tint swings to its linear-light complement: the halo
  //               changes color, holds, and swings back through the resting
  //               look — byte-identical to flip off (the halation answer to
  //               the glasses' stack mirror; color is what a halo is made
  //               of, so color is what flips)
  //   'picture' — the halo rests on the frame between kicks; on a kick it
  //               lifts clean off so the untouched picture flashes through
  //               and settles back
  //   'print'   — the untouched picture rests between kicks (early return,
  //               zero cost — but the detector still advances) and the
  //               halation stamps in on the kick, holds, fades back out
  const flipTo = cfg.beatFlipTo ?? 'around'
  const flipToPicture = !!cfg.beatFlip && flipTo === 'picture'
  const flipToPrint = !!cfg.beatFlip && flipTo === 'print'
  const flipT = cfg.beatFlip
    ? flipGate(
        ctx,
        Math.min(1, Math.max(0, frame.sub ?? frame.bass)),
        frame.time,
        Math.min(1, Math.max(0, cfg.flipSensitivity ?? 0.1)),
        Math.min(1, Math.max(0, cfg.flipHold ?? 0.2)) * 2,
        'halation',
      )
    : 0

  // Print direction at rest: the untouched picture alone — zero cost.
  if (flipToPrint && flipT <= 0.001) return

  // 'around': per-channel lerp from the picked tint to its linear-light
  // complement as the kick lands (the heat mix and the half-white-hot core
  // derive from the tint inside both render paths, so the whole look flips
  // coherently); flipT 0 = the picked color, byte-identical to flip off.
  const mixChannel = (a: number) => a + (1 - a - a) * flipT
  const tintUsed: [number, number, number] =
    flipTo === 'around' && flipT > 0.001
      ? [mixChannel(tint[0]), mixChannel(tint[1]), mixChannel(tint[2])]
      : tint

  // The untouched pre-halation frame, for the flip's picture/print
  // dissolves — snapshotted before either render path touches the canvas.
  let snap: HTMLCanvasElement | null = null
  if ((flipToPicture || flipToPrint) && flipT > 0.001) {
    snap = getWork('halation:snap', W, H)
    const sc = resetWork(snap.getContext('2d')!)
    sc.clearRect(0, 0, W, H)
    sc.drawImage(ctx.canvas, 0, 0)
  }

  let done = false
  const entry = getGlEntry(ctx.canvas)
  if (entry) {
    const t0 = performance.now()
    try {
      const out = entry.inst.render({
        source: ctx.canvas,
        threshold,
        knee,
        boost,
        localDiffusion,
        globalDiffusion,
        intensity,
        tint: tintUsed,
        beat,
        flare,
        backgroundGain,
        blueComp,
        scale: entry.scale,
      })
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.drawImage(out, 0, 0, W, H)
      ctx.restore()
      // The flip's picture/print directions dissolve the untouched frame
      // (the snap) over the finished look as the kick lands and falls back
      // — the CPU fallback runs the identical overlay.
      if (snap && flipToPicture && flipT > 0.001) {
        ctx.globalAlpha = flipT
        ctx.drawImage(snap, 0, 0)
        ctx.globalAlpha = 1
      }
      if (snap && flipToPrint && flipT < 0.999) {
        ctx.globalAlpha = 1 - flipT
        ctx.drawImage(snap, 0, 0)
        ctx.globalAlpha = 1
      }
      done = true
    } catch (err) {
      // The chain itself failed (lost context mid-frame, driver hiccup).
      // Drop the instance and let the cooldown decide when GL may retry —
      // never pin the app to a dead context.
      console.warn('[halation] WebGL chain failed this frame, CPU fallback:', err)
      entry.inst.dispose()
      glEntries.delete(ctx.canvas)
      lastGlFailAt = performance.now()
      done = false
    }

    // Adaptive internal resolution (live preview only): track render +
    // composite cost and step the scale down when the GPU can't keep up.
    // Exports call this through a canvas of their own and always run at
    // full scale (they take the cost regardless — fidelity first).
    const dt = performance.now() - t0
    entry.ema = entry.ema * 0.9 + dt * 0.1
    if (entry.ema > 45 && entry.scale > 0.5) {
      entry.scale = entry.scale >= 0.85 ? 0.75 : 0.5
      entry.cool = 0
    } else if (entry.ema < 25) {
      entry.cool += 1
      if (entry.cool > 90 && entry.scale < 1) {
        entry.scale = entry.scale <= 0.55 ? 0.75 : 1
        entry.cool = 0
      }
    } else {
      entry.cool = 0
    }
  }

  if (!done) {
    drawHalationCPU(
      rc,
      threshold,
      knee,
      boost,
      localDiffusion,
      globalDiffusion,
      intensity,
      tintUsed,
      backgroundGain,
      blueComp,
      beat,
      flare,
      snap,
      flipToPicture,
      flipToPrint,
      flipT,
    )
  }
}
