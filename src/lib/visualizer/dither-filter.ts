/**
 * Dither filter — retro ordered dithering over the whole composed frame.
 *
 * The picture is resampled onto a chunky grid (one sample per dither cell,
 * the classic "big pixel" look), every cell is thresholded against a tiled
 * 8×8 Bayer matrix, and each cell is repainted either the dark tone or the
 * bright tone — brightness spreads across dot patterns exactly like old
 * 1-bit screens and dither-poster art. Four palettes:
 *
 *   · Blue glow — the "all shades of one color" poster: your paper color
 *     behind the dots, bright cells climb a shade ladder rebuilt from your
 *     glow color (the canonical navy → royal → electric → sky → ice ramp,
 *     rotated to the glow color's hue), and a two-pass additive bloom makes
 *     the bright dots shine (the glowing look).
 *   · Black & white — the classic 1-bit Mac look: black paper, white ink.
 *   · Color — per-channel retro quantization: each RGB channel snaps to 3
 *     levels with the Bayer offset steering which way borderline values
 *     round, giving the chunky 27-color computer-graphics look.
 *   · Custom — your own two colors (bright dots / dark dots).
 *   · MacPaint — effect.app's MacPaint effect, rebuilt from its own decrypted
 *     shader: no Bayer matrix at all. 38 hand-crafted 8×8 bitmap patterns
 *     (the classic MacPaint brush screens: sparse dots, hatches, diagonals,
 *     cross-hatch, dense stipple …), each with a measured ink coverage; every
 *     cell picks the ENABLED pattern whose coverage best matches its tone —
 *     threshold + contrast shape the pivot, bitmap width sizes the grid by
 *     the longer side (32..4096, printed VERBATIM by the GPU path —
 *     dither-macpaint-gl.ts — whose cost is per output pixel, so the site's
 *     full 4096 runs free and the fine screens blend into the smooth grey
 *     tones a real MacPaint print carries; the CPU fallback below clamps
 *     finer grids for interactivity), a variance-based smooth flattens noise
 *     into even tones, an unsharp sharpen/denoise refines the cells, a Sobel
 *     pass stamps Ink along edges or Shades them toward paper, and a hash
 *     grain breaks up flat areas.
 *
 * Glow: two blurred, contrast-crushed copies of the dithered grid (a tight
 * one and a wide one) are drawn back additively, so only the bright dots
 * bloom — soft halos around the light pattern, the paper stays dark.
 * "React to beat" flares the bloom on the song's low end.
 *
 * How it stays fast & deterministic (pure canvas ops, one tiny getImageData):
 *   1. One GPU downscale of the frame onto a cols×rows canvas (the contrast
 *      conditioning rides on this same draw), one small getImageData.
 *   2. One JS pass that writes every cell's color into a cached ImageData.
 *   3. One putImageData onto an offscreen grid canvas, then nearest-
 *      neighbor draws back over the frame — crisp cells, no sub-cell mush.
 * No Math.random, no time-hashed noise — same frame in, same pixels out,
 * so live preview and offline exports agree frame-exactly. Transparent
 * backgrounds skip the pass.
 */
import type { AudioFrame, DitherFilterConfig, RenderContext } from './types'
import { beatBoost, clamp01, getWork, resetWork } from './filter-utils'
import { MacpaintGL, type MacpaintParams } from './dither-macpaint-gl'
import {
  ANCHOR_INK_RGB,
  ANCHOR_PAPER_RGB,
  buildShadeLadder,
  parseHexRGB,
} from './shade-ladder'

/* ------------------------------ Bayer matrix ------------------------------ */

/** The classic 8×8 ordered-dither threshold matrix, normalized to [0, 1).
 *  Tiles across the dither grid; each cell compares its tone against the
 *  threshold at its grid position, which spreads tones into dot patterns. */
const BAYER8 = (() => {
  const m = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ]
  const out: number[] = new Array(64)
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) out[j * 8 + i] = m[j][i] / 64
  return out
})()

/* --------------------------- MacPaint patterns ---------------------------- */

/**
 * The MacPaint screen set — effect.app's own 38 hand-crafted 8×8 bitmap
 * patterns, ported verbatim from the decrypted MacPaint shader. Each entry
 * packs the 8 pattern rows as two 32-bit words (top 4 rows in the first
 * word, bottom 4 in the second); MP_DENSITY carries each pattern's measured
 * ink coverage, which is what the per-cell density matcher selects against.
 * Order runs from empty paper (slot 0) through the classic sparse dots,
 * hatches and diagonals to solid ink (slot 37).
 */
