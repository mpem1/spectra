/**
 * Phosphor monitor filter — the lo-fi sci-fi video-tube look (the analogue
 * retro-futuristic monitor aesthetic): the picture is resampled onto a fine
 * grid (one sample per dash cell), every cell's tone picks a shade from the
 * shared glow ladder (rebuilt around the picked phosphor color), and the
 * frame is repainted as columns of short horizontal dashes — bright areas
 * shine, shadows sink into the dark tube, like an old green CRT terminal
 * playing the video.
 *
 * Layers, bottom to top:
 *   1. The dark tube — the frame darkened and multiplied by the tube color,
 *      so the picture's structure survives as a deep paper-toned shadow.
 *   2. The dash print — the ladder-colored grid upscaled crisp (nearest
 *      neighbor) and masked into dashes by a cached gap grid (horizontal
 *      breaks inside each column + thin vertical breaks between columns),
 *      so the print reads as stacked glowing ticks.
 *   3. The bloom — two contrast-crushed blurred copies of the dash print
 *      drawn back additively (a tight one and a wide one), so only the
 *      bright dashes radiate. "React to beat" flares the bloom on the low
 *      end.
 *   4. Below 100% strength the untouched frame fades back through.
 *
 * How it stays fast & deterministic (pure canvas ops, one tiny getImageData):
 *   1. One GPU downscale of the frame onto a cols×rows canvas (the contrast
 *      conditioning rides on this same draw), one small getImageData.
 *   2. One JS pass that writes every cell's ladder shade into a cached
 *      ImageData → putImageData onto a grid canvas.
 *   3. Nearest-neighbor upscale + the cached dash mask ('destination-in')
 *      — no per-dash fillRects, the print is two full-res GPU draws.
 *   4. The gap mask rebuilds only when the geometry changes, never per frame.
 * No Math.random, no time-hashed noise — same frame in, same pixels out, so
 * live preview and offline exports agree frame-exactly. Transparent
 * backgrounds skip the pass.
 */
import type { AudioFrame, PhosphorFilterConfig, RenderContext } from './types'
import { beatBoost, clamp01, getWork, resetWork } from './filter-utils'
import { buildShadeLadder, parseHexRGB } from './shade-ladder'

/** Field defaults — the classic green phosphor tube. */
const PHOSPHOR_INK_CSS = '#3dff7c'
const PHOSPHOR_PAPER_CSS = '#03160c'

/** Grid-resolution ImageData cache — one write buffer per grid size. */
const gridBuffers = new Map<string, ImageData>()

function gridImageData(cols: number, rows: number): ImageData {
  const key = `${cols}x${rows}`
  let img = gridBuffers.get(key)
  if (!img) {
    img = new ImageData(cols, rows)
    gridBuffers.set(key, img)
  }
  return img
}

/** The baked dash-gap mask and the geometry key it was built for — the mask
 *  only rebuilds when the frame size or dash geometry actually changes. */
let maskKey = ''

/**
 * The dash mask: opaque exactly where a dash lives. Built from just two
 * stripe loops (one per axis) instead of cols×rows rects — the pattern is
 * the same in every cell, so rows horizontal breaks + cols vertical breaks
 * carve the whole grid of glowing ticks in ~cols+rows fills.
 */
function buildDashMask(
  W: number,
  H: number,
  cols: number,
  rows: number,
  gap: number,
): void {
  const mask = getWork('phosphor:mask', W, H)
  const mctx = resetWork(mask.getContext('2d')!)
  mctx.clearRect(0, 0, W, H)
  const cellWf = W / cols
  const cellHf = H / rows
  // Dash footprint inside its cell: vertical breaks are the full gap, side
  // (horizontal) breaks are thinner, so each column reads as one strip of
  // stacked ticks rather than isolated squares.
  const dashHf = Math.max(1, cellHf * (1 - gap))
  const dashWf = Math.max(1, cellWf * (1 - gap * 0.55))
  mctx.fillStyle = '#ffffff'
  mctx.fillRect(0, 0, W, H)
  mctx.globalCompositeOperation = 'destination-out'
  mctx.fillStyle = '#000000'
  // Horizontal breaks — the gap between stacked dashes inside a column.
  for (let j = 0; j < rows; j++) {
    const y = Math.round(j * cellHf + dashHf)
    const h = Math.max(0, Math.round((j + 1) * cellHf) - y)
    if (h > 0) mctx.fillRect(0, y, W, h)
  }
  // Vertical breaks — the thin gap between neighboring columns.
  for (let i = 0; i < cols; i++) {
    const x = Math.round(i * cellWf + dashWf)
    const w = Math.max(0, Math.round((i + 1) * cellWf) - x)
    if (w > 0) mctx.fillRect(x, 0, w, H)
  }
  mctx.globalCompositeOperation = 'source-over'
}

