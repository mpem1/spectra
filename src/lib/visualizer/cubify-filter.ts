/**
 * Cubify filter — effect.app's Cubify effect, rebuilt over the whole
 * finished frame.
 *
 * What the real effect does (measured against its published before/after):
 * the picture is pixelated onto a chunky grid, but instead of flat mosaic
 * squares every cell renders as a glossy 3D cube FACE — the cell's averaged
 * color, beveled with one global light direction (bright top-left edge
 * falling through a soft mid to a dark bottom-right edge), a gentle specular
 * sheen near the upper-left corner, and hairline seams between neighbors, so
 * detailed scenes become bold, blocky glass-tile compositions where large
 * shapes stay readable as stepped cube silhouettes.
 *
 * How this port works (pure canvas ops, one tiny getImageData):
 *   1. One GPU area-average of the frame onto a cols×rows canvas, one small
 *      getImageData — the same trick the dither filter uses.
 *   2. The grid upscales nearest-neighbor onto an offscreen work canvas —
 *      this is the darkened GROUT layer (what shows in the seams).
 *   3. One pass over the cells draws every cube: the true averaged color
 *      filled inside a rounded, seam-inset Path2D, then the bevel gradient
 *      and the gloss hotspot on top. ONE Path2D + TWO gradients are built
 *      per frame and reused for every cell via translate — the per-cell cost
 *      is three fills, and a cell budget caps the grid so the smallest dial
 *      stays interactive (the same clamp the dither MacPaint engine uses).
 *   4. Composite: the cube print replaces the frame; below 100% strength the
 *      untouched frame fades back through.
 *
 * Beat pop (opt-in): on a detected low-end hit the cubes brighten and their
 * gloss flares, driven by frame.bass through the shared additive
 * `beatAmount` gate — resting EXACTLY at the dialed look between kicks.
 *
 * Deterministic: no Math.random, no time-hashed noise — same frame in, same
 * pixels out, so the live preview and offline exports agree frame-exactly.
 * Skipped on transparent backgrounds like every full-frame filter.
 */
import type { AudioFrame, CubifyFilterConfig, RenderContext } from './types'
import { beatAmount, clamp01, getWork, resetWork } from './filter-utils'

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

/** Rounded cube face in LOCAL cell coordinates, built once per frame.
 *  Path2D.roundRect is Chrome 99+/Safari 16.4+/FF 112+ — the rect fallback
 *  keeps every ancient-but-alive browser rendering (just with square tiles). */
function cubePath(w: number, h: number, radius: number): Path2D {
  const p = new Path2D()
  const rounded = (
    p as unknown as { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }
  ).roundRect
  if (typeof rounded === 'function') rounded.call(p, 0, 0, w, h, radius)
  else p.rect(0, 0, w, h)
  return p
}

