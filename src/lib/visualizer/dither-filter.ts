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

/* ------------------------------- blue ladder ------------------------------- */

/** The default Blue glow ink — every custom glow color rotates the shade
 *  ladder away from this anchor hue, so this exact pick reproduces the
 *  original all-blue ramp byte-for-byte. */
const BLUE_INK_CSS = '#49b6ff'
const BLUE_INK_RGB: readonly [number, number, number] = [73, 182, 255]

/** The default paper behind the dots (near-black navy). */
const BLUE_PAPER_CSS = '#030a24'
const BLUE_PAPER_RGB: readonly [number, number, number] = [3, 10, 36]

/** Bright-cell shade ladder stops (luminance → navy → royal → electric →
 *  sky → ice), the canonical "all shades of blue" ramp. With a custom glow
 *  color the whole ramp is hue-rotated to it (see blueLadderFor). */
const BLUE_STOPS: Array<readonly [number, number, number, number]> = [
  [0.0, 10, 30, 82],
  [0.28, 20, 71, 200],
  [0.52, 47, 125, 255],
  [0.74, 108, 196, 255],
  [1.0, 217, 246, 255],
]

const BLUE_LUT: Array<readonly [number, number, number]> = (() => {
  const lut: Array<readonly [number, number, number]> = new Array(64)
  for (let k = 0; k < 64; k++) {
    const t = k / 63
    let a = BLUE_STOPS[0]
    let b = BLUE_STOPS[BLUE_STOPS.length - 1]
    for (let s = 0; s < BLUE_STOPS.length - 1; s++) {
      if (t >= BLUE_STOPS[s][0] && t <= BLUE_STOPS[s + 1][0]) {
        a = BLUE_STOPS[s]
        b = BLUE_STOPS[s + 1]
        break
      }
    }
    const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0])
    lut[k] = [
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f),
      Math.round(a[3] + (b[3] - a[3]) * f),
    ]
  }
  return lut
})()

/* --------------------------- recolorable ladder ---------------------------- */

/** RGB → HSL (h in degrees 0..360, s/l in 0..1). */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d > 1e-6) {
    s = Math.min(1, d / (1 - Math.abs(2 * l - 1)))
    if (max === rr) h = 60 * (((gg - bb) / d) % 6)
    else if (max === gg) h = 60 * ((bb - rr) / d + 2)
    else h = 60 * ((rr - gg) / d + 4)
    if (h < 0) h += 360
  }
  return [h, s, l]
}

/** HSL → RGB. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

/** The ink hue/sat the canonical ramp is anchored to (from the default
 *  '#49b6ff' pick, so picking it back gives a pure identity transform). */
const ANCHOR_HSL = rgbToHsl(BLUE_INK_RGB[0], BLUE_INK_RGB[1], BLUE_INK_RGB[2])

interface BlueLadder {
  /** Bright-cell shade for each luminance step 0..63. */
  lut: Array<readonly [number, number, number]>
  /** The paper behind the unlit dots. */
  paper: readonly [number, number, number]
}

/** Rebuilt ladders keyed by "ink|paper" — colors change rarely, frames
 *  render 60×/s, so the ramp is only recomputed when the pick changes. */
const ladderCache = new Map<string, BlueLadder>()

/** One ramp color hue-rotated by `dh` degrees with its saturation scaled. */
function rampColor(
  c: readonly [number, number, number],
  dh: number,
  sat: number,
): [number, number, number] {
  const [h, s, l] = rgbToHsl(c[0], c[1], c[2])
  return hslToRgb(h + dh, Math.min(1, s * sat), l)
}

/** The Blue glow ladder for the user's colors: the canonical navy → royal →
 *  electric → sky → ice ramp hue-rotated from the default blue to the picked
 *  glow color, with its saturation scaled to the pick's (clamped, so deep
 *  or muted inks give deeper/muted ramps; near-neutral picks drop the whole
 *  ramp to glowing grays), on the picked paper. Deterministic, and the
 *  default pick rebuilds the canonical ramp exactly. */
function blueLadderFor(inkCss: string, paperCss: string): BlueLadder {
  const key = `${inkCss}|${paperCss}`
  const hit = ladderCache.get(key)
  if (hit) return hit
  const inkRGB = parseHexRGB(inkCss) ?? [
    BLUE_INK_RGB[0],
    BLUE_INK_RGB[1],
    BLUE_INK_RGB[2],
  ]
  const paperRGB = parseHexRGB(paperCss) ?? [
    BLUE_PAPER_RGB[0],
    BLUE_PAPER_RGB[1],
    BLUE_PAPER_RGB[2],
  ]
  const [inkH, inkS] = rgbToHsl(inkRGB[0], inkRGB[1], inkRGB[2])
  // Achromatic pick (white/gray/black): no hue to rotate to — desaturate the
  // whole ramp into neutral grays instead of leaving it blue.
  const achromatic = inkS < 0.05
  const dh = achromatic ? 0 : inkH - ANCHOR_HSL[0]
  const sat = achromatic ? 0 : Math.min(1.25, Math.max(0, inkS / ANCHOR_HSL[1]))
  const identity = Math.abs(dh) < 0.01 && Math.abs(sat - 1) < 0.005
  const ladder: BlueLadder = {
    lut: identity ? BLUE_LUT.slice() : BLUE_LUT.map((c) => rampColor(c, dh, sat)),
    paper: paperRGB,
  }
  if (ladderCache.size > 12) ladderCache.clear()
  ladderCache.set(key, ladder)
  return ladder
}

/* --------------------------------- helpers --------------------------------- */

/** Parses #rgb / #rgba / #rrggbb / #rrggbbaa into RGB bytes (null if invalid). */
function parseHexRGB(css: string): [number, number, number] | null {
  let h = css.trim().replace(/^#/, '')
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6 && h.length !== 8) return null
  if (!/^[0-9a-fA-F]+$/.test(h)) return null
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

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
  const contrast = clamp01(cfg.contrast ?? 0.5)
  const glow = clamp01(cfg.glow ?? 0.55)
  // Beat flare: the bloom swells on the low end; between beats (boost
  // exactly 1, no flare) the dither plays exactly as dialed in.
  const glowAmt = glow * beatBoost(cfg, clamp01(frame.bass ?? 0), 1.2)
  const cellSize = Math.round(Math.min(14, Math.max(2, cfg.cellSize ?? 4)) * S)
  const cell = Math.max(2, cellSize)
  const inkRGB = parseHexRGB(cfg.inkColor ?? BLUE_INK_CSS) ?? [
    BLUE_INK_RGB[0],
    BLUE_INK_RGB[1],
    BLUE_INK_RGB[2],
  ]
  const paperRGB = parseHexRGB(cfg.paperColor ?? BLUE_PAPER_CSS) ?? [
    BLUE_PAPER_RGB[0],
    BLUE_PAPER_RGB[1],
    BLUE_PAPER_RGB[2],
  ]
  // Blue glow ladder — rebuilt from the user's glow + paper picks (cached).
  const ladder =
    mode === 'blue'
      ? blueLadderFor(cfg.blueInkColor ?? BLUE_INK_CSS, cfg.bluePaperColor ?? BLUE_PAPER_CSS)
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
