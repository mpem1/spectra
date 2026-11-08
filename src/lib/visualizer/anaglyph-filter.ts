/**
 * Anaglyph filter — the old-school paper 3D-glasses look.
 *
 * The finished picture is re-projected twice and the copies drift apart
 * horizontally: the LEFT copy keeps only the red channel (multiply by pure
 * red), the RIGHT copy keeps cyan (green + blue). The two are summed back
 * with 'lighter' so their overlap recomposes the full-color picture while
 * everything near high-contrast edges wears the classic red/blue fringes —
 * the exact look of watching through red/cyan paper glasses.
 *
 *   depth      — base separation, the amount of 3D-ness
 *   reactivity — how much the song's low end pushes the copies apart, so
 *                the 3D pops on beats (frame.bass ships in AudioFrame, so
 *                the live preview and the offline exporter pop identically)
 *   strength   — blend of the anaglyph back over the untouched picture
 *
 * The un-overlapped strips at the frame edges keep tinted content (red-only
 * on the left, cyan-only on the right) instead of black bars — the authentic
 * anaglyph border fringe. Deterministic: no Math.random / Date.now anywhere,
 * same (frame, config) → same pixels in preview, MP4 and PNG exports.
 * Transparent backgrounds skip the pass (alpha must stay clean).
 */
import type { AudioFrame, RenderContext, AnaglyphFilterConfig } from './types'
import { clamp01, getWork, resetWork } from './filter-utils'

/** Copy `snap` into `work` keeping only one channel (multiply by a pure
 *  channel color zeroes the other two). Same trick as the CRT filter. */
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

export function drawAnaglyphFilter(
  rc: RenderContext,
  cfg: AnaglyphFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  const S = H / 720
  const depth = clamp01(cfg.depth)
  const reactivity = clamp01(cfg.reactivity ?? 0.5)
  const strength = clamp01(cfg.strength ?? 1)
  if (depth <= 0.001 && reactivity <= 0.001) return
  if (strength <= 0.001) return

  // Beat pop — the low end pushes the copies wider so the 3D breathes with
  // the music. pop ranges 1× (silent) to ~2.2× (reactivity 1 + full bass).
  const bass = clamp01(frame.bass)
  const pop = 1 + reactivity * 1.2 * bass
  const sep = depth * 20 * S * pop // total red↔cyan separation in px
  const dx = Math.round(sep / 2) // each copy moves half the separation
  if (dx < 1) return

  // One snapshot; both channel copies sample the finished frame from it.
  const snap = getWork('anaglyph:snap', W, H)
  const sc = resetWork(snap.getContext('2d')!)
  sc.clearRect(0, 0, W, H)
  sc.drawImage(ctx.canvas, 0, 0)

  const redW = getWork('anaglyph:red', W, H)
  channelize(redW, snap, '#ff0000', W, H)
  const cyanW = getWork('anaglyph:cyan', W, H)
  channelize(cyanW, snap, '#00ffff', W, H)

  // Recombine on black so the edge strips keep their tinted content —
  // left edge = red-only copy, right edge = cyan-only copy, middle = the
  // full-color recombined anaglyph.
  const out = getWork('anaglyph:out', W, H)
  const oc = resetWork(out.getContext('2d')!)
  oc.fillStyle = '#000000'
  oc.fillRect(0, 0, W, H)
  oc.drawImage(redW, -dx, 0)
  oc.globalCompositeOperation = 'lighter'
  oc.drawImage(cyanW, dx, 0)
  oc.globalCompositeOperation = 'source-over'

  // Blend over the original — strength 1 is the full glasses look, lower
  // values mix the untouched picture back in.
  ctx.globalAlpha = strength
  ctx.drawImage(out, 0, 0)
  ctx.globalAlpha = 1
}