const MP_PATTERN: readonly [number, number][] = [
  [0x00000000, 0x00000000],
  [0x80000000, 0x00000000],
  [0x80000800, 0x80000800],
  [0x80402000, 0x02040800],
  [0x40a00000, 0x040a0000],
  [0x80100220, 0x01084004],
  [0x88002200, 0x88002200],
  [0x01020408, 0x10204080],
  [0xaa008000, 0x88008000],
  [0x081c22c1, 0x80010204],
  [0x03844830, 0x0c020101],
  [0x20508888, 0x88880502],
  [0x88142241, 0x8800aa00],
  [0x82443944, 0x82010101],
  [0xff808080, 0x80808080],
  [0x88888888, 0x88888888],
  [0x55a04040, 0x550a0404],
  [0x88228822, 0x88228822],
  [0xaa00aa00, 0xaa00aa00],
  [0x11224488, 0x11224488],
  [0xff000000, 0xff000000],
  [0x0008142a, 0x552a1408],
  [0x8080413e, 0x080814e3],
  [0x102054aa, 0xff020408],
  [0xff808080, 0xff080808],
  [0xb130031b, 0xd8c00c8d],
  [0xff888888, 0xff888888],
  [0xf8742247, 0x8f172271],
  [0xaa55aa55, 0xaa55aa55],
  [0xaaaaaaaa, 0xaaaaaaaa],
  [0xff00ff00, 0xff00ff00],
  [0xbf00bfbf, 0xb0b0b0b0],
  [0x77898f8f, 0x7798f8f8],
  [0xdd77dd77, 0xdd77dd77],
  [0x55ff55ff, 0x55ff55ff],
  [0xeeddbb77, 0xeeddbb77],
  [0xddff77ff, 0xddff77ff],
  [0xffffffff, 0xffffffff],
]

const MP_SLOTS = 38
export { MP_SLOTS as MACPAINT_SLOT_COUNT }

/** Ink coverage per pattern — the density matcher picks the enabled slot
 *  closest to each cell's target coverage (published table, verbatim). */
const MP_DENSITY: readonly number[] = [
  0.0, 0.01562, 0.0625, 0.09375, 0.09375, 0.125, 0.125, 0.125, 0.125, 0.20312,
  0.20312, 0.21875, 0.21875, 0.23438, 0.23438, 0.25, 0.25, 0.25, 0.25, 0.25,
  0.25, 0.25, 0.28125, 0.3125, 0.34375, 0.375, 0.4375, 0.46875, 0.5, 0.5,
  0.5, 0.51562, 0.59375, 0.75, 0.75, 0.75, 0.875, 1.0,
]

/** MP_PATTERN unpacked: MP_BITS[slot * 64 + y * 8 + x] ∈ {0, 1} — one flat
 *  lookup per cell instead of per-cell bit twiddling. */
const MP_BITS = (() => {
  const bits = new Uint8Array(MP_SLOTS * 64)
  for (let s = 0; s < MP_SLOTS; s++) {
    for (let y = 0; y < 8; y++) {
      const word = y < 4 ? MP_PATTERN[s][0] : MP_PATTERN[s][1]
      const row = (word >>> ((3 - (y & 3)) * 8)) & 0xff
      for (let x = 0; x < 8; x++) bits[s * 64 + y * 8 + x] = (row >>> (7 - x)) & 1
    }
  }
  return bits
})()

/** effect.app's published default selection — slots 0, 2, 6, 17, 28, 33,
 *  36, 37 (its default slots/slots_hi bitmask unpacked: slots=131141 holds
 *  bits 0/2/6/17, slots_hi=410112 bits 9/14/17/18 → 19+each), a spread from
 *  clean paper (slot 0 — the empty screen, so the brightest tones print
 *  unbroken paper) through the light stipples and mid checkers to solid
 *  ink. */
const MP_DEFAULT_ENABLED = [0, 2, 6, 17, 28, 33, 36, 37]

// The card UI renders the swatch grid and density labels straight from the
// engine's own tables, so chooser and matcher can never drift apart.
export { MP_BITS as MACPAINT_PATTERN_BITS }
export { MP_DENSITY as MACPAINT_PATTERN_DENSITY }
export { MP_DEFAULT_ENABLED as MACPAINT_DEFAULT_PATTERNS }

/** The shader's own vec2 hash (fract/sin-free, fully deterministic in JS) —
 *  drives the Grain dial's per-cell coverage jitter. */
