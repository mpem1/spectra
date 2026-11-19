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
 * On WebGL2 the four-pass chain runs on the GPU (halation-gl.ts) — the
 * bright + diffusion chain at an adaptive internal scale (0.35..0.75 live,
 * 1 for exports) with the composite always at full canvas resolution, so
 * the glow is cheap and the picture stays sharp; without GL (or after a
 * context loss), a CPU path runs the same math: the bright pass per pixel,
 * the two-radius diffusion as a sliding-window triple box blur (O(1) per
 * pixel — the faithful 80-tap gather measured at over two seconds a frame
 * at preview resolution, which no machine survives), and the composite per
 * pixel, with the whole CPU chain capped at 800px live / full-size for
 * exports. Both deterministic — same frame in, same pixels out — and both
 * skipped on transparent backgrounds (alpha stays clean).
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
 * dispose and retry on a cooldown, and the live preview drops the CHAIN's
 * internal resolution when the GPU can't keep up (the composite stays
 * full-res, so this is visually free). Exports always render at full scale.
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
  /** Internal CHAIN render scale (1 = full res). Live previews start at
   *  0.5 and adapt in the 0.35..0.75 band — the glow is low-frequency and
   *  the composite lands full-res, so the chain scale is invisible; exports
   *  always run 1. */
  scale: number
  /** Live-preview marker: adapt the chain scale (exports never do) */
  interactive: boolean
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

