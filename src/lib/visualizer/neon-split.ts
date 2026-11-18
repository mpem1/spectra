/**
 * Neon Split filter — a faithful reproduction of the effect.app "neon split"
 * preset, built by measuring the real preset's output pixel-by-pixel (the
 * four sections the preset is made of, in its own stack order):
 *
 *   1. Gradient map — every pixel's luminance re-reads as a position on a
 *      256-entry ramp whose stops are SAMPLED from the preset's actual
 *      output: dark plum shadows → indigo → blue-violet → orchid → pink →
 *      pale-pink highlights. Nothing clips to pure black or white — even the
 *      deepest shadow keeps a violet-plum cast and the hottest highlight
 *      lands on near-white pink.
 *   2. Color gradient — the preset's signature vertical veil: a light-pink
 *      wash screen-blended over the top of the frame, holding its strength
 *      down to ~42% of the height, then cutting out sharply by ~58% (the
 *      bottom keeps the pure gradient map). Tinted per ramp for the other
 *      palettes; the Top wash dial scales its strength.
 *   3. Bloom — two blurred, contrast-crushed copies of the CLEAN mapped
 *      frame (pre-veil, pre-grain, so the wash never milks up and the grain
 *      never flares into blobs) screen-blended back with a high threshold:
 *      bright areas glow outward in the ramp's colors, dark areas contribute
 *      nothing, and the hottest cores hold their pale pink. With React to beat the bloom flares on
 *      kicks, resting exactly as dialed in between hits.
 *   4. Noise — the preset's film grain: fine per-pixel luminance speckle
 *      applied ON TOP of everything (±5% at the default dial, slightly
 *      damped in the shadows), hashed deterministically and re-offset at a
 *      quantized song-time step each frame — animated grain, same frame in →
 *      same pixels out.
 *
 *   5. The split — below a soft line the untouched picture fades back in
 *      (optional): the top of the frame wears the neon, the bottom keeps its
 *      own colors. With React to beat, the line slides down on kicks.
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
  // Sampled off the reference preset's actual output (luminance deciles →
  // mean color): plum → indigo → blue-violet → violet → orchid → pink →
  // pale pink. The bottom third climbs slowly through blue-violet; the top
  // quarter compresses into soft pinks — exactly how the preset reads.
  violet: [
    { t: 0, c: '#170d18' },
    { t: 0.08, c: '#1a0e1f' },
    { t: 0.12, c: '#21183f' },
    { t: 0.16, c: '#232151' },
    { t: 0.21, c: '#2a2e6c' },
    { t: 0.31, c: '#4d3f97' },
    { t: 0.44, c: '#8d52c4' },
    { t: 0.65, c: '#d87fe4' },
    { t: 0.78, c: '#edabed' },
    { t: 0.84, c: '#f6c0f3' },
    { t: 0.89, c: '#fcd2f7' },
    { t: 1, c: '#fedcfa' },
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

/* ------------------------- the color-gradient veil ------------------------- */

/** The preset's vertical color-gradient section: a wash screen-blended over
 *  the mapped frame. Stops = (position from top, RGB, alpha). Sampled from
 *  the reference: near-opaque light pink at the very top, holding through
 *  ~42%, then crashing out by ~58% so the bottom wears the pure map. */
type WashStop = { t: number; c: [number, number, number]; a: number }

