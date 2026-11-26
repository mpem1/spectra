/**
 * Vignette filter — the lens works the frame's edges one of two ways,
 * chosen on the card (either function, one at a time).
 *
 * COLOR mode (classic): one radial gradient centered on the picture —
 * transparent at the middle, the tint color fading in toward the corners
 * (an ellipse that touches the frame's farthest corner, so the falloff
 * follows the frame's shape). The tint stays near-black for the classic
 * neutral lens or takes a hue for a colored shadow.
 *
 * EDGE BLUR mode (opt-in): the same elliptical falloff, but the edges read
 * a BLURRED copy of the picture instead of a darkened one — a frosted lens
 * rim. The finished frame is snapshotted offscreen, redrawn through a
 * canvas blur at a radius tied to the frame size, masked by the identical
 * elliptical gradient (destination-in: transparent at the center, the
 * Amount dial as the rim's alpha) and composited back over the untouched
 * frame — so the center stays pixel-sharp and the sharp image shows
 * through wherever the blur runs thin. The blur pass draws the snapshot
 * slightly overscanned (a uniform scale grown by the blur radius) so the
 * blur never samples past the canvas edge: no transparent halo at the rim.
 *
 * Shared geometry: the Reach dial sets how far in from the corners the
 * effect starts; Softness feathers the falloff (0 = a hard lens edge that
 * snaps in at the reach line, 1 = the longest smooth fade). Amount is the
 * rim's strength either way — darkness in color mode, how fully the blur
 * takes over in blur mode. Skipped on transparent backgrounds like every
 * full-frame filter.
 *
 * Beat pulse (opt-in): on a detected low-end hit the vignette digs deeper
 * — additive through the shared `beatAmount` gate, resting EXACTLY at the
 * dialed look between kicks (the shadow darkens in color mode, the frost
 * thickens in blur mode).
 *
 * Deterministic: no randomness, no time-hashed noise — same frame in, same
 * pixels out, so the live preview and offline exports agree frame-exactly.
 */
import type { AudioFrame, RenderContext, VignetteFilterConfig } from './types'
import { beatAmount, clamp01, getWork, resetWork } from './filter-utils'
import { parseHexRGB } from './shade-ladder'

export function drawVignetteFilter(
  rc: RenderContext,
  cfg: VignetteFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 16 || H < 16) return

  const amount = clamp01(cfg.amount ?? 0.55)
  if (amount <= 0.001) return

  // Beat pulse — additive on kicks, resting at exactly 0 between them.
  const amountEff = clamp01(amount + beatAmount(cfg, frame.bass) * 0.5)

  // Elliptical falloff: the gradient's radius reaches the farthest corner,
  // so the effect hugs the frame's own shape. Shared by both modes.
  const cx = W / 2
  const cy = H / 2
  const maxR = Math.hypot(W, H) / 2
  // Reach 0 → the fade starts right at the corner; reach 1 → well inside.
  const inner = maxR * (1 - clamp01(cfg.reach ?? 0.5) * 0.85)
  // Softness: hold full transparency until this share of the falloff, then
  // ramp to the full amount at the corner. 0 = hold almost to the end (a
  // hard lens edge), 1 = no hold (the longest smooth fade).
  const hold = Math.min(0.98, Math.max(0.001, 1 - clamp01(cfg.softness ?? 0.6) * 0.98))

  if (cfg.edgeBlur) {
    // ---- EDGE BLUR: the frame's own picture, blurred, masked to the rim.
    const blurPx = Math.max(4, Math.round(maxR * 0.055))

    // Snapshot the finished frame.
    const src = getWork('vignette:src', W, H)
    const sctx = resetWork(src.getContext('2d')!)
    sctx.drawImage(ctx.canvas, 0, 0)

    // The blurred print: redrawn through a canvas blur, overscanned by the
    // blur radius (uniform scale, centered) so the blur never samples past
    // the canvas edge and the rim stays fully opaque.
    const buf = getWork('vignette:blur', W, H)
    const bctx = resetWork(buf.getContext('2d')!)
    const overscan = 1 + (2 * blurPx) / Math.max(W, H)
    const dw = W * overscan
    const dh = H * overscan
    bctx.filter = `blur(${blurPx}px)`
    bctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh)
    bctx.filter = 'none'

    // Mask the blurred print to the rim — the identical ellipse: nothing at
    // the center, the Amount dial as the corner alpha. destination-in keeps
    // only what the gradient covers, alpha-scaled.
    const mask = bctx.createRadialGradient(cx, cy, inner, cx, cy, maxR)
    mask.addColorStop(0, 'rgba(0,0,0,0)')
    mask.addColorStop(hold, 'rgba(0,0,0,0)')
    mask.addColorStop(1, `rgba(0,0,0,${amountEff.toFixed(3)})`)
    bctx.globalCompositeOperation = 'destination-in'
    bctx.fillStyle = mask
    bctx.fillRect(0, 0, W, H)
    bctx.globalCompositeOperation = 'source-over'

    // Composite the frosted rim back over the untouched frame.
    ctx.save()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.shadowBlur = 0
    ctx.drawImage(buf, 0, 0)
    ctx.restore()
    return
  }

  // ---- COLOR: the classic tinted shadow fading in toward the corners.
  const tint = parseHexRGB(cfg.tintColor ?? '#000000') ?? [0, 0, 0]
  const [r, g, b] = tint

  const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, maxR)
  grad.addColorStop(0, `rgba(${r},${g},${b},0)`)
  grad.addColorStop(hold, `rgba(${r},${g},${b},0)`)
  grad.addColorStop(1, `rgba(${r},${g},${b},${amountEff.toFixed(3)})`)

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
}
