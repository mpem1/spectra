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
 *   beatFlip   — Flip on kick: on a solid low-end hit the whole look
 *                swaps, in the direction beatFlipTo chooses — 'around'
 *                mirrors the whole stack (every copy jumps to the
 *                opposite side, like turning the paper glasses around),
 *                'picture' lifts the glasses clean off so the untouched
 *                frame flashes through and settles back, 'print' rests
 *                as the untouched frame and stamps the glasses in on
 *                the kick. Holds for flipHold, then falls back over a
 *                short release. Same onset detector as the halftone
 *                print's flip (imported flipGate, clean sub-band drive,
 *                per-filter detector state — dialed the same, both flip
 *                on the same kicks).
 *   depthPop   — Depth pop on kick: on the same low-end hits the
 *                separation snaps to 0% (every copy lands on the center
 *                line and the lenses recombine into the clean full-color
 *                picture), holds flat for popHold, then blooms back out
 *                to the dialed depth. Own detector state ('anaglyph:pop'
 *                key) so its dials stay independent of the flip's.
 *   depthMode  — which perspective the separation reads as:
 *                'sides' (default, the shipped look) shifts every copy
 *                of the whole frame by the SAME amount — one uniform
 *                depth, the classic paper-glasses window into the scene.
 *                'foreground' builds a per-strip depth field from the
 *                picture itself and shifts each strip on its own: bright,
 *                center-weighted rows count as NEAR and get CROSSED
 *                parallax (left-lens copy lands right of the right-lens
 *                copy) so they pop OUT toward the camera in front of the
 *                character, while darker rows fall behind the screen
 *                plane and recede. The subject detaches from its
 *                backdrop instead of the frame sliding sideways. A
 *                flipped kick turns the stage inside-out (near ↔ far);
 *                depth pop still flattens everything to the center line.
 *
 * The un-overlapped strips at the frame edges keep tinted content (left
 * tints trail off the left edge, right tints off the right) instead of
 * black bars — the authentic anaglyph border fringe, now with the tracer
 * echos stepping outward through it. In 'foreground' mode each depth
 * strip exposes its own narrow fringe band, and the two lenses' gaps
 * mirror each other so their union always covers the full frame.
 * Deterministic: no Math.random / Date.now anywhere, same (frame, config)
 * → same pixels in preview, MP4 and PNG exports. Transparent backgrounds
 * skip the pass (alpha must stay clean).
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
 *  Same trick as the CRT filter. `clipAlpha` (used by the foreground mode's
 *  per-strip displaced views, which carry transparent fringe bands where a
 *  strip shifted away) re-multiplies the result's alpha back down to the
 *  source's alpha via 'destination-in', so the gaps stay transparent and
 *  never paint raw lens color into the additive composite. */
function channelize(
  work: HTMLCanvasElement,
  snap: HTMLCanvasElement,
  color: string,
  w: number,
  h: number,
  clipAlpha?: HTMLCanvasElement,
): void {
  const c = resetWork(work.getContext('2d')!)
  c.clearRect(0, 0, w, h)
  c.drawImage(snap, 0, 0)
  c.globalCompositeOperation = 'multiply'
  c.fillStyle = color
  c.fillRect(0, 0, w, h)
  if (clipAlpha) {
    c.globalCompositeOperation = 'destination-in'
    c.drawImage(clipAlpha, 0, 0)
  }
  c.globalCompositeOperation = 'source-over'
}

/* ------------------------------ foreground mode ------------------------------ */

/**
 * Build the per-strip depth field for the 'foreground' perspective from the
 * finished frame: the snap is downscaled into a thin grid (one cell column
 * strip), each cell's luminance is averaged across the strip with a
 * center-weighted falloff (a centered character dominates its rows — edges
 * barely vote), a small vertical-center profile lifts the middle bands
 * (where a face usually lives), the field is smoothed vertically, stretched
 * across its own full range (the nearest strip = full pop-out, the farthest
 * = full recession) and pushed through a smoothstep so subject vs
 * background contrast spreads apart.
 *
 * Deterministic: derived from frame pixels + config only — same frame, same
 * depth field, so preview and export agree.
 */
