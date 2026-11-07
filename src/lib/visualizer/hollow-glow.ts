/**
 * Pure-outward glow halo for hollow ("Empty" fill) text.
 *
 * When the text fill is empty there is no crisp fill drawn over the glow
 * pass, so the old glow technique (fill the glyph in the glow color and let
 * the crisp fill cover the body) would leave a solid glow-colored letter
 * behind. Instead the halo is baked the same way the pulse image glow is:
 * the full dilated glyph — body plus the outline stroke band when one is
 * enabled, so the halo follows the outermost visible contour — is drawn into
 * an offscreen layer with a heavy shadow, then the same shapes are punched
 * back out with 'destination-out'. Only the shadow that survived OUTSIDE the
 * contour remains: a soft halo radiating purely outward, hugging the glyph
 * edge, with the text interior left completely see-through.
 *
 * The layer is a single module-level scratch canvas that only ever grows —
 * the same scratch-canvas rule as the pulse image stages. Everything on it
 * is redrawn per call, so output is a pure function of the inputs and
 * exports render identical halos.
 */

let layer: HTMLCanvasElement | null = null
let layerCtx: CanvasRenderingContext2D | null = null

/**
 * Composite the outward-only glow halo for `text` centered at (x, y) — the
 * same anchor fillText would use with textAlign 'center' / baseline
 * 'middle'. The caller draws its crisp stroke (and fill, if any) afterwards
 * so the halo always sits underneath.
 *
 * @param font      full ctx.font string (must match the caller's crisp text)
 * @param px        font size in canvas px (sizes the layer)
 * @param blur      shadow blur radius in canvas px
 * @param glowColor halo color
 * @param strokeWidth outline stroke width in canvas px, 0 = plain glyph edge
 */
export function drawHollowGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  font: string,
  px: number,
  blur: number,
  glowColor: string,
  strokeWidth: number,
): void {
  if (!text || blur <= 0) return

  if (!layer) {
    layer = document.createElement('canvas')
    layerCtx = layer.getContext('2d')
  }
  const c = layerCtx
  if (!c) return

  c.font = font
  const tw = Math.ceil(c.measureText(text).width)
  if (tw <= 0 || !Number.isFinite(tw)) return

  // Pad: the blur reaches roughly 3× its radius; the stroke band sticks out
  // half its width. Generous but capped — canvas minimum guaranteed size.
  const pad = Math.ceil(blur * 1.5) + Math.ceil(strokeWidth) + 6
  const lw = Math.min(4096, tw + pad * 2)
  const lh = Math.min(4096, Math.ceil(px * 2.2) + pad * 2)
  if (lw < 4 || lh < 4) return
  if (layer.width < lw || layer.height < lh) {
    layer.width = lw // realloc clears — every call redraws from scratch anyway
    layer.height = lh
  }

  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
  c.clearRect(0, 0, lw, lh)
  c.font = font
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.lineJoin = 'round'
  c.miterLimit = 2

  const cx = lw / 2
  const cy = lh / 2

  // 1) Glow source: the full dilated shape in the glow color, double-drawn
  //    with a heavy shadow — the shadow is what becomes the halo.
  c.shadowColor = glowColor
  c.shadowBlur = blur
  c.fillStyle = glowColor
  c.strokeStyle = glowColor
  for (let i = 0; i < 2; i++) {
    if (strokeWidth > 0) {
      c.lineWidth = strokeWidth
      c.strokeText(text, cx, cy)
    }
    c.fillText(text, cx, cy)
  }

  // 2) Punch the same shapes back out — the solid body (and the shadow that
  //    hid underneath it) is erased, the interior stays clear, and only the
  //    outward shadow survives around the contour.
  c.globalCompositeOperation = 'destination-out'
  c.shadowBlur = 0
  c.fillStyle = '#000000'
  c.strokeStyle = '#000000'
  for (let i = 0; i < 2; i++) {
    if (strokeWidth > 0) {
      c.lineWidth = strokeWidth
      c.strokeText(text, cx, cy)
    }
    c.fillText(text, cx, cy)
  }

  // 3) Composite under the caller's crisp drawing (inherits its transform,
  //    so swivel/pulse already applied to ctx apply to the halo too).
  ctx.drawImage(layer, 0, 0, lw, lh, x - lw / 2, y - lh / 2, lw, lh)
}
