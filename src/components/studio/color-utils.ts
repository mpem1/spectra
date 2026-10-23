import type { ColorStop } from '@/lib/visualizer/types'

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function fromHex(hex: string): Rgba | null {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3 || h.length === 4) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (h.length !== 6 && h.length !== 8) return null
  if (!/^[0-9a-fA-F]+$/.test(h)) return null
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  return { r, g, b, a }
}

function fromRgbFunc(str: string): Rgba | null {
  const m = str.match(/^rgba?\(([^)]+)\)$/i)
  if (!m) return null
  const parts = m[1].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return null
  const r = parseFloat(parts[0])
  const g = parseFloat(parts[1])
  const b = parseFloat(parts[2])
  const a = parts.length >= 4 ? parseFloat(parts[3]) : 1
  if ([r, g, b, a].some(Number.isNaN)) return null
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b), a: clamp01(a) }
}

/** Parses "#rgb", "#rrggbb", "#rrggbbaa", "rgb(...)", "rgba(...)" into Rgba. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim()
  if (s.startsWith('#')) return fromHex(s)
  if (s.toLowerCase().startsWith('rgb')) return fromRgbFunc(s)
  return null
}

/** 6-digit lowercase hex of the RGB channels (alpha dropped). */
export function toHex6(rgb: Rgba): string {
  const hex = (v: number) => clampByte(v).toString(16).padStart(2, '0')
  return `#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}`
}

function hex2(v: number): string {
  return clampByte(Math.round(v * 255))
    .toString(16)
    .padStart(2, '0')
}

/** Returns "#rrggbb" when alpha = 1, otherwise "#rrggbbaa". */
export function withAlpha(color: string, alpha01: number): string {
  const parsed = parseColor(color) ?? { r: 255, g: 255, b: 255, a: 1 }
  const a = clamp01(alpha01)
  if (a >= 1) return toHex6(parsed)
  return `${toHex6(parsed)}${hex2(a)}`
}

/** Returns the alpha channel (0..1) of a CSS color string. */
export function alphaOf(color: string): number {
  const parsed = parseColor(color)
  return parsed ? parsed.a : 1
}

/** CSS rgba() string, for swatches / CSS gradient previews. */
export function toCss(color: string): string {
  const parsed = parseColor(color)
  if (!parsed) return color
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${Number(parsed.a.toFixed(3))})`
}

/** CSS linear-gradient preview at 90deg from a stop list. */
export function gradientCss(stops: ColorStop[], angle = 90): string {
  const parts = [...stops]
    .sort((a, b) => a.position - b.position)
    .map((s) => `${toCss(s.color)} ${Math.max(0, Math.min(100, s.position))}%`)
  if (parts.length === 0) return 'transparent'
  return `linear-gradient(${angle}deg, ${parts.join(', ')})`
}