const WASHES: Record<NeonSplitFilterConfig['ramp'], WashStop[]> = {
  violet: [
    { t: 0, c: [246, 204, 242], a: 0.97 },
    { t: 0.3, c: [234, 178, 233], a: 0.93 },
    { t: 0.42, c: [221, 156, 224], a: 0.9 },
    { t: 0.48, c: [183, 94, 203], a: 0.8 },
    { t: 0.53, c: [90, 58, 160], a: 0.15 },
    { t: 0.565, c: [0, 0, 0], a: 0 },
  ],
  // The sibling palettes reuse the measured alpha profile with their own
  // tint (top = the ramp's highlight color lifted, mid = the ramp's orchid
  // zone, deep = the ramp's shadow hue).
  uv: [
    { t: 0, c: [232, 214, 255], a: 0.97 },
    { t: 0.3, c: [216, 190, 250], a: 0.93 },
    { t: 0.42, c: [198, 158, 244], a: 0.9 },
    { t: 0.48, c: [160, 100, 228], a: 0.82 },
    { t: 0.545, c: [74, 58, 160], a: 0.2 },
    { t: 0.585, c: [0, 0, 0], a: 0 },
  ],
  acid: [
    { t: 0, c: [226, 248, 208], a: 0.97 },
    { t: 0.3, c: [206, 240, 182], a: 0.93 },
    { t: 0.42, c: [178, 228, 152], a: 0.9 },
    { t: 0.48, c: [116, 204, 104], a: 0.82 },
    { t: 0.545, c: [58, 106, 58], a: 0.2 },
    { t: 0.585, c: [0, 0, 0], a: 0 },
  ],
  ember: [
    { t: 0, c: [255, 228, 204], a: 0.97 },
    { t: 0.3, c: [252, 206, 172], a: 0.93 },
    { t: 0.42, c: [248, 182, 140], a: 0.9 },
    { t: 0.48, c: [236, 128, 84], a: 0.82 },
    { t: 0.545, c: [138, 58, 32], a: 0.2 },
    { t: 0.585, c: [0, 0, 0], a: 0 },
  ],
  ice: [
    { t: 0, c: [214, 244, 255], a: 0.97 },
    { t: 0.3, c: [188, 234, 250], a: 0.93 },
    { t: 0.42, c: [158, 222, 244], a: 0.9 },
    { t: 0.48, c: [104, 192, 228], a: 0.82 },
    { t: 0.545, c: [42, 90, 138], a: 0.2 },
    { t: 0.585, c: [0, 0, 0], a: 0 },
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

/* ------------------------------- veil rows -------------------------------- */

/** Per-row veil color+alpha (r,g,b,a), cached per ramp+height — computed
 *  once per frame-size change, read four floats per row in the hot loop. */
let veilCache: { ramp: string; h: number; data: Float32Array } | null = null

function getVeilRows(ramp: NeonSplitFilterConfig['ramp'], h: number): Float32Array {
  if (veilCache && veilCache.ramp === ramp && veilCache.h === h) return veilCache.data
  const stops = WASHES[ramp] ?? WASHES.violet
  const data = new Float32Array(h * 4)
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1)
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (let k = 0; k < stops.length - 1; k++) {
      const s0 = stops[k]
      const s1 = stops[k + 1]
      if (t >= s0.t && t <= s1.t) {
        const span = s1.t - s0.t
        const f = span > 0 ? (t - s0.t) / span : 0
        r = s0.c[0] + (s1.c[0] - s0.c[0]) * f
        g = s0.c[1] + (s1.c[1] - s0.c[1]) * f
        b = s0.c[2] + (s1.c[2] - s0.c[2]) * f
        a = s0.a + (s1.a - s0.a) * f
        break
      }
    }
    data[y * 4] = r
    data[y * 4 + 1] = g
    data[y * 4 + 2] = b
    data[y * 4 + 3] = a
  }
  veilCache = { ramp, h, data }
  return data
}

/* ------------------------------ clean buffer ------------------------------ */

/** Reused ImageData for the clean mapped frame (the bloom source — no veil,
 *  no grain). Re-allocated only when the frame size changes. */
