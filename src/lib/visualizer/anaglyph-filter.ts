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
 *                'foreground' reads a per-pixel depth field out of the
 *                picture itself (bright OR high-contrast, center-weighted
 *                pixels count as NEAR, dark flat pixels as FAR, the
 *                outermost border is pinned to the screen plane) and
 *                re-projects the frame once per eye on a GPU warp whose
 *                depth budget lives in the foreground: the near range
 *                climbs on a steep slope and runs at ~3× the classic warp
 *                amp, so the subject crosses HARD and pops OUT toward the
 *                camera, well in front of the character's backdrop, while
 *                the dark flat backdrop leans back behind the screen
 *                plane at a fraction of that. The subject detaches from
 *                its backdrop in every direction instead of the frame
 *                sliding sideways — no strips, no bands, no
 *                renormalization, so a steady amp renders frame-stable
 *                (zero jitter). A flipped kick turns the stage inside-out
 *                (near ↔ far); depth pop still flattens everything to the
 *                center line. No WebGL → uniform-spread fallback
 *                (warpDepthViews returns false).
 *
 * The un-overlapped edges keep tinted content (left tints trail off the
 * left edge, right tints off the right) instead of black bars — the
 * authentic anaglyph border fringe, with the tracer echos stepping
 * outward through it. In 'foreground' mode the per-eye views come back
 * complete and opaque (the GPU warp fills every pixel; the pinned depth
 * border keeps the frame edges glued in place), so the fringes live only
 * where depth actually changes — around the subject. Deterministic: no
 * Math.random / Date.now anywhere, same (frame, config) → same pixels on
 * a given machine in preview, MP4 and PNG exports (the GL warp runs the
 * same path for both). Transparent backgrounds skip the pass (alpha must
 * stay clean).
 */
import type { AudioFrame, RenderContext, AnaglyphFilterConfig } from './types'
import { getWork, resetWork } from './filter-utils'
import { flipGate } from './halftone-filter'
import { warpDepthViews } from './depth-warp'

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
 *  Same trick as the CRT filter. The optional `clipAlpha` canvas re-multiplies
 *  the result's alpha back down to its own via 'destination-in' (kept for
 *  displaced views that carry transparent bands; the GPU depth views are
 *  opaque and skip it). */
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

/** Fixed depth anchors — they NEVER move between frames, so the stage can't
 *  jitter: raw field at/below NEAR_LO reads fully far, at/above NEAR_LO +
 *  NEAR_SPAN fully near, and DEPTH_SCREEN maps to zero parallax (the
 *  border pin + the shader's screen plane must both use it). The span is
 *  deliberately TIGHT — the subject should saturate to full near instead
 *  of idling at half-depth, which is what diluted the first pop-out into
 *  a faint fringe. */
const DEPTH_NEAR_LO = 0.16
const DEPTH_NEAR_SPAN = 0.44
const DEPTH_SCREEN = 0.375
/** The pop-out stage's warp gain over the classic separation step: the GPU
 *  amp is FG_WARP_GAIN× the base half-separation AND the shader's near
 *  slope (2.2×) stacks on top, so a fully-near subject crosses at ~3.3×
 *  the classic per-eye offset — the exaggerated foreground pop — while
 *  the far slope (0.55×) keeps the backdrop's recession gentle. Tracer
 *  tints keep stepping at the classic offset so multi-tint trails don't
 *  smear off the frame. */
const FG_WARP_GAIN = 2.4

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

/** Reusable pixel buffer for the depth grid (keyed by grid size). */
const depthPixels = new Map<string, ImageData>()

/**
 * Build the per-pixel depth field for the 'foreground' perspective from the
 * finished frame, into `depthCanvas` (R channel = depth 0..1, one cell per
 * ~10px of width). Per cell: a saliency cue — brightness OR local contrast
 * (characters wear strong outlines and interior detail; backdrops are broad
 * and flat, so a dark-outlined subject still reads near against a bright
 * wall) — times a firm center-weighted falloff (a centered subject keeps
 * nearly all of its cue; the frame corners lean back), the field is
 * box-blurred so depth ramps smoothly across silhouettes, remapped through
 * the FIXED anchors above (dark+flat reads far, bright/detailed reads fully
 * near — no per-frame renormalization, which is what made the old strip
 * field wobble frame to frame), and the outermost cell ring is pinned to
 * the screen plane so the picture's border stays glued in place (zero
 * parallax at the sample clamp — no edge smear).
 *
 * Deterministic: derived from frame pixels only — same frame, same field.
 */
