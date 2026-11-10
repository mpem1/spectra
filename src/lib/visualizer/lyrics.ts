/**
 * Pulse Studio — timed lyric rendering.
 *
 * Scrolling two-line karaoke queue. Each new line fades in at the main
 * position (underneath the previous one); the moment it arrives, the line it
 * replaces glides up into the echo slot above and dims — it STAYS there until
 * the following line arrives, which pushes it off completely. So the newest
 * line is always at the bottom, the runner-up sits above it, and everything
 * older is gone.
 *
 * A line that is never replaced within `holdTime` seconds (the trailing line,
 * or a long gap to the next one) fades out on its own instead of sticking
 * around forever.
 *
 * The replaced line's echo slot is optional (`echo`, default on): with the
 * echo off, each line leaves the moment the next one arrives — no dimmed
 * copy lingers above.
 *
 * Text can be filled with a flat color, a sweep of the visualizer palette,
 * the lyrics' own gradient (angle-aware, respects stop positions), or left
 * empty — a see-through hollow letter showing only its outline stroke
 * and/or glow halo. Long lines auto-shrink to fit. An overall `opacity`
 * (0..1) scales the whole layer uniformly, on top of every other alpha.
 *
 * Deterministic — a pure function of (rc, frame, lyrics, palette).
 */
import type { AudioFrame, GradientConfig, LyricLine, LyricsConfig, RenderContext } from './types'
import { fontStack } from './custom-fonts'
import { buildGradient, buildRadialGradient, gradientLine } from './gradients'
import { drawHollowGlow } from './hollow-glow'

/**
 * Index of the last line whose start time is <= `time`, or -1 if none yet.
 */
export function findActiveLine(lines: LyricLine[], time: number): number {
  let active = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= time) active = i
    else break
  }
  return active
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * Draw every live lyric line for this frame.
 *
 * Line i's lifecycle (times: T_i = start, R = when line i+1 replaces it):
 *  - [T_i, R): main slot, full alpha. It never fades early — it stays until
 *    the next line actually arrives.
 *  - [R, D): echo slot. Glides up and dims to 0.6 over `fade` seconds.
 *  - D: departure. If line i+2 arrives before line i+1's hold would expire,
 *    D = T_{i+2} and the line is pushed off completely (hard cut, masked by
 *    the new arrival). Otherwise it fades out together with line i+1's
 *    auto-hide at R + holdTime.
 *  - Never replaced (no next line, or the gap exceeds holdTime): fades out
 *    over `fade` seconds ending at T_i + holdTime.
 */
