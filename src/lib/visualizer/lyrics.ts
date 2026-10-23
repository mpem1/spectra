/**
 * Pulse Studio — timed lyric rendering.
 *
 * Pure drawing helper consumed by the renderer: picks the active line for a
 * given time and paints it with fade in/out envelopes. Deterministic — a pure
 * function of (rc, frame, lyrics).
 */
import type { AudioFrame, LyricLine, LyricsConfig, RenderContext } from './types'

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

/**
 * Draw the active lyric line (if any) for this frame. Alpha fades in over
 * `lyrics.fade` seconds after the line starts and fades out over the same
 * duration before the next line's time; the last line stays visible.
 */
export function drawLyrics(rc: RenderContext, frame: AudioFrame, lyrics: LyricsConfig): void {
  if (!lyrics.enabled || lyrics.lines.length === 0) return
  const index = findActiveLine(lyrics.lines, frame.time)
  if (index === -1) return

  const line = lyrics.lines[index]
  const next = index + 1 < lyrics.lines.length ? lyrics.lines[index + 1] : null
  const fade = Math.max(lyrics.fade, 0.001)
  const fadeIn = clamp01((frame.time - line.time) / fade)
  const fadeOut = next ? clamp01((next.time - frame.time) / fade) : 1
  const alpha = Math.min(fadeIn, fadeOut)
  if (alpha <= 0) return

  const { ctx, width, height } = rc
  const S = height / 720
  const family =
    lyrics.font === 'sans'
      ? 'system-ui, sans-serif'
      : lyrics.font === 'serif'
        ? 'Georgia, serif'
        : 'monospace'
  const text = lyrics.uppercase ? line.text.toUpperCase() : line.text
  if (!text) return

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = lyrics.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${lyrics.weight} ${lyrics.size * S}px ${family}`
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
  ctx.shadowBlur = 12 * S
  ctx.fillText(text, width / 2, (lyrics.positionY / 100) * height)
  ctx.restore()
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