function macHash(x: number, y: number): number {
  const fx = (v: number) => v - Math.floor(v)
  let px = fx(x * 0.1031)
  let py = fx(y * 0.1031)
  let pz = fx(x * 0.1031)
  const d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33)
  px += d
  py += d
  pz += d
  return fx((px + py) * pz)
}

/** Pooled per-size scratch for the MacPaint pass (gridded cell colors +
 *  luma) — reused across frames like the grid ImageData above. */
const macBuffers = new Map<string, { color: Float32Array; luma: Float32Array }>()

function macBufs(cols: number, rows: number) {
  const key = `${cols}x${rows}`
  let b = macBuffers.get(key)
  if (!b) {
    b = { color: new Float32Array(cols * rows * 3), luma: new Float32Array(cols * rows) }
    macBuffers.set(key, b)
  }
  return b
}

/** Bilinear read of the gridded luma at cell-index (x, y) — cell centers sit
 *  at integer indices, edges clamp (the GL path samples its source texture
 *  with CLAMP_TO_EDGE). Fractional offsets land between cell centers. */
function macLumaAt(luma: Float32Array, cols: number, rows: number, x: number, y: number): number {
  const cx = Math.min(cols - 1, Math.max(0, x))
  const cy = Math.min(rows - 1, Math.max(0, y))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(cols - 1, x0 + 1)
  const y1 = Math.min(rows - 1, y0 + 1)
  const fx = cx - x0
  const fy = cy - y0
  const r0 = y0 * cols
  const r1 = y1 * cols
  const a = luma[r0 + x0] * (1 - fx) + luma[r0 + x1] * fx
  const b = luma[r1 + x0] * (1 - fx) + luma[r1 + x1] * fx
  return a * (1 - fy) + b * fy
}

