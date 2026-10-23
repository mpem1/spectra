/**
 * Pulse Studio — gradient & color helpers.
 *
 * Pure, dependency-free color utilities used by the renderer: CSS-style
 * gradient construction with time-based hue cycling, gradient sampling for
 * per-bar coloring, and alpha manipulation. Hex (#rgb, #rrggbb, plus optional
 * alpha suffix like #rrggbbaa) and rgb()/rgba() strings are understood;
 * anything else passes through untouched.
 */
import type { ColorStop } from './types'

interface Rgba {
  r: number
  g: number
  b: number
  /** Alpha 0..1 */
  a: number
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/* --------------------------------- Parsing --------------------------------- */

/** Parse a CSS color into floats. Returns null for unparseable colors. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase()
  if (s.startsWith('#')) return parseHex(s)
  if (s.startsWith('rgb')) return parseRgbFn(s)
  return null
}

function parseHex(s: string): Rgba | null {
  let hex = s.slice(1)
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (hex.length !== 6 && hex.length !== 8) return null
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)) return null
  return { r, g, b, a }
}

function parseRgbFn(s: string): Rgba | null {
  const inner = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')'))
  const parts = inner.replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean)
  if (parts.length < 3) return null
  const nums = parts.slice(0, 3).map(parseChannel)
  const [r, g, b] = nums
  if (r === null || g === null || b === null) return null
  let a = 1
  if (parts.length >= 4) {
    const raw = parts[3]
    if (raw.endsWith('%')) {
      const v = parseFloat(raw)
      if (Number.isNaN(v)) return null
      a = clamp(v / 100, 0, 1)
    } else {
      const v = parseFloat(raw)
      if (Number.isNaN(v)) return null
      a = clamp(v, 0, 1)
    }
  }
  return { r, g, b, a }
}

/** Parse one rgb() channel (number 0..255 or percentage). */
function parseChannel(raw: string): number | null {
  if (raw.endsWith('%')) {
    const v = parseFloat(raw)
    if (Number.isNaN(v)) return null
    return clamp(v, 0, 100) * 2.55
  }
  const v = parseFloat(raw)
  if (Number.isNaN(v)) return null
  return clamp(v, 0, 255)
}

/* ---------------------------- Conversions & CSS ----------------------------- */

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
    else if (max === gn) h = ((bn - rn) / d + 2) * 60
    else h = ((rn - gn) / d + 4) * 60
  }
  return { h, s, l }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hn = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1))
  const m = l - c / 2
  let rn = 0
  let gn = 0
  let bn = 0
  if (hn < 60) [rn, gn, bn] = [c, x, 0]
  else if (hn < 120) [rn, gn, bn] = [x, c, 0]
  else if (hn < 180) [rn, gn, bn] = [0, c, x]
  else if (hn < 240) [rn, gn, bn] = [0, x, c]
  else if (hn < 300) [rn, gn, bn] = [x, 0, c]
  else [rn, gn, bn] = [c, 0, x]
  return {
    r: Math.round((rn + m) * 255),
    g: Math.round((gn + m) * 255),
    b: Math.round((bn + m) * 255),
  }
}

