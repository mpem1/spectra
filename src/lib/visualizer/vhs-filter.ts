/**
 * VHS filter — the full-frame "worn-out tape" post-pass.
 *
 * Three stacked artifacts, all derived deterministically from song time:
 *
 *   1. Wobble — every ~3px scan band of the snapshot is redrawn with a small
 *      horizontal offset: a slow sine wave drifts the whole picture while a
 *      per-band hash jitter shimmers at 24 "tape fps". Rare hash-chosen bands
 *      jump far (flagging), the big tear you see on damaged tapes.
 *   2. Tracking — a noisy horizontal band rolls through the frame; inside it
 *      rows are displaced hard and mixed with light/dark noise streaks, like
 *      the bottom-of-tape head clog line on a VCR. Intensity (`tracking`) and
 *      cadence (`trackingSpeed`) are separate dials: intensity sets band
 *      thickness/noise, speed sets how often a pass happens and how fast it
 *      sweeps. At speed 1 the band rolls continuously; below that the tape
 *      "behaves" between passes and the band is parked off-screen.
 *   3. Dust — white dropout streaks (thin horizontal dashes) that pop in and
 *      out on a ~9 fps seed, exactly how tape dropouts flicker.
 *
 * No Math.random / Date.now anywhere: band offsets, streaks and specks come
 * from integer hashes of (index, quantized time), so the live preview, the
 * MP4 export and the PNG sequence render identical pixels for the same song
 * second. Transparent backgrounds skip the pass (alpha must stay clean).
 */
import type { AudioFrame, RenderContext, VhsFilterConfig } from './types'
import { beatBoost, clamp01, frameSeed, getWork, hash01, resetWork } from './filter-utils'

