/**
 * Vignette filter — the lens darkens toward the frame's edges.
 *
 * Mechanism: one radial gradient centered on the picture — transparent at
 * the middle, the tint color fading in toward the corners (an ellipse that
 * touches the frame's farthest corner, so the falloff follows the frame's
 * shape). The Reach dial sets how far in from the corners the darkness
 * starts; Softness feathers the falloff (0 = a hard lens edge that snaps
 * in at the reach line, 1 = the longest smooth fade); the tint stays
 * near-black for the classic neutral lens or takes a hue for a colored
 * shadow. Skipped on transparent backgrounds like every full-frame filter.
 *
 * Beat pulse (opt-in): on a detected low-end hit the vignette darkens
 * deeper — additive through the shared `beatAmount` gate, resting EXACTLY
 * at the dialed look between kicks (so even a faint vignette breathes on
 * the beat when the switch is on).
 *
 * Deterministic: no randomness, no time-hashed noise — same frame in, same
 * pixels out, so the live preview and offline exports agree frame-exactly.
 */
import type { AudioFrame, RenderContext, VignetteFilterConfig } from './types'
import { beatAmount, clamp01 } from './filter-utils'
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

  const tint = parseHexRGB(cfg.tintColor ?? '#000000') ?? [0, 0, 0]
  const [r, g, b] = tint

  // Elliptical falloff: the gradient's radius reaches the farthest corner,
  // so the darkness hugs the frame's own shape.
  const cx = W / 2
  const cy = H / 2
  const maxR = Math.hypot(W, H) / 2
  // Reach 0 → the fade starts right at the corner; reach 1 → well inside.
  const inner = maxR * (1 - clamp01(cfg.reach ?? 0.5) * 0.85)
  // Softness: hold full transparency until this share of the falloff, then
  // ramp to the full amount at the corner. 0 = hold almost to the end (a
  // hard lens edge), 1 = no hold (the longest smooth fade).
  const hold = Math.min(0.98, Math.max(0.001, 1 - clamp01(cfg.softness ?? 0.6) * 0.98))

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
