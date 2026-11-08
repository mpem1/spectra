/**
 * Shared helpers for the time-based full-frame filters (VHS, film).
 *
 * The renderer contract is determinism: same (frame, config) → same pixels.
 * These effects need "random" tape/film behavior, so instead of Math.random
 * they derive everything from INTEGER HASHING of stable inputs (band index,
 * speck index, quantized song time). Same song second always produces the
 * same noise pattern — live preview and offline export agree frame-exactly.
 */

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * Deterministic 2-integer hash → [0, 1). Pure integer mixing (imul/xorshift),
 * so every browser and every run computes the exact same values.
 */
export function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) | 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** Film-frame / tape-frame seed: song time quantized to `fps` steps. */
export function frameSeed(time: number, fps: number): number {
  return Math.floor(time * fps)
}

/* ------------------------------- work canvases ------------------------------- */

/** Offscreen canvases shared by the new filters, addressed by name. */
const works = new Map<string, HTMLCanvasElement>()

export function getWork(key: string, w: number, h: number): HTMLCanvasElement {
  let canvas = works.get(key)
  if (!canvas) {
    canvas = document.createElement('canvas')
    works.set(key, canvas)
  }
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  return canvas
}

/** Reset a work context to the plain draw state before reusing it. */
export function resetWork(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
  if ('filter' in ctx) ctx.filter = 'none'
  return ctx
}
