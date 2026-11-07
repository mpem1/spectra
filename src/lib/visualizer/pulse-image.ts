/**
 * Pulse image — a PNG/SVG logo that breathes with the music. The rest size
 * comes from the config; the live swell mixes bass (punch) and overall
 * energy (sustain) so it dances like the blob/radial styles do. Optional
 * spin (with a speed multiplier), an aura in the palette's or its own
 * color, a beat color overlay that washes the image from a quiet color at
 * silence to a loud color at full level, and an outline stroke traced
 * around the artwork's alpha silhouette — the glow shadow is cast by the
 * stroked composite, so the aura follows the outline. Deterministic:
 * everything derives from the AudioFrame + config.
 */
import type { AudioFrame, GradientConfig, PulseImageConfig, RenderContext } from './types'
import { getBackgroundImage } from './image-cache'
import { sampleGradient } from './gradients'

/* ----------------------------- beat tint utils ----------------------------- */

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** Parses #rgb / #rgba / #rrggbb / #rrggbbaa into RGB bytes (null if invalid). */
function parseHexRGB(css: string): [number, number, number] | null {
  let h = css.trim().replace(/^#/, '')
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6 && h.length !== 8) return null
  if (!/^[0-9a-fA-F]+$/.test(h)) return null
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/** Blends two CSS hex colors (t = 0 → a, t = 1 → b) into an rgba() string. */
function mixHex(a: string, b: string, t: number, alpha: number): string {
  const ca = parseHexRGB(a) ?? [255, 255, 255]
  const cb = parseHexRGB(b) ?? ca
  const k = clamp01(t)
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * k)
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * k)
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * k)
  return `rgba(${r}, ${g}, ${bl}, ${clamp01(alpha)})`
}

/* ------------------------------ sprite stages ------------------------------ */
/* Both stages are clipped to the image's own alpha shape via 'source-atop'
 * on scratch canvases, so transparent stays transparent. Both are cached by
 * image identity; scratch canvases are rebuilt each frame they are active
 * (a couple of drawImage/fillRect ops at natural size — cheap for logos).  */

/** One scratch canvas per source image for the beat color wash. */
const tintCanvases = new WeakMap<HTMLImageElement, HTMLCanvasElement>()

function tintSprite(img: HTMLImageElement, color: string): HTMLImageElement | HTMLCanvasElement {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (nw <= 0 || nh <= 0) return img // SVG without intrinsic size — leave untouched
  let oc = tintCanvases.get(img)
  if (!oc) {
    oc = document.createElement('canvas')
    oc.width = nw
    oc.height = nh
    tintCanvases.set(img, oc)
  }
  const og = oc.getContext('2d')
  if (!og) return img
  og.clearRect(0, 0, nw, nh)
  og.drawImage(img, 0, 0)
  og.globalCompositeOperation = 'source-atop'
  og.fillStyle = color
  og.fillRect(0, 0, nw, nh)
  og.globalCompositeOperation = 'source-over'
  return oc
}

/** One silhouette canvas per source image (alpha shape, recolored per frame). */
const silhouetteCanvases = new WeakMap<HTMLImageElement, HTMLCanvasElement>()

function silhouetteOf(img: HTMLImageElement, color: string): HTMLCanvasElement | null {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (nw <= 0 || nh <= 0) return null
  let sc = silhouetteCanvases.get(img)
  if (!sc) {
    sc = document.createElement('canvas')
    sc.width = nw
    sc.height = nh
    silhouetteCanvases.set(img, sc)
  }
  const sg = sc.getContext('2d')
  if (!sg) return null
  sg.clearRect(0, 0, nw, nh)
  sg.drawImage(img, 0, 0)
  sg.globalCompositeOperation = 'source-in'
  sg.fillStyle = color
  sg.fillRect(0, 0, nw, nh)
  sg.globalCompositeOperation = 'source-over'
  return sc
}

/**
 * Outline stroke: the silhouette is stamped in 16 directions around the
 * sprite (a cheap morphological dilation), so only the band just outside
 * the artwork's edge stays visible under the sprite. Lives on a padded
 * canvas (pad = stroke width) so the ring never clips. Cached by image +
 * pad; rebuilt when the width slider moves.
 */
const STAMP_DIRS = 16

interface PaddedEntry {
  canvas: HTMLCanvasElement
  pad: number
}
const paddedCanvases = new WeakMap<HTMLImageElement, PaddedEntry>()