export function drawVhsFilter(
  rc: RenderContext,
  cfg: VhsFilterConfig | undefined,
  frame: Pick<AudioFrame, 'time' | 'bass'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  const S = H / 720
  // Beat reactive: wobble, tracking and dropouts punch harder on the low
  // end and rest exactly at the dialed-in look between beats. The band's
  // CADENCE (`trackingSpeed`) never moves — the beat only amplifies what
  // is already on screen, it never reschedules the pass. On top of the
  // dial punch, kicks add the tape-jolt signature: extra scan bands tear
  // loose (flagging) and a jitter floor keeps the kick visible even with
  // Wobble parked at 0.
  const boost = beatBoost(cfg, frame.bass, 1.3)
  const beat = beatAmount(cfg, frame.bass)
  const wobble = Math.min(1, clamp01(cfg.wobble) * boost)
  const tracking = Math.min(1, clamp01(cfg.tracking) * boost)
  const trackingSpeed = clamp01(cfg.trackingSpeed ?? 0.5)
  const dust = Math.min(1, clamp01(cfg.dust) * boost)

  ctx.save()
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0

  // Snapshot the finished frame once — every artifact samples from it.
  const snap = getWork('vhs:snap', W, H)
  const sc = resetWork(snap.getContext('2d')!)
  sc.clearRect(0, 0, W, H)
  sc.drawImage(ctx.canvas, 0, 0)

  /* --------------------------------- wobble --------------------------------- */
  const tapeFrame = frameSeed(frame.time, 24)
  const bandH = Math.max(2, Math.round(3 * S))
  const waveAmp = wobble * 7 * S
  // The + beat × 1.5px floor makes kicks visible even at Wobble 0.
  const jitAmp = wobble * 2.5 * S + beat * 1.5 * S
  const bands = Math.ceil(H / bandH)

  // Base copy fills the strips that displaced bands vacate (sub-pixel ghost
  //ing reads as tape smear, never as empty canvas).
  ctx.drawImage(snap, 0, 0)
  for (let b = 0; b < bands; b++) {
    const y = b * bandH
    const wave = Math.sin(y * (2.2 / H) * Math.PI + frame.time * 1.7) * waveAmp
    let dx = wave + (hash01(b, tapeFrame) - 0.5) * 2 * jitAmp
    // Flagging tear: ~0.4% of bands jump far for one tape frame at rest —
    // on a kick up to ~5% do, and the tear reaches further (tape jolt).
    if (hash01(b * 7 + 13, tapeFrame) > 0.996 - beat * 0.045) {
      dx += (hash01(b, tapeFrame + 5) - 0.5) * 26 * S * (wobble + beat * 0.6)
    }
    const rdx = Math.round(dx)
    if (rdx !== 0) ctx.drawImage(snap, 0, y, W, bandH, rdx, y, W, bandH)
  }

  /* -------------------------------- tracking -------------------------------- */
  if (tracking > 0.001) {
    // Cadence comes from trackingSpeed alone: `rate` is the sweep speed while
    // a pass is happening, `duty` is the fraction of time a pass occupies.
    // speed 1 → duty 1 → continuous roll (old max feel); lower speeds park
    // the band off-screen between passes so it shows up rarely but just as
    // strong — lowering speed never weakens the look.
    const rate = 0.3 + 0.5 * trackingSpeed // cycles/s mid-pass (0.3..0.8)
    const duty = 0.05 + 0.95 * trackingSpeed ** 1.5 // time share of a pass
    const bandPx = Math.round((16 + 26 * tracking) * S)
    const range = H + bandPx * 2
    const passDur = 1 / rate
    const period = passDur / duty
    const local = frame.time % period
    const by =
      local < passDur
        ? Math.round((local / passDur) * range - bandPx) // top edge mid-pass
        : H + bandPx // resting — parked just below the frame
    const seed = frameSeed(frame.time, 30)
    const rowH = Math.max(2, Math.round(2.5 * S))
    const rows = Math.ceil(bandPx / rowH)

    for (let r = 0; r < rows; r++) {
      const y = by + r * rowH
      if (y + rowH < 0 || y >= H) continue
      const sy = Math.min(Math.max(y, 0), H - 1)
      const sh = Math.min(rowH, H - sy)
      const dx = Math.round((hash01(r, seed) - 0.5) * 44 * S * tracking)
      ctx.drawImage(snap, 0, sy, W, sh, dx, sy, W, sh)
    }

    // Noise streaks inside the band — bright speckle + dark gaps.
    const streaks = Math.round(70 * tracking)
    for (let i = 0; i < streaks; i++) {
      const y = by + hash01(i, seed + 3) * bandPx
      if (y < 0 || y >= H) continue
      const x = hash01(i, seed + 7) * W
      const w = (2 + hash01(i, seed + 11) * 46) * S
      const bright = hash01(i, seed + 17) > 0.4
      ctx.fillStyle = bright ? '#ffffff' : '#000000'
      ctx.globalAlpha = (bright ? 0.1 + hash01(i, seed + 23) * 0.35 : 0.08 + hash01(i, seed + 23) * 0.3) * tracking
      ctx.fillRect(x, y, w, Math.max(1, 1.4 * S))
    }
    // Soft brightness lift over the band so it reads as a signal fault.
    if (by + bandPx > 0 && by < H) {
      const y0 = Math.max(by, 0)
      const y1 = Math.min(by + bandPx, H)
      ctx.globalAlpha = 0.05 * tracking
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, y0, W, y1 - y0)
    }
    ctx.globalAlpha = 1
  }

  /* ---------------------------------- dust ---------------------------------- */
  if (dust > 0.001) {
    const seed = frameSeed(frame.time, 9)
    const specks = Math.round(80 * dust)
    for (let i = 0; i < specks; i++) {
      const x = hash01(i, seed) * W
      const y = hash01(i, seed + 31) * H
      const w = (2 + hash01(i, seed + 47) * 13) * S
      const h = Math.max(1, (0.8 + hash01(i, seed + 53) * 1.4) * S)
      ctx.globalAlpha = 0.25 + hash01(i, seed + 61) * 0.6 * dust
      ctx.fillStyle = hash01(i, seed + 71) > 0.15 ? '#ffffff' : '#101010'
      ctx.fillRect(x, y, w, h)
    }
    ctx.globalAlpha = 1
  }

  ctx.restore()
}
