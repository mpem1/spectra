/**
 * Corner watermark — a small logo image or @handle text drawn on the very
 * top layer (above lyrics/title) so posted videos stay credited. Exports
 * render through the same renderFrame call, so the watermark is always
 * included; the export pipelines preload the image via loadBackgroundImage
 * so frame 0 already carries it.
 */
import type { RenderContext, WatermarkConfig } from './types'
import { getBackgroundImage } from './image-cache'

/** Margin from the canvas edge, px relative to the 720p canvas. */
const MARGIN = 28

function anchor(
  position: WatermarkConfig['position'],
  W: number,
  H: number,
  w: number,
  h: number,
  m: number,
): { x: number; y: number } {
  switch (position) {
    case 'tl':
      return { x: m, y: m }
    case 'tr':
      return { x: W - m - w, y: m }
    case 'bl':
      return { x: m, y: H - m - h }
    case 'br':
    default:
      return { x: W - m - w, y: H - m - h }
  }
}

export function drawWatermark(rc: RenderContext, cfg: WatermarkConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const size = Math.max(16, cfg.size) * S
  const opacity = Math.min(1, Math.max(0.05, cfg.opacity))
  const margin = MARGIN * S
  const trimmed = (cfg.text ?? '').trim()

  // Image mode wins when a logo is set; otherwise a short text handle.
  if (cfg.imageSrc) {
    const img = getBackgroundImage(cfg.imageSrc)
    if (!img) return // still decoding — next preview frame picks it up
    const aspect = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1
    const h = size
    const w = size * (Number.isFinite(aspect) && aspect > 0 ? Math.min(4, aspect) : 1)
    const { x, y } = anchor(cfg.position, W, H, w, h, margin)
    ctx.save()
    ctx.globalAlpha = opacity
    ctx.drawImage(img, x, y, w, h)
    ctx.restore()
    return
  }

  if (trimmed.length === 0) return
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`
  const tw = ctx.measureText(trimmed).width
  const th = size * 1.05
  // anchor() places a left-aligned box of (tw × th) per corner — align the
  // fill to that box (left-aligned always; the corner math handles the rest).
  const { x, y } = anchor(cfg.position, W, H, tw, th, margin)
  // Soft shadow keeps the handle readable over bright scenes.
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = 6 * S
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(trimmed, x, y + th - th * 0.14)
  ctx.restore()
}