export function drawCubifyFilter(
  rc: RenderContext,
  cfg: CubifyFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 16 || H < 16) return
  const S = H / 720

  const strength = clamp01(cfg.strength ?? 1)
  if (strength <= 0.001) return
  const bevel = clamp01(cfg.bevel ?? 0.6)
  const gap = Math.min(0.5, Math.max(0, cfg.gap ?? 0.14))

  // Beat pop — additive on kicks, resting at exactly 0 between them.
  const beat = beatAmount(cfg, frame.bass)
  const lift = 1 + beat * 0.5
  const glossEff = Math.min(1, clamp01(cfg.gloss ?? 0.55) + beat * 0.35)

  /* ------------------------------ grid sizing ------------------------------ */

  // Cube size rides the 720p reference scale like every other metric.
  let cell = Math.max(4, Math.round((cfg.size ?? 36) * S))
  // Cell budget: the cube pass is O(cells × 3 fills); keep the live grid
  // bounded for interactivity, exports with a generous ceiling so cranked
  // dials can't stall a render (same clamp the dither MacPaint engine uses).
  const cap = rc.interactive ? 30000 : 100000
  for (;;) {
    const cols = Math.ceil(W / cell)
    const rows = Math.ceil(H / cell)
    if (cols * rows <= cap || cell >= 512) break
    cell = Math.min(512, Math.ceil(cell * Math.sqrt((cols * rows) / cap)))
  }
  const cols = Math.max(2, Math.ceil(W / cell))
  const rows = Math.max(2, Math.ceil(H / cell))

  const cubePass = bevel > 0.001 || glossEff > 0.001

  /* --------------------------- 1) area-average ----------------------------- */

  const sample = getWork('cubify:grid', cols, rows)
  const smCtx = resetWork(sample.getContext('2d', { willReadFrequently: true })!)
  smCtx.imageSmoothingEnabled = true
  smCtx.imageSmoothingQuality = 'high'
  smCtx.drawImage(ctx.canvas, 0, 0, cols, rows)
  const src = smCtx.getImageData(0, 0, cols, rows).data

  /* ------------------------ 2) grout flat mosaic --------------------------- */

  // The flat layer is what shows in the seams: every cell's averaged color,
  // darkened into grout (only when the cube pass actually carves seams —
  // with bevel AND gloss at zero the dial is inert and the base stays the
  // pure flat mosaic), brightened by the beat lift.
  const flat = gridBuf(cols, rows)
  const d = flat.data
  const groutMul = cubePass ? 1 - 0.55 * (gap / 0.5) : 1
  for (let k = 0; k < cols * rows; k++) {
    const kk = k * 4
    d[kk] = Math.min(255, src[kk] * groutMul * lift + 0.5) | 0
    d[kk + 1] = Math.min(255, src[kk + 1] * groutMul * lift + 0.5) | 0
    d[kk + 2] = Math.min(255, src[kk + 2] * groutMul * lift + 0.5) | 0
    d[kk + 3] = 255
  }
  const flatCanvas = getWork('cubify:flat', cols, rows)
  const fctx = resetWork(flatCanvas.getContext('2d')!)
  fctx.putImageData(flat, 0, 0)

  const out = getWork('cubify:out', W, H)
  const octx = resetWork(out.getContext('2d', { willReadFrequently: true })!)
  octx.imageSmoothingEnabled = false
  octx.drawImage(flatCanvas, 0, 0, cols, rows, 0, 0, W, H)
  octx.imageSmoothingEnabled = true

  /* --------------------------- 3) the cube pass ---------------------------- */

  if (cubePass) {
    const gapPx = cell * gap
    const cw = Math.max(1, cell - gapPx)
    const ch = cw // square grid → square cubes
    const path = cubePath(cw, ch, cw * 0.16)

    // Bevel gradient — ONE global light direction (top-left), shared by
    // every cube; defined in local cell space and moved by translate.
    const bevelGrad = octx.createLinearGradient(0, 0, cw, ch)
    bevelGrad.addColorStop(0, `rgba(255,255,255,${(0.5 * bevel).toFixed(4)})`)
    bevelGrad.addColorStop(0.22, `rgba(255,255,255,${(0.16 * bevel).toFixed(4)})`)
    bevelGrad.addColorStop(0.5, 'rgba(255,255,255,0)')
    bevelGrad.addColorStop(0.78, `rgba(0,0,0,${(0.2 * bevel).toFixed(4)})`)
    bevelGrad.addColorStop(1, `rgba(0,0,0,${(0.36 * bevel).toFixed(4)})`)

    // Gloss hotspot — the soft sheen near each cube's upper-left corner.
    const hx = cw * 0.3
    const hy = ch * 0.26
    const glossGrad = octx.createRadialGradient(hx, hy, 0, hx, hy, cw * 0.8)
    glossGrad.addColorStop(0, `rgba(255,255,255,${(0.55 * glossEff).toFixed(4)})`)
    glossGrad.addColorStop(0.4, `rgba(255,255,255,${(0.14 * glossEff).toFixed(4)})`)
    glossGrad.addColorStop(1, 'rgba(255,255,255,0)')

    for (let j = 0; j < rows; j++) {
      const py = j * cell
      for (let i = 0; i < cols; i++) {
        const kk = (j * cols + i) * 4
        const px = i * cell
        octx.save()
        octx.translate(px, py)
        // Cube body — the TRUE averaged color (the grout layer beneath
        // only shows in the seams), brightened by the beat lift.
        octx.fillStyle = `rgb(${Math.min(255, src[kk] * lift + 0.5) | 0},${Math.min(255, src[kk + 1] * lift + 0.5) | 0},${Math.min(255, src[kk + 2] * lift + 0.5) | 0})`
        octx.fill(path)
        // 3D face — bevel, then the specular sheen.
        octx.fillStyle = bevelGrad
        octx.fill(path)
        octx.fillStyle = glossGrad
        octx.fill(path)
        octx.restore()
      }
    }
    octx.setTransform(1, 0, 0, 1, 0, 0)
  }

  /* ----------------------------- 4) composite ------------------------------ */

  // The cube print replaces the frame; below 100% strength the untouched
  // frame fades back through (the same blend the dither engines use).
  let base: HTMLCanvasElement | null = null
  if (strength < 0.999) {
    base = getWork('cubify:base', W, H)
    const bctx = resetWork(base.getContext('2d')!)
    bctx.drawImage(ctx.canvas, 0, 0, W, H)
  }
  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  ctx.drawImage(out, 0, 0, W, H)
  if (base) {
    ctx.globalAlpha = 1 - strength
    ctx.drawImage(base, 0, 0, W, H)
    ctx.globalAlpha = 1
  }
  ctx.restore()
}
