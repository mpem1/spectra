/**
 * Halftone filter — newspaper print over the whole frame.
 *
 * The picture is resampled onto a 45°-rotated dot grid (the classic newspaper
 * screen angle) and BLACK DOTS are laid over it — but only where the tone is
 * dark enough: `dotRange` sets the luminance threshold ("only halftone the
 * darker colors, leave the rest intact"). Inside the dotted range the dot
 * AREA grows with darkness (dot radius ∝ √depth), so deep shadows merge into
 * solid ink exactly like real halftone print. Lighter areas never get a dot.
 *
 * How it stays fast & deterministic (pure canvas ops, one getImageData):
 *   1. The frame snapshot is drawn rotated -45° into a TINY n×n canvas
 *      (one pixel per grid cell) — the browser's downscale smoothing does
 *      the area averaging for free.
 *   2. One getImageData on that small canvas, one JS pass building a single
 *      Path2D of dots (skipping cells lighter than the threshold).
 *   3. One fill into a diag×diag dot layer drawn in rotated space, then one
 *      rotated drawImage back onto the frame.
 * No randomness, no time — same frame in, same dots out, in every pipeline.
 */
import type { HalftoneFilterConfig, RenderContext } from './types'
import { clamp01, getWork, resetWork } from './filter-utils'

export function drawHalftoneFilter(
  rc: RenderContext,
  cfg: HalftoneFilterConfig | undefined,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  const S = H / 720
  const cell = Math.max(3, Math.round(Math.max(3, Math.min(14, cfg.dotSize)) * S))
  const range = clamp01(cfg.dotRange)
  const strength = clamp01(cfg.strength)
  if (range <= 0.001 || strength <= 0.001) return

  const diag = Math.ceil(Math.hypot(W, H))
  const n = Math.ceil(diag / cell)
  const cellS = diag / n // exact pitch so sampling & dots never drift apart

  ctx.save()
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0

  // Snapshot the finished frame.
  const snap = getWork('ht:snap', W, H)
  const sc = resetWork(snap.getContext('2d')!)
  sc.clearRect(0, 0, W, H)
  sc.drawImage(ctx.canvas, 0, 0)

  // 1) Resample the snapshot into rotated space — one pixel per grid cell.
  //    Dest pixel d must end up holding the frame color at
  //    fp(d) = center + R(45°)·(d − center)·cellS, so the draw transform is
  //    its inverse: translate(n/2) · scale(1/cellS) · rotate(−45°) ·
  //    translate(−W/2, −H/2).
  const sample = getWork('ht:sample', n, n)
  const smCtx = resetWork(sample.getContext('2d', { willReadFrequently: true })!)
  smCtx.clearRect(0, 0, n, n)
  smCtx.imageSmoothingEnabled = true
  smCtx.imageSmoothingQuality = 'low'
  smCtx.setTransform(1, 0, 0, 1, n / 2, n / 2)
  smCtx.scale(1 / cellS, 1 / cellS)
  smCtx.rotate(-Math.PI / 4)
  smCtx.translate(-W / 2, -H / 2)
  smCtx.drawImage(snap, 0, 0, W, H)

  // 2) One read of the tiny sample; build all dots as a single Path2D.
  //    Path coords live in ROTATED space (origin = frame center) — the same
  //    mapping the sampler used, so each dot sits exactly on its cell.
  const data = smCtx.getImageData(0, 0, n, n).data
  const path = new Path2D()
  for (let j = 0; j < n; j++) {
    const y = (j + 0.5 - n / 2) * cellS
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 4
      if (data[k + 3] < 120) continue // outside the rotated frame footprint
      const lum = (0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]) / 255
      if (lum >= range) continue // lighter than the threshold → untouched
      const depth = (range - lum) / range // 0 at threshold → 1 at pure black
      const r = Math.sqrt(depth) * cellS * 0.72 // ink area grows with darkness
      if (r < 0.4) continue
      const x = (i + 0.5 - n / 2) * cellS
      path.moveTo(x + r, y)
      path.arc(x, y, r, 0, Math.PI * 2)
    }
  }

  // 3) Rasterize the dots into a diag×diag layer in rotated space —
  //    TRANSLATED ONLY (the layer is a plain buffer; the single 45°
  //    rotation happens once, at composite time)…
  const layer = getWork('ht:layer', diag, diag)
  const lc = resetWork(layer.getContext('2d')!)
  lc.clearRect(0, 0, diag, diag)
  lc.translate(diag / 2, diag / 2)
  lc.fillStyle = '#000000'
  lc.globalAlpha = strength
  lc.fill(path)

  // …and composite it back over the frame (corners of the rotated layer map
  // outside the canvas and are clipped).
  ctx.translate(W / 2, H / 2)
  ctx.rotate(Math.PI / 4)
  ctx.drawImage(layer, -diag / 2, -diag / 2)
  ctx.restore()
}