/** Bilinear read of the gridded RGB (same field as macLumaAt, 3 channels). */
function macColorAt(
  color: Float32Array,
  cols: number,
  rows: number,
  x: number,
  y: number,
  out: Float32Array,
): void {
  const cx = Math.min(cols - 1, Math.max(0, x))
  const cy = Math.min(rows - 1, Math.max(0, y))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(cols - 1, x0 + 1)
  const y1 = Math.min(rows - 1, y0 + 1)
  const fx = cx - x0
  const fy = cy - y0
  for (let ch = 0; ch < 3; ch++) {
    const a = color[(y0 * cols + x0) * 3 + ch] * (1 - fx) + color[(y0 * cols + x1) * 3 + ch] * fx
    const b = color[(y1 * cols + x0) * 3 + ch] * (1 - fx) + color[(y1 * cols + x1) * 3 + ch] * fx
    out[ch] = a * (1 - fy) + b * fy
  }
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/* ------------------------------ MacPaint GL -------------------------------- */

/** One GL chain per source canvas — the preview canvas and the exporter's
 *  canvas each own an instance, so an export render can't fight the live
 *  preview's texture sizes. Construction runs the self-test: any stack that
 *  links but draws nothing throws there and the CPU port takes the dial. */
const macGlEntries = new WeakMap<HTMLCanvasElement, MacpaintGL>()
let macGlBroken = false
/** performance.now() of the last context loss / construction failure — new
 *  instances wait this out so a dead GPU can't spin a recreate-storm. */
let macGlLastFailAt = -Infinity
const MAC_GL_FAIL_COOLDOWN_MS = 4000

function getMacGl(source: HTMLCanvasElement): MacpaintGL | null {
  if (macGlBroken) return null
  let inst = macGlEntries.get(source)
  if (inst && inst.isLost) {
    inst.dispose()
    macGlEntries.delete(source)
    macGlLastFailAt = performance.now()
    inst = undefined
  }
  if (!inst) {
    if (performance.now() - macGlLastFailAt < MAC_GL_FAIL_COOLDOWN_MS) return null
    try {
      inst = new MacpaintGL()
      macGlEntries.set(source, inst)
    } catch {
      macGlBroken = true
      return null
    }
  }
  return inst
}

function dropMacGl(source: HTMLCanvasElement): void {
  const inst = macGlEntries.get(source)
  if (inst) {
    inst.dispose()
    macGlEntries.delete(source)
  }
  macGlLastFailAt = performance.now()
}

/** Pack the enabled pattern list into the shader's two bitmask uniforms —
 *  slots 0..18 in `slots`, 19..37 in `slots_hi`. An empty selection plays
 *  the full set (the shader's own zeroed-mask rule). */
function packMacSlots(list: number[] | undefined): [number, number] {
  const raw = Array.isArray(list) && list.length > 0 ? list : MP_DEFAULT_ENABLED
  let lo = 0
  let hi = 0
  for (const s of raw) {
    const slot = Math.round(s)
    if (slot < 0 || slot >= MP_SLOTS) continue
    if (slot < 19) lo |= 1 << slot
    else hi |= 1 << (slot - 19)
  }
  if (lo === 0 && hi === 0) {
    lo = (1 << 19) - 1
    hi = (1 << (MP_SLOTS - 19)) - 1
  }
  return [lo, hi]
}

/** One GL print: parse the config exactly like the CPU port (same clamps),
 *  hand the uniforms to the site's own shader, draw the finished frame back
 *  onto the 2D context. */
function drawMacpaintGlFrame(
  rc: RenderContext,
  gl: MacpaintGL,
  cfg: DitherFilterConfig,
  strength: number,
  bitmapWidth: number,
): void {
  const { ctx, width: W, height: H } = rc
  const [slotsLo, slotsHi] = packMacSlots(cfg.macPatterns)
  const toUnit = (hex: string, fallback: number[]): [number, number, number] => {
    const p = parseHexRGB(hex) ?? fallback
    return [p[0] / 255, p[1] / 255, p[2] / 255]
  }
  const out = gl.render({
    source: ctx.canvas,
    slotsLo,
    slotsHi,
    bitmapWidth,
    threshold: Math.min(1, Math.max(0, cfg.macThreshold ?? 0.354)),
    contrast: Math.min(4, Math.max(0.1, cfg.macContrast ?? 2.5)),
    grain: clamp01(cfg.macGrain ?? 0),
    smoothing: Math.min(3, Math.max(0, Math.round(cfg.macSmoothing ?? 1))),
    sharpen: Math.min(2, Math.max(-1, cfg.macSharpen ?? -0.83)),
    radius: Math.min(5, Math.max(0.5, cfg.macRadius ?? 1.2)),
    edgeMode: Math.round(cfg.macEdgeMode ?? 1),
    edgeThreshold: Math.min(1, Math.max(0.01, cfg.macEdgeThreshold ?? 0.1)),
    edgeWidth: Math.min(3, Math.max(0.5, cfg.macEdgeWidth ?? 1.1)),
    ink: toUnit(cfg.macInkColor ?? '#0f0f12', [15, 15, 18]),
    paper: toUnit(cfg.macPaperColor ?? '#f7f5eb', [247, 245, 235]),
    blend: clamp01(strength),
  })
  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(out, 0, 0, W, H)
  ctx.imageSmoothingEnabled = true
  ctx.restore()
}

/**
 * The MacPaint engine — effect.app's shader, cell-for-cell. On any working
 * GPU the site's own GLSL pass runs the dial VERBATIM (dither-macpaint-gl.ts):
 * its cost is per output pixel, not per cell, so Bitmap width 4096 prints as
 * cheaply as 32 — exactly the site's behavior — and the fine screens blend
 * into the smooth grey tones a real MacPaint print carries. The CPU port
 * below stays the fallback (sandbox / no-WebGL / context loss) with its own
 * interactivity budget. Per cell, both paths: area-averaged color → optional
 * unsharp (sharpen, radius) → luma → optional variance-based flattening
 * (smooth: picks the flattest diagonal quadrant of the raw grid, keeps the
 * sharpen detail on top) → optional Sobel edges (Ink stamps them, Shade
 * pushes them to paper) → the threshold/contrast curve → density-matched
 * bitmap pattern → ink/paper.
 */
function drawMacpaintGrid(
  rc: RenderContext,
  cfg: DitherFilterConfig,
  strength: number,
): void {
  const { width: W, height: H } = rc
  const bitmapDial = Math.min(4096, Math.max(32, Math.round(cfg.macBitmapWidth ?? 342)))

  // GPU first — the site's own shader prints the dial verbatim (blend = the
  // Strength dial, so the fade-back rides inside the pass).
  const gl = getMacGl(rc.ctx.canvas)
  if (gl) {
    try {
      drawMacpaintGlFrame(rc, gl, cfg, strength, bitmapDial)
      return
    } catch {
      dropMacGl(rc.ctx.canvas)
      // fall through to the CPU port
    }
  }

  // CPU cell budget: the pass is O(cells); keep the live grid bounded (the
  // look — cells per frame side — only bends past ~90k cells) and exports
  // can go finer, with a generous ceiling so cranked dials can't stall a
  // render. Machines without the GL path therefore clamp finer widths here.
  let bitmapWidth = bitmapDial
  const cap = rc.interactive ? 90000 : 300000
  for (;;) {
    const cell = Math.max(W, H) / bitmapWidth
    const cols = Math.ceil(W / cell)
    const rows = Math.ceil(H / cell)
    if (cols * rows <= cap || bitmapWidth <= 32) {
      drawMacpaintGridAt(rc, cfg, strength, bitmapWidth)
      return
    }
    bitmapWidth = Math.max(32, Math.floor(bitmapWidth * Math.sqrt(cap / (cols * rows))))
  }
}

function drawMacpaintGridAt(
  rc: RenderContext,
  cfg: DitherFilterConfig,
  strength: number,
  bitmapWidth: number,
): void {
  const { ctx, width: W, height: H } = rc
  const cell = Math.max(Math.max(W, H) / bitmapWidth, 1e-4)
  const cols = Math.max(2, Math.ceil(W / cell))
  const rows = Math.max(2, Math.ceil(H / cell))

  const threshold = Math.min(1, Math.max(0, cfg.macThreshold ?? 0.354))
  const contrast = Math.min(4, Math.max(0.1, cfg.macContrast ?? 2.5))
  const grain = clamp01(cfg.macGrain ?? 0)
  const smoothing = Math.min(3, Math.max(0, Math.round(cfg.macSmoothing ?? 1)))
  const sharpen = Math.min(2, Math.max(-1, cfg.macSharpen ?? -0.83))
  const radius = Math.min(5, Math.max(0.5, cfg.macRadius ?? 1.2))
  const edgeMode = Math.round(cfg.macEdgeMode ?? 1)
  const edgeThreshold = Math.min(1, Math.max(0.01, cfg.macEdgeThreshold ?? 0.1))
  const edgeWidth = Math.min(3, Math.max(0.5, cfg.macEdgeWidth ?? 1.1))
  const ink = parseHexRGB(cfg.macInkColor ?? '#0f0f12') ?? [15, 15, 18]
  const paper = parseHexRGB(cfg.macPaperColor ?? '#f7f5eb') ?? [247, 245, 235]

  // Enabled pattern slots (dedup, 0..37); an empty selection plays the full
  // published set — the shader does the same for a zeroed bitmask.
  const rawList = Array.isArray(cfg.macPatterns) ? cfg.macPatterns : MP_DEFAULT_ENABLED
  const enabled: number[] = []
  for (const s of rawList) {
    const slot = Math.round(s)
    if (slot >= 0 && slot < MP_SLOTS && !enabled.includes(slot)) enabled.push(slot)
  }
  // The binary search below walks density-ascending order — the saved
  // pattern list is user order, so sort by the table before searching.
  const slots = (enabled.length > 0 ? enabled : Array.from({ length: MP_SLOTS }, (_, i) => i))
    .slice()
    .sort((a, b) => MP_DENSITY[a] - MP_DENSITY[b])
  // MP_DENSITY is monotonic, so the nearest match over any subset is a binary
  // search with a neighbor tie-check — one comparison chain per cell.
  const slotCount = slots.length
  const grainNorm = grain / Math.max(slotCount - 1, 1)

  // 1) Area-average the frame onto the cell grid (the shader's rotated
  //    4-tap average, done properly by the GPU downscale).
  const sample = getWork('dither:mac', cols, rows)
  const smCtx = resetWork(sample.getContext('2d', { willReadFrequently: true })!)
  smCtx.imageSmoothingEnabled = true
  smCtx.imageSmoothingQuality = 'high'
  smCtx.drawImage(ctx.canvas, 0, 0, cols, rows)
  const src = smCtx.getImageData(0, 0, cols, rows).data

  // 2) Gridded cell colors + luma (sRGB straight through, like the shader —
  //    its own gamma helpers go unused in mainImage).
  const { color, luma } = macBufs(cols, rows)
  const n = cols * rows
  for (let k = 0; k < n; k++) {
    const r = src[k * 4] / 255
    const g = src[k * 4 + 1] / 255
    const b = src[k * 4 + 2] / 255
    color[k * 3] = r
    color[k * 3 + 1] = g
    color[k * 3 + 2] = b
    luma[k] = 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  // 3) Output cells.
  const out = gridBuf(cols, rows)
  const d = out.data
  const inkR = ink[0]
  const inkG = ink[1]
  const inkB = ink[2]
  const papR = paper[0]
  const papG = paper[1]
  const papB = paper[2]
  const blur: Float32Array = new Float32Array(3)
  const doSharpen = sharpen !== 0
  const doSmooth = smoothing > 0
  const doEdge = edgeMode === 1 || edgeMode === 2
  const soft = 0.25 // the shader's MP_EDGE_SOFT

  for (let j = 0; j < rows; j++) {
    const ym8 = (j % 8) * 8
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i
      let r = color[k * 3]
      let g = color[k * 3 + 1]
      let b = color[k * 3 + 2]
      let y = luma[k]
      const rawY = y

      if (doSharpen) {
        // Unsharp over the cell grid: 3×3 weighted blur (1/2/4 weights,
        // wsum 16) sampled at radius-cell offsets.
        let br = 0
        let bg = 0
        let bb = 0
        for (let q = 0; q < 9; q++) {
          const dx = (q % 3) - 1
          const dy = ((q / 3) | 0) - 1
          const wgt = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1)
          macColorAt(color, cols, rows, i + dx * radius, j + dy * radius, blur)
          br += wgt * blur[0]
          bg += wgt * blur[1]
          bb += wgt * blur[2]
        }
        br /= 16
        bg /= 16
        bb /= 16
        r = Math.min(1, Math.max(0, r + sharpen * (r - br)))
        g = Math.min(1, Math.max(0, g + sharpen * (g - bg)))
        b = Math.min(1, Math.max(0, b + sharpen * (b - bb)))
        y = 0.2126 * r + 0.7152 * g + 0.0722 * b
      }

      if (doSmooth) {
        // The flattest diagonal quadrant of the RAW luma (variance pick),
        // with the sharpen detail laid back on top — the shader's exact
        // order: y = flatten(rawY) + (y − rawY).
        let best = 1e9
        let flat = rawY
        for (let q = 0; q < 4; q++) {
          const dx = q === 0 || q === 3 ? -1 : 1
          const dy = q < 2 ? -1 : 1
          let sum = 0
          let sumSq = 0
          let cnt = 0
          for (let jj = 0; jj <= 3; jj++) {
            if (jj > smoothing) break
            for (let ii = 0; ii <= 3; ii++) {
              if (ii > smoothing) break
              const sx = Math.min(cols - 1, Math.max(0, i + ii * dx))
              const sy = Math.min(rows - 1, Math.max(0, j + jj * dy))
              const v = luma[sy * cols + sx]
              sum += v
              sumSq += v * v
              cnt++
            }
          }
          const mean = sum / cnt
          const variance = Math.abs(sumSq / cnt - mean * mean)
          if (variance < best) {
            best = variance
            flat = mean
          }
        }
        y = Math.min(1, Math.max(0, flat + (y - rawY)))
      }

      let edge = 0
      if (doEdge) {
        const w = edgeWidth
        const tl = macLumaAt(luma, cols, rows, i - w, j - w)
        const tm = macLumaAt(luma, cols, rows, i, j - w)
        const tr = macLumaAt(luma, cols, rows, i + w, j - w)
        const ml = macLumaAt(luma, cols, rows, i - w, j)
        const mr = macLumaAt(luma, cols, rows, i + w, j)
        const bl = macLumaAt(luma, cols, rows, i - w, j + w)
        const bm = macLumaAt(luma, cols, rows, i, j + w)
        const br = macLumaAt(luma, cols, rows, i + w, j + w)
        const gx = tr + 2 * mr + br - (tl + 2 * ml + bl)
        const gy = bl + 2 * bm + br - (tl + 2 * tm + tr)
        edge = Math.sqrt(gx * gx + gy * gy) * 0.1767767
        if (edgeMode === 2) y *= 1 - smoothstep(edgeThreshold, edgeThreshold + soft, edge)
      }

      // The threshold/contrast pivot → ink coverage → nearest pattern.
      const t = Math.min(1, Math.max(0, (y - threshold) * contrast + 0.5))
      let coverage = 1 - t
      if (grain > 0) coverage += grainNorm * (macHash(i + 0.5, j + 0.5) - 0.5)

      // Density match over the enabled slots (monotonic table → binary
      // search, neighbor tie-check).
      let lo = 0
      let hi = slotCount - 1
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (MP_DENSITY[slots[mid]] < coverage) lo = mid
        else hi = mid
      }
      let slot = slots[lo]
      if (
        hi !== lo &&
        Math.abs(MP_DENSITY[slots[hi]] - coverage) < Math.abs(MP_DENSITY[slots[lo]] - coverage)
      ) {
        slot = slots[hi]
      }
      let bit = MP_BITS[slot * 64 + ym8 + (i % 8)]

      if (edgeMode === 1 && edge >= edgeThreshold) bit = 1

      const kk = k * 4
      d[kk] = bit ? inkR : papR
      d[kk + 1] = bit ? inkG : papG
      d[kk + 2] = bit ? inkB : papB
      d[kk + 3] = 255
    }
  }
  const grid = getWork('dither:macgrid', cols, rows)
  const gctx = resetWork(grid.getContext('2d')!)
  gctx.putImageData(out, 0, 0)

  // 4) Composite — the pattern print replaces the frame (crisp cells),
  //    below 100% strength the untouched frame fades back through. No bloom:
  //    the real MacPaint is a flat ink print.
  let base: HTMLCanvasElement | null = null
  if (strength < 0.999) {
    base = getWork('dither:macbase', W, H)
    const bctx = resetWork(base.getContext('2d')!)
    bctx.drawImage(ctx.canvas, 0, 0, W, H)
  }
  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(grid, 0, 0, cols, rows, 0, 0, W, H)
  ctx.imageSmoothingEnabled = true
  if (base) {
    ctx.globalAlpha = 1 - strength
    ctx.drawImage(base, 0, 0, W, H)
    ctx.globalAlpha = 1
  }
  ctx.restore()
}