function rgbaToCss(c: Rgba): string {
  const r = Math.round(clamp(c.r, 0, 255))
  const g = Math.round(clamp(c.g, 0, 255))
  const b = Math.round(clamp(c.b, 0, 255))
  const a = clamp(c.a, 0, 1)
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`
}

/* ------------------------------ Public helpers ------------------------------ */

/**
 * Rotate the hue of a color by `deg` degrees. Unparseable colors (e.g. named
 * CSS colors) are returned unchanged. Embedded alpha (#rrggbbaa) is preserved.
 */
export function hueRotate(color: string, deg: number): string {
  const c = parseColor(color)
  if (!c) return color
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b)
  const rotated = hslToRgb(h + deg, s, l)
  return rgbaToCss({ r: rotated.r, g: rotated.g, b: rotated.b, a: c.a })
}

/**
 * Return `color` with its alpha multiplied by `alpha` (0..1). Unparseable
 * colors are returned unchanged.
 */
export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color)
  if (!c) return color
  return rgbaToCss({ r: c.r, g: c.g, b: c.b, a: c.a * clamp(alpha, 0, 1) })
}

interface NormalizedStop {
  color: string
  position: number // 0..100
  alpha: number // 0..1 (stop.opacity)
}

function normalizeStops(stops: ColorStop[]): NormalizedStop[] {
  return stops
    .filter((s) => s && typeof s.color === 'string')
    .map((s) => ({
      color: s.color,
      position: clamp(s.position, 0, 100),
      alpha: clamp(s.opacity, 0, 100) / 100,
    }))
    .sort((a, b) => a.position - b.position)
}

/** Resolve one stop to a CSS color: hue-cycle (if cycling) then apply alpha. */
function stopColor(stop: NormalizedStop, hueShift: number, cycling: boolean): string {
  const base = cycling ? hueRotate(stop.color, hueShift) : stop.color
  return withAlpha(base, stop.alpha)
}

/**
 * Build a linear canvas gradient. Callers convert the config angle to canvas
 * coordinates themselves (see gradientLine) and pass the endpoints here.
 */
export function buildGradient(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: ColorStop[],
  time: number,
  cycle: boolean,
  cycleSpeed: number,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1)
  const normalized = normalizeStops(stops)
  if (normalized.length === 0) {
    gradient.addColorStop(0, '#ffffff')
    gradient.addColorStop(1, '#ffffff')
    return gradient
  }
  const hueShift = cycle ? time * cycleSpeed * 360 : 0
  for (const stop of normalized) {
    gradient.addColorStop(stop.position / 100, stopColor(stop, hueShift, cycle))
  }
  return gradient
}

/**
 * Interpolated color at t ∈ [0..1] along the stop list (for per-bar coloring).
 * Applies the same hue cycling as buildGradient so bars stay in sync.
 */
export function sampleGradient(
  stops: ColorStop[],
  t: number,
  time: number,
  cycle: boolean,
  cycleSpeed: number,
): string {
  const normalized = normalizeStops(stops)
  if (normalized.length === 0) return '#ffffff'
  if (normalized.length === 1) return stopColor(normalized[0], cycle ? time * cycleSpeed * 360 : 0, cycle)

  const pos = clamp(t, 0, 1) * 100
  const hueShift = cycle ? time * cycleSpeed * 360 : 0

  if (pos <= normalized[0].position) return stopColor(normalized[0], hueShift, cycle)
  const last = normalized[normalized.length - 1]
  if (pos >= last.position) return stopColor(last, hueShift, cycle)

  for (let i = 0; i < normalized.length - 1; i++) {
    const a = normalized[i]
    const b = normalized[i + 1]
    if (pos >= a.position && pos <= b.position) {
      const span = b.position - a.position
      const k = span <= 0 ? 0 : (pos - a.position) / span
      // Lerp in RGB space (alpha included), then apply hue cycling once.
      const ca = parseColor(a.color) ?? { r: 255, g: 255, b: 255, a: 1 }
      const cb = parseColor(b.color) ?? { r: 255, g: 255, b: 255, a: 1 }
      const mixed: Rgba = {
        r: ca.r + (cb.r - ca.r) * k,
        g: ca.g + (cb.g - ca.g) * k,
        b: ca.b + (cb.b - ca.b) * k,
        a: (ca.a + (cb.a - ca.a) * k) * (a.alpha + (b.alpha - a.alpha) * k),
      }
      return cycle ? rotateRgba(mixed, hueShift) : rgbaToCss(mixed)
    }
  }
  return stopColor(last, hueShift, cycle)
}

function rotateRgba(c: Rgba, deg: number): string {
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b)
  const rotated = hslToRgb(h + deg, s, l)
  return rgbaToCss({ r: rotated.r, g: rotated.g, b: rotated.b, a: c.a })
}

/**
 * Convert a CSS gradient angle (degrees, 0deg = to-top, 90deg = to-right) to
 * the linear-gradient line endpoints across a width×height box, centered.
 */
export function gradientLine(
  angle: number,
  width: number,
  height: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const rad = (angle * Math.PI) / 180
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad)
  // CSS gradient line length: perpendicular projection of the box.
  const len = Math.abs(width * dx) + Math.abs(height * dy)
  const cx = width / 2
  const cy = height / 2
  return {
    x0: cx - (dx * len) / 2,
    y0: cy - (dy * len) / 2,
    x1: cx + (dx * len) / 2,
    y1: cy + (dy * len) / 2,
  }
}
