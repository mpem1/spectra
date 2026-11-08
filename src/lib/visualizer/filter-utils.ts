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

/* ------------------------------ beat reactivity ------------------------------ */

/**
 * Beat-reactive boost shared by every full-frame filter ("React to beat" —
 * the filter twin of the background's beat bounce / beat shake / blur pulse).
 *
 * Opt-in via `beatReactive`: OFF returns exactly 1, so the filter renders
 * pixel-identical to before. ON, the multiplier rests at 1 while the song is
 * quiet ("normal till the beat") and punches up to `1 + strength * maxKick`
 * on a full low-end hit, driven by `frame.bass` — the same deterministic
 * AudioFrame field the background beat features use, so the live preview and
 * the offline export kick on the exact same frames.
 */
export function beatBoost(
  cfg: { beatReactive?: boolean; beatStrength?: number } | undefined,
  bass: number,
  maxKick: number,
): number {
  if (!cfg?.beatReactive) return 1
  const strength = clamp01(cfg.beatStrength ?? 0.5)
  return 1 + strength * clamp01(bass) * maxKick
}

/**
 * Gated additive beat amount — the companion to `beatBoost`. Where boost
 * MULTIPLIES a dial, `beatAmount` lets an effect ADD on top of the dialed-in
 * look: 0 when "React to beat" is off (or the low end is silent), up to
 * `strength` on a full kick. Additive reactions stay visible even when the
 * base dial sits near zero (a CRT with no color split still splits on the
 * beat), which a pure multiplier can never do.
 */
export function beatAmount(
  cfg: { beatReactive?: boolean; beatStrength?: number } | undefined,
  bass: number,
): number {
  if (!cfg?.beatReactive) return 0
  return clamp01(cfg.beatStrength ?? 0.5) * clamp01(bass)
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