export function drawLyrics(
  rc: RenderContext,
  frame: AudioFrame,
  lyrics: LyricsConfig,
  palette: GradientConfig,
): void {
  if (!lyrics.enabled || lyrics.lines.length === 0) return

  const { ctx, width, height } = rc
  const S = height / 720
  // Overall layer opacity — render-level ?? fallback keeps very old raw
  // configs (that skipped the store merge) fully opaque.
  const baseOpacity = clamp01(lyrics.opacity ?? 1)
  // Invisible layer: skip all the work (font measuring, glow passes…).
  if (baseOpacity <= 0.002) return
  const fade = Math.max(lyrics.fade, 0.001)
  const hold = Math.max(lyrics.holdTime, 0.5)
  const lines = lyrics.lines
  const t = frame.time
  const yMain = (lyrics.positionY / 100) * height
  const gap = lyrics.size * 1.35 * S

  // Gradient sweep source: the visualizer palette, or the lyrics' own
  // gradient when the user picked Custom in the Lyrics tab.
  const fillPalette =
    lyrics.fill === 'gradient' && lyrics.gradientMode === 'custom' ? lyrics.gradient : palette

  const paint = (rawText: string, py: number, alpha: number) => {
    const text = lyrics.uppercase ? rawText.toUpperCase() : rawText
    // The layer opacity scales every pass (glow, outline, fill) uniformly.
    const a = alpha * baseOpacity
    if (!text || a <= 0.002) return

    ctx.save()
    ctx.globalAlpha = a
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // Shrink long sentences until they fit 92% of the canvas width.
    let px = lyrics.size * S
    ctx.font = `${lyrics.weight} ${px}px ${fontStack(lyrics.font)}`
    const maxW = width * 0.92
    const measured = ctx.measureText(text).width
    if (measured > maxW && measured > 0) {
      px = Math.max(10, px * (maxW / measured))
      ctx.font = `${lyrics.weight} ${px}px ${fontStack(lyrics.font)}`
    }
    const font = `${lyrics.weight} ${px}px ${fontStack(lyrics.font)}`

    // Hollow fill: no body is drawn, so the glow has to be a pure outward
    // halo baked from the full dilated glyph (see hollow-glow) — the old
    // pass's solid body would otherwise show through the empty fill.
    const hollow = lyrics.fill === 'empty'
    const strokePx = lyrics.outline && lyrics.outlineWidth > 0 ? lyrics.outlineWidth * S : 0

    // Glow halo: a colored pass under the crisp fill. Double-drawn so the
    // halo reads at low strengths too.
    if (lyrics.glow) {
      if (hollow) {
        drawHollowGlow(
          ctx,
          width / 2,
          py,
          text,
          font,
          px,
          (6 + 34 * clamp01(lyrics.glowStrength)) * S,
          lyrics.glowColor,
          strokePx,
        )
      } else {
        ctx.save()
        ctx.shadowColor = lyrics.glowColor
        ctx.shadowBlur = (6 + 34 * clamp01(lyrics.glowStrength)) * S
        ctx.fillStyle = lyrics.glowColor
        ctx.fillText(text, width / 2, py)
        ctx.fillText(text, width / 2, py)
        ctx.restore()
      }
    }

    // Outline stroke behind the fill.
    if (strokePx > 0) {
      ctx.lineWidth = strokePx
      ctx.strokeStyle = lyrics.outlineColor
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.strokeText(text, width / 2, py)
    }

    // Fill: palette sweep, flat color — or nothing at all when the fill is
    // empty and only the outline/glow should show.
    if (hollow) {
      ctx.restore()
      return
    }
    if (lyrics.fill === 'gradient' && fillPalette.stops.length > 0) {
      const tw = Math.max(ctx.measureText(text).width, 1)
      const th = px
      if (fillPalette.shape === 'radial') {
        // Palette radiates from the text's center out to its edges.
        ctx.fillStyle = buildRadialGradient(
          ctx,
          width / 2,
          py,
          Math.max(tw, th) / 2,
          fillPalette.stops,
          frame.styleTime,
          fillPalette.cycleColors,
          fillPalette.cycleSpeed,
        )
      } else {
        // Gradient line across the text's box (width = measured text, height =
        // current font size), rotated by the palette angle — 90° sweeps left to
        // right, 0° bottom to top. buildGradient honors stop positions and
        // applies the same ping-pong color cycling as everywhere else.
        const ln = gradientLine(fillPalette.angle, tw, th)
        ctx.fillStyle = buildGradient(
          ctx,
          width / 2 + ln.x0 - tw / 2,
          py + ln.y0 - th / 2,
          width / 2 + ln.x1 - tw / 2,
          py + ln.y1 - th / 2,
          fillPalette.stops,
          frame.styleTime,
          fillPalette.cycleColors,
          fillPalette.cycleSpeed,
        )
      }
    } else {
      ctx.fillStyle = lyrics.color
    }
    if (!lyrics.glow) {
      // Base readability shadow (skipped when the glow replaces it).
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
      ctx.shadowBlur = 12 * S
    }
    ctx.fillText(text, width / 2, py)
    ctx.restore()
  }

  for (let i = 0; i < lines.length; i++) {
    const start = lines[i].time
    if (start > t) continue
    const next = i + 1 < lines.length ? lines[i + 1] : null
    const next2 = i + 2 < lines.length ? lines[i + 2] : null

    let alpha = 0
    let y = yMain

    if (next === null || next.time >= start + hold) {
      // Never replaced in time: lives at the main slot, fades out after hold.
      alpha = clamp01((t - start) / fade) * clamp01((start + hold - t) / fade)
    } else {
      const replaceAt = next.time
      if (t < replaceAt) {
        // Current line: stays fully on screen until the next line arrives.
        alpha = clamp01((t - start) / fade)
      } else if (!lyrics.echo) {
        // Echo off: the line leaves the moment its replacement arrives —
        // the incoming line fades in at the same spot and masks the cut.
        continue
      } else {
        // Replaced: glide up to the echo slot while dimming to 0.6.
        const p = clamp01((t - replaceAt) / fade)
        y = yMain - gap * p
        alpha = 1 - 0.4 * p
        // Departure: pushed off completely the moment the line after this
        // one arrives (if it does so before the successor's hold expires);
        // otherwise it leaves together with the successor's auto-hide.
        const pushed = next2 !== null && next2.time <= replaceAt + hold
        const departAt = pushed ? next2.time : replaceAt + hold
        if (t >= departAt) {
          if (pushed) continue
          alpha *= clamp01((departAt - t) / fade)
        }
      }
    }
    paint(lines[i].text, y, alpha)
  }
}
