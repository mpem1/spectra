/**
 * Neon Split filter — a luminance gradient-map in the spirit of the classic
 * "neon split" social look (the effect.app preset the filter is modeled on):
 *
 *   1. Contrast pre-pass — the frame is contrast-conditioned on the GPU
 *      (the site's CURVES layer, 0.5 = neutral).
 *   2. Sparkle grain — a deterministic noise tile is screen-blended over the
 *      frame (the site's NOISE + hard-light texture layers): mostly-dark
 *      purple sparkle points that lift the shadows' luminance, so the dark
 *      end of the picture glitters. The tile is baked ONCE from integer
 *      hashes and re-tiled at a quantized song-time offset each frame —
 *      animated grain, same frame in → same pixels out.
 *   3. The map — every pixel's luminance re-reads as a position on a neon
 *      ramp through a 256-entry LUT: shadows sink to near-black navy, mids
 *      climb through deep blue and violet, highlights flare to magenta and
 *      pale pink ('violet' reproduces the sampled preset ramp byte-for-byte;
 *      four more ramps recolor the same geometry).
 *   4. Bloom — two blurred, contrast-crushed copies of the graded frame
 *      drawn back additively (the site's BLOOM layer, threshold ≈ 0.1,
 *      intensity 3): bright areas glow outward, the whole frame milks up.
 *   5. The split — below a soft line the untouched picture fades back in
 *      (the site's gradient-masked LEVELS stage): the top of the frame wears
 *      the neon, the bottom keeps its own colors. With React to beat on, the
 *      line slides down on kicks — the neon pushes further over the picture
 *      — and the bloom flares, resting exactly as dialed in between hits.
 *
 * Deterministic: no Math.random / Date.now anywhere — same (frame, config) →
 * same pixels in the live preview, the MP4 and the PNG exports. Transparent
 * backgrounds skip the pass (alpha must stay clean).
 */
import type { AudioFrame, NeonSplitFilterConfig, RenderContext } from './types'
import {
  beatAmount,
  beatBoost,
  clamp01,
  frameSeed,
  getWork,
  hash01,
  resetWork,
} from './filter-utils'

/* --------------------------------- ramps ---------------------------------- */

/** Ramp stops — position on the luminance axis + the color that tone maps
 *  to. Linear RGB interpolation between stops, baked into a 256-entry LUT. */
type RampStop = { t: number; c: string }

const RAMPS: Record<NeonSplitFilterConfig['ramp'], RampStop[]> = {
  // Sampled off the reference preset's gradient map (black → navy → deep
  // blue → violet → bright purple → magenta → pale pink).
  violet: [
    { t: 0, c: '#000000' },
    { t: 0.18, c: '#16124e' },
    { t: 0.38, c: '#232e83' },
    { t: 0.58, c: '#6143b6' },
    { t: 0.74, c: '#a855dd' },
    { t: 0.87, c: '#d55fec' },
    { t: 1, c: '#ffd6fa' },
  ],
  // Deeper ultraviolet — colder shadows, electric-violet highlights.
  uv: [
    { t: 0, c: '#01000a' },
    { t: 0.2, c: '#0b1030' },
    { t: 0.42, c: '#232b7c' },
    { t: 0.62, c: '#4f2bb8' },
    { t: 0.8, c: '#8a45ff' },
    { t: 0.92, c: '#c9a1ff' },
    { t: 1, c: '#f4ecff' },
  ],
  // Acid green — the same sweep in radioactive territory.
  acid: [
    { t: 0, c: '#000000' },
    { t: 0.18, c: '#052012' },
    { t: 0.4, c: '#0d5c2a' },
    { t: 0.6, c: '#2fae4e' },
    { t: 0.78, c: '#7ee06a' },
    { t: 0.9, c: '#c9ff7a' },
    { t: 1, c: '#f2ffc9' },
  ],
  // Ember — furnace shadows through orange to hot cream.
  ember: [
    { t: 0, c: '#000000' },
    { t: 0.18, c: '#200509' },
    { t: 0.4, c: '#7c1a12' },
    { t: 0.6, c: '#c43e18' },
    { t: 0.76, c: '#f57b21' },
    { t: 0.9, c: '#ffb45e' },
    { t: 1, c: '#ffedc9' },
  ],
  // Ice — glacial blues to near-white cyan.
  ice: [
    { t: 0, c: '#000000' },
    { t: 0.18, c: '#041224' },
    { t: 0.4, c: '#0a3a5c' },
    { t: 0.6, c: '#1a7ab0' },
    { t: 0.78, c: '#4fc3e8' },
    { t: 0.9, c: '#a5ecf7' },
    { t: 1, c: '#eafcff' },
  ],
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Cached 256×3 LUT per ramp id — luminance index → ramp RGB. */
const rampLuts = new Map<string, Uint8ClampedArray>()

function getRampLut(ramp: NeonSplitFilterConfig['ramp']): Uint8ClampedArray {
  const cached = rampLuts.get(ramp)
  if (cached) return cached
  const stops = RAMPS[ramp] ?? RAMPS.violet
  const rgb = stops.map((s) => ({ t: s.t, rgb: hexToRgb(s.c) }))
  const lut = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let j = 0
    while (j < rgb.length - 2 && t > rgb[j + 1].t) j++
    const a = rgb[j]
    const b = rgb[Math.min(rgb.length - 1, j + 1)]
    const span = b.t - a.t
    const k = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0
    lut[i * 3] = a.rgb[0] + (b.rgb[0] - a.rgb[0]) * k
    lut[i * 3 + 1] = a.rgb[1] + (b.rgb[1] - a.rgb[1]) * k
    lut[i * 3 + 2] = a.rgb[2] + (b.rgb[2] - a.rgb[2]) * k
  }
  rampLuts.set(ramp, lut)
  return lut
}