function buildDepthField(
  snap: HTMLCanvasElement,
  W: number,
  H: number,
  depthCanvas: HTMLCanvasElement,
): HTMLCanvasElement {
  const gw = Math.min(144, Math.max(72, Math.round(W / 10)))
  const gh = Math.max(24, Math.round((gw * H) / W))
  if (depthCanvas.width !== gw || depthCanvas.height !== gh) {
    depthCanvas.width = gw
    depthCanvas.height = gh
  }
  const dc = depthCanvas.getContext('2d', { willReadFrequently: true })!
  dc.imageSmoothingEnabled = true
  dc.imageSmoothingQuality = 'medium'
  dc.drawImage(snap, 0, 0, gw, gh)
  const data = dc.getImageData(0, 0, gw, gh).data

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
    const t = Math.min(1, Math.max(0, (field[i] - DEPTH_NEAR_LO) / DEPTH_NEAR_SPAN))
    field[i] = t * t * (3 - 2 * t)
  }
  // Pin the outermost ring to the screen plane, then one small blur blends
  // the pin into the stage.
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1) field[y * gw + x] = DEPTH_SCREEN
    }
  }
  blurGrid(field, scratch, gw, gh, 1)

  const pkey = `${gw}x${gh}`
  let img = depthPixels.get(pkey)
  if (!img) {
    img = dc.createImageData(gw, gh)
    depthPixels.set(pkey, img)
  }
  const px = img.data
  for (let i = 0, n = gw * gh; i < n; i++) {
    const v = Math.round(Math.min(1, Math.max(0, field[i])) * 255)
    px[i * 4] = v
    px[i * 4 + 1] = v
    px[i * 4 + 2] = v
    px[i * 4 + 3] = 255
  }
  dc.putImageData(img, 0, 0)
  return depthCanvas
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
  // depth for the whole frame; 'foreground' = a per-pixel crossed-parallax
  // depth stage built from the picture's own saliency (bright or detailed,
  // centered shapes cross HARD toward the camera — several times the
  // classic offset — while dark flat edges recede gently behind the screen
  // plane).
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
  // 'foreground': the snap is re-projected into two per-eye views on the
  // GPU depth warp — every pixel offset horizontally by its own depth
  // (near: crossed parallax, pops OUT in front of the screen plane; far:
  // uncrossed, behind it; the pinned border stays glued). Each lens's
  // tint list then channelizes its view exactly like the sides mode —
  // base tint on the displaced frame, extra tints one scalar step further
  // out per lens. The views come back complete, so there is no gap
  // patching. depthPop collapses the whole stage to the center line
  // (clean recombine); a flipped kick inverts the field (near ↔ far, the
  // stage turns inside-out).
  const out = getWork('anaglyph:out', W, H)
  const oc = resetWork(out.getContext('2d')!)
  oc.fillStyle = '#000000'
  oc.fillRect(0, 0, W, H)
  oc.globalCompositeOperation = 'lighter'
  const tint = getWork('anaglyph:tint', W, H)
  if (fgMode) {
    // The depth stage: build the per-pixel saliency field from the finished
    // frame, then re-project it once per eye on the GPU warp — amp at
    // FG_WARP_GAIN× the classic half-separation with the shader's steep
    // near slope on top, so a fully-near subject crosses at ~3.3× the
    // classic per-eye offset (the exaggerated foreground pop) while the
    // far slope keeps the backdrop's recession gentle; the pinned border
    // stays glued. The two views come back opaque and complete, so the
    // lenses channelize them exactly like the sides mode — no gap
    // patching, no alpha clips. Tracer tints keep stepping at the classic
    // dxPop so multi-tint trails stay on the frame.
    const depthGrid = buildDepthField(snap, W, H, getWork('anaglyph:depth', 128, 72))
    const vl = getWork('anaglyph:vl', W, H)
    const vr = getWork('anaglyph:vr', W, H)
    const warped = warpDepthViews(snap, depthGrid, vl, vr, dxPop * FG_WARP_GAIN * dir)
    if (!warped) {
      // No WebGL on this device — fall back to the classic uniform spread
      // so the glasses still read.
      const vlc = resetWork(vl.getContext('2d')!)
      vlc.clearRect(0, 0, W, H)
      vlc.drawImage(snap, -Math.round(dxPop * dir), 0)
      const vrc = resetWork(vr.getContext('2d')!)
      vrc.clearRect(0, 0, W, H)
      vrc.drawImage(snap, Math.round(dxPop * dir), 0)
    }
    leftTints.forEach((color, i) => {
      channelize(tint, vl, color, W, H)
      oc.drawImage(tint, -i * dxPop * dir, 0)
    })
    rightTints.forEach((color, i) => {
      channelize(tint, vr, color, W, H)
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
