/**
 * Pulse image — a PNG/SVG logo that breathes with the music. The rest size
 * comes from the config; the live swell mixes bass (punch) and overall
 * energy (sustain) so it dances like the blob/radial styles do. Optional
 * slow spin and a palette-tinted aura keep it glued to the scene's look.
 * Deterministic: everything derives from the AudioFrame + config.
 */
import type { AudioFrame, GradientConfig, PulseImageConfig, RenderContext } from './types'
import { getBackgroundImage } from './image-cache'
import { sampleGradient } from './gradients'

export function drawPulseImage(
  rc: RenderContext,
  frame: AudioFrame,
  cfg: PulseImageConfig,
  gradient: GradientConfig,
  S: number,
): void {
  const { ctx, width: W, height: H } = rc
  if (!cfg.imageSrc) return
  const img = getBackgroundImage(cfg.imageSrc)
  if (!img) return // still decoding — the next preview frame picks it up

  const base = (Math.max(4, Math.min(100, cfg.size)) / 100) * H
  // Swell: bass gives the punch, energy the sustain — up to +35% at pulse 1.
  const drive = Math.min(1, 0.6 * frame.bass + 0.4 * frame.energy)
  const swell = 1 + Math.min(1, Math.max(0, cfg.pulse)) * drive * 0.35
  const aspect = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1
  const h = base * swell
  const w = base * swell * (Number.isFinite(aspect) && aspect > 0 ? Math.min(4, aspect) : 1)

  const cx = (Math.min(100, Math.max(0, cfg.x)) / 100) * W
  const cy = (Math.min(100, Math.max(0, cfg.y)) / 100) * H

  ctx.save()
  ctx.translate(cx, cy)
  if (cfg.spin) ctx.rotate(frame.styleTime * 0.45)
  if (cfg.glow) {
    // Aura tinted by the visualizer palette at the image's height so the
    // emblem never looks detached from the scene's color story.
    const t = H > 0 ? cy / H : 0.5
    ctx.shadowColor = sampleGradient(
      gradient.stops,
      t,
      frame.styleTime,
      gradient.cycleColors,
      gradient.cycleSpeed,
    )
    ctx.shadowBlur = Math.max(w, h) * 0.45
  }
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
  ctx.restore()
}
