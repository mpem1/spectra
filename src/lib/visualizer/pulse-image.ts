/**
 * Pulse image — a PNG/SVG logo that breathes with the music. The rest size
 * comes from the config; the live swell mixes bass (punch) and overall
 * energy (sustain) so it dances like the blob/radial styles do. Optional
 * spin (with a speed multiplier), an aura in the palette's or its own
 * color, a beat color overlay that washes the image from a quiet color at
 * silence to a loud color at full level, and an outline ring stamped from
 * the artwork's alpha silhouette and painted BEHIND the image — only the
 * band outside its edge, so the artwork keeps every pixel of detail at any
 * stroke width. The glow shadow is cast by the ring, so the aura follows
 * the outline. Deterministic: everything derives from the AudioFrame +
 * config.
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
/* Scratch canvases are cached by image identity: the tint wash recolors per
 * frame via 'source-atop' (transparent stays transparent), the punch stencil
 * is built once, and the outline ring rebuilds only when width/color move —
 * all a handful of drawImage/fillRect ops at natural size, cheap for logos. */

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
 * Punch stencil: the artwork's alpha stacked 8× toward opaque (0.45 →
 * ~0.996, 0.3 → ~0.94). Used to cut the ring, so translucent fills (glass,
 * baked shadows, soft overlays) don't pick up the paint behind them, while
 * the anti-aliased edge keeps a whisper of paint so the ring hugs the
 * artwork without a seam. Built once per image.
 */
const punchStencils = new WeakMap<HTMLImageElement, HTMLCanvasElement>()

function punchStencilOf(img: HTMLImageElement): HTMLCanvasElement | null {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (nw <= 0 || nh <= 0) return null
  let pc = punchStencils.get(img)
  if (!pc) {
    pc = document.createElement('canvas')
    pc.width = nw
    pc.height = nh
    const pg = pc.getContext('2d')
    if (!pg) return null
    for (let k = 0; k < 8; k++) pg.drawImage(img, 0, 0)
    punchStencils.set(img, pc)
  }
  return pc
}

/**
 * Outline ring: the silhouette is stamped on rings from the edge out to
 * the stroke width (a proper morphological dilation — the old single-ring
 * stamp scalloped at wide strokes), then the artwork's own footprint is
 * punched back out ('destination-out'), leaving ONLY the band just
 * outside the edge. The ring is drawn as its own layer BEHIND the
 * artwork, so nothing is ever painted beneath its pixels — transparent
 * holes and translucent fills stay clean no matter how wide the stroke
 * gets. Lives on a padded canvas (pad = stroke width) so the ring never
 * clips. Cached by image + width + color; rebuilt only when a slider or
 * the color moves.
 */
const RING_DIRS = 24

interface RingEntry {
  canvas: HTMLCanvasElement
  pad: number
  color: string
}
const ringCanvases = new WeakMap<HTMLImageElement, RingEntry>()

function outlineRing(img: HTMLImageElement, cfg: PulseImageConfig): HTMLCanvasElement | null {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (nw <= 0 || nh <= 0) return null // SVG without intrinsic size — skip
  const strokePx = clamp01(cfg.outlineWidth ?? 0.4) * 0.1 * Math.max(nw, nh)
  const pad = Math.max(1, Math.ceil(strokePx))
  const color = cfg.outlineColor || '#ffffff'
  const cached = ringCanvases.get(img)
  if (cached && cached.pad === pad && cached.color === color) return cached.canvas

  const sil = silhouetteOf(img, color)
  if (!sil) return null
  const oc = document.createElement('canvas')
  oc.width = nw + 2 * pad
  oc.height = nh + 2 * pad
  const og = oc.getContext('2d')
  if (!og) return null

  // Dilate: stamp the silhouette on rings out to the stroke width. The
  // radial step widens on very large strokes to keep the one-off rebuild
  // cheap — playback always reuses the cached canvas.
  const radial = pad > 48 ? 3 : pad > 16 ? 2 : 1
  for (let r = radial; r <= pad; r += radial) {
    for (let k = 0; k < RING_DIRS; k++) {
      const a = (k / RING_DIRS) * Math.PI * 2
      og.drawImage(sil, pad + Math.cos(a) * r, pad + Math.sin(a) * r)
    }
  }
  // Punch the artwork's own footprint back out (alpha boosted toward
  // opaque) — the ring keeps only what lies OUTSIDE the artwork's pixels,
  // so as a layer behind the image it never bleeds through translucent
  // fills, and holes only show paint where a nearby edge's outline
  // legitimately reaches.
  const stencil = punchStencilOf(img)
  if (!stencil) return null
  og.globalCompositeOperation = 'destination-out'
  og.drawImage(stencil, pad, pad)
  og.globalCompositeOperation = 'source-over'

  const entry: RingEntry = { canvas: oc, pad, color }
  ringCanvases.set(img, entry)
  return entry.canvas
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

  // Stage 2 — outline ring: only the band OUTSIDE the artwork's edge,
  // drawn as its own layer BEHIND the image. Nothing sits beneath the
  // artwork's interior, so its detail survives any stroke width. With
  // glow on, the shadow cast by this ring IS the aura — it hugs the
  // outline instead of the bare artwork.
  const ring = cfg.outline ? outlineRing(img, cfg) : null

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
  const nw = img.naturalWidth || 1
  const nh = img.naturalHeight || 1
  if (ring) {
    // Ring box = artwork box plus the stroke on every side; drawn first,
    // under the sprite. Then the shadow is dropped so the artwork itself
    // doesn't cast a second, competing aura.
    const rw = w * (ring.width / nw)
    const rh = h * (ring.height / nh)
    ctx.drawImage(ring, -rw / 2, -rh / 2, rw, rh)
    if (cfg.glow) {
      ctx.shadowColor = 'rgba(0,0,0,0)'
      ctx.shadowBlur = 0
    }
  }
  ctx.drawImage(sprite, -w / 2, -h / 2, w, h)
  ctx.restore()
}
