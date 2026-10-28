/**
 * Spectra — title card rendering.
 *
 * A free-floating text card (song title, artist, channel name…) that lives in
 * its own time window: it fades in at `startTime`, holds for `duration`
 * seconds, then fades out. Multi-line via \n; every line auto-shrinks so the
 * widest one fits 92% of the canvas.
 *
 * Fill mirrors the lyrics design language: flat color, a sweep of the
 * visualizer palette, or the title's own gradient (angle-aware, honors stop
 * positions and ping-pong color cycling) — plus optional outline stroke and
 * glow halo. The card is positioned freely via positionX/positionY (0..100,
 * 50/50 = dead center).
 *
 * Deterministic — a pure function of (rc, frame, title, palette).
 */
import type { AudioFrame, GradientConfig, RenderContext, TitleConfig } from './types'
import { buildGradient, buildRadialGradient, gradientLine } from './gradients'

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function drawTitle(
  rc: RenderContext,
  frame: AudioFrame,
  title: TitleConfig,
  palette: GradientConfig,
): void {
  if (!title.enabled) return
  const raw = title.uppercase ? title.text.toUpperCase() : title.text
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return

  const { ctx, width, height } = rc
  const S = height / 720
  const t = frame.time

  // Visibility window with soft edges. Strictly outside → nothing to draw.
  const start = Math.max(0, title.startTime)
  const end = start + Math.max(title.duration, 0.1)
  if (t < start || t >= end) return
  const fade = Math.max(title.fade, 0.001)
  const alpha = clamp01((t - start) / fade) * clamp01((end - t) / fade)
  if (alpha <= 0.002) return

  // Gradient sweep source: the visualizer palette, or the title's own
  // gradient when the user picked Custom.
  const fillPalette =
    title.fill === 'gradient' && title.gradientMode === 'custom' ? title.gradient : palette

  const cx = (title.positionX / 100) * width
  const lineH = title.size * 1.25 * S
  const cy = (title.positionY / 100) * height

  // Auto-shrink the block until its widest line fits 92% of the canvas.
  const fontFor = (size: number) => `${title.weight} ${size}px ${family(title.font)}`
  let px = title.size * S
  ctx.save()
  ctx.font = fontFor(px)
  const maxW = width * 0.92
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), 1)
  if (widest > maxW && widest > 0) {
    px = Math.max(10, px * (maxW / widest))
    ctx.font = fontFor(px)
  }

  const paint = (text: string, x: number, py: number) => {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // Glow halo: a colored pass under the crisp fill. Double-drawn so the
    // halo reads at low strengths too.
    if (title.glow) {
      ctx.save()
      ctx.shadowColor = title.glowColor
      ctx.shadowBlur = (6 + 34 * clamp01(title.glowStrength)) * S
      ctx.fillStyle = title.glowColor
      ctx.fillText(text, x, py)
      ctx.fillText(text, x, py)
      ctx.restore()
    }

    // Outline stroke behind the fill.
    if (title.outline && title.outlineWidth > 0) {
      ctx.lineWidth = title.outlineWidth * S
      ctx.strokeStyle = title.outlineColor
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.strokeText(text, x, py)
    }

    // Fill: palette sweep or flat color.
    if (title.fill === 'gradient' && fillPalette.stops.length > 0) {
      const tw = Math.max(ctx.measureText(text).width, 1)
      const th = px
      if (fillPalette.shape === 'radial') {
        // Palette radiates from the line's center out to its edges.
        ctx.fillStyle = buildRadialGradient(
          ctx,
          x,
          py,
          Math.max(tw, th) / 2,
          fillPalette.stops,
          frame.styleTime,
          fillPalette.cycleColors,
          fillPalette.cycleSpeed,
        )
      } else {
        // Gradient line across the text's box, rotated by the palette angle —
        // same semantics as the lyrics sweep.
        const ln = gradientLine(fillPalette.angle, tw, th)
        ctx.fillStyle = buildGradient(
          ctx,
          x + ln.x0 - tw / 2,
          py + ln.y0 - th / 2,
          x + ln.x1 - tw / 2,
          py + ln.y1 - th / 2,
          fillPalette.stops,
          frame.styleTime,
          fillPalette.cycleColors,
          fillPalette.cycleSpeed,
        )
      }
    } else {
      ctx.fillStyle = title.color
    }
    if (!title.glow) {
      // Base readability shadow (skipped when the glow replaces it).
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
      ctx.shadowBlur = 12 * S
    }
    ctx.fillText(text, x, py)
    ctx.restore()
  }

  // Stack lines around the vertical anchor so the block stays centered.
  const blockH = (lines.length - 1) * lineH
  for (let i = 0; i < lines.length; i++) {
    paint(lines[i], cx, cy - blockH / 2 + i * lineH)
  }
  ctx.restore()
}

function family(font: TitleConfig['font']): string {
  return font === 'sans'
    ? 'system-ui, sans-serif'
    : font === 'serif'
      ? 'Georgia, serif'
      : 'monospace'
}
