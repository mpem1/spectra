/**
 * Anaglyph filter — the old-school paper 3D-glasses look with tracer
 * stacking.
 *
 * The finished picture is re-projected once per tint: tint 1 of each lens
 * is the BASE layer — the left base copy and the right base copy drift
 * apart by the depth separation and are summed with 'lighter' so their
 * overlap recomposes the picture while edges wear the classic tint
 * fringes. Every EXTRA tint is a tracer echo: its own channelized copy of
 * the full frame, drawn additively one separation-step FURTHER OUT than
 * the previous tint (tint 2 at 2×, tint 3 at 3×, tint 4 at 4× the base
 * offset). The echoes never dilute or recolor the base layer — adding a
 * color extends the trail outward instead of averaging into the glasses.
 *
 *   leftColors / rightColors — 1–4 tint hex strings per lens, ordered from
 *     the base layer outward (tint 1 = the lens that recomposes the
 *     picture). The classic red/cyan pair is the default.
 *   depth      — base separation, the amount of 3D-ness (up to 2.5× the
 *                classic amount for a wide-POP stereo look)
 *   reactivity — how much the song's low end pushes the copies apart, so
 *                the 3D pops on beats (gated by beatReactive — off gives a
 *                fixed, steady separation; frame.bass ships in AudioFrame,
 *                so the live preview and the offline exporter pop identically)
 *   strength   — blend of the anaglyph back over the untouched picture
 *   beatFlip   — Flip on kick: on a solid low-end hit the whole stack
 *                mirrors (every copy jumps to the opposite side, like
 *                turning the paper glasses around), holds for flipHold,
 *                then swings back — through the clean recomposed picture
 *                — to rest. Same onset detector as the halftone print's
 *                flip (imported flipGate, clean sub-band drive, per-filter
 *                detector state — dialed the same, both flip on the same
 *                kicks).
 *
 * The un-overlapped strips at the frame edges keep tinted content (left
 * tints trail off the left edge, right tints off the right) instead of
 * black bars — the authentic anaglyph border fringe, now with the tracer
 * echos stepping outward through it. Deterministic: no Math.random /
 * Date.now anywhere, same (frame, config) → same pixels in preview, MP4
 * and PNG exports. Transparent backgrounds skip the pass (alpha must
 * stay clean).
 */
import type { AudioFrame, RenderContext, AnaglyphFilterConfig } from './types'
import { getWork, resetWork } from './filter-utils'
import { flipGate } from './halftone-filter'

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

export function drawAnaglyphFilter(
  rc: RenderContext,
  cfg: AnaglyphFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass' | 'sub' | 'time'>,
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

  // Flip on kick — the same detector the halftone print's flip uses: bass
  // ONSETS on the clean sub-band channel fire once per hit, pin the flip
  // fully swapped for the hold dial's time, then fall back over a short
  // release. The flip multiplies every copy's offset by (1 − 2·env): env 0
  // is the resting glasses (byte-identical to flip off), env 1 mirrors the
  // whole stack — left-lens copies land where the right-lens copies sat and
  // vice versa, like the glasses turned around — and the release swings
  // back through offset 0, where the lens copies recombine into the clean
  // full-color picture, so each kick reads as a snap flip and a swing home.
  const flipT = cfg.beatFlip
    ? flipGate(
        ctx,
        Math.min(1, Math.max(0, frame.sub ?? frame.bass)),
        frame.time,
        Math.min(1, Math.max(0, cfg.flipSensitivity ?? 0.5)),
        Math.min(1, Math.max(0, cfg.flipHold ?? 0)) * 2,
        'anaglyph',
      )
    : 0
  const dir = 1 - 2 * flipT

  // One snapshot; every tint copy samples the finished frame from it.
  const snap = getWork('anaglyph:snap', W, H)
  const sc = resetWork(snap.getContext('2d')!)
  sc.clearRect(0, 0, W, H)
  sc.drawImage(ctx.canvas, 0, 0)

  // Recombine on black: tint 1 of each lens at the base ±dx (the classic
  // anaglyph pair — byte-identical to the single-tint pipeline), then every
  // extra tint additively one step FURTHER OUT (2dx, 3dx, 4dx). Nothing is
  // averaged or diluted: added colors only extend the trail outward, so the
  // base layer keeps its full strength everywhere.
  const out = getWork('anaglyph:out', W, H)
  const oc = resetWork(out.getContext('2d')!)
  oc.fillStyle = '#000000'
  oc.fillRect(0, 0, W, H)
  oc.globalCompositeOperation = 'lighter'
  const tint = getWork('anaglyph:tint', W, H)
  leftTints.forEach((color, i) => {
    channelize(tint, snap, color, W, H)
    oc.drawImage(tint, -(i + 1) * dx * dir, 0)
  })
  rightTints.forEach((color, i) => {
    channelize(tint, snap, color, W, H)
    oc.drawImage(tint, (i + 1) * dx * dir, 0)
  })
  oc.globalCompositeOperation = 'source-over'

  // Blend over the original — strength 1 is the full glasses look, lower
  // values mix the untouched picture back in.
  ctx.globalAlpha = strength
  ctx.drawImage(out, 0, 0)
  ctx.globalAlpha = 1
}
