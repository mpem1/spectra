/**
 * Strobe filter — the screen flashes to its negative at random intervals.
 *
 * Mechanism: the finished picture is snapshotted offscreen, inverted there
 * (a white `difference` fill is the exact per-channel negative), optionally
 * re-tinted (a `color`-blend fill of the overlay hue — the negative keeps
 * its flipped luminosity and takes the overlay's hue + saturation, so a red
 * overlay reads as a red-negative strobe), and composited back over the
 * live frame at the Mix dial. Pure black/white negative when the overlay is
 * off.
 *
 * Random intervals: the timeline is divided into windows one `Frequency`
 * average apart; each window hashes ONE flash moment inside itself, so the
 * gaps between flashes wander around the dial's average instead of ticking
 * like a metronome. Every hash input is the quantized song time
 * (`hash01`, the filter-utils contract), so the live preview and the
 * offline export flash on the exact same frames — no Math.random anywhere.
 * Frequency 0 silences the schedule: a beat-only strobe.
 *
 * Beat trigger (opt-in): the shared kick-gate idiom (glitch's) — a real
 * low-end hit (`punch * bass * bass` over threshold) fires the strobe too,
 * for as long as the kick holds; between kicks the frame rests exactly at
 * the dialed look. `beatStrength` sets both the sensitivity and how fully
 * the beat flash inverts.
 *
 * Per-flash color roll: when "randomize color on beat" is on, every flash
 * lands a fresh hue — ambient flashes tint from their own window's hash
 * (one hue per flash, constant for its whole duration), beat flashes from
 * fifth-second buckets (a fresh hue on every kick). Deterministic per
 * flash, so exports roll the exact same colors.
 *
 * Clock: song time (`frame.time`) — the flash schedule is content, not
 * decoration, so it freezes with the song like the glitch bursts do.
 * Skipped on transparent backgrounds like every full-frame filter.
 */
import type { AudioFrame, RenderContext, StrobeFilterConfig } from './types'
import { clamp01, getWork, hash01, resetWork } from './filter-utils'

/** One strobe blink, in seconds — short enough to read as a flash at any
 *  frame rate (2 frames at 30 fps, 4 at 60). */
const FLASH_S = 0.07

/** hsl(h° 0–360, s 0–1, l 0–1) → '#rrggbb' — the per-flash color roll's
 *  vocabulary (same math as the randomizer's roll, local to stay off the
 *  renderer's dependency graph). */
function hslHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hue < 60) {
    r = c
    g = x
  } else if (hue < 120) {
    r = x
    g = c
  } else if (hue < 180) {
    g = c
    b = x
  } else if (hue < 240) {
    g = x
    b = c
  } else if (hue < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const hex = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v + m)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

export function drawStrobeFilter(
  rc: RenderContext,
  cfg: StrobeFilterConfig | undefined,
  frame: Pick<AudioFrame, 'time' | 'bass'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 16 || H < 16) return

  const mix = clamp01(cfg.mix ?? 1)
  if (mix <= 0.001) return

  const t = Math.max(0, frame.time)

  // Ambient schedule — random intervals: each 1/Frequency window fires at
  // one hashed moment inside itself, so the gaps wander around the dial's
  // average. Frequency 0 silences the schedule (beat-only strobe).
  const f = Math.max(0, cfg.frequency ?? 2)
  let ambient = false
  let epoch = 0
  if (f > 0.01) {
    const windowS = 1 / f
    const k = Math.floor(t / windowS)
    epoch = k
    const fire = (k + hash01(k, 91)) * windowS
    ambient = t >= fire && t < fire + FLASH_S
  }

  // Beat gate — the shared kick idiom (glitch's): only a real low-end hit
  // passes; bass squared suppresses sustained moderate bass, so the strobe
  // fires ON kicks and rests between them.
  const punch = clamp01(cfg.beatStrength ?? 0.5)
  const beatHit = !!cfg.beatReactive && punch * frame.bass * frame.bass > 0.08

  if (!ambient && !beatHit) return

  // The flash's color epoch — ambient flashes tint from their own window
  // (one hue per flash), beat flashes from fifth-second buckets (a fresh
  // hue on every kick).
  const colorEpoch = ambient ? epoch : Math.floor(t * 5)

  // Build the flash print offscreen, then composite it back at the Mix.
  const src = getWork('strobe:src', W, H)
  const sctx = resetWork(src.getContext('2d')!)
  sctx.drawImage(ctx.canvas, 0, 0)

  // Negative: white difference is the exact per-channel invert.
  sctx.globalCompositeOperation = 'difference'
  sctx.fillStyle = '#ffffff'
  sctx.fillRect(0, 0, W, H)

  // Color overlay on the invert: the negative keeps its flipped luminosity
  // and takes the overlay hue ('color' blend) — dialed, or rolled fresh
  // per flash when the beat-roll switch is on.
  if (cfg.colorOverlay) {
    let overlay = cfg.overlayColor ?? '#ff3b5c'
    if (cfg.randomColorOnBeat) {
      const hue = hash01(colorEpoch, 137) * 360
      const sat = 0.72 + hash01(colorEpoch, 139) * 0.22
      const lum = 0.52 + hash01(colorEpoch, 149) * 0.12
      overlay = hslHex(hue, sat, lum)
    }
    sctx.globalCompositeOperation = 'color'
    sctx.fillStyle = overlay
    sctx.fillRect(0, 0, W, H)
  }

  ctx.save()
  ctx.globalAlpha = mix
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  ctx.drawImage(src, 0, 0)
  ctx.restore()
}
