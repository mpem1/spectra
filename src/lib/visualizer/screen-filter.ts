/**
 * Screen filter — the full-frame display post-pass.
 *
 * Runs AFTER everything else in renderFrame (visualizer, disc, lyrics,
 * title, watermark included), so the whole picture reads like it is playing
 * on a physical screen. The v1 look is CRT:
 *
 *   1. Chromatic aberration — the red/blue channels shift a pixel or two
 *      apart, the way a slightly misconverged tube fringes bright edges.
 *   2. Bloom — a blurred, additive copy of the frame so bright areas bleed
 *      light like phosphor glow.
 *   3. Phosphor mask — ONE multiply-pattern fill that lays down the
 *      horizontal scanlines AND the vertical R/G/B aperture grille, the
 *      pixel structure every reference photo of a CRT shows.
 *
 * Everything here is deterministic (no time, no randomness) and drawn with
 * plain canvas ops, so the live preview, the MP4 export, the PNG snapshot
 * and the PNG sequence all produce identical pixels. Offscreen buffers and
 * the mask tile are cached module-level and only rebuilt when their inputs
 * change — caching never changes what is drawn.
 *
 * Transparent backgrounds skip the filter entirely: a CRT is a physical
 * surface, and alpha recordings must stay clean.
 */
import type { RenderContext, ScreenFilterConfig } from './types'

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

/* ------------------------------ offscreen buffers ----------------------------- */

const WORK_SLOTS = 5
const works: (HTMLCanvasElement | null)[] = new Array(WORK_SLOTS).fill(null)

/** Slot 0 = frame snapshot · 1/2/3 = R/G/B channels · 4 = bloom scratch. */
function getWork(slot: number, w: number, h: number): HTMLCanvasElement {
  let canvas = works[slot]
  if (!canvas) {
    canvas = document.createElement('canvas')
    works[slot] = canvas
  }
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  return canvas
}

/** Reset a work context to the plain draw state before reusing it. */
function resetWork(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
  if ('filter' in ctx) ctx.filter = 'none'
  return ctx
}

/* -------------------------------- mask pattern ------------------------------- */

let maskTile: HTMLCanvasElement | null = null
let maskPattern: CanvasPattern | null = null
let maskKey = ''

/**
 * One repeating tile carries the whole mask: a white (neutral under
 * multiply) background, one dark scanline row per cell, and three vertical
 * R/G/B phosphor stripes per tile. `ctx.createPattern` caches internally,
 * but the tile itself is rebuilt only when cell/strengths change.
 */
function getMaskPattern(
  ctx: CanvasRenderingContext2D,
  cell: number,
  scanlines: number,
  grille: number,
): CanvasPattern | null {
  const key = `${cell}|${scanlines.toFixed(3)}|${grille.toFixed(3)}`
  if (key === maskKey && maskPattern) return maskPattern

  const w = cell * 3
  if (!maskTile) {
    maskTile = document.createElement('canvas')
  }
  maskTile.width = w
  maskTile.height = cell
  const t = resetWork(maskTile.getContext('2d')!)

  // Neutral white — multiply by white leaves the frame untouched.
  t.fillStyle = '#ffffff'
  t.fillRect(0, 0, w, cell)

  // Vertical phosphor stripes — R | G | B, one per cell. Under multiply
  // each stripe keeps its own channel and dims the other two, so bright
  // areas pick up the RGB structure seen in close-up CRT photos.
  if (grille > 0.001) {
    const colors = ['#ff0000', '#00ff00', '#0000ff']
    for (let i = 0; i < 3; i++) {
      t.globalAlpha = grille * 0.55
      t.fillStyle = colors[i]
      t.fillRect(i * cell, 0, cell, cell)
    }
    t.globalAlpha = 1
  }

  // Horizontal scanline — a dark row at the bottom edge of each cell.
  if (scanlines > 0.001) {
    const lineH = Math.max(1, Math.round(cell / 3))
    t.globalAlpha = scanlines * 0.85
    t.fillStyle = '#000000'
    t.fillRect(0, cell - lineH, w, lineH)
    t.globalAlpha = 1
  }

  maskPattern = ctx.createPattern(maskTile, 'repeat')
  maskKey = key
  return maskPattern
}

/* ---------------------------------- channel ---------------------------------- */

/**
 * Copy `snap` into `work` keeping only one color channel (multiply by a
 * pure channel color zeroes the other two).
 */
function channelize(
  work: HTMLCanvasElement,
  snap: HTMLCanvasElement,
  color: string,
  w: number,
  h: number,
): void {
  const c = resetWork(work.getContext('2d')!)
  c.clearRect(0, 0, w, h)
  c.drawImage(snap, 0, 0)
  c.globalCompositeOperation = 'multiply'
  c.fillStyle = color
  c.fillRect(0, 0, w, h)
  c.globalCompositeOperation = 'source-over'
}

/* --------------------------------- entry point -------------------------------- */

/**
 * Draw the screen filter over the finished frame. `transparent` mirrors
 * background.mode === 'transparent' — the filter is skipped there so alpha
 * exports keep their clean channels.
 */
export function drawScreenFilter(
  rc: RenderContext,
  cfg: ScreenFilterConfig | undefined,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  const S = H / 720

  ctx.save()
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0

  // 1) Chromatic aberration — snapshot the frame, isolate R/G/B, re-add them
  //    with the red and blue channels nudged apart. addColor('lighter')
  //    sums the channels back into the full picture.
  const dx = Math.round(clamp01(cfg.aberration) * 3.5 * S)
  if (dx >= 1) {
    const snap = getWork(0, W, H)
    const sc = resetWork(snap.getContext('2d')!)
    sc.clearRect(0, 0, W, H)
    sc.drawImage(ctx.canvas, 0, 0)

    const rWork = getWork(1, W, H)
    const gWork = getWork(2, W, H)
    const bWork = getWork(3, W, H)
    channelize(rWork, snap, '#ff0000', W, H)
    channelize(gWork, snap, '#00ff00', W, H)
    channelize(bWork, snap, '#0000ff', W, H)

    ctx.fillStyle = '#000000'
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(rWork, -dx, 0)
    ctx.drawImage(gWork, 0, 0)
    ctx.drawImage(bWork, dx, 0)
    ctx.globalCompositeOperation = 'source-over'
  }

  // 2) Bloom — a blurred additive copy of the (already aberrated) frame.
  const glow = clamp01(cfg.glow)
  if (glow > 0.001 && 'filter' in ctx) {
    const bloom = getWork(4, W, H)
    const bc = resetWork(bloom.getContext('2d')!)
    bc.clearRect(0, 0, W, H)
    bc.filter = `blur(${(glow * 7 * S).toFixed(2)}px)`
    bc.drawImage(ctx.canvas, 0, 0)
    bc.filter = 'none'
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = glow * 0.5
    ctx.drawImage(bloom, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  // 3) Phosphor mask — scanlines + RGB grille in a single multiply fill.
  const cell = Math.max(2, Math.round(clamp(cfg.size, 2, 8) * S))
  const pattern = getMaskPattern(
    ctx,
    cell,
    clamp01(cfg.scanlines),
    clamp01(cfg.grille),
  )
  if (pattern) {
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = pattern
    ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'source-over'
  }

  ctx.restore()
}
