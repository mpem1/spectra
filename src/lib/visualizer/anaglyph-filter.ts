/**
 * Anaglyph filter — the old-school paper 3D-glasses look.
 *
 * The finished picture is re-projected twice and the copies drift apart
 * horizontally: the LEFT copy is tinted by the left-lens colors (multiply),
 * the RIGHT copy by the right-lens colors. Each side can carry 1–4 tints —
 * the tinted copies are averaged into that side's image (so two tints look
 * like wearing two pairs of glasses at once, at half strength each), then
 * the two side images are summed back with 'lighter' so their overlap
 * recomposes the picture while everything near high-contrast edges wears
 * the tint fringes. The default red/cyan pair is the authentic paper-glasses
 * look; any other pairs restyle it (green/magenta, blue/amber, full-color
 * trios like red+green / blue).
 *
 *   depth      — base separation, the amount of 3D-ness (up to 2.5× the
 *                classic amount for a wide-POP stereo look)
 *   reactivity — how much the song's low end pushes the copies apart, so
 *                the 3D pops on beats (gated by beatReactive — off gives a
 *                fixed, steady separation; frame.bass ships in AudioFrame,
 *                so the live preview and the offline exporter pop identically)
 *   strength   — blend of the anaglyph back over the untouched picture
 *
 * The un-overlapped strips at the frame edges keep tinted content (left
 * tints only on the left, right tints only on the right) instead of black
 * bars — the authentic anaglyph border fringe. Deterministic: no
 * Math.random / Date.now anywhere, same (frame, config) → same pixels in
 * preview, MP4 and PNG exports. Transparent backgrounds skip the pass
 * (alpha must stay clean).
 */
import type { AudioFrame, RenderContext, AnaglyphFilterConfig } from './types'
import { getWork, resetWork } from './filter-utils'

/** Tints per side — hard cap so a hand-edited project can't spawn 100 passes. */
const MAX_TINTS = 4

const DEFAULT_LEFT: string[] = ['#ff0000']
const DEFAULT_RIGHT: string[] = ['#00ffff']

/** The classic default tint for a side when its list is missing/empty. */
function defaultFor(side: 'left' | 'right'): string[] {
  return side === 'left' ? DEFAULT_LEFT : DEFAULT_RIGHT
}

/** Sanitize a saved tint list: strings only, opaque hex (8-digit hex is
 *  truncated to 6 — a translucent lens would half-apply the multiply),
 *  deduped, capped. Empty/invalid → that side's classic default. */
function tintList(raw: string[] | undefined, side: 'left' | 'right'): string[] {
  const seen = new Set<string>()
  const list: string[] = []
  for (const c of Array.isArray(raw) ? raw : []) {
    if (typeof c !== 'string') continue
    const hex = /^#[0-9a-fA-F]{8}$/.test(c) ? c.slice(0, 7) : c
    const key = hex.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    list.push(hex)
    if (list.length >= MAX_TINTS) break
  }
  return list.length > 0 ? list : defaultFor(side)
}

/** Copy `snap` into `work` keeping only one tint (multiply by a color zeroes
 *  whatever the color doesn't pass — red passes red, cyan passes green+blue).
 *  Same trick as the CRT filter. */
function channelize(
  work: HTMLCanvasElement,
  snap: HTMLCanvasElement,
  color: string,
  w: number,
  h: number,
): void {
  const c = resetWork(work.getContext('2d')!)
  c.clearRect(0, 0, w, h)
  c.drawImage(snap, 0, 0)
  c.globalCompositeOperation = 'multiply'
  c.fillStyle = color
  c.fillRect(0, 0, w, h)
  c.globalCompositeOperation = 'source-over'
}

/**
 * Average every tint of one side into `acc`: each tint colors its own copy
 * of the snapshot, the copies are summed with 'lighter' at alpha 1/count, so
 * the side image is the MEAN of the tinted passes — one tint reproduces the
 * classic lens exactly, two tints = two lenses averaged (no blowout), and
 * matching pairs across sides can still recompose full color in the overlap.
 */
function accumulateSide(
  acc: HTMLCanvasElement,
  snap: HTMLCanvasElement,
  tint: HTMLCanvasElement,
  colors: string[],
  w: number,
  h: number,
): void {
  const ac = resetWork(acc.getContext('2d')!)
  ac.clearRect(0, 0, w, h)
  ac.globalCompositeOperation = 'lighter'
  const alpha = 1 / colors.length
  for (const color of colors) {
    channelize(tint, snap, color, w, h)
    ac.globalAlpha = alpha
    ac.drawImage(tint, 0, 0)
  }
  ac.globalCompositeOperation = 'source-over'
  ac.globalAlpha = 1
}

export function drawAnaglyphFilter(
  rc: RenderContext,
  cfg: AnaglyphFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  const S = H / 720
  const depth = Math.min(2.5, Math.max(0, cfg.depth))
  const reactivity = Math.min(1, Math.max(0, cfg.reactivity ?? 0.5))
  const strength = Math.min(1, Math.max(0, cfg.strength ?? 1))
  if (depth <= 0.001 && reactivity <= 0.001) return
  if (strength <= 0.001) return

  const leftTints = tintList(cfg.leftColors, 'left')
  const rightTints = tintList(cfg.rightColors, 'right')

  // Beat pop — gated by the React-to-beat switch: off = the copies sit at a
  // fixed separation (a steady glasses look); on = the low end pushes them
  // wider so the 3D breathes with the music, popping ~2.2× at reactivity 1
  // on a full hit and resting at the dialed-in depth between beats.
  const bass = Math.min(1, Math.max(0, frame.bass))
  const pop = cfg.beatReactive ? 1 + reactivity * 1.2 * bass : 1
  const sep = depth * 20 * S * pop // total left↔right separation in px
  const dx = Math.round(sep / 2) // each copy moves half the separation
  if (dx < 1) return

  // One snapshot; both side copies sample the finished frame from it.
  const snap = getWork('anaglyph:snap', W, H)
  const sc = resetWork(snap.getContext('2d')!)
  sc.clearRect(0, 0, W, H)
  sc.drawImage(ctx.canvas, 0, 0)

  const leftAcc = getWork('anaglyph:left', W, H)
  const rightAcc = getWork('anaglyph:right', W, H)
  const tint = getWork('anaglyph:tint', W, H)
  accumulateSide(leftAcc, snap, tint, leftTints, W, H)
  accumulateSide(rightAcc, snap, tint, rightTints, W, H)

  // Recombine on black so the edge strips keep their tinted content —
  // left edge = left-lens copy, right edge = right-lens copy, middle = the
  // full-color recombined anaglyph.
  const out = getWork('anaglyph:out', W, H)
  const oc = resetWork(out.getContext('2d')!)
  oc.fillStyle = '#000000'
  oc.fillRect(0, 0, W, H)
  oc.drawImage(leftAcc, -dx, 0)
  oc.globalCompositeOperation = 'lighter'
  oc.drawImage(rightAcc, dx, 0)
  oc.globalCompositeOperation = 'source-over'

  // Blend over the original — strength 1 is the full glasses look, lower
  // values mix the untouched picture back in.
  ctx.globalAlpha = strength
  ctx.drawImage(out, 0, 0)
  ctx.globalAlpha = 1
}