/* -------------------------------- the filter -------------------------------- */

export function drawPhosphorFilter(
  rc: RenderContext,
  cfg: PhosphorFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 8 || H < 8) return
  const S = H / 720

  const strength = clamp01(cfg.strength ?? 1)
  const contrast = clamp01(cfg.contrast ?? 0.5)
  const glow = clamp01(cfg.glow ?? 0.55)
  // Spacing between the dashes — 0 melts the columns solid, higher chews
  // them into broken ticks (capped so a dash never fully disappears).
  const gap = Math.min(0.6, Math.max(0, clamp01(cfg.gap ?? 0.4)))
  // Beat flare: the bloom swells on the low end; between beats (boost
  // exactly 1, no flare) the monitor plays exactly as dialed in.
  const glowAmt = glow * beatBoost(cfg, clamp01(frame.bass ?? 0), 1.2)
  const cellSize = Math.round(Math.min(12, Math.max(3, cfg.cellSize ?? 5)) * S)
  const cell = Math.max(3, cellSize)

  const inkCss = cfg.inkColor ?? PHOSPHOR_INK_CSS
  const paperCssRaw = cfg.paperColor ?? PHOSPHOR_PAPER_CSS
  // Validated paper as a CSS fill for the tube multiply (invalid pick → the
  // default green so the tube never paints with an ignored fillStyle).
  const paperCss = parseHexRGB(paperCssRaw) ? paperCssRaw : PHOSPHOR_PAPER_CSS
  const ladder = buildShadeLadder(inkCss, paperCssRaw)

  const cols = Math.max(2, Math.ceil(W / cell))
  const rows = Math.max(2, Math.ceil(H / cell))

  // 1) Resample the live frame to one pixel per dash cell — a proper area
  //    average per cell ('high' engages the browser's mipmapped downscale).
  //    The contrast conditioning rides on this same GPU draw (0.5 = skip).
  const sample = getWork('phosphor:sample', cols, rows)
  const smCtx = resetWork(sample.getContext('2d', { willReadFrequently: true })!)
  smCtx.imageSmoothingEnabled = true
  smCtx.imageSmoothingQuality = 'high'
  if (Math.abs(contrast - 0.5) > 1e-3) smCtx.filter = `contrast(${(contrast * 2).toFixed(4)})`
  smCtx.drawImage(ctx.canvas, 0, 0, cols, rows)
  smCtx.filter = 'none'
  const src = smCtx.getImageData(0, 0, cols, rows).data

  // 2) The tone pass: every cell picks its phosphor shade straight from its
  //    luminance (no Bayer threshold — the tube renders continuous tones as
  //    dash brightness, not dot patterns). Near-black cells go transparent
  //    instead of stacking dim dashes, so shadows sink into the bare tube
  //    and the print only starts where the picture actually lights up (soft
  //    ramp so the cutoff doesn't band).
  const out = gridImageData(cols, rows)
  const d = out.data
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = (j * cols + i) * 4
      const lum = (0.2126 * src[k] + 0.7152 * src[k + 1] + 0.0722 * src[k + 2]) / 255
      const c = ladder.lut[Math.min(63, (lum * 63) | 0)]
      d[k] = c[0]
      d[k + 1] = c[1]
      d[k + 2] = c[2]
      d[k + 3] = lum <= 0.07 ? 0 : Math.min(255, Math.round(((lum - 0.07) / 0.08) * 255))
    }
  }
  const grid = getWork('phosphor:grid', cols, rows)
  const gctx = resetWork(grid.getContext('2d')!)
  gctx.putImageData(out, 0, 0)

  // 3) The dash print — the ladder grid upscaled crisp, then carved into
  //    columns of ticks by the cached gap mask.
  const dash = getWork('phosphor:dash', W, H)
  const dctx = resetWork(dash.getContext('2d')!)
  dctx.clearRect(0, 0, W, H)
  dctx.imageSmoothingEnabled = false
  dctx.drawImage(grid, 0, 0, cols, rows, 0, 0, W, H)
  dctx.imageSmoothingEnabled = true
  const key = `${W}x${H}|${cols}x${rows}|${cell}|${gap.toFixed(3)}`
  if (key !== maskKey) {
    maskKey = key
    buildDashMask(W, H, cols, rows, gap)
  }
  const mask = getWork('phosphor:mask', W, H)
  dctx.globalCompositeOperation = 'destination-in'
  dctx.drawImage(mask, 0, 0)
  dctx.globalCompositeOperation = 'source-over'

  // 4) The dark tube — the frame darkened and multiplied by the tube color:
  //    the picture's structure survives as a deep paper-toned shadow behind
  //    the dashes, exactly like a CRT's dark phosphor field.
  const bg = getWork('phosphor:bg', W, H)
  const bctx = resetWork(bg.getContext('2d')!)
  bctx.filter = 'brightness(0.36)'
  bctx.drawImage(ctx.canvas, 0, 0)
  bctx.filter = 'none'
  bctx.globalCompositeOperation = 'multiply'
  bctx.fillStyle = paperCss
  bctx.fillRect(0, 0, W, H)
  bctx.globalCompositeOperation = 'source-over'

  // 5) Glow bake — full-res blurred, contrast-crushed copies of the dash
  //    print (a tight one and a wide one): only the bright dashes survive
  //    the crush, and their blur radiates into soft halos. Scaled with the
  //    dash size so the bloom breathes with the cell dial.
  let glowA: HTMLCanvasElement | null = null
  let glowB: HTMLCanvasElement | null = null
  if (glowAmt > 0.004) {
    glowA = getWork('phosphor:glowA', W, H)
    const actx = resetWork(glowA.getContext('2d')!)
    actx.clearRect(0, 0, W, H)
    actx.filter = `brightness(1.55) contrast(2.6) blur(${Math.max(1, cell * 0.4).toFixed(2)}px)`
    actx.drawImage(dash, 0, 0)
    actx.filter = 'none'
    glowB = getWork('phosphor:glowB', W, H)
    const gbctx = resetWork(glowB.getContext('2d')!)
    gbctx.clearRect(0, 0, W, H)
    gbctx.filter = `brightness(1.65) contrast(2.2) blur(${Math.max(2, cell * 1.15).toFixed(2)}px)`
    gbctx.drawImage(dash, 0, 0)
    gbctx.filter = 'none'
  }

  // 6) Composite — the tube replaces the frame, the dash print sits on top,
  //    the glow draws back additively, and below 100% strength the
  //    untouched frame fades back through.
  let base: HTMLCanvasElement | null = null
  if (strength < 0.999) {
    base = getWork('phosphor:base', W, H)
    const pbctx = resetWork(base.getContext('2d')!)
    pbctx.drawImage(ctx.canvas, 0, 0, W, H)
  }

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  ctx.drawImage(bg, 0, 0)
  ctx.drawImage(dash, 0, 0)
  if (glowAmt > 0.004 && glowA && glowB) {
    ctx.globalCompositeOperation = 'lighter'
    // Alpha clamps: canvas silently ignores globalAlpha > 1, and the beat
    // flare can push past 1 — saturate instead of no-op.
    ctx.globalAlpha = Math.min(1, glowAmt * 0.65)
    ctx.drawImage(glowA, 0, 0)
    ctx.globalAlpha = Math.min(1, glowAmt * 0.45)
    ctx.drawImage(glowB, 0, 0)
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