/** Cached COMBINED LUTs — contrast conditioning folded into the ramp lookup
 *  (input luminance → contrasted luminance → ramp color), so the per-pixel
 *  pass is a single table read with no extra GPU filter pass. Keyed by ramp
 *  + contrast in 1/40 steps (the UI slider moves in 0.05), bounded. */
const gradeLuts = new Map<string, Uint8ClampedArray>()

function getGradeLut(ramp: NeonSplitFilterConfig['ramp'], contrast: number): Uint8ClampedArray {
  const key = `${ramp}:${Math.round(contrast * 40)}`
  const cached = gradeLuts.get(key)
  if (cached) return cached
  const base = getRampLut(ramp)
  const cf = 0.4 + 1.2 * contrast
  const lut = new Uint8ClampedArray(256 * 3)
  for (let v = 0; v < 256; v++) {
    let t = (v / 255 - 0.5) * cf + 0.5
    if (t < 0) t = 0
    else if (t > 1) t = 1
    const li = (t * 255 + 0.5) | 0
    lut[v * 3] = base[li * 3]
    lut[v * 3 + 1] = base[li * 3 + 1]
    lut[v * 3 + 2] = base[li * 3 + 2]
  }
  gradeLuts.set(key, lut)
  return lut
}

/* ------------------------------ sparkle grain ------------------------------ */

/** Grain tile edge in px — tiled across the frame, offset per song-time
 *  step so the grain shimmers deterministically. */
const GRAIN_TILE = 96

let grainTile: HTMLCanvasElement | null = null

/**
 * The sparkle tile, baked once: mostly near-black pixels (screen-blend
 * no-ops) with sparse two-scale sparkle points that peak around violet
 * luminance — after the map they read as glitter in the ramp's colors,
 * not blown-out white. Pure integer hashes → identical on every machine.
 */
