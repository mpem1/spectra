/**
 * Anaglyph filter — the old-school paper 3D-glasses look with tracer
 * stacking, plus a light-trace Pop-out stage.
 *
 * LEFT & RIGHT (the classic mode): the finished picture is re-projected
 * once per tint: tint 1 of each lens is the BASE layer — the left base
 * copy and the right base copy drift apart by the depth separation and
 * are summed with 'lighter' so their overlap recomposes the picture while
 * edges wear the classic tint fringes. Every EXTRA tint is a tracer echo:
 * its own channelized copy of the full frame, drawn additively one
 * separation-step FURTHER OUT than the previous tint (tint 2 at 2×, tint 3
 * at 3×, tint 4 at 4× the base offset). The echoes never dilute or recolor
 * the base layer — adding a color extends the trail outward instead of
 * averaging into the glasses.
 *
 * POP-OUT 3D ('foreground'): NOT a horizontal separation at all. A
 * saliency mask read off the picture (bright OR high-contrast, center-
 * weighted pixels — the character and anything lit) lifts the subject's
 * light off the frame as stacked additive TRACE LAYERS that bloom outward
 * from the screen center: each layer is scaled a step further toward the
 * camera and drawn a step fainter, so the glow smears outward like a
 * light trail floating in front of the picture while the picture itself
 * stays sharp and unmoved. The layers alternate through both lenses'
 * merged tint palette (red, cyan, red, …), so the trail keeps the
 * glasses' colors. Nothing slides, nothing wobbles — the traces are pure
 * added light over untouched pixels.
 *
 *   leftColors / rightColors — 1–4 tint hex strings per lens, ordered from
 *     the base layer outward (tint 1 = the lens that recomposes the
 *     picture in Left & right). The classic red/cyan pair is the default.
 *     In Pop-out 3D both lists merge into one trace palette the layers
 *     cycle through.
 *   depth      — base separation, the amount of 3D-ness (up to 2.5× the
 *                classic amount for a wide-POP stereo look); in Pop-out 3D
 *                it drives how far the light traces bloom toward the camera
 *   reactivity — how much the song's low end pushes the copies apart (or
 *                the traces further out), so the 3D pops on beats (gated
 *                by beatReactive — off gives a fixed, steady look;
 *                frame.bass ships in AudioFrame, so the live preview and
 *                the offline exporter pop identically)
 *   strength   — blend of the anaglyph back over the untouched picture
 *   beatFlip   — Flip on kick: on a solid low-end hit the whole look
 *                swaps, in the direction beatFlipTo chooses — 'around'
 *                mirrors the whole stack (in Left & right every copy
 *                jumps to the opposite side, like turning the paper
 *                glasses around; in Pop-out 3D the traces swing through
 *                flat and bloom inward, toward the screen plane), and the
 *                release swings back through the resting look — byte-
 *                identical to flip off. 'picture' lifts the glasses clean
 *                off so the untouched frame flashes through and settles
 *                back, 'print' rests as the untouched frame and stamps
 *                the glasses in on the kick. Holds for flipHold, then
 *                falls back over a short release. Same onset detector as
 *                the halftone print's flip (imported flipGate, clean
 *                sub-band drive, per-filter detector state — dialed the
 *                same, both flip on the same kicks).
 *   depthPop   — Depth pop on kick: on the same low-end hits the stage
 *                snaps to 0 (in Left & right the copies land on the
 *                center line and the lenses recombine into the clean
 *                full-color picture; in Pop-out 3D the traces collapse
 *                flat so the clean picture shows), holds flat for
 *                popHold, then blooms back out to the dialed depth. Own
 *                detector state ('anaglyph:pop' key) so its dials stay
 *                independent of the flip's.
 *   depthMode  — which perspective the 3D reads as: 'sides' (default, the
 *                shipped look) or 'foreground' (Pop-out 3D, the
 *                light-trace stage described above). Old saves without
 *                this field load as 'sides'.
 *
 * The un-overlapped edges keep tinted content (left tints trail off the
 * left edge, right tints off the right) instead of black bars — the
 * authentic anaglyph border fringe, with the tracer echos stepping
 * outward through it (Left & right only; Pop-out 3D displaces nothing, so
 * the frame and its edges stay exactly where the earlier filters left
 * them and the traces are pure added light). Deterministic: no
 * Math.random / Date.now anywhere, same (frame, config) → same pixels on
 * a given machine in preview, MP4 and PNG exports. Transparent
 * backgrounds skip the pass (alpha must stay clean).
 */
