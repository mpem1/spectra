/**
 * Glitch filter — digital corruption bursts over the finished frame.
 *
 * The picture plays clean most of the time; every so often a BURST hits —
 * a few frames of broken-signal chaos — then the image snaps back. Inside a
 * burst, at 15 glitch-fps:
 *
 *   1. Slices — horizontal strips of the picture shoved sideways (the torn
 *      datamosh look) plus raw saturated color bars (magenta/cyan/yellow…)
 *      stamped over the frame: the broken-video-signal signature.
 *   2. Blocks — corrupted macroblocks: square patches pixelated in place
 *      (nearest-neighbor magnification), patches COPIED from the wrong spot
 *      (mis-referenced data) and a few tinted with raw palette colors.
 *
 * `rate` is the burst cadence — its own dial (how often bursts fire and how
 * long they last), so intensity (`blocks` / `slices`) never has to be traded
 * for frequency: a rare burst is exactly as violent as a frequent one.
 *
 * No Math.random / Date.now anywhere: the burst schedule comes from the song
 * clock (time modulo a period), and every block/slice/bar position comes from
 * integer hashes of (index, quantized time), so the live preview, the MP4
 * export and the PNG sequence render identical pixels for the same song
 * second. Transparent backgrounds skip the pass (alpha must stay clean).
 */
import type { AudioFrame, RenderContext, GlitchFilterConfig } from './types'
import { clamp01, frameSeed, getWork, hash01, resetWork } from './filter-utils'

/** Raw "broken signal" palette for color bars and tinted blocks. */
const PALETTE = ['#ff00ff', '#00ffff', '#ffff00', '#ff0000', '#00ff00', '#0000ff', '#ffffff']

export function drawGlitchFilter(
  rc: RenderContext,
  cfg: GlitchFilterConfig | undefined,
  frame: Pick<AudioFrame, 'time'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  const S = H / 720
  const blocks = clamp01(cfg.blocks)
  const slices = clamp01(cfg.slices)
  const rate = clamp01(cfg.rate ?? 0.5)
  if (blocks <= 0.001 && slices <= 0.001) return

  // Burst schedule — cadence lives here and ONLY here (Task 71's lesson
  // applied from day one). duty = share of time a burst occupies; burstDur =
  // seconds of corruption per burst. rate 1 → duty 1 → continuous corruption;
  // lower rates park the picture clean between bursts.
  const duty = 0.05 + 0.95 * rate ** 2 // 0.05..1
  const burstDur = 0.25 + 0.45 * rate // 0.25..0.7 s
  const period = burstDur / duty
  const local = frame.time % period
  if (local >= burstDur) return // clean stretch — nothing to draw

  // One snapshot; every artifact samples the finished frame from it.
  const snap = getWork('glitch:snap', W, H)
  const sc = resetWork(snap.getContext('2d')!)
  sc.clearRect(0, 0, W, H)
  sc.drawImage(ctx.canvas, 0, 0)

  // Artifacts stutter at 15 glitch-fps — they hold for ~66ms then re-hash.
  const seed = frameSeed(frame.time, 15)

  /* --------------------------------- slices --------------------------------- */
  if (slices > 0.001) {
    const count = Math.round(2 + 6 * slices)
    for (let i = 0; i < count; i++) {
      const h = Math.max(2, Math.round((3 + hash01(i, seed + 43) * 26) * S))
      const y = Math.round(hash01(i, seed + 47) * Math.max(1, H - h))
      if (hash01(i, seed + 53) < 0.62) {
        // Displaced slice — the picture torn sideways. Drawing over the
        // intact frame leaves a ghosted edge, which reads as authentic
        // datamosh doubling.
        const dx = Math.round((hash01(i, seed + 59) - 0.5) * 2 * 70 * S * slices)
        if (dx !== 0) ctx.drawImage(snap, 0, y, W, h, dx, y, W, h)
      } else {
        // Raw color bar — a strip of pure signal corruption, shifted to a
        // hashed start and running off the right edge.
        const alpha = (0.35 + hash01(i, seed + 61) * 0.5) * (0.3 + 0.7 * slices)
        ctx.globalAlpha = alpha
        ctx.fillStyle = PALETTE[Math.floor(hash01(i, seed + 67) * PALETTE.length)]
        const bx = Math.round(hash01(i, seed + 71) * W * 0.5)
        ctx.fillRect(bx, y, W - bx, h)
        ctx.globalAlpha = 1
      }
    }
  }

  /* --------------------------------- blocks --------------------------------- */
  if (blocks > 0.001) {
    const count = Math.round(3 + 9 * blocks)
    ctx.imageSmoothingEnabled = false // chunky nearest-neighbor pixels
    for (let i = 0; i < count; i++) {
      const size = Math.round((10 + hash01(i, seed) * (18 + 30 * blocks)) * S)
      if (size < 2) continue
      const x = Math.round(hash01(i, seed + 5) * Math.max(1, W - size))
      const y = Math.round(hash01(i, seed + 9) * Math.max(1, H - size))
      if (hash01(i, seed + 13) < 0.45) {
        // Wrong-macroblock copy — content teleported from elsewhere.
        const sx = Math.round(hash01(i, seed + 17) * Math.max(1, W - size))
        const sy = Math.round(hash01(i, seed + 23) * Math.max(1, H - size))
        ctx.drawImage(snap, sx, sy, size, size, x, y, size, size)
      } else {
        // Pixelate in place — magnify a small centered sub-region.
        const m = 3 + Math.floor(hash01(i, seed + 29) * 4) // 3..6× chunk
        const src = Math.max(1, Math.round(size / m))
        const off = Math.round((size - src) / 2)
        ctx.drawImage(snap, x + off, y + off, src, src, x, y, size, size)
      }
      if (hash01(i, seed + 31) < 0.3) {
        // Raw palette tint on some blocks — data painted the wrong color.
        ctx.globalAlpha = 0.2 + hash01(i, seed + 37) * 0.35
        ctx.fillStyle = PALETTE[Math.floor(hash01(i, seed + 41) * PALETTE.length)]
        ctx.fillRect(x, y, size, size)
        ctx.globalAlpha = 1
      }
    }
    ctx.imageSmoothingEnabled = true
  }
}