function getGrainTile(): HTMLCanvasElement {
  if (grainTile) return grainTile
  const c = document.createElement('canvas')
  c.width = GRAIN_TILE
  c.height = GRAIN_TILE
  const g = c.getContext('2d')!
  const img = g.createImageData(GRAIN_TILE, GRAIN_TILE)
  const d = img.data
  for (let y = 0; y < GRAIN_TILE; y++) {
    for (let x = 0; x < GRAIN_TILE; x++) {
      const o = (y * GRAIN_TILE + x) * 4
      // Two octaves: fine per-pixel grain clustered into chunkier flecks.
      const v = 0.62 * hash01(x + 1, y + 1) + 0.38 * hash01((x >> 1) + 7, (y >> 1) + 11)
      // ~55% of pixels stay at the dark base (screen = no-op there), the
      // rest ramp up to mid-bright sparkle luminance.
      const s = v <= 0.55 ? 0 : Math.min(1, (v - 0.55) * 2.1)
      // Dark violet base → bright lavender sparkle, luminance-capped so
      // the map lands the glitter in the blue-violet/magenta zone.
      const base = 10
      const r = base + (207 - base) * s * s
      const gg = base + (155 - base) * s * s
      const b = 26 + (245 - 26) * s
      d[o] = r
      d[o + 1] = gg
      d[o + 2] = b
      d[o + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  grainTile = c
  return c
}

/* -------------------------------- the filter -------------------------------- */

export function drawNeonSplitFilter(
  rc: RenderContext,
  cfg: NeonSplitFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass' | 'time'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 8 || H < 8) return
  const S = H / 720

  const strength = clamp01(cfg.strength ?? 1)
  if (strength <= 0.001) return
  const contrast = clamp01(cfg.contrast ?? 0.5)
  const grain = clamp01(cfg.grain ?? 0.5)
  const glow = clamp01(cfg.glow ?? 0.6)
  const split = clamp01(cfg.split ?? 0)
  const bass = clamp01(frame.bass ?? 0)

  // React to beat — the split line slides down on kicks (the neon pushes
  // over the picture) and the bloom flares; between beats both rest at
  // exactly the dialed-in look.
  const beatShift = beatAmount(cfg, bass) * 0.16
  const glowAmt = glow * beatBoost(cfg, bass, 1.2)

  // The untouched frame — the split region fades back to it, and below
  // 100% strength the whole look mixes over it. Both rest states off → the
  // copy is skipped and the grade reads the live frame directly.
  const needsSnap = split > 0.001 || beatShift > 0.001 || strength < 0.999
  let snap: HTMLCanvasElement | null = null
  let sc: CanvasRenderingContext2D | null = null
  if (needsSnap) {
    snap = getWork('neon:snap', W, H)
    sc = resetWork(snap.getContext('2d')!)
    sc.clearRect(0, 0, W, H)
    sc.drawImage(ctx.canvas, 0, 0)
  }

  // 1+2) The grade canvas — plain copy first, then the sparkle grain
  //      screen-blended on top at HALF resolution (grain is chunky by
  //      design and the composite cost drops 4×). The contrast conditioning
  //      rides INSIDE the map LUT, so no full-frame filter pass is spent
  //      on it.
  const grade = getWork('neon:grade', W, H)
  const gc = resetWork(grade.getContext('2d', { willReadFrequently: true })!)
  gc.clearRect(0, 0, W, H)
  gc.drawImage(snap ?? ctx.canvas, 0, 0)
  if (grain > 0.001) {
    const gw = Math.max(2, W >> 1)
    const gh = Math.max(2, H >> 1)
    const half = getWork('neon:grain', gw, gh)
    const hc = resetWork(half.getContext('2d')!)
    hc.clearRect(0, 0, gw, gh)
    const pat = hc.createPattern(getGrainTile(), 'repeat')
    if (pat) {
      // Animated grain: the tile re-offsets every 1/24 s, hashed from song
      // time — same frame, same offset, export-safe.
      const seed = frameSeed(frame.time ?? 0, 24)
      const ox = hash01(seed, 91) * GRAIN_TILE
      const oy = hash01(seed, 92) * GRAIN_TILE
      if (typeof DOMMatrix !== 'undefined') {
        try {
          pat.setTransform(new DOMMatrix([1, 0, 0, 1, ox, oy]))
        } catch {
          /* pattern stays static — still deterministic */
        }
      }
      hc.fillStyle = pat
      hc.fillRect(0, 0, gw, gh)
      gc.globalCompositeOperation = 'screen'
      gc.globalAlpha = grain * 0.7
      gc.imageSmoothingEnabled = true
      gc.drawImage(half, 0, 0, gw, gh, 0, 0, W, H)
      gc.globalCompositeOperation = 'source-over'
      gc.globalAlpha = 1
    }
  }

  // 3) The gradient map — one tight per-pixel pass: integer luminance →
  //     combined contrast+ramp LUT color.
  const lut = getGradeLut(cfg.ramp ?? 'violet', contrast)
  const img = gc.getImageData(0, 0, W, H)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const l = (54 * d[i] + 183 * d[i + 1] + 19 * d[i + 2]) >> 8
    const o = l * 3
    d[i] = lut[o]
    d[i + 1] = lut[o + 1]
    d[i + 2] = lut[o + 2]
  }
  gc.putImageData(img, 0, 0)

  // 4) Bloom sources — two blurred, contrast-crushed copies of the graded
  //     frame at HALF resolution (the bloom is low-frequency; upscaling the
  //     small blurred copies is visually identical and 4× cheaper). Only
  //     the bright end survives the crush, so the halos are neon light,
  //     not gray milk.
  let glowA: HTMLCanvasElement | null = null
  let glowB: HTMLCanvasElement | null = null
  if (glowAmt > 0.004) {
    const gw = Math.max(2, W >> 1)
    const gh = Math.max(2, H >> 1)
    const qw = Math.max(2, W >> 2)
    const qh = Math.max(2, H >> 2)
    glowA = getWork('neon:glowA', gw, gh)
    const ac = resetWork(glowA.getContext('2d')!)
    ac.clearRect(0, 0, gw, gh)
    ac.imageSmoothingEnabled = true
    ac.imageSmoothingQuality = 'high'
    ac.filter = `brightness(1.4) contrast(2.6) blur(${(1 * S).toFixed(2)}px)`
    ac.drawImage(grade, 0, 0, gw, gh)
    ac.filter = 'none'
    glowB = getWork('neon:glowB', qw, qh)
    const bc = resetWork(glowB.getContext('2d')!)
    bc.clearRect(0, 0, qw, qh)
    bc.imageSmoothingEnabled = true
    bc.imageSmoothingQuality = 'high'
    bc.filter = `brightness(1.5) contrast(2.2) blur(${(2.2 * S).toFixed(2)}px)`
    bc.drawImage(grade, 0, 0, qw, qh)
    bc.filter = 'none'
  }

  // 5) The split — the untouched picture masked to the region below the
  //     line (edge measured from the top; beat pushes it DOWN, so the neon
  //     grows over the picture on kicks). A ~5% soft band blends the two.
  let splitCanvas: HTMLCanvasElement | null = null
  const edge = 1 - split + beatShift
  if (edge < 0.985) {
    splitCanvas = getWork('neon:split', W, H)
    const pc = resetWork(splitCanvas.getContext('2d')!)
    pc.clearRect(0, 0, W, H)
    pc.drawImage(snap, 0, 0)
    const soft = 0.05
    const p0 = Math.max(0, edge - soft)
    const p1 = Math.min(1, edge + soft)
    const g = pc.createLinearGradient(0, 0, 0, H)
    if (p0 > 0.001) g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(p0, 'rgba(0,0,0,0)')
    g.addColorStop(Math.min(1, Math.max(p0, edge)), 'rgba(0,0,0,0.5)')
    g.addColorStop(p1, 'rgba(0,0,0,1)')
    if (p1 < 0.999) g.addColorStop(1, 'rgba(0,0,0,1)')
    pc.globalCompositeOperation = 'destination-in'
    pc.fillStyle = g
    pc.fillRect(0, 0, W, H)
    pc.globalCompositeOperation = 'source-over'
  }

  // Composite — the graded frame replaces the picture, the bloom draws back
  // additively (the half-res glow sources stretch back over the frame), the
  // split region restores the untouched pixels, and below 100% mix the whole
  // look blends over the original.
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.drawImage(grade, 0, 0)
  if (glowAmt > 0.004 && glowA && glowB) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = glowAmt * 0.5
    ctx.drawImage(glowA, 0, 0, glowA.width, glowA.height, 0, 0, W, H)
    ctx.globalAlpha = glowAmt * 0.35
    ctx.drawImage(glowB, 0, 0, glowB.width, glowB.height, 0, 0, W, H)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }
  if (splitCanvas) ctx.drawImage(splitCanvas, 0, 0)
  if (snap && strength < 0.999) {
    ctx.globalAlpha = 1 - strength
    ctx.drawImage(snap, 0, 0)
    ctx.globalAlpha = 1
  }
  ctx.restore()
}
