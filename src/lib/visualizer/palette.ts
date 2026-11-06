/**
 * Auto-palette — pull a gradient color set straight from the album art.
 *
 * Loads the cover image into a tiny offscreen canvas, counts quantized
 * colors, then greedily picks the most frequent ones that are far enough
 * apart to read as distinct gradient stops. Deterministic: the same image
 * always produces the same palette. Data-URL images (the only kind the
 * studio uploads) never taint the canvas, so pixel access is always safe.
 */
import type { ColorStop } from './types'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

function toHex(r: number, g: number, b: number): string {
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/** Relative luminance 0..1 — used to order stops dark → light. */
function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

interface Bucket {
  count: number
  r: number
  g: number
  b: number
}

/**
 * Extract `count` dominant, visually distinct colors from an image and
 * return them as gradient stops positioned evenly 0..100 (dark → light).
 * Monochrome covers still yield a usable ramp: missing slots are filled
 * with lightened / darkened variants of the dominant color.
 */
export async function extractPaletteFromArt(src: string, count = 4): Promise<ColorStop[]> {
  const img = await loadImage(src)
  const N = 64
  const canvas = document.createElement('canvas')
  canvas.width = N
  canvas.height = N
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(img, 0, 0, N, N)
  const { data } = ctx.getImageData(0, 0, N, N)

  // Quantize to 12-bit keys (4 bits per channel) and average true colors
  // per bucket for better fidelity than raw quantized values.
  const buckets = new Map<number, Bucket>()
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? 0
    if (a < 125) continue
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.count++
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else {
      buckets.set(key, { count: 1, r, g, b })
    }
  }
  if (buckets.size === 0) throw new Error('no opaque pixels')

  const ranked = [...buckets.values()]
    .map((bk) => ({ count: bk.count, r: bk.r / bk.count, g: bk.g / bk.count, b: bk.b / bk.count }))
    .sort((a, b) => b.count - a.count)

  // Greedy pick: most frequent first, skipping colors too close to what is
  // already picked. The threshold relaxes if the art is genuinely simple so
  // we always return something sensible.
  const picked: Bucket[] = []
  let minDist = 84
  while (picked.length < count && minDist > 8) {
    for (const cand of ranked) {
      if (picked.length >= count) break
      const far = picked.every((p) => {
        const dr = p.r - cand.r
        const dg = p.g - cand.g
        const db = p.b - cand.b
        return Math.sqrt(dr * dr + dg * dg + db * db) >= minDist
      })
      if (far) picked.push(cand)
    }
    minDist -= 16
  }

  // Guarantee a usable ramp even for single-color art.
  if (picked.length === 1) {
    const [p] = picked
    picked.push(
      { count: 0, r: Math.min(255, p.r * 0.45), g: Math.min(255, p.g * 0.45), b: Math.min(255, p.b * 0.45) },
      { count: 0, r: Math.min(255, p.r * 1.6 + 40), g: Math.min(255, p.g * 1.6 + 40), b: Math.min(255, p.b * 1.6 + 40) },
    )
  }

  // Order dark → light so the sweep reads naturally bottom → top.
  picked.sort(
    (a, b) => luminance(a.r, a.g, a.b) - luminance(b.r, b.g, b.b),
  )

  const n = picked.length
  return picked.map((p, i) => ({
    color: toHex(Math.round(p.r), Math.round(p.g), Math.round(p.b)),
    position: n > 1 ? Math.round((i / (n - 1)) * 100) : 50,
    opacity: 100,
  }))
}
