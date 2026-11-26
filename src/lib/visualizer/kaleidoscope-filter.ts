/**
 * Kaleidoscope filter — the whole picture mirrored through a radial array
 * of wedge slices around a center point.
 *
 * Geometry: the frame is redrawn once per wedge — each wedge clips a slice
 * of angle 2π/segments around the picked center, and draws the SOURCE
 * picture (snapshotted offscreen) translated so its center point sits on
 * the wedge's apex, scaled so the slice always covers the full frame (the
 * auto-cover factor: the distance from the center to the nearest frame
 * edge is stretched out to the corner radius, so no wedge can ever show a
 * gap, whatever the center or zoom). Odd wedges mirror about their own
 * center axis, which is exactly the classic kaleidoscope tiling: every
 * boundary between wedges reads as a clean reflection of the same slice.
 * The whole array rotates with the Spin dial (negative = the other way)
 * and kicks around an extra wedge on the song's low end when "React to
 * beat" is on — additive, resting EXACTLY at the dialed look between
 * kicks. Mix below 1 fades the untouched frame back through.
 *
 * Clock: the spin follows the decorative style clock (wall clock live so
 * the mirror keeps turning while paused; song time in exports), the
 * app-wide contract for ambient motion — deterministic files, alive
 * previews.
 *
 * Deterministic: no Math.random, no time-hashed noise — same frame in, same
 * pixels out, so the live preview and offline exports agree frame-exactly.
 * Skipped on transparent backgrounds like every full-frame filter.
 */
import type { AudioFrame, KaleidoscopeFilterConfig, RenderContext } from './types'
import { beatAmount, clamp01, getWork, resetWork } from './filter-utils'

const TAU = Math.PI * 2

export function drawKaleidoscopeFilter(
  rc: RenderContext,
  cfg: KaleidoscopeFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass' | 'styleTime'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 16 || H < 16) return

  const blend = clamp01(cfg.blend ?? 1)
  if (blend <= 0.001) return

  const segments = Math.max(2, Math.round(cfg.segments ?? 8))
  const zoom = Math.max(1, cfg.zoom ?? 1.4)
  const cx = (clamp01((cfg.centerX ?? 50) / 100) * W) | 0
  const cy = (clamp01((cfg.centerY ?? 50) / 100) * H) | 0

  // Beat spin — additive on kicks, resting at exactly 0 between them: the
  // array swings around by up to half a wedge on a full low-end hit.
  const beat = beatAmount(cfg, frame.bass)
  const spinAngle = (cfg.spin ?? 0.05) * frame.styleTime * TAU + beat * 0.5

  // Corner radius from the picked center — the wedge print must reach
  // everywhere in the frame.
  const radius = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy))
  // Auto-cover: stretch the source so the distance from the center to the
  // nearest frame edge fills out to the corner radius — with the zoom dial
  // at 1 the slice already covers the whole print, whatever the center.
  const edgeDist = Math.max(1, Math.min(cx, W - cx, cy, H - cy))
  const cover = radius / edgeDist

  const src = getWork('kaleido:src', W, H)
  const sctx = resetWork(src.getContext('2d')!)
  sctx.drawImage(ctx.canvas, 0, 0)

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  const segAngle = TAU / segments
  for (let i = 0; i < segments; i++) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(spinAngle + i * segAngle)
    if (i % 2 === 1) ctx.scale(1, -1)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, radius + 1, -segAngle / 2 - 0.004, segAngle / 2 + 0.004)
    ctx.closePath()
    ctx.clip()
    ctx.scale(zoom * cover, zoom * cover)
    ctx.drawImage(src, -cx, -cy)
    ctx.restore()
  }
  // Mix below 1: fade the untouched frame back through the mirror print.
  if (blend < 0.999) {
    ctx.globalAlpha = 1 - blend
    ctx.drawImage(src, 0, 0)
  }
  ctx.restore()
}