function strokedComposite(
  img: HTMLImageElement,
  sprite: HTMLImageElement | HTMLCanvasElement,
  cfg: PulseImageConfig,
): HTMLCanvasElement | null {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (nw <= 0 || nh <= 0) return null
  const strokePx = clamp01(cfg.outlineWidth ?? 0.4) * 0.1 * Math.max(nw, nh)
  const pad = Math.max(1, Math.ceil(strokePx))
  let entry = paddedCanvases.get(img)
  if (!entry || entry.pad !== pad) {
    const oc = document.createElement('canvas')
    oc.width = nw + 2 * pad
    oc.height = nh + 2 * pad
    entry = { canvas: oc, pad }
    paddedCanvases.set(img, entry)
  }
  const oc = entry.canvas
  const og = oc.getContext('2d')
  if (!og) return null
  const sil = silhouetteOf(img, cfg.outlineColor || '#ffffff')
  if (!sil) return null

  og.clearRect(0, 0, oc.width, oc.height)
  for (let k = 0; k < STAMP_DIRS; k++) {
    const a = (k / STAMP_DIRS) * Math.PI * 2
    og.drawImage(sil, pad + Math.cos(a) * pad, pad + Math.sin(a) * pad)
  }
  // The artwork goes on top — only the band just outside its edge shows.
  og.drawImage(sprite, pad, pad)
  return oc
}

/* -------------------------------- the layer -------------------------------- */

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
  // Swell + beat color share one drive: bass gives the punch, energy the
  // sustain — up to +35% size at pulse 1, and the same level steers the
  // tint from the quiet color toward the loud one.
  const drive = Math.min(1, 0.6 * frame.bass + 0.4 * frame.energy)
  const swell = 1 + Math.min(1, Math.max(0, cfg.pulse)) * drive * 0.35
  const aspect = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1
  const h = base * swell
  const w = base * swell * (Number.isFinite(aspect) && aspect > 0 ? Math.min(4, aspect) : 1)

  const cx = (Math.min(100, Math.max(0, cfg.x)) / 100) * W
  const cy = (Math.min(100, Math.max(0, cfg.y)) / 100) * H

  // Stage 1 — beat color overlay: silence → tintLow, loudest hit → tintHigh,
  // with the strength slider capping how much of the color washes in.
  const tint = clamp01(cfg.tint ?? 0)
  let sprite: HTMLImageElement | HTMLCanvasElement = img
  if (tint > 0.001) {
    sprite = tintSprite(img, mixHex(cfg.tintLow ?? '#ff3b5c', cfg.tintHigh ?? '#2bffa8', drive, tint))
  }

  // Stage 2 — outline stroke: dilated silhouette ring on a padded canvas.
  // The glow shadow below is cast by whatever is drawn, so with the ring
  // on, the aura hugs the outline instead of the bare artwork.
  let source: HTMLImageElement | HTMLCanvasElement = sprite
  let pad = 0
  if (cfg.outline) {
    const oc = strokedComposite(img, sprite, cfg)
    if (oc) {
      source = oc
      pad = (oc.width - img.naturalWidth) / 2
    }
  }

  ctx.save()
  ctx.translate(cx, cy)
  if (cfg.spin) ctx.rotate(frame.styleTime * 0.45 * Math.max(0, cfg.spinSpeed ?? 1))
  if (cfg.glow) {
    // Aura color: either the visualizer palette at the image's height (so the
    // emblem stays glued to the scene's color story) or the glow's own color
    // when the user picked one. Missing mode = old save → palette tint.
    if ((cfg.glowColorMode ?? 'palette') === 'custom') {
      ctx.shadowColor = cfg.glowColor || '#ffffff'
    } else {
      const t = H > 0 ? cy / H : 0.5
      ctx.shadowColor = sampleGradient(
        gradient.stops,
        t,
        frame.styleTime,
        gradient.cycleColors,
        gradient.cycleSpeed,
      )
    }
    ctx.shadowBlur = Math.max(w, h) * 0.45
  }
  // Draw box grows with the stroke padding (stroke scales with the artwork).
  const nw = img.naturalWidth || 1
  const nh = img.naturalHeight || 1
  const dw = w * ((nw + 2 * pad) / nw)
  const dh = h * ((nh + 2 * pad) / nh)
  ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh)
  ctx.restore()
}
