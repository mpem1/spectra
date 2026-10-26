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
 * Text can be filled with a flat color, a sweep of the visualizer palette,
 * or the lyrics' own gradient (angle-aware, respects stop positions), plus
 * optional outline stroke and glow halo. Long lines auto-shrink to fit.
 *
 * Deterministic — a pure function of (rc, frame, lyrics, palette).
 */
import type { AudioFrame, GradientConfig, LyricLine, LyricsConfig, RenderContext } from './types'
import { buildGradient, gradientLine } from './gradients'

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
    if (!text || alpha <= 0.002) return

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // Shrink long sentences until they fit 92% of the canvas width.
    let px = lyrics.size * S
    ctx.font = `${lyrics.weight} ${px}px ${family(lyrics.font)}`
    const maxW = width * 0.92
    const measured = ctx.measureText(text).width
    if (measured > maxW && measured > 0) {
      px = Math.max(10, px * (maxW / measured))
      ctx.font = `${lyrics.weight} ${px}px ${family(lyrics.font)}`
    }

    // Glow halo: a colored pass under the crisp fill. Double-drawn so the
    // halo reads at low strengths too.
    if (lyrics.glow) {
      ctx.save()
      ctx.shadowColor = lyrics.glowColor
      ctx.shadowBlur = (6 + 34 * clamp01(lyrics.glowStrength)) * S
      ctx.fillStyle = lyrics.glowColor
      ctx.fillText(text, width / 2, py)
      ctx.fillText(text, width / 2, py)
      ctx.restore()
    }

    // Outline stroke behind the fill.
    if (lyrics.outline && lyrics.outlineWidth > 0) {
      ctx.lineWidth = lyrics.outlineWidth * S
      ctx.strokeStyle = lyrics.outlineColor
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.strokeText(text, width / 2, py)
    }

    // Fill: palette sweep or flat color.
    if (lyrics.fill === 'gradient' && fillPalette.stops.length > 0) {
      // Gradient line across the text's box (width = measured text, height =
      // current font size), rotated by the palette angle — 90° sweeps left to
      // right, 0° bottom to top. buildGradient honors stop positions and
      // applies the same ping-pong color cycling as everywhere else.
      const tw = Math.max(ctx.measureText(text).width, 1)
      const th = px
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

function family(font: LyricsConfig['font']): string {
  return font === 'sans'
    ? 'system-ui, sans-serif'
    : font === 'serif'
      ? 'Georgia, serif'
      : 'monospace'
}
