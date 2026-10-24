/**
 * Pulse Studio — timed lyric rendering.
 *
 * Paints a two-line karaoke stack: the current line sits bright at the chosen
 * position while the previous line lingers dimmed just above it, so two lines
 * share the screen and each new line appears underneath the last one. A line
 * that is never replaced fades out after `holdTime` seconds instead of
 * sticking around forever.
 *
 * Text can be filled with a flat color or with a sweep of the visualizer
 * palette (respecting cycle colors, deterministic via frame.styleTime), plus
 * optional outline stroke and glow halo. Long lines auto-shrink to fit.
 *
 * Deterministic — a pure function of (rc, frame, lyrics, palette).
 */
import type { AudioFrame, GradientConfig, LyricLine, LyricsConfig, RenderContext } from './types'
import { sampleGradient } from './gradients'

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

/** A line plus the instant its window closes (next line's start or start+hold). */
interface LyricWindow {
  line: LyricLine
  end: number
}

function lineWindow(lines: LyricLine[], index: number, holdTime: number): LyricWindow {
  const line = lines[index]
  const next = index + 1 < lines.length ? lines[index + 1] : null
  const end = Math.min(next ? next.time : Number.POSITIVE_INFINITY, line.time + holdTime)
  return { line, end }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * Draw the active lyric line for this frame with the previous line stacked
 * above it. Alpha envelopes: the current line fades in over `fade` seconds at
 * its start and fades out over `fade` seconds as its window closes (the next
 * line's start, or `holdTime` after its own start when nothing replaces it).
 * The previous line lingers dimmed above and leaves together with it.
 */
export function drawLyrics(
  rc: RenderContext,
  frame: AudioFrame,
  lyrics: LyricsConfig,
  palette: GradientConfig,
): void {
  if (!lyrics.enabled || lyrics.lines.length === 0) return
  const index = findActiveLine(lyrics.lines, frame.time)
  if (index === -1) return

  const fade = Math.max(lyrics.fade, 0.001)
  const hold = Math.max(lyrics.holdTime, 0.5)
  const cur = lineWindow(lyrics.lines, index, hold)
  const prev = index > 0 ? lineWindow(lyrics.lines, index - 1, hold) : null

  const curAlpha =
    clamp01((frame.time - cur.line.time) / fade) * clamp01((cur.end - frame.time) / fade)
  // Dimmed echo of the previous line, departing together with the current one.
  const prevAlpha = prev
    ? 0.55 *
      clamp01((frame.time - prev.line.time) / fade) *
      clamp01((cur.end - frame.time) / fade)
    : 0

  const { ctx, width, height } = rc
  const S = height / 720
  const family =
    lyrics.font === 'sans'
      ? 'system-ui, sans-serif'
      : lyrics.font === 'serif'
        ? 'Georgia, serif'
        : 'monospace'
  const y = (lyrics.positionY / 100) * height
  const gap = lyrics.size * 1.35 * S

  const paint = (rawText: string, py: number, alpha: number) => {
    const text = lyrics.uppercase ? rawText.toUpperCase() : rawText
    if (!text || alpha <= 0.002) return

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // Shrink long sentences until they fit 92% of the canvas width.
    let px = lyrics.size * S
    ctx.font = `${lyrics.weight} ${px}px ${family}`
    const maxW = width * 0.92
    const measured = ctx.measureText(text).width
    if (measured > maxW && measured > 0) {
      px = Math.max(10, px * (maxW / measured))
      ctx.font = `${lyrics.weight} ${px}px ${family}`
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
    if (lyrics.fill === 'gradient' && palette.stops.length > 0) {
      const tw = Math.max(ctx.measureText(text).width, 1)
      const g = ctx.createLinearGradient(
        width / 2 - tw / 2,
        0,
        width / 2 + tw / 2,
        0,
      )
      const STEPS = 8
      for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS
        g.addColorStop(
          t,
          sampleGradient(
            palette.stops,
            t,
            frame.styleTime,
            palette.cycleColors,
            palette.cycleSpeed,
          ),
        )
      }
      ctx.fillStyle = g
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

  // Previous line first so the current line paints on top of the stack.
  if (prev) paint(prev.line.text, y - gap, prevAlpha)
  paint(cur.line.text, y, curAlpha)
}