function getGlEntry(source: HTMLCanvasElement, interactive: boolean): GlEntry | null {
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
      entry = { inst: new HalationGL(), scale: interactive ? 0.5 : 1, interactive, ema: 0, cool: 0 }
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

/**
 * Transfer-function lookup tables. The per-pixel loops call these millions
 * of times a frame — with Math.pow that measured as the dominant CPU-path
 * cost (the bright and composite passes run six conversions per pixel).
 * Both tables are exact for their input domain: the bright/composite passes
 * read BYTES (256 possible values — the byte LUT loses nothing), and the
 * linear→srgb output is rounded to 8 bits anyway, so an 8192-step table
 * over [0, 1] (screen() never exceeds 1) shifts a pixel by well under one
 * output level — invisible, and it removes ~2M Math.pow calls per frame.
 */
const SRGB_TO_LINEAR = new Float32Array(256)
for (let i = 0; i < 256; i++) SRGB_TO_LINEAR[i] = srgbToLinear(i / 255)
const LINEAR_TO_SRGB = new Float32Array(8193)
for (let i = 0; i <= 8192; i++) LINEAR_TO_SRGB[i] = linearToSrgb(i / 8192)
/** linear (0..1) → srgb via the 8192-step table (inputs outside clamp). */
function linearToSrgbLUT(c: number): number {
  return LINEAR_TO_SRGB[c <= 0 ? 0 : c >= 1 ? 8192 : (c * 8192) | 0]
}

/**
 * Scratch buffer pool for the CPU chain — the blur stages move ~17MB of
 * Float32Arrays per frame; allocating fresh ones every frame fed the GC
 * hundreds of MB per second. The pool keys stable buffers by stage name and
 * reallocates only when the chain size changes.
 */
const bufPool = new Map<string, Float32Array>()
function pooled(key: string, len: number): Float32Array {
  let a = bufPool.get(key)
  if (!a || a.length !== len) {
    a = new Float32Array(len)
    bufPool.set(key, a)
  }
  return a
}

/** softKnee from the bright-pass shader. */
function softKnee(y: number, t: number, k: number): number {
  const x = Math.max(y - (t - k), 0)
  return Math.min(1, Math.max(0, (x * x) / (4 * k * x + 1e-6)))
}

/**
 * One axis of the CPU diffusion — three sliding-window box blurs in series
 * (triple box ≈ the site's smooth capped-80-tap sweep at a tiny fraction of
 * the cost). The faithful sweep gathers ~300 bilinear samples per pixel per
 * direction, which measured at over TWO SECONDS a frame at preview
 * resolution (the live loop didn't complete a single frame — unusable).
 * Every box pass runs as a running window sum with EDGE-REPLICATED indices
 * (exactly the GL chain's CLAMP_TO_EDGE sampling): O(1) per pixel, and —
 * decisive for JS speed — BOTH axes iterate rows sequentially. The
 * naive column-major vertical pass strides W floats between reads, missing
 * a cache line per sample; the running-row-window form keeps every access
 * streaming. `disabled` mirrors the shader: radius ≤ 0 fills with the
 * center sample ('center') or 0 ('zero'); a radius under 1px returns the
 * input unchanged. Buffers come from the pool via `key` (two alternating
 * scratch slots per stage, so three passes ping-pong without realloc).
 */
function blurAxis(
  src: Float32Array,
  W: number,
  H: number,
  radiusN: number,
  horizontal: boolean,
  disabled: 'center' | 'zero',
  key: string,
): Float32Array {
  const span = horizontal ? W : H
  if (radiusN <= 0) {
    const out = pooled(key + ':a', src.length)
    if (disabled === 'center') {
      out.set(src)
    } else {
      out.fill(0)
    }
    return out
  }
  const radiusPx = radiusN * span
  if (radiusPx < 1) {
    const out = pooled(key + ':a', src.length)
    out.set(src)
    return out
  }
  // triple box: three uniform windows of half-width h in series have a
  // Gaussian-like spread with std ≈ h — matched to the sweep kernel, whose
  // weight bump lives inside radiusPx, via h ≈ 0.35 × radiusPx
  const h = Math.max(1, Math.round(radiusPx * 0.35))
  const win = 2 * h + 1
  let cur = src
  for (let pass = 0; pass < 3; pass++) {
    // two pooled slots alternate, so each pass reads its input and writes a
    // different buffer (pass 3 reuses slot a, whose old content is done)
    const out = pooled(pass === 1 ? key + ':b' : key + ':a', cur.length)
    if (horizontal) {
      for (let y = 0; y < H; y++) {
        const row = y * W
        // S(x) = Σ_{k=x-h}^{x+h} cur[row + clamp(k, 0, W-1)], built once and
        // advanced by adding the entering pixel and subtracting the leaving
        // one — the clamp replicates edges, matching CLAMP_TO_EDGE
        let s = cur[row] * (h + 1)
        const lim = h < W - 1 ? h : W - 1
        for (let k = 1; k <= lim; k++) s += cur[row + k]
        for (let x = 0; x < W; x++) {
          out[row + x] = s / win
          // advance to S(x+1): drop clamp(x-h), admit clamp(x+h+1) — both
          // inline, never lagged a step behind the write
          const ei = x + h + 1 < W - 1 ? x + h + 1 : W - 1
          const li = x - h > 0 ? x - h : 0
          s += cur[row + ei] - cur[row + li]
        }
      }
    } else {
      // vertical — SAME row-sequential shape, but the window state lives in
      // a per-column running sum advanced a whole row at a time
      const colSum = pooled(key + ':s', W)
      for (let x = 0; x < W; x++) colSum[x] = cur[x] * (h + 1)
      for (let k = 1; k <= h; k++) {
        const rk = (k < H ? k : H - 1) * W
        for (let x = 0; x < W; x++) colSum[x] += cur[rk + x]
      }
      for (let y = 0; y < H; y++) {
        const row = y * W
        for (let x = 0; x < W; x++) out[row + x] = colSum[x] / win
        if (y < H - 1) {
          const ai = y + h + 1 < H ? y + h + 1 : H - 1
          const si = y - h > 0 ? y - h : 0
          const nAdd = ai * W
          const nSub = si * W
          for (let x = 0; x < W; x++) colSum[x] += cur[nAdd + x] - cur[nSub + x]
        }
      }
    }
    cur = out
  }
  return cur
}

/**
 * The whole chain on the CPU: bright pass → horizontal two-radius blur →
 * vertical two-radius blur → composite. Same math as the GL chain (the
 * site's verbatim shaders) with the diffusion replaced by the sliding
 * triple-box of blurAxis — deterministic, same pixels frame over frame.
 * `chainScale` < 1 runs the whole chain at reduced internal resolution
 * (the live preview's perf escape hatch on machines without usable GL):
 * the finished frame upscales smoothly onto the canvas, and since the
 * diffusion radii are fractions of the frame size, the look is unchanged.
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
  chainScale: number,
): void {
  const { ctx, width: W, height: H } = rc
  const cw = Math.max(8, Math.round(W * chainScale))
  const ch = Math.max(8, Math.round(H * chainScale))
  const work = getWork('halation:base', cw, ch)
  const wctx = resetWork(work.getContext('2d', { willReadFrequently: true })!)
  wctx.imageSmoothingEnabled = true
  wctx.drawImage(ctx.canvas, 0, 0, cw, ch)
  const img = wctx.getImageData(0, 0, cw, ch)
  const d = img.data

  // PASS 1 — bright pass (linear-light luminance through the soft knee,
  // times the beat flare multiplier — exactly 1 when the flare is off).
  // The conversions run through the byte LUT and the per-pixel invariants
  // are hoisted — this loop and the composite are the CPU path's hot core.
  const bright = pooled('halation:bright', cw * ch)
  const kneeEff = Math.max(0.02, knee)
  const energyGain = (0.4 + boost * 1.8) * beat
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = SRGB_TO_LINEAR[d[i]]
    const g = SRGB_TO_LINEAR[d[i + 1]]
    const b = SRGB_TO_LINEAR[d[i + 2]]
    const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
    bright[p] = softKnee(y, threshold, kneeEff) * energyGain
  }

  // PASS 2 — horizontal diffusion (local + global, both from the energy)
  const localH = blurAxis(bright, cw, ch, localDiffusion, true, 'center', 'hal:h')
  const globalH = blurAxis(bright, cw, ch, globalDiffusion, true, 'zero', 'hal:gh')

  // PASS 3 — vertical diffusion (local from R, global from G)
  const localHV = blurAxis(localH, cw, ch, localDiffusion, false, 'center', 'hal:v')
  const globalHV = blurAxis(globalH, cw, ch, globalDiffusion, false, 'zero', 'hal:gv')

  // PASS 4 — composite (screen back over the original in linear light)
  const heat = Math.min(1, Math.max(0, 0.5 + boost * 0.4))
  const hotR = tint[0] + (1 - tint[0]) * 0.5
  const hotG = tint[1] + (1 - tint[1]) * 0.5
  const hotB = tint[2] + (1 - tint[2]) * 0.5
  const oneMinusBlueDampK = 1 - blueComp
  const flareK = intensity * flare
  const tR = tint[0]
  const tG = tint[1]
  const tB = tint[2]
  const gateMix = 1 - backgroundGain
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const glowL = Math.min(1, Math.max(0, localHV[p]))
    const glowG = Math.min(1, Math.max(0, globalHV[p]))
    const br = SRGB_TO_LINEAR[d[i]]
    const bg = SRGB_TO_LINEAR[d[i + 1]]
    const bb = SRGB_TO_LINEAR[d[i + 2]]
    const bgY = 0.2126729 * br + 0.7151522 * bg + 0.072175 * bb

    const energy = Math.min(1, Math.max(0, glowL * 3))
    // toward the half-white-hot tint by how hot the glow burns
    const m = energy * heat
    const lr = tR + (hotR - tR) * m
    const lg = tG + (hotG - tG) * m
    const lb = tB + (hotB - tB) * m

    const haloR = lr * glowL + tR * glowG * 0.5
    const haloG = lg * glowL + tG * glowG * 0.5
    const haloB = lb * glowL + tB * glowG * 0.5

    const darkOnly = 1 - smoothstep(0, 0.5, bgY)
    const bgGate = darkOnly * gateMix + backgroundGain
    const blueBg = bb > bgY ? bb - bgY : 0
    const blueDamp = 1 - blueBg * oneMinusBlueDampK

    const hk = bgGate * blueDamp * flareK
    const or = 1 - (1 - br) * (1 - haloR * hk)
    const og = 1 - (1 - bg) * (1 - haloG * hk)
    const ob = 1 - (1 - bb) * (1 - haloB * hk)

    d[i] = Math.round(linearToSrgbLUT(or) * 255)
    d[i + 1] = Math.round(linearToSrgbLUT(og) * 255)
    d[i + 2] = Math.round(linearToSrgbLUT(ob) * 255)
  }
  wctx.putImageData(img, 0, 0)
  // the finished chain frame upscales smoothly onto the canvas — at a
  // reduced chain scale this is the glow AND the base resampled, but the
  // diffusion radii are frame fractions, so the look is unchanged
  ctx.drawImage(work, 0, 0, W, H)

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
  // (factory default 'print' — the kick stamps the halo in from a clean
  //  frame; old saves without the field land here too)
  const flipTo = cfg.beatFlipTo ?? 'print'
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
  const interactive = rc.interactive === true
  const entry = getGlEntry(ctx.canvas, interactive)
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

    // Adaptive CHAIN resolution (live preview only): the glow is rendered
    // at entry.scale while the composite stays full-res, so stepping the
    // scale is visually free. Track render + composite cost and step down
    // when the GPU can't keep up. Exports (interactive = false) always run
    // at full scale — fidelity first, they take the cost regardless.
    if (entry.interactive) {
      const dt = performance.now() - t0
      entry.ema = entry.ema * 0.9 + dt * 0.1
      if (entry.ema > 30 && entry.scale > 0.36) {
        entry.scale = entry.scale >= 0.6 ? 0.5 : 0.35
        entry.cool = 0
      } else if (entry.ema < 12) {
        entry.cool += 1
        if (entry.cool > 120 && entry.scale < 0.75) {
          entry.scale = entry.scale <= 0.4 ? 0.5 : 0.75
          entry.cool = 0
        }
      } else {
        entry.cool = 0
      }
    }
  }

  if (!done) {
    // CPU fallback chain scale: the live preview caps the chain's larger
    // dimension at 800px (the diffusion radii are frame fractions, so the
    // look is unchanged — only the resample softens at a reduced scale,
    // and this is the no-GL emergency path where usability wins); exports
    // render the chain at full size, where the O(1)-per-pixel blur makes
    // even 1080p+ affordable offline.
    const chainScale = interactive ? Math.min(1, 800 / Math.max(W, H)) : 1
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
      chainScale,
    )
  }
}