/* ------------------------------- blue ladder ------------------------------- */

/** The Blue glow palette's default ink — the shared shade ladder (see
 *  shade-ladder.ts) is anchored at exactly this blue, so this pick
 *  reproduces the original all-blue ramp byte-for-byte. */
const BLUE_INK_CSS = '#49b6ff'

/** The Blue glow palette's default paper behind the dots (near-black navy). */
const BLUE_PAPER_CSS = '#030a24'

/* --------------------------------- helpers --------------------------------- */

/** Grid-resolution ImageData cache — one write buffer per grid size. */
const gridBuffers = new Map<string, ImageData>()

function gridBuf(cols: number, rows: number): ImageData {
  const key = `${cols}x${rows}`
  let img = gridBuffers.get(key)
  if (!img) {
    img = new ImageData(cols, rows)
    gridBuffers.set(key, img)
  }
  return img
}

/** One RGB channel snapped to 3 levels, the Bayer threshold steering which
 *  way borderline values round (the ordered-dither quantization formula). */
function quantize3(c: number, b: number): number {
  const q = Math.min(2, Math.floor((c / 255) * 2 + b))
  return q * 127.5
}

/* -------------------------------- the filter -------------------------------- */

export function drawDitherFilter(
  rc: RenderContext,
  cfg: DitherFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 8 || H < 8) return
  const S = H / 720

  const mode = cfg.mode ?? 'blue'
  const strength = clamp01(cfg.strength ?? 1)

  // MacPaint mode — effect.app's pattern-matched bitmap engine, a completely
  // different pipeline from the Bayer modes below (own grid sizing, own
  // threshold/contrast curve, no bloom): hand the whole frame over.
  if (mode === 'macpaint') {
    drawMacpaintGrid(rc, cfg, strength)
    return
  }

  const contrast = clamp01(cfg.contrast ?? 0.5)
  const glow = clamp01(cfg.glow ?? 0.55)
  // Beat flare: the bloom swells on the low end; between beats (boost
  // exactly 1, no flare) the dither plays exactly as dialed in.
  const glowAmt = glow * beatBoost(cfg, clamp01(frame.bass ?? 0), 1.2)
  const cellSize = Math.round(Math.min(14, Math.max(2, cfg.cellSize ?? 4)) * S)
  const cell = Math.max(2, cellSize)
  const inkRGB = parseHexRGB(cfg.inkColor ?? BLUE_INK_CSS) ?? [
    ANCHOR_INK_RGB[0],
    ANCHOR_INK_RGB[1],
    ANCHOR_INK_RGB[2],
  ]
  const paperRGB = parseHexRGB(cfg.paperColor ?? BLUE_PAPER_CSS) ?? [
    ANCHOR_PAPER_RGB[0],
    ANCHOR_PAPER_RGB[1],
    ANCHOR_PAPER_RGB[2],
  ]
  // Blue glow ladder — rebuilt from the user's glow + paper picks (cached,
  // shared with the phosphor monitor filter).
  const ladder =
    mode === 'blue'
      ? buildShadeLadder(cfg.blueInkColor ?? BLUE_INK_CSS, cfg.bluePaperColor ?? BLUE_PAPER_CSS)
      : null

  const cols = Math.max(2, Math.ceil(W / cell))
  const rows = Math.max(2, Math.ceil(H / cell))

  // 1) Resample the live frame to one pixel per dither cell — a proper area
  //    average per cell ('high' engages the browser's mipmapped downscale).
  //    The contrast conditioning rides on this same GPU draw (0.5 = skip).
  const sample = getWork('dither:sample', cols, rows)
  const smCtx = resetWork(sample.getContext('2d', { willReadFrequently: true })!)
  smCtx.imageSmoothingEnabled = true
  smCtx.imageSmoothingQuality = 'high'
  if (Math.abs(contrast - 0.5) > 1e-3) smCtx.filter = `contrast(${(contrast * 2).toFixed(4)})`
  smCtx.drawImage(ctx.canvas, 0, 0, cols, rows)
  smCtx.filter = 'none'
  const src = smCtx.getImageData(0, 0, cols, rows).data

  // 2) The ordered-dither pass: one threshold decision per cell.
  const out = gridBuf(cols, rows)
  const d = out.data
  const blue = ladder !== null
  const mono = mode === 'mono'
  for (let j = 0; j < rows; j++) {
    const brow = (j % 8) * 8
    for (let i = 0; i < cols; i++) {
      const k = (j * cols + i) * 4
      const b = BAYER8[brow + (i % 8)]
      if (mode === 'color') {
        d[k] = quantize3(src[k], b)
        d[k + 1] = quantize3(src[k + 1], b)
        d[k + 2] = quantize3(src[k + 2], b)
      } else {
        const lum = (0.2126 * src[k] + 0.7152 * src[k + 1] + 0.0722 * src[k + 2]) / 255
        let pr: number
        let pg: number
        let pb: number
        if (lum > b) {
          if (blue) {
            const c = ladder!.lut[Math.min(63, (lum * 63) | 0)]
            pr = c[0]
            pg = c[1]
            pb = c[2]
          } else if (mono) {
            pr = pg = pb = 244
          } else {
            pr = inkRGB[0]
            pg = inkRGB[1]
            pb = inkRGB[2]
          }
        } else if (blue) {
          const p = ladder!.paper
          pr = p[0]
          pg = p[1]
          pb = p[2]
        } else if (mono) {
          pr = pg = pb = 0
        } else {
          pr = paperRGB[0]
          pg = paperRGB[1]
          pb = paperRGB[2]
        }
        d[k] = pr
        d[k + 1] = pg
        d[k + 2] = pb
      }
      d[k + 3] = 255
    }
  }
  const grid = getWork('dither:grid', cols, rows)
  const gctx = resetWork(grid.getContext('2d')!)
  gctx.putImageData(out, 0, 0)

  // 3) Glow bake — two blurred, contrast-crushed copies of the dithered
  //    grid: only the bright dots survive the crush, and the tiny blur
  //    radii bloom into wide soft halos once stretched back over the frame.
  let glowA: HTMLCanvasElement | null = null
  let glowB: HTMLCanvasElement | null = null
  if (glowAmt > 0.004) {
    glowA = getWork('dither:glowA', cols, rows)
    const actx = resetWork(glowA.getContext('2d')!)
    actx.clearRect(0, 0, cols, rows)
    actx.filter = 'brightness(1.6) contrast(3) blur(1.1px)'
    actx.drawImage(grid, 0, 0)
    actx.filter = 'none'
    glowB = getWork('dither:glowB', cols, rows)
    const bctx = resetWork(glowB.getContext('2d')!)
    bctx.clearRect(0, 0, cols, rows)
    bctx.filter = 'brightness(1.7) contrast(2.5) blur(3px)'
    bctx.drawImage(grid, 0, 0)
    bctx.filter = 'none'
  }

  // 4) Composite — the dithered print replaces the frame (crisp cells:
  //    nearest-neighbor upscale), the glow draws back additively, and
  //    below 100% strength the untouched frame fades back through.
  let base: HTMLCanvasElement | null = null
  if (strength < 0.999) {
    base = getWork('dither:base', W, H)
    const bctx = resetWork(base.getContext('2d')!)
    bctx.drawImage(ctx.canvas, 0, 0, W, H)
  }

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(grid, 0, 0, cols, rows, 0, 0, W, H)
  ctx.imageSmoothingEnabled = true
  if (glowAmt > 0.004 && glowA && glowB) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = glowAmt * 0.65
    ctx.drawImage(glowA, 0, 0, cols, rows, 0, 0, W, H)
    ctx.globalAlpha = glowAmt * 0.45
    ctx.drawImage(glowB, 0, 0, cols, rows, 0, 0, W, H)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }
  if (base) {
    ctx.globalAlpha = 1 - strength
    ctx.drawImage(base, 0, 0, W, H)
    ctx.globalAlpha = 1
  }
  ctx.restore()
}