import type { AudioFrame, RenderContext, AnaglyphFilterConfig } from './types'
import { getWork, resetWork } from './filter-utils'
import { flipGate } from './halftone-filter'

/** Tints per side — hard cap so a hand-edited project can't spawn 100 passes. */
const MAX_TINTS = 4

/** Hard cap on the merged Pop-out trace palette (both lenses combined). */
const MAX_TRACE_TINTS = 8

/** Pop-out 3D trace stack — the light smears through this many layers. */
const TRACE_LAYERS = 6

/** The outermost trace layer's scale offset at depth 1 (× depth, × beat
 *  pop): 0.22 → the trail blooms to 1.22× the frame at 100% depth and
 *  1.55× at 250% — each inner layer a proportionally smaller step, so the
 *  subject's light visibly smears out beyond its silhouette. */
const TRACE_SPREAD = 0.22

/** Peak alpha of the innermost trace layer — kept well under 1 so the
 *  additive stack glows without blowing the subject out to flat white;
 *  the falloff steepens outward so the trail melts away instead of
 *  stacking up a hard rim. */
const TRACE_ALPHA = 0.34

/** Mask softening (px at 720p) — blurring the mask as it clips each
 *  trace source turns the scaled copies into a continuous light smear. */
const TRACE_BLUR = 2.5

/** Fixed saliency anchors — they NEVER move between frames, so the mask
 *  can't breathe: a cell's cue at/below SALIENCY_LO reads fully off (no
 *  trace), at/above SALIENCY_LO + SALIENCY_SPAN fully on. The span is
 *  deliberately TIGHT — the subject should saturate to full glow instead
 *  of idling at half-strength, which is what diluted the first pop-out
 *  into a faint fringe. */
const SALIENCY_LO = 0.16
const SALIENCY_SPAN = 0.44

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

/** The Pop-out trace palette: both lenses' tint lists merged in order
 *  (left lens first), deduped, capped at MAX_TRACE_TINTS — the trace
 *  layers cycle through it as they stack outward. */
function mergeTints(left: string[], right: string[]): string[] {
  const seen = new Set<string>()
  const list: string[] = []
  for (const c of [...left, ...right]) {
    const key = c.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    list.push(c)
    if (list.length >= MAX_TRACE_TINTS) break
  }
  return list.length > 0 ? list : ['#ffffff']
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

/* --------------------------- Pop-out light traces --------------------------- */

/** Separable box blur with clamped edges — the small-grid twin of the
 *  contour filter's blurField. Blurs `src` in place, `dst` is scratch. */
function blurGrid(src: Float32Array, dst: Float32Array, gw: number, gh: number, r: number): void {
  const w = 2 * r + 1
  for (let y = 0; y < gh; y++) {
    const o = y * gw
    for (let x = 0; x < gw; x++) {
      let acc = 0
      for (let k = -r; k <= r; k++) acc += src[o + Math.min(gw - 1, Math.max(0, x + k))]
      dst[o + x] = acc / w
    }
  }
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let acc = 0
      for (let k = -r; k <= r; k++) acc += dst[Math.min(gh - 1, Math.max(0, y + k)) * gw + x]
      src[y * gw + x] = acc / w
    }
  }
}

/** Reusable pixel buffer for the saliency grid (keyed by grid size). */
const maskPixels = new Map<string, ImageData>()

