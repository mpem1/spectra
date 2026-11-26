/**
 * Camera shake filter — the finished picture is reframed like handheld
 * footage.
 *
 * Mechanism: the frame is snapshotted offscreen and drawn back through one
 * transform — a smooth two-sine wander (incommensurate frequencies, so the
 * drift never visibly loops) moves the picture around by the Drift dial's
 * pixel budget, a Roll wobble dial tilts it a fraction of a degree with the
 * same wander, and an overscan scale (grown to cover the largest possible
 * offset + rotation) keeps the moved frame from ever revealing its edges.
 *
 * Beat jolt (opt-in): on a detected low-end hit a sharp offset kicks the
 * frame — additive through the shared `beatAmount` gate, resting EXACTLY at
 * the dialed drift between kicks. Each kick's direction hashes from the
 * quantized song time (`hash01`, the filter-utils contract), so the live
 * preview and the offline export kick on the exact same frames in the
 * exact same directions.
 *
 * Clock: the wander follows the decorative style clock (wall clock live so
 * the camera stays alive while paused; song time in exports), the app-wide
 * contract for ambient motion — deterministic files, alive previews.
 *
 * Deterministic: no Math.random — hashed noise and the style clock only,
 * so same frame in, same pixels out.
 * Skipped on transparent backgrounds like every full-frame filter.
 */
import type { AudioFrame, RenderContext, ShakeFilterConfig } from './types'
import { beatAmount, clamp01, frameSeed, getWork, hash01, resetWork } from './filter-utils'

export function drawShakeFilter(
  rc: RenderContext,
  cfg: ShakeFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass' | 'styleTime' | 'time'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 16 || H < 16) return

  const amount = Math.max(0, cfg.amount ?? 10)
  const speed = cfg.speed ?? 1
  const wobble = Math.max(0, cfg.wobble ?? 0.4)
  if (amount <= 0.01 && wobble <= 0.01) return

  const ref = H / 720
  const t = frame.styleTime * speed

  // Handheld wander — two incommensurate sines per axis, so the drift
  // circles organically and never visibly loops.
  const wanderX =
    Math.sin(t * 1.13 + 0.7) * 0.62 + Math.sin(t * 2.71 + 2.1) * 0.38
  const wanderY =
    Math.cos(t * 1.31 + 1.9) * 0.62 + Math.sin(t * 2.23 + 4.2) * 0.38
  let dx = wanderX * amount * ref
  let dy = wanderY * amount * ref

  // Roll wobble — the frame tilts with the same wander.
  let rot =
    (Math.sin(t * 0.93 + 3.1) * 0.7 + Math.sin(t * 2.07 + 1.2) * 0.3) *
    wobble *
    (Math.PI / 180)

  // Beat jolt — a sharp kick off the dialed drift, direction hashed from
  // the quantized song time (deterministic per frame).
  const beat = beatAmount(cfg, frame.bass)
  if (beat > 0.001) {
    const seed = frameSeed(frame.time, 30)
    const ang = hash01(seed, 11) * Math.PI * 2
    const mag = beat * amount * 1.6 * ref
    dx += Math.cos(ang) * mag
    dy += Math.sin(ang) * mag
    rot += (hash01(seed, 13) - 0.5) * 2 * wobble * (Math.PI / 180) * beat * 2
  }

  // Overscan: grow the redrawn frame just enough that the largest possible
  // offset + rotation never exposes an edge.
  const maxOff = amount * ref * 2.6
  const rotMargin = (Math.abs(rot) * Math.max(W, H)) / 2
  const scale = 1 + (2 * (maxOff + rotMargin)) / Math.min(W, H)

  const src = getWork('shake:src', W, H)
  const sctx = resetWork(src.getContext('2d')!)
  sctx.drawImage(ctx.canvas, 0, 0)

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  ctx.translate(W / 2 + dx, H / 2 + dy)
  ctx.rotate(rot)
  ctx.scale(scale, scale)
  ctx.translate(-W / 2, -H / 2)
  ctx.drawImage(src, 0, 0)
  ctx.restore()
}
