/**
 * Pulse image — a PNG/SVG logo that breathes with the music. The rest size
 * comes from the config; the live swell mixes bass (punch) and overall
 * energy (sustain) so it dances like the blob/radial styles do. Optional
 * spin (with a speed multiplier), an aura in the palette's or its own
 * color, and a beat color overlay that washes the image from a quiet
 * color at silence to a loud color at full level. Deterministic:
 * everything derives from the AudioFrame + config.
 */
import type { AudioFrame, GradientConfig, PulseImageConfig, RenderContext } from './types'
import { getBackgroundImage } from './image-cache'
import { sampleGradient } from './gradients'

/* ----------------------------- beat tint utils ----------------------------- */

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
  const k = Math.min(1, Math.max(0, t))
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * k)
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * k)
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * k)
  const al = Math.min(1, Math.max(0, alpha))
  return `rgba(${r}, ${g}, ${bl}, ${al})`
}

/**
 * One scratch canvas per source image (cached by identity) so the tint can
 * be clipped to the image's own alpha shape: draw the sprite, then fill it
 * 'source-atop' — transparent stays transparent, the artwork is washed in
 * the beat color. Rebuilt every frame the tint is active (it's cheap:
 * one drawImage + one fillRect at natural size).
 */
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

  // Beat color overlay: silence → tintLow, loudest hit → tintHigh, with the
  // strength slider capping how much of the color washes in (0 = untouched).
  const tint = Math.min(1, Math.max(0, cfg.tint ?? 0))
  let source: HTMLImageElement | HTMLCanvasElement = img
  if (tint > 0.001) {
    source = tintSprite(img, mixHex(cfg.tintLow ?? '#ff3b5c', cfg.tintHigh ?? '#2bffa8', drive, tint))
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
  ctx.drawImage(source, -w / 2, -h / 2, w, h)
  ctx.restore()
}
