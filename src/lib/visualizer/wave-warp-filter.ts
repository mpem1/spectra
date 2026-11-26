/**
 * Water wave filter — the whole picture ripples like a reflection on
 * water.
 *
 * Mechanism: the frame is snapshotted offscreen and redrawn in thin
 * horizontal strips (2px each, scaled to the canvas height so big frames
 * stay smooth); every strip shifts sideways by
 * sin(phase) · amplitude, where the phase rolls down the frame
 * (Ripples dial — full waves from top edge to bottom) and drifts with the
 * decorative style clock (Flow speed dial — cycles per second). Each strip
 * draws twice, the second copy wrapped one frame-width over, so the
 * shifted edges stay seamless instead of smearing a gap. Mix below 1
 * fades the untouched frame back through.
 *
 * Beat wobble (opt-in): on a detected low-end hit the amplitude swells —
 * multiplicative through the shared `beatBoost` gate, resting EXACTLY at
 * the dialed look between kicks.
 *
 * Clock: the drift follows the decorative style clock (wall clock live so
 * the water keeps flowing while paused; song time in exports), the
 * app-wide contract for ambient motion — deterministic files, alive
 * previews.
 *
 * Deterministic: no Math.random, no time-hashed noise — same frame in, same
 * pixels out, so the live preview and offline exports agree frame-exactly.
 * Skipped on transparent backgrounds like every full-frame filter.
 */
import type { AudioFrame, RenderContext, WaveWarpFilterConfig } from './types'
import { beatBoost, clamp01, getWork, resetWork } from './filter-utils'

const TAU = Math.PI * 2

export function drawWaveWarpFilter(
  rc: RenderContext,
  cfg: WaveWarpFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass' | 'styleTime'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 16 || H < 16) return

  const blend = clamp01(cfg.blend ?? 1)
  if (blend <= 0.001) return

  // Beat wobble — multiplicative on kicks (1 between them): the ripples
  // swell up to double depth on a full low-end hit at strength 1.
  const amp =
    (cfg.amplitude ?? 22) * (H / 720) * beatBoost(cfg, frame.bass, 1)
  const density = Math.max(0.1, cfg.density ?? 2.5)
  const speed = cfg.speed ?? 0.8
  if (amp <= 0.01) return

  const src = getWork('wave:src', W, H)
  const sctx = resetWork(src.getContext('2d')!)
  sctx.drawImage(ctx.canvas, 0, 0)

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0

  // Thin strips: 2px slices so the sine reads smooth without one draw
  // call per scanline.
  const sliceH = Math.max(2, Math.round(H / 360))
  const t = frame.styleTime * speed * TAU
  for (let y = 0; y < H; y += sliceH) {
    const sh = Math.min(sliceH, H - y)
    const dx = Math.sin((y / H) * TAU * density + t) * amp
    const shift = Math.round(dx)
    ctx.drawImage(src, 0, y, W, sh, shift, y, W, sh)
    // Wrap copy — covers the edge the shift opened (one frame-width over,
    // same strip), so the ripple never smears a gap at the frame edge.
    if (shift > 0) ctx.drawImage(src, 0, y, W, sh, shift - W, y, W, sh)
    else if (shift < 0) ctx.drawImage(src, 0, y, W, sh, shift + W, y, W, sh)
  }

  // Mix below 1: fade the untouched frame back through the ripple.
  if (blend < 0.999) {
    ctx.globalAlpha = 1 - blend
    ctx.drawImage(src, 0, 0)
  }
  ctx.restore()
}