function buildStripDepth(
  snap: HTMLCanvasElement,
  W: number,
  H: number,
  S: number,
  depthCanvas: HTMLCanvasElement,
): { depth: Float32Array; strips: number; stripH: number } {
  const stripH = Math.max(3, Math.round(4 * S))
  const strips = Math.max(1, Math.ceil(H / stripH))
  const gw = 32 // enough horizontal resolution for the center weighting
  const dc = resetWork(depthCanvas.getContext('2d')!)
  if (depthCanvas.width !== gw || depthCanvas.height !== strips) {
    depthCanvas.width = gw
    depthCanvas.height = strips
  }
  dc.imageSmoothingEnabled = true
  dc.imageSmoothingQuality = 'medium'
  dc.drawImage(snap, 0, 0, gw, strips)
  const data = dc.getImageData(0, 0, gw, strips).data

  // Center-weighted horizontal falloff — the middle columns carry the
  // subject, the frame edges barely vote. Quadratic² profile with a small
  // floor so a fully edge-hugging subject still shows up a little.
  const weights = new Float32Array(gw)
  let wsum = 0
  for (let x = 0; x < gw; x++) {
    const t = ((x + 0.5) / gw - 0.5) * 2 // −1 .. 1 across the frame
    const w = (1 - t * t) * (1 - t * t) + 0.05
    weights[x] = w
    wsum += w
  }

  const depth = new Float32Array(strips)
  for (let j = 0; j < strips; j++) {
    let acc = 0
    for (let x = 0; x < gw; x++) {
      const o = (j * gw + x) * 4
      const lum = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255
      acc += weights[x] * lum
    }
    const lumRow = acc / wsum
    // Vertical-center profile — the middle bands step slightly forward
    // (faces live there), the top and bottom edges lean back.
    const vp = 1 - Math.abs((j + 0.5) / strips - 0.5) * 2
    depth[j] = 0.82 * lumRow + 0.18 * vp
  }

  // Vertical smooth — two 3-tap passes so adjacent strips never jump more
  // than a pixel or two (kills strip-boundary tearing at the seams).
  const tmp = new Float32Array(strips)
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < strips; j++) {
      const a = depth[Math.max(0, j - 1)]
      const b = depth[j]
      const c = depth[Math.min(strips - 1, j + 1)]
      tmp[j] = 0.25 * a + 0.5 * b + 0.25 * c
    }
    depth.set(tmp)
  }

  // Stretch the smoothed field across the FULL depth range: the raw center-
  // weighted luminance of a bright subject on a dark backdrop hovers well
  // below 1 (the weights blend subject and background together), and without
  // this the subject would sit near the screen plane while only the backdrop
  // receded. Normalizing by the field's own min/max pins the nearest strip
  // at full pop-out and the farthest at full recession. The smoothing above
  // already suppresses one-off speckle outliers, so the anchors stay steady
  // frame to frame (and stay deterministic — pure frame pixels).
  let mn = Infinity
  let mx = -Infinity
  for (let j = 0; j < strips; j++) {
    if (depth[j] < mn) mn = depth[j]
    if (depth[j] > mx) mx = depth[j]
  }
  const span = mx - mn
  if (span > 0.04) {
    for (let j = 0; j < strips; j++) depth[j] = (depth[j] - mn) / span
  }

  // Smoothstep — pushes the field apart so near reads NEARER and far reads
  // FARTHER than the raw luminance would suggest.
  for (let j = 0; j < strips; j++) {
    const d = Math.min(1, Math.max(0, depth[j]))
    depth[j] = d * d * (3 - 2 * d)
  }
  return { depth, strips, stripH }
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
  // depth for the whole frame; 'foreground' = per-strip crossed parallax
  // built from the picture's own luminance (bright, centered shapes pop
  // OUT toward the camera, dark edges recede behind the screen plane).
  const fgMode = (cfg.depthMode ?? 'sides') === 'foreground'
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
  // ONSETS on the clean sub-band channel fire once per hit and pin the swap
  // for the hold dial's time, then it falls back over a short release.
  // beatFlipTo chooses which side of the swap the kick reveals:
  //   'around'  — the whole stack mirrors (env drives dir = 1 − 2·env):
  //               left-lens copies land where the right-lens copies sat and
  //               vice versa, and the release swings back through offset 0
  //               — the resting glasses, byte-identical to flip off.
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
  // the separation multiplier snaps to 0 — every copy lands on the center
  // line, the lenses recombine into the clean full-color picture — holds
  // flat for the pop-hold time, then the 0.25 s release blooms the 3D back
  // out to the dialed-in depth. popT 0 = the resting glasses (byte-
  // identical to pop off). Computed BEFORE the print-direction rest exit
  // so the pop detector stays warm even while the glasses rest off-frame.
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

  // Recombine on black. 'sides': tint 1 of each lens at the base ±dx (the
  // classic anaglyph pair — byte-identical to the single-tint pipeline),
  // then every extra tint additively one step FURTHER OUT (2dx, 3dx, 4dx).
  // Nothing is averaged or diluted: added colors only extend the trail
  // outward, so the base layer keeps its full strength everywhere.
  //
  // 'foreground': the frame is first re-projected into two per-eye views —
  // the snap drawn strip by strip, each strip shifted by its OWN depth
  // amount (near strips: the left-lens view lands RIGHT of the right-lens
  // view = crossed parallax = in front of the screen plane; far strips:
  // uncrossed = behind it). Each lens's tint list then channelizes its
  // displaced view exactly like the sides mode — base tint on the displaced
  // frame, extra tints one scalar step further out per lens — and the
  // alpha clip in channelize keeps each strip's fringe band transparent so
  // the other lens's copy fills it (their gaps mirror each other, so the
  // union always covers the full frame). depthPop collapses every strip to
  // the center line (clean recombine); a flipped kick inverts the field
  // (near ↔ far, the stage turns inside-out).
  const out = getWork('anaglyph:out', W, H)
  const oc = resetWork(out.getContext('2d')!)
  oc.fillStyle = '#000000'
  oc.fillRect(0, 0, W, H)
  oc.globalCompositeOperation = 'lighter'
  const tint = getWork('anaglyph:tint', W, H)
  if (fgMode) {
    const { depth: stripDepth, strips, stripH } = buildStripDepth(
      snap,
      W,
      H,
      S,
      getWork('anaglyph:depth', 32, 1),
    )
    // The two per-eye views of the depth stage. Each strip carries its own
    // shift: depth 1 (near, the subject) = +dx crossed, depth 0 (far, the
    // edges) = −dx recessed, the screen plane sits at depth 0.5. The +1px
    // vertical overlap walks each strip one row into its neighbor so the
    // per-strip seams never open, and adjacent shifts stay within a pixel
    // or two thanks to the field's vertical smoothing.
    const vl = getWork('anaglyph:vl', W, H)
    const vlc = resetWork(vl.getContext('2d')!)
    vlc.clearRect(0, 0, W, H)
    const vr = getWork('anaglyph:vr', W, H)
    const vrc = resetWork(vr.getContext('2d')!)
    vrc.clearRect(0, 0, W, H)
    for (let j = 0; j < strips; j++) {
      const y0 = j * stripH
      const hh = Math.min(stripH + 1, H - y0)
      if (hh <= 0) break
      const s = Math.round((stripDepth[j] - 0.5) * 2 * dxPop * dir)
      vlc.drawImage(snap, 0, y0, W, hh, s, y0, W, hh)
      vrc.drawImage(snap, 0, y0, W, hh, -s, y0, W, hh)
    }
    leftTints.forEach((color, i) => {
      channelize(tint, vl, color, W, H, vl)
      oc.drawImage(tint, -i * dxPop * dir, 0)
    })
    rightTints.forEach((color, i) => {
      channelize(tint, vr, color, W, H, vr)
      oc.drawImage(tint, i * dxPop * dir, 0)
    })
  } else {
    leftTints.forEach((color, i) => {
      channelize(tint, snap, color, W, H)
      oc.drawImage(tint, -(i + 1) * dxPop * dir, 0)
    })
    rightTints.forEach((color, i) => {
      channelize(tint, snap, color, W, H)
      oc.drawImage(tint, (i + 1) * dxPop * dir, 0)
    })
  }
  oc.globalCompositeOperation = 'source-over'

  // Blend over the original — strength 1 is the full glasses look, lower
  // values mix the untouched picture back in. The flip's picture/print
  // directions dissolve the untouched frame (the snap) over/under that
  // blend as the kick lands and falls back.
  ctx.globalAlpha = strength
  ctx.drawImage(out, 0, 0)
  if (flipToPicture && flipT > 0.001) {
    // Picture direction: the untouched frame dissolves in over the glasses.
    ctx.globalAlpha = flipT
    ctx.drawImage(snap, 0, 0)
  }
  if (flipToPrint && flipT < 0.999) {
    // Print direction: the untouched frame dissolves out as the glasses
    // stamp in.
    ctx.globalAlpha = 1 - flipT
    ctx.drawImage(snap, 0, 0)
  }
  ctx.globalAlpha = 1
}
