/**
 * Spectra — shared cover-fit drawing used by the vinyl/CD faces and the
 * cassette label. Kept in its own module so disc.ts and cassette.ts can both
 * import it without a cycle (disc.ts dispatches to cassette.ts).
 */

/**
 * Cover-fit an image into a box (fills it, cropping overflow). An extra zoom
 * enlarges the art further, and fx/fy (0..1) pick which part of the art fills
 * the box — 0.5 keeps it centered, 0 shows its left/top edge, 1 its
 * right/bottom. The box is always fully covered — no empty gaps, ever.
 */
export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  zoom = 1,
  fx = 0.5,
  fy = 0.5,
): void {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (iw <= 0 || ih <= 0) return
  const scale = Math.max(w / iw, h / ih) * Math.max(1, zoom)
  const dw = iw * scale
  const dh = ih * scale
  const panX = (w - dw) * (fx < 0 ? 0 : fx > 1 ? 1 : fx)
  const panY = (h - dh) * (fy < 0 ? 0 : fy > 1 ? 1 : fy)
  ctx.drawImage(img, x + panX, y + panY, dw, dh)
}

/** Parse a #rgb / #rrggbb hex color to 0..1 channels (null on garbage). */
export function parseHex6(color: string): { r: number; g: number; b: number } | null {
  let c = color.trim().replace('#', '')
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]
  if (c.length !== 6 || /[^0-9a-fA-F]/.test(c)) return null
  return {
    r: parseInt(c.slice(0, 2), 16) / 255,
    g: parseInt(c.slice(2, 4), 16) / 255,
    b: parseInt(c.slice(4, 6), 16) / 255,
  }
}

/**
 * Lighten (amount > 0) or darken (amount < 0) a hex color toward white/black.
 * Falls back to the input string on anything unparseable — renderer colors
 * come from the color picker as #rrggbb, but a hand-typed config stays safe.
 */
export function shadeHex(color: string, amount: number): string {
  const c = parseHex6(color)
  if (!c) return color
  const t = amount < 0 ? 0 : 1
  const a = Math.min(1, Math.abs(amount))
  const mix = (v: number) => Math.round((v + (t - v) * a) * 255)
  return `rgb(${mix(c.r)}, ${mix(c.g)}, ${mix(c.b)})`
}

/** Rounded-rect path with a fallback for browsers without roundRect. */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

/**
 * Drop-shadow parameters behind the album-art faces (square cover, vinyl/CD
 * disc, cassette) from the depth (0..100) and angle (degrees) sliders.
 * Depth drives reach, blur and darkness together — depth 100 is a huge,
 * unmistakable shadow (52px reach, 110px blur, 0.95 alpha at 720p) while 0
 * returns null so callers skip the shadow pass entirely. Angle aims the
 * offset around the clock (90 = straight down). Color is applied by callers
 * via withAlpha() — a black shadow is invisible on near-black backgrounds,
 * so the panel offers a color picker too.
 */
export function faceShadow(
  depth: number,
  angle: number,
  S: number,
): { dx: number; dy: number; blur: number; alpha: number } | null {
  const d = Math.max(0, Math.min(100, Number.isFinite(depth) ? depth : 55)) / 100
  if (d <= 0.001) return null
  const rad = ((Number.isFinite(angle) ? angle : 90) * Math.PI) / 180
  return {
    dx: Math.cos(rad) * d * 52 * S,
    dy: Math.sin(rad) * d * 52 * S,
    blur: d * 110 * S,
    alpha: 0.32 + d * 0.63,
  }
}

/**
 * Two-layer face shadow — the silhouette is filled twice:
 * 1. a TIGHT contact shadow (short offset, small blur, near-opaque) that
 *    hugs the edge, so the shadow reads even on very dark backgrounds;
 * 2. the main soft throw at full depth/blur — the big cinematic one.
 * Callers pass a buildPath() closure (path only, no fill) plus the opaque
 * silhouette color; the real face art overdraws the silhouette right after,
 * so the intermediate fills never show.
 */
export function paintFaceShadow(
  ctx: CanvasRenderingContext2D,
  buildPath: () => void,
  fillColor: string,
  color: string,
  depth: number,
  angle: number,
  S: number,
): void {
  const sh = faceShadow(depth, angle, S)
  if (!sh) return
  const passes = [
    // Contact layer: glued to the edge, makes the ANGLE legible.
    { dx: sh.dx * 0.4, dy: sh.dy * 0.4, blur: sh.blur * 0.3, alpha: Math.min(1, sh.alpha + 0.2) },
    // Main layer: the big soft throw.
    { dx: sh.dx, dy: sh.dy, blur: sh.blur, alpha: sh.alpha },
  ]
  for (const p of passes) {
    ctx.save()
    ctx.shadowColor = withAlpha(color || '#000000', p.alpha)
    ctx.shadowBlur = p.blur
    ctx.shadowOffsetX = p.dx
    ctx.shadowOffsetY = p.dy
    buildPath()
    ctx.fillStyle = fillColor
    ctx.fill()
    ctx.restore()
  }
}

/** Apply an alpha to a #hex color (black fallback for anything unparseable). */
export function withAlpha(color: string, alpha: number): string {
  const c = parseHex6(color)
  if (!c) return `rgba(0, 0, 0, ${alpha})`
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`
}