let cleanBuf: ImageData | null = null
let cleanBufW = 0
let cleanBufH = 0

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
  const veil = clamp01(cfg.wash ?? 1)
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
  if (needsSnap) {
    snap = getWork('neon:snap', W, H)
    const sc = resetWork(snap.getContext('2d')!)
    sc.clearRect(0, 0, W, H)
    sc.drawImage(ctx.canvas, 0, 0)
  }

  // 1-4) One full-res pass does the whole grade: copy the frame in, then
  //      per pixel → contrast+ramp LUT (the gradient map) → write the CLEAN
  //      color to the bloom-source buffer → screen the color-gradient veil
  //      over it → add the film-grain speckle on top. No half-res sparkle
  //      tiles, no separate blend passes — the grain is 1:1 per-pixel.
  const grade = getWork('neon:grade', W, H)
  const gc = resetWork(grade.getContext('2d', { willReadFrequently: true })!)
  gc.clearRect(0, 0, W, H)
  gc.drawImage(snap ?? ctx.canvas, 0, 0)

  const cleanMap = getWork('neon:clean', W, H)
  const cc = resetWork(cleanMap.getContext('2d')!)

  if (!cleanBuf || cleanBufW !== W || cleanBufH !== H) {
    cleanBuf = gc.createImageData(W, H)
    cleanBufW = W
    cleanBufH = H
  }

  const img = gc.getImageData(0, 0, W, H)
  const fd = img.data
  const cd = cleanBuf.data
  const lut = getGradeLut(cfg.ramp ?? 'violet', contrast)
  const veilRows = veil > 0.001 ? getVeilRows(cfg.ramp ?? 'violet', H) : null

  // Film grain: ±(grain × 49) luminance — the default dial (0.5) lands the
  // speckle std at ~15/255, measured off the reference. The tile re-offsets
  // every 1/24 s, hashed from song time — same frame, same offset, export-
  // safe. Slightly damped in the shadows (the reference's dark end reads
  // calmer), full strength through the mids and highlights.
  const amp = grain * 49
  const step = frameSeed(frame.time ?? 0, 24)
  const nx = 131 * step
  const ny = 197 * step

  for (let y = 0; y < H; y++) {
    let vr = 0
    let vg = 0
    let vb = 0
    let va = 0
    if (veilRows) {
      vr = veilRows[y * 4]
      vg = veilRows[y * 4 + 1]
      vb = veilRows[y * 4 + 2]
      va = veilRows[y * 4 + 3] * veil
    }
    const row = y * W
    for (let x = 0; x < W; x++) {
      const o = (row + x) * 4
      const l = (54 * fd[o] + 183 * fd[o + 1] + 19 * fd[o + 2]) >> 8
      const u = l * 3
      const r = lut[u]
      const g = lut[u + 1]
      const b = lut[u + 2]
      // The clean mapped frame — what the bloom reads (no veil, no grain).
      cd[o] = r
      cd[o + 1] = g
      cd[o + 2] = b
      cd[o + 3] = 255
      // The color-gradient veil, screen-blended (brightens toward the wash
      // color, never darkens — how the preset's gradient layer sits).
      let rr = r
      let gg = g
      let bb = b
      if (va > 0) {
        rr = r + va * ((255 - ((255 - r) * (255 - vr)) / 255) - r)
        gg = g + va * ((255 - ((255 - g) * (255 - vg)) / 255) - g)
        bb = b + va * ((255 - ((255 - b) * (255 - vb)) / 255) - b)
      }
      // Film grain on top — one deterministic luminance speck per pixel.
      if (amp > 0.5) {
        const lum = rr * 0.299 + gg * 0.587 + bb * 0.114
        const damp = lum < 200 ? 0.78 + (0.22 * lum) / 200 : 1
        const n = (hash01(x + nx, y + ny) - 0.5) * 2 * amp * damp
        rr += n
        gg += n
        bb += n
      }
      fd[o] = rr
      fd[o + 1] = gg
      fd[o + 2] = bb
    }
  }
  gc.putImageData(img, 0, 0)
  cc.putImageData(cleanBuf, 0, 0)

  // 3) Bloom sources — two blurred, contrast-crushed copies of the CLEAN
  //     mapped frame at HALF resolution (the bloom is low-frequency; the
  //     veil and grain are not in it, so only true highlights glow). Only
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
    // High-threshold crush — only the true highlights survive as light
    // (measured off the reference: the dark bottom contributes ZERO glow
    // and the bright cores never milk past their pale-pink ramp color).
    ac.filter = `contrast(3.2) blur(${(2 * S).toFixed(2)}px)`
    ac.drawImage(cleanMap, 0, 0, gw, gh)
    ac.filter = 'none'
    glowB = getWork('neon:glowB', qw, qh)
    const bc = resetWork(glowB.getContext('2d')!)
    bc.clearRect(0, 0, qw, qh)
    bc.imageSmoothingEnabled = true
    bc.imageSmoothingQuality = 'high'
    bc.filter = `contrast(2.2) blur(${(3.4 * S).toFixed(2)}px)`
    bc.drawImage(cleanMap, 0, 0, qw, qh)
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

  // Composite — the graded frame (map + veil + grain) replaces the picture,
  // the bloom screens back from the clean map, the split region
  // restores the untouched pixels, and below 100% mix the whole look blends
  // over the original.
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.drawImage(grade, 0, 0)
  if (glowAmt > 0.004 && glowA && glowB) {
    // Screen, not additive — the reference's bright cores hold their pale
    // pink (#fedcfa) instead of clipping to pure white.
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = glowAmt * 0.55
    ctx.drawImage(glowA, 0, 0, glowA.width, glowA.height, 0, 0, W, H)
    ctx.globalAlpha = glowAmt * 0.4
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