/**
 * Build the saliency mask for the Pop-out 3D light-trace stage from the
 * finished frame, into `maskCanvas` (ALPHA channel = trace weight 0..1,
 * RGB stays white — the tint pass supplies the color; one cell per ~10px
 * of width, upscaled with smoothing wherever it's used). Per cell: a
 * saliency cue — brightness OR local contrast (characters wear strong
 * outlines and interior detail; backdrops are broad and flat, so a
 * dark-outlined subject still glows against a bright wall) — times a firm
 * center-weighted falloff (a centered subject keeps nearly all of its
 * cue; the frame corners lean back), the field is box-blurred so the mask
 * ramps smoothly across silhouettes, and remapped through the FIXED
 * anchors above (dark+flat reads zero, bright/detailed reads fully on —
 * no per-frame renormalization). The outermost cell ring is pinned to
 * zero so the traces die gently before the frame edge.
 *
 * Deterministic: derived from frame pixels only — same frame, same mask.
 */
function buildTraceMask(
  snap: HTMLCanvasElement,
  W: number,
  H: number,
  maskCanvas: HTMLCanvasElement,
): HTMLCanvasElement {
  const gw = Math.min(144, Math.max(72, Math.round(W / 10)))
  const gh = Math.max(24, Math.round((gw * H) / W))
  if (maskCanvas.width !== gw || maskCanvas.height !== gh) {
    maskCanvas.width = gw
    maskCanvas.height = gh
  }
  const mc = maskCanvas.getContext('2d', { willReadFrequently: true })!
  mc.imageSmoothingEnabled = true
  mc.imageSmoothingQuality = 'medium'
  mc.drawImage(snap, 0, 0, gw, gh)
  const data = mc.getImageData(0, 0, gw, gh).data

  const raw = new Float32Array(gw * gh)
  const field = new Float32Array(gw * gh)
  const scratch = new Float32Array(gw * gh)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const o = (y * gw + x) * 4
      raw[y * gw + x] = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255
    }
  }
  // Local mean of the luminance — the gap between raw and mean is the
  // cell's contrast, the cheapest subject detector there is.
  field.set(raw)
  blurGrid(field, scratch, gw, gh, 2)
  for (let y = 0; y < gh; y++) {
    const cy = ((y + 0.5) / gh - 0.5) * 2
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x
      const cx = ((x + 0.5) / gw - 0.5) * 2
      const center = Math.max(0, 1 - (cx * cx + cy * cy) / 1.3)
      const contrast = Math.abs(raw[i] - field[i])
      const cue = Math.max(raw[i], Math.min(1, contrast * 2.4))
      field[i] = cue * (0.64 + 0.36 * center)
    }
  }
  blurGrid(field, scratch, gw, gh, 2)
  blurGrid(field, scratch, gw, gh, 2)

  for (let i = 0, n = gw * gh; i < n; i++) {
    const t = Math.min(1, Math.max(0, (field[i] - SALIENCY_LO) / SALIENCY_SPAN))
    field[i] = t * t * (3 - 2 * t)
  }
  // Pin the outermost ring to zero, then one small blur blends the pin
  // into the stage so the traces fade out before the frame edge.
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1) field[y * gw + x] = 0
    }
  }
  blurGrid(field, scratch, gw, gh, 1)

  const pkey = `${gw}x${gh}`
  let img = maskPixels.get(pkey)
  if (!img) {
    img = mc.createImageData(gw, gh)
    maskPixels.set(pkey, img)
  }
  const px = img.data
  for (let i = 0, n = gw * gh; i < n; i++) {
    const v = Math.round(Math.min(1, Math.max(0, field[i])) * 255)
    px[i * 4] = 255
    px[i * 4 + 1] = 255
    px[i * 4 + 2] = 255
    px[i * 4 + 3] = v
  }
  mc.putImageData(img, 0, 0)
  return maskCanvas
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
  // Depth perspective: 'sides' = the shipped uniform left/right drift, one
  // depth for the whole frame; 'foreground' = the Pop-out light-trace
  // stage — the subject's glow blooms toward the camera as stacked,
  // tinted, additive layers and nothing is displaced horizontally.
  const fgMode = (cfg.depthMode ?? 'sides') === 'foreground'
  if (depth <= 0.001 && reactivity <= 0.001) return
  if (strength <= 0.001) return

  const leftTints = tintList(cfg.leftColors, 'left')
  const rightTints = tintList(cfg.rightColors, 'right')

  // Beat pop — gated by the React-to-beat switch: off = the copies sit at a
  // fixed separation (a steady glasses look); on = the low end pushes them
  // wider so the 3D breathes with the music, popping ~2.2× at reactivity 1
  // on a full hit and resting at the dialed-in depth between beats. In
  // Pop-out 3D the same push drives the traces further out.
  const bass = Math.min(1, Math.max(0, frame.bass))
  const pop = cfg.beatReactive ? 1 + reactivity * 1.2 * bass : 1
  const sep = depth * 20 * S * pop // total left↔right separation in px (sides mode)
  const dx = Math.round(sep / 2) // each copy moves half the separation
  if (!fgMode && dx < 1) return

  // Flip on kick — the same detector the halftone print's flip uses: bass
  // ONSETS on the clean sub-band channel fire once per hit and pin the swap
  // for the hold dial's time, then it falls back over a short release.
  // beatFlipTo chooses which side of the swap the kick reveals:
  //   'around'  — the whole stack turns inside-out (env drives
  //               dir = 1 − 2·env): in Left & right the left-lens copies
  //               land where the right-lens copies sat and vice versa; in
  //               Pop-out 3D the traces swing through flat and bloom
  //               inward, toward the screen plane. The release swings back
  //               through the resting look — byte-identical to flip off.
  //   'picture' — the glasses lift clean off: the untouched frame (the
  //               snap taken before the recombine) dissolves IN over the
  //               finished glasses as the kick lands; at the peak the frame
  //               is exactly as the earlier filters left it.
  //   'print'   — the untouched picture rests between kicks (early return,
  //               zero cost — but both detectors still advance) and the
  //               glasses stamp in on the kick: the untouched frame
  //               dissolves OUT while the glasses take over.
  const flipTo = cfg.beatFlipTo ?? 'around'
  const flipToPicture = !!cfg.beatFlip && flipTo === 'picture'
  const flipToPrint = !!cfg.beatFlip && flipTo === 'print'
  const flipT = cfg.beatFlip
    ? flipGate(
        ctx,
        Math.min(1, Math.max(0, frame.sub ?? frame.bass)),
        frame.time,
        Math.min(1, Math.max(0, cfg.flipSensitivity ?? 0.1)),
        Math.min(1, Math.max(0, cfg.flipHold ?? 0.2)) * 2,
        'anaglyph',
      )
    : 0

  // Depth pop on kick — the same onset detector that drives the flip, with
  // its own 'anaglyph:pop' state so the pop dials stay independent of the
  // flip's (dialed the same, both fire on the same kicks). On a fired kick
  // the stage snaps to 0 — in Left & right every copy lands on the center
  // line and the lenses recombine into the clean full-color picture; in
  // Pop-out 3D the traces collapse flat so the clean picture shows — holds
  // flat for the pop-hold time, then the 0.25 s release blooms the 3D back
  // out to the dialed-in depth. popT 0 = the resting look (byte-identical
  // to pop off). Computed BEFORE the print-direction rest exit so the pop
  // detector stays warm even while the glasses rest off-frame.
  const popT = cfg.depthPop
    ? flipGate(
        ctx,
        Math.min(1, Math.max(0, frame.sub ?? frame.bass)),
        frame.time,
        Math.min(1, Math.max(0, cfg.popSensitivity ?? 0.1)),
        Math.min(1, Math.max(0, cfg.popHold ?? 0.2)) * 2,
        'anaglyph:pop',
      )
    : 0

  // Print direction at rest: the untouched picture alone — zero cost.
  if (flipToPrint && flipT <= 0.001) return

  const dir = flipToPicture || flipToPrint ? 1 : 1 - 2 * flipT
  const dxPop = Math.round(dx * (1 - popT))

  // One snapshot; every tint copy samples the finished frame from it.
  const snap = getWork('anaglyph:snap', W, H)
  const sc = resetWork(snap.getContext('2d')!)
  sc.clearRect(0, 0, W, H)
  sc.drawImage(ctx.canvas, 0, 0)

  if (fgMode) {
    // Pop-out 3D — the light-trace stage. trailAmp drives how far the
    // outermost trace blooms past the frame: the Depth dial scales it,
    // Beat pop pushes it wider on the low end, Depth pop collapses it
    // flat on a kick, and a flipped 'around' kick swings it through flat
    // and inward (the traces bloom toward the screen plane instead).
    const trailAmp = depth * TRACE_SPREAD * pop * (1 - popT) * dir
    if (Math.abs(trailAmp) * strength > 0.004) {
      // The saliency mask: near content only (bright, detailed, centered).
      const mask = buildTraceMask(snap, W, H, getWork('anaglyph:depth', 128, 72))
      const tints = mergeTints(leftTints, rightTints)
      // One tinted trace source per palette color: the frame through the
      // tint, then masked down to the saliency — the destination-in draw
      // carries a soft blur so the layers read as smeared light, not ghost
      // copies.
      for (let j = 0; j < tints.length; j++) {
        const tcv = getWork(`anaglyph:trace${j}`, W, H)
        const tc = resetWork(tcv.getContext('2d')!)
        tc.drawImage(snap, 0, 0)
        tc.globalCompositeOperation = 'multiply'
        tc.fillStyle = tints[j]
        tc.fillRect(0, 0, W, H)
        tc.globalCompositeOperation = 'destination-in'
        tc.imageSmoothingEnabled = true
        tc.imageSmoothingQuality = 'high'
        tc.filter = `blur(${(TRACE_BLUR * S).toFixed(2)}px)`
        tc.drawImage(mask, 0, 0, W, H)
        tc.filter = 'none'
        tc.globalCompositeOperation = 'source-over'
      }
      // The stack: layer i scales a step further out from the screen
      // center and steps a class fainter, alternating through the palette
      // — pure additive light over the untouched picture. The picture
      // never moves, so nothing slides and nothing wobbles.
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 1; i <= TRACE_LAYERS; i++) {
        const s = 1 + (trailAmp * i) / TRACE_LAYERS
        const a = TRACE_ALPHA * Math.pow(1 - i / (TRACE_LAYERS + 1), 1.6) * strength
        if (a <= 0.004 || Math.abs(s - 1) < 0.0004) continue
        const tcv = getWork(`anaglyph:trace${(i - 1) % tints.length}`, W, H)
        ctx.save()
        ctx.globalAlpha = a
        ctx.translate(W / 2, H / 2)
        ctx.scale(s, s)
        ctx.translate(-W / 2, -H / 2)
        ctx.drawImage(tcv, 0, 0)
        ctx.restore()
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
    }
  } else {
    // Recombine on black. 'sides': tint 1 of each lens at the base ±dx
    // (the classic anaglyph pair — byte-identical to the single-tint
    // pipeline), then every extra tint additively one step FURTHER OUT
    // (2dx, 3dx, 4dx). Nothing is averaged or diluted: added colors only
    // extend the trail outward, so the base layer keeps its full strength
    // everywhere.
    const out = getWork('anaglyph:out', W, H)
    const oc = resetWork(out.getContext('2d')!)
    oc.fillStyle = '#000000'
    oc.fillRect(0, 0, W, H)
    oc.globalCompositeOperation = 'lighter'
    const tint = getWork('anaglyph:tint', W, H)
    leftTints.forEach((color, i) => {
      channelize(tint, snap, color, W, H)
      oc.drawImage(tint, -(i + 1) * dxPop * dir, 0)
    })
    rightTints.forEach((color, i) => {
      channelize(tint, snap, color, W, H)
      oc.drawImage(tint, (i + 1) * dxPop * dir, 0)
    })
    oc.globalCompositeOperation = 'source-over'

    // Blend over the original — strength 1 is the full glasses look, lower
    // values mix the untouched picture back in.
    ctx.globalAlpha = strength
    ctx.drawImage(out, 0, 0)
    ctx.globalAlpha = 1
  }

  // The flip's picture/print directions dissolve the untouched frame (the
  // snap) over the finished look as the kick lands and falls back — shared
  // by both depth perspectives.
  if (flipToPicture && flipT > 0.001) {
    ctx.globalAlpha = flipT
    ctx.drawImage(snap, 0, 0)
  }
  if (flipToPrint && flipT < 0.999) {
    ctx.globalAlpha = 1 - flipT
    ctx.drawImage(snap, 0, 0)
  }
  ctx.globalAlpha = 1
}
