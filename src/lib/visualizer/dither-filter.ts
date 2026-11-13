/**
 * Dither filter — retro ordered dithering over the whole composed frame.
 *
 * The picture is resampled onto a chunky grid (one sample per dither cell,
 * the classic "big pixel" look), every cell is thresholded against a tiled
 * 8×8 Bayer matrix, and each cell is repainted either the dark tone or the
 * bright tone — brightness spreads across dot patterns exactly like old
 * 1-bit screens and dither-poster art. Four palettes:
 *
 *   · Blue glow — the "all shades of blue" poster: deep-navy paper, bright
 *     cells pick a shade from a navy → royal → electric → sky → ice ladder
 *     by their luminance, and a two-pass additive bloom makes the bright
 *     dots shine (the glowing look).
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

/** The paper every unlit blue cell lands on (near-black navy). */
const BLUE_PAPER: readonly [number, number, number] = [3, 10, 36]

/** Bright-cell shade ladder (luminance stop → navy → royal → electric →
 *  sky → ice), the "all shades of blue" ramp. */
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
  const inkRGB = parseHexRGB(cfg.inkColor ?? '#49b6ff') ?? [73, 182, 255]
  const paperRGB = parseHexRGB(cfg.paperColor ?? '#030a24') ?? [3, 10, 36]

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
  const blue = mode === 'blue'
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
            const c = BLUE_LUT[Math.min(63, (lum * 63) | 0)]
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
          pr = BLUE_PAPER[0]
          pg = BLUE_PAPER[1]
          pb = BLUE_PAPER[2]
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
