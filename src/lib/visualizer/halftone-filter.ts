/**
 * Halftone filter — newspaper print over the whole frame.
 *
 * The picture is resampled onto a 45°-rotated dot grid (the classic newspaper
 * screen angle) and DOTS are laid over it — but only where the tone is dark
 * enough: `dotRange` sets the luminance threshold ("only halftone the darker
 * colors, leave the rest intact"). Inside the dotted range the dot AREA grows
 * with darkness (dot radius ∝ √depth), so deep shadows merge into solid ink
 * exactly like real halftone print. Lighter areas never get a dot.
 *
 * Before printing, the picture itself can be conditioned. `grayscale` and
 * `contrast` run as one GPU filter pass (CSS filter chain on a work canvas,
 * drawn straight back over the frame) BEFORE the screen reads the tones, so
 * the print always follows the picture the user actually sees. `invert` is
 * the deliberate exception: it runs as ONE pass at the very END of the
 * filter — flipping the finished print (picture AND ink) into a photo
 * negative. Feeding the negative to the screen instead would leave a dark
 * scene with no dark tones below the threshold and wipe the whole print off
 * the frame; and flipping ONLY the picture (the old behavior) breaks the
 * ink: any ink whose lightness lands near the negative background's (a
 * light ink over this dark scene) becomes invisible — white dots on white
 * paper. Flipping the composite conserves contrast exactly — the print is
 * precisely as visible as it was before the flip, whatever the ink and the
 * scene. With everything at defaults both passes are skipped entirely
 * (zero cost, pixel-identical output).
 *
 * `beatFlip` (Flip on kick) swaps the whole look on the beat, in either
 * direction: 'picture' (default) rests as the print between kicks and
 * flashes the untouched regular picture on a kick — print and negative, if
 * on, dissolve together; 'print' is the mirror image — the regular picture
 * rests between kicks and the print stamps in on the kick, then fades back
 * out. The kick is detected by ONSET, not level: the detector watches how
 * fast the bass RISES over a short window (a kick = sharp rise; a long bass
 * note = high level, flat top, no rise), with an adaptive threshold that
 * follows the track's local punch — so sustained bass never pins the swap
 * open and soft kicks in quiet passages still fire. `flipSensitivity` sets
 * how sharp a hit must be, `flipHold` pins the swap fully open for a
 * dialled time before a short 0.25 s release (a per-canvas envelope driven
 * by SONG time — deterministic, preview and export agree), and `flipMono`
 * keeps the picture conditioning (Grayscale/Contrast) on the kick side so
 * only the dots come and go instead of the color flashing back.
 *
 * The ink is black by default but can be any color, or a two-color gradient
 * whose angle drifts slowly with song time and swings with the low end —
 * recoloring happens on the ink canvas with one 'source-in' fill (paints the
 * new color into the dots' coverage silhouette), never per-pixel.
 * How it stays fast & deterministic (pure canvas ops, one tiny getImageData):
 *   1. The LIVE frame is drawn rotated -45° straight into a TINY n×n canvas
 *      (one pixel per grid cell) — the browser's downscale smoothing does the
 *      area averaging for free. No full-resolution snapshot is ever made and
 *      the grid canvas stays GPU-backed (NO willReadFrequently hint — a CPU
 *      backing store here would force a full-frame GPU→CPU readback of the
 *      live canvas on every single frame), so the only CPU read is the small
 *      n×n grid itself.
 *   2. One getImageData on that small grid, one JS pass that stamps every
 *      dark cell's dot into a reusable full-frame INK BUFFER (see below).
 *   3. One putImageData onto an offscreen ink canvas, one drawImage onto the
 *      frame — the ink never touches a Path2D.
 * No randomness, no time — same frame in, same dots out, in every pipeline
 * (the dot coverage is computed in JS, so it no longer depends on the
 * browser's path anti-aliasing at all).
 *
 * Why sprites instead of Path2D: a frame can carry tens of thousands of dots
 * and Skia's build+scan-convert of that many AA circles measured ~40 ms per
 * frame (measured 7.6 ms path build + 31.9 ms fill at 23k dots). Radii are
 * quantized to a GEOMETRIC ladder of ~2%-area rungs (see below) and each
 * (radius × sub-pixel offset) variant is rasterized EXACTLY ONCE into a tiny
 * coverage sprite — supersampled with a size-aware soft rim, so even 1 px
 * specks render as round ink blobs instead of the square/plus/X clusters
 * that spelled an artificial grid on gradients; stamping is then a max-blend
 * copy (~3 ms for the whole frame, measured), and alpha-max reproduces the
 * same dot-union a nonzero Path2D fill paints.
 */
import type { AudioFrame, HalftoneFilterConfig, RenderContext } from './types'
import { clamp01, getWork, resetWork } from './filter-utils'

/* --------------------------------- ink sprites --------------------------------- */

/** A pre-rasterized anti-aliased dot: coverage bytes over a (2·box+1)² square. */
interface DotSprite {
  a: Uint8Array
  box: number
}

// Radius ladder — rungs at R_MIN·(1+RUNG_GROW)^k, ABSOLUTE constants (they do
// not move with rMax) so sprite keys stay stable while beat-reactive press
// swings every frame — the cache never churns mid-song.
//
// Why GEOMETRIC (and why the old 24-linear steps had to go): a multiplicative
// ladder keeps the dot AREA step constant (~2%) at every size. The old linear
// ladder quantized radii in ~0.07 px jumps, and on a smooth gradient that made
// every dot inside a contour band exactly the same size — whole ROWS of
// same-size dots lined up into visible bands following the luminance contours
// (horizontal bands on a horizontal ramp, vertical on a vertical one, both at
// once on 2-D gradients). At small dot sizes those bands crossed into exactly
// what users reported: an artificial square-looking grid over smooth colors.
// A 2% area rung sits below the eye's contrast step, and the size changes
// every 1–2 cells instead of every 3–10, so no coherent rows survive.
const R_MIN = 0.4 // smallest dot worth stamping (a sub-pixel speck)
const RUNG_GROW = 0.01 // +1% radius per rung ≈ +2% dot area per rung
const LOG_RUNG = Math.log(1 + RUNG_GROW)
const INV_R_MIN = 1 / R_MIN
const MAX_RUNGS = 4096 // hard stop; rMax clamps far below this in practice
const rungRadii: number[] = [] // rung index → exact radius, filled on demand

// Ladder-position lookup table — the hot loop's only new math. Dots are the
// most numerous thing in the filter (up to ~10⁵ per frame), and a per-dot
// Math.log measured ~15–20% slower frames; tabulating the (pure, monotonic)
// ladder position at 1/512 px turns it into one array read. Worst-case
// tabulation error: |d(ladder)/dr| = 1/(r·ln 1.01), so ±1/1024 px of radius
// bends the position by ≤ 0.24 rungs at the smallest dot (r = 0.4) and ≤
// 0.02 rungs at r = 4 — i.e. ≤ 0.24% radius noise, an order of magnitude
// below the rung spacing itself. Table covers r ≤ 128 px — far beyond any
// real dot (rMax ≤ ~15 px even at 1080p), so no clamping branch is needed.
const LADDER_LUT_STEP = 512
const LADDER_LUT = new Float32Array(65536)
for (let i = 0; i < LADDER_LUT.length; i++) {
  LADDER_LUT[i] = Math.log(((i + 0.5) / LADDER_LUT_STEP) * INV_R_MIN) / LOG_RUNG
}

function rungRadius(lvl: number): number {
  let r = rungRadii[lvl]
  if (r === undefined) {
    r = R_MIN * Math.exp(lvl * LOG_RUNG)
    rungRadii[lvl] = r
  }
  return r
}

/*
 * Sprite store — a flat array indexed by (rung, oy, ox) instead of a
 * string-keyed Map. The finer ladder (hundreds of rungs × 25 offset variants)
 * pushes the variant count into the thousands, and the old per-dot cost of
 * building a template-string key and hashing it through a big Map showed up
 * in frame times; the key space here is fully enumerable
 * (lvl·5 + oy)·5 + ox, so a direct array slot does the same job with zero
 * allocation and zero hashing. The working set is bounded by the lattice
 * itself (only rungs the current dotSize actually reaches are ever built —
 * ≤ ~6,000 sprites ≈ 2 MB at the finest real settings), so it can never
 * churn or grow without bound.
 */
const SPRITE_O = 5 // offset grid: ox, oy ∈ {−0.5, −0.25, 0, 0.25, 0.5}
const spriteLut: (DotSprite | undefined)[] = []

/**
 * Coverage sprite for ladder rung `lvl` at offset indices (oxIdx, oyIdx) —
 * the sub-pixel offset is (idx − 2) / 4 px from the integer stamp position.
 *
 * Two fidelity layers, both pure deterministic math (same frame in, same
 * coverage out, in every pipeline):
 *   1. SOFT RIM — the coverage ramp width grows as dots shrink (2.1 px on the
 *      smallest specks → the classic 1 px canvas-AA edge at r ≥ 2.6). At the
 *      tiny radii the small dial sizes produce, a hard-edged disc cannot be
 *      round — it rasterizes into the square / plus / X pixel clusters that
 *      read as an artificial grid on smooth gradients. A wider radial falloff
 *      turns those same dots into graded round blobs, exactly how a real ink
 *      dot bleeds into the paper.
 *   2. 4×4 SUPERSAMPLING — each sprite pixel averages the soft coverage over
 *      a 4×4 subsample grid, so the ramp is measured, not stabbed at one
 *      center point: edges grade smoothly and the dot's total ink matches its
 *      dialled area.
 * Each (rung, offset) sprite is rasterized EXACTLY ONCE; the rim width
 * derives from the rung alone, so (lvl, oxIdx, oyIdx) is a complete key.
 */
function getSprite(lvl: number, oxIdx: number, oyIdx: number): DotSprite {
  const slot = (lvl * SPRITE_O + oyIdx) * SPRITE_O + oxIdx
  let s = spriteLut[slot]
  if (!s) {
    const r = rungRadius(lvl)
    const ox = (oxIdx - 2) / 4
    const oy = (oyIdx - 2) / 4
    // Soft-rim width: 2.1 px on the smallest specks, easing down to the
    // classic 1 px edge by r = 2.6 — big dots keep the crisp print look.
    const rim = r >= 2.6 ? 1 : 1 + 1.1 * ((2.6 - r) / 2.2)
    const box = Math.ceil(r + rim * 0.5) + 1
    const a = new Uint8Array((2 * box + 1) * (2 * box + 1))
    let p = 0
    const SUB = 4 // 4×4 subsamples per sprite pixel
    const SUB2 = SUB * SUB
    const halfRim = rim * 0.5
    for (let dy = -box; dy <= box; dy++) {
      for (let dx = -box; dx <= box; dx++) {
        let cov = 0
        for (let sy = 0; sy < SUB; sy++) {
          const ddy = dy + (sy + 0.5) / SUB - oy
          const dy2 = ddy * ddy
          for (let sx = 0; sx < SUB; sx++) {
            const ddx = dx + (sx + 0.5) / SUB - ox
            const d = Math.sqrt(ddx * ddx + dy2)
            cov += Math.min(1, Math.max(0, (r + halfRim - d) / rim))
          }
        }
        a[p++] = Math.round((cov / SUB2) * 255)
      }
    }
    s = { a, box }
    spriteLut[slot] = s
  }
  return s
}

/* --------------------------------- ink buffer ---------------------------------- */

/** Full-frame RGBA scratch (black + stamped alpha), reused across frames. */
const inkBuffers = new Map<string, { buf: Uint8ClampedArray; img: ImageData }>()

function getInkBuffer(W: number, H: number): { buf: Uint8ClampedArray; img: ImageData } {
  const key = `${W}x${H}`
  let e = inkBuffers.get(key)
  if (!e) {
    const buf = new Uint8ClampedArray(W * H * 4)
    e = { buf, img: new ImageData(buf, W, H) } // ImageData views the SAME buffer
    inkBuffers.set(key, e)
  }
  e.buf.fill(0)
  return e
}

/* ----------------------------------- filter ------------------------------------ */

/*
 * Flip onset detector + hold state, per canvas context: the live preview and
 * each offline export run their own envelope, so interleaved pipelines never
 * see each other's kicks. Driven by SONG time (frame.time), never the wall
 * clock — same frame sequence in, same envelope out, which is what keeps
 * exports frame-exact against the preview.
 */
interface FlipGateState {
  env: number // the swap's drive level 0..1
  holdLeft: number // seconds of fully-swapped time left
  lastT: number // last song time seen (seek / loop detection)
  // --- onset detector ---
  hist: Float32Array // recent bass samples (ring buffer)
  histT: Float32Array // their song times
  histLen: number
  histHead: number
  act: number // slow EMA of the bass rise — the track's recent punch scale
  lvl: number // slow EMA of the bass level — scales the sensitivity bar
  lastKickT: number // song time of the last fired kick (refractory)
  armed: boolean // re-arms only after the bass dips — one gesture, one fire
  peakSinceFire: number // loudest bass since the last fire (dip reference)
}
const flipStates = new WeakMap<CanvasRenderingContext2D, FlipGateState>()
/** Seconds the swap takes to fall back once the hold runs out. */
const FLIP_RELEASE = 0.25
/**
 * Rise window: the detector compares the bass to its LOWEST sample this many
 * seconds back. Long enough to catch a smoothed kick's whole attack, short
 * enough that a sustained note's flat top slides back to "no rise" — which
 * is exactly what a level gate could never tell apart.
 */
const RISE_WINDOW = 0.09
/** History capacity: 90 ms at 240 fps ≈ 22 samples; 32 is comfortably safe. */
const RISE_CAP = 32
/** Time constants (s) of the adaptive activity (rise) and level EMAs. */
const ACT_TAU = 1.5
const LVL_TAU = 2.0
/** One kick fires once: same-kick re-rises inside this window are ignored. */
const REFRACTORY = 0.13
/** Absolute silence floor and cap for the trigger threshold. */
const NOISE_FLOOR = 0.045
const THR_CAP = 0.5

/**
 * The flip's drive level 0..1, fired by bass ONSETS. The detector tracks how
 * fast the bass rises over a short lookback window and compares that rise to
 * an adaptive threshold (a multiple of the recent rise activity plus an
 * absolute bar that lowers in quiet passages) — so a kick fires once on the
 * hit, a sustained bass note fires only at its attack (its flat top never
 * re-arms anything), and a slow swell never fires at all. A fired kick pins
 * the level at 1 for the hold dial's time — the swap stays fully swapped
 * whatever the kick's tail does — then falls back over a short linear
 * release. Seeks / loop restarts (song time moving backward) drop the stale
 * envelope AND the stale detector history.
 */
export function flipGate(
  ctx: CanvasRenderingContext2D,
  bass: number,
  time: number,
  sens: number,
  holdSec: number,
): number {
  let st = flipStates.get(ctx)
  if (!st) {
    st = {
      env: 0,
      holdLeft: 0,
      lastT: time,
      hist: new Float32Array(RISE_CAP),
      histT: new Float32Array(RISE_CAP),
      histLen: 0,
      histHead: 0,
      act: 0,
      lvl: bass, // start the level EMA at the current level (no cold-start)
      lastKickT: -Infinity,
      armed: true,
      peakSinceFire: 0,
    }
    flipStates.set(ctx, st)
  }
  if (time < st.lastT) {
    // Seek / loop restart — the envelope and the detector history are stale.
    st.env = 0
    st.holdLeft = 0
    st.histLen = 0
    st.act = 0
    st.lvl = bass
    st.lastKickT = -Infinity
    st.armed = true
    st.peakSinceFire = bass
  }
  const dt = Math.min(0.1, Math.max(0, time - st.lastT))
  st.lastT = time

  // --- Onset detector -------------------------------------------------------
  // Push the current bass into the short history ring.
  st.hist[st.histHead] = bass
  st.histT[st.histHead] = time
  st.histHead = (st.histHead + 1) % RISE_CAP
  if (st.histLen < RISE_CAP) st.histLen++
  // The rise over the lookback window: current bass minus the lowest sample
  // still inside the window. A kick lifts this for a few frames as the
  // window slides over the attack (robust against analyzer smoothing, which
  // spreads the attack over several frames); a sustained note's flat top
  // slides back to ~0 — no rise, no fire, no pinning.
  const cutoff = time - RISE_WINDOW
  let min = bass
  for (let i = 1; i <= st.histLen; i++) {
    const idx = (st.histHead - i + RISE_CAP) % RISE_CAP
    if (st.histT[idx] < cutoff) break
    const v = st.hist[idx]
    if (v < min) min = v
  }
  const rise = bass - min
  // Adaptive scale, dt-weighted so any frame rate walks the same envelope:
  // `act` follows the recent rise activity (how punchy the track is right
  // now), `lvl` the recent bass level (how loud it is).
  if (dt > 0) {
    st.act += (rise - st.act) * (1 - Math.exp(-dt / ACT_TAU))
    st.lvl += (bass - st.lvl) * (1 - Math.exp(-dt / LVL_TAU))
  }
  // Sensitivity dials the trigger bar: a relative multiple of the recent
  // activity plus an absolute bar that eases down in quiet passages, so
  // breakdowns still fire on their (smaller) kicks. Lower sensitivity = a
  // higher bar (only true slams), higher sensitivity = a lower one (every
  // hit). The cap keeps even a machine-gun low end from demanding the
  // impossible, the floor keeps digital silence from firing.
  const relMult = 2.3 - 1.6 * sens
  const base = (0.26 - 0.19 * sens) * (0.3 + 0.7 * clamp01(st.lvl / 0.5))
  const thr = Math.min(THR_CAP, Math.max(NOISE_FLOOR, st.act * relMult + base))
  // One GESTURE fires once: after a fire the detector disarms and only
  // re-arms once the bass has dipped meaningfully below its loudest level
  // since that fire — a sustained note (or any long riser) never dips, so it
  // can never machine-gun the flip; real kicks always dip between hits.
  if (bass > st.peakSinceFire) st.peakSinceFire = bass
  else if (bass < st.peakSinceFire * 0.85) st.armed = true
  let fired = false
  if (st.armed && rise > thr && time - st.lastKickT >= REFRACTORY) {
    fired = true
    st.lastKickT = time
    st.holdLeft = holdSec
    st.armed = false
    st.peakSinceFire = bass
  }

  // --- Envelope ---------------------------------------------------------------
  if (st.holdLeft > 0) {
    // Hold phase: the swap stays fully open whatever the kick does.
    st.holdLeft = Math.max(0, st.holdLeft - dt)
    st.env = 1
  } else if (fired) {
    // Hold dial at 0: still a full-strength flash on the kick frame itself.
    st.env = 1
  } else if (st.env > 0) {
    // Release: instant attack (above), then a short linear fall back to rest.
    st.env = Math.max(0, st.env - dt / FLIP_RELEASE)
  }
  return st.env
}

export function drawHalftoneFilter(
  rc: RenderContext,
  cfg: HalftoneFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass' | 'time'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  const S = H / 720

  // Flip on kick — the print and the regular picture SWAP on the beat.
  // 'picture' (default): between kicks the frame rests as the dialed-in
  // halftone print; on a solid low-end hit the whole look (print and, if
  // on, the negative) dissolves into the untouched regular picture, then
  // settles back as the kick decays. 'print': the mirror image — the
  // regular picture rests between kicks and the print stamps in on the
  // kick, then fades back out as the kick decays. Driven by the same
  // smoothed bass field as every other beat reaction, so exports match
  // the preview frame-exactly. At rest (and with the toggle off) everything
  // below costs exactly what it cost before.
  const bass = clamp01(frame.bass)
  const flipOn = !!cfg.beatFlip
  const flipToPrint = flipOn && cfg.beatFlipTo === 'print'
  // Kick sensitivity — how sharp a low-end hit must land before the flip
  // fires. The detector listens for the HIT, not the loudness: it tracks how
  // fast the bass RISES, so a long bass note (high level, no rise) never
  // pins the swap open, and quiet passages still fire on their real kicks.
  // 50% (the default) is a balanced gate; lower sensitivity raises the bar
  // toward "true slams only", higher drops it toward "every hit".
  const flipSens = clamp01(cfg.flipSensitivity ?? 0.5)
  // Flip hold — how long the swap stays FULLY swapped after a fired kick
  // before it fades back over 0.25 s (the dial spans 0–2 s). 0 gives a
  // quick full-strength flash per kick.
  const holdSec = clamp01(cfg.flipHold ?? 0) * 2
  const flipT = flipOn ? flipGate(ctx, bass, frame.time, flipSens, holdSec) : 0
  // "Stay black & white" — the kick side of the swap keeps the picture
  // conditioning below instead of flashing back to the untouched color
  // picture, so only the dots come and go. A no-op without conditioning.
  const flipMono = flipOn && !!cfg.flipMono

  // Picture conditioning pass — grayscale + contrast, always applied while
  // the filter is on (independent of the ink dials below). One GPU pass:
  // draw the live frame onto a work canvas through the CSS filter chain,
  // draw it straight back. These two shape the picture AND the print (the
  // screen samples what they produce). Defaults skip this. Defined BEFORE
  // the flip early exits so "Stay black & white" can run it on the
  // kick-side frames that would otherwise show the raw picture.
  const grayscale = !!cfg.grayscale
  const invert = !!cfg.invert
  const contrast = clamp01(cfg.contrast ?? 0.5)
  const preF: string[] = []
  if (grayscale) preF.push('grayscale(1)')
  if (Math.abs(contrast - 0.5) > 1e-3)
    preF.push(`contrast(${(contrast * 2).toFixed(4)})`) // 0.5 → 1.0 = untouched
  const applyConditioning = () => {
    if (!preF.length) return
    const cond = getWork('ht:cond', W, H)
    const cctx = resetWork(cond.getContext('2d')!)
    cctx.filter = preF.join(' ')
    cctx.drawImage(ctx.canvas, 0, 0, W, H)
    cctx.filter = 'none'
    ctx.drawImage(cond, 0, 0, W, H)
  }

  if (!flipToPrint && flipT >= 0.999) {
    // Kick peak, picture direction: the regular picture alone — even the
    // picture conditioning is skipped, so the flash shows the frame exactly
    // as the earlier filters left it (with Stay black & white on, the
    // conditioning IS applied first so the flash keeps the mono look).
    if (flipMono) applyConditioning()
    return
  }
  if (flipToPrint && flipT <= 0.001) {
    // Rest, print direction: the regular picture alone — zero cost, the
    // frame is exactly as the earlier filters left it (with Stay black &
    // white on, the conditioning runs so the rest keeps the mono look).
    if (flipMono) applyConditioning()
    return
  }
  let raw: HTMLCanvasElement | null = null
  // Which side of the swap shows the untouched frame: in the picture
  // direction it dissolves IN over the finished print as the kick lands;
  // in the print direction it dissolves OUT as the print stamps in.
  const rawA = flipToPrint ? 1 - flipT : flipT
  if (flipMono) {
    // "Stay black & white" conditions BEFORE the raw snapshot so the
    // dissolving picture is the mono one too — the whole swap then happens
    // inside the mono look, with no color popping through mid-crossfade
    // (conditioning after the snapshot would leave the dissolving side
    // full-color while the peak/rest sides are mono — a visible jump at
    // the swap's edges). The pass below is skipped when this ran.
    applyConditioning()
  }
  if (flipOn && rawA > 0.001) {
    // Keep the untouched frame around so the swap can dissolve between
    // the print state and the regular picture (one full-frame GPU copy,
    // and only while a kick is landing or fading).
    raw = getWork('ht:raw', W, H)
    resetWork(raw.getContext('2d')!).drawImage(ctx.canvas, 0, 0, W, H)
  }
  // The swap itself: the regular picture dissolves over the finished
  // print state — the last step of every exit below while the flip is
  // mid-swap. In the picture direction the negative dissolves with the
  // print, so the flash is always the true regular picture even when
  // Invert is on; in the print direction the picture dissolves out as
  // the (optionally negative) print stamps in.
  const finishFlip = () => {
    if (!raw) return
    ctx.save()
    ctx.globalAlpha = rawA
    ctx.drawImage(raw, 0, 0)
    ctx.restore()
  }

  // 0) Picture conditioning — run the pass defined above (one GPU pass;
  //    the defaults skip it inside). Shapes the picture AND the print.
  //    "Stay black & white" already conditioned up above (before the raw
  //    snapshot), and running it twice would double the contrast.
  if (!flipMono) applyConditioning()

  // The negative flip — one GPU pass that inverts whatever is currently on
  // the frame. Runs at the very END (after the ink is laid down) so picture
  // and print flip TOGETHER: a true photo negative whose contrast — and
  // therefore print visibility — is conserved for any ink color. At 0 ink
  // (or when nothing is dark enough to print) it still runs, so a bare
  // negative shows instead of silently doing nothing.
  const flipNegative = () => {
    const cond = getWork('ht:cond', W, H)
    const cctx = resetWork(cond.getContext('2d')!)
    cctx.filter = 'invert(1)'
    cctx.drawImage(ctx.canvas, 0, 0, W, H)
    cctx.filter = 'none'
    ctx.drawImage(cond, 0, 0, W, H)
  }

  // Beat reactive: on a kick the print LIFTS — dots shrink back, the ink
  // fades and the shadow range narrows, so the clean picture pops through
  // for a moment; between beats the print rests exactly as dialed in.
  const beatOn = !!cfg.beatReactive
  const punch = clamp01(cfg.beatStrength ?? 0.5)
  // Beat pop dial — wide variance: the response runs PAST the old ceiling so
  // the dial spans from a gentle breath to the print lifting clean off the
  // page. lift ≤ 1 caps the ink fade at ~25% (the old max); beyond that the
  // fade continues to ZERO at lift 1.35, so a full-dial kick on a hard low
  // end wipes the print entirely and it snaps back between kicks. The power
  // curve (1.3) keeps the low half gentle while 1.9·bass pushes the top end
  // over the cap on real kicks. Deterministic AudioFrame fields only, so
  // exports match the preview frame-exactly.
  const lift = beatOn ? Math.min(1.35, Math.pow(punch, 1.3) * 1.9 * bass) : 0
  // While Flip on kick is on (picture direction), a kick drives the lift
  // all the way to the clean-off ceiling (1.35) no matter where the Beat
  // pop dial sits — the swap IS the full pop. In the print direction the
  // print is the thing ARRIVING on the kick, so it stamps in exactly as
  // dialed — no extra clean-off boost (the crossfade does the swap).
  // Toggle off → this is exactly the old lift.
  const effLift = flipToPrint ? lift : Math.max(lift, flipT * 1.35)
  const press = 1 - 0.5 * effLift // dots back off on the kick (ink lifts off the page)
  const cell = Math.max(
    3,
    Math.round(Math.max(3, Math.min(14, cfg.dotSize)) * S * (1 + 0.22 * effLift)),
  )
  const range = Math.max(0.001, clamp01(cfg.dotRange) - 0.32 * effLift)
  // The bottom clamp lets a full-dial kick on a hard low end — or any kick
  // while Flip on kick is on (lift → 1.35) — take the ink to exactly zero:
  // the print lifts clean off, the picture alone flashes through, then the
  // print snaps back between kicks.
  const strength = clamp01(cfg.strength) * Math.max(0, 1 - 0.75 * effLift)

  // 0 ink → just the (optionally negative) picture, no print — checked
  // BEFORE the grid is resampled: there is nothing to print, so the tiny
  // n×n draw is skipped too.
  if (range <= 0.001 || strength <= 0.001) {
    if (invert) flipNegative()
    finishFlip()
    return
  }

  const diag = Math.ceil(Math.hypot(W, H))
  const n = Math.ceil(diag / cell)
  const cellS = diag / n // exact pitch so sampling & dots never drift apart

  // 1) Resample the live frame into rotated space — one pixel per grid cell.
  //    Dest pixel d must end up holding the frame color at
  //    fp(d) = center + R(45°)·(d − center)·cellS, so the draw transform is
  //    its inverse: translate(n/2) · scale(1/cellS) · rotate(−45°) ·
  //    translate(−W/2, −H/2). Reading straight from the frame canvas skips
  //    the full-resolution snapshot copy the old version made — and keeping
  //    this canvas GPU-backed (no willReadFrequently) keeps that read a
  //    GPU→GPU downscale; the follow-up getImageData only pulls the tiny
  //    grid back to the CPU.
  const sample = getWork('ht:sample', n, n)
  const smCtx = resetWork(sample.getContext('2d')!)
  smCtx.clearRect(0, 0, n, n)
  smCtx.imageSmoothingEnabled = true
  // 'high' engages the browser's mipmapped downscale, so each grid cell holds
  // a proper area average of the frame instead of a 2×2 bilinear stab —
  // detailed sources no longer leak pixel-level speckle into the dot sizes
  // (speckle that used to sparkle as grid noise over smooth gradients).
  smCtx.imageSmoothingQuality = 'high'
  smCtx.setTransform(1, 0, 0, 1, n / 2, n / 2)
  smCtx.scale(1 / cellS, 1 / cellS)
  smCtx.rotate(-Math.PI / 4)
  smCtx.translate(-W / 2, -H / 2)
  smCtx.drawImage(ctx.canvas, 0, 0, W, H)

  // 2) One read of the tiny grid; stamp every dark cell's dot into the ink
  //    buffer. Grid coords g live in ROTATED space (origin = frame center) —
  //    the same mapping the sampler used — and each dot lands at
  //    screen = center + R(45°)·g, so every dot sits exactly on its cell.
  const data = smCtx.getImageData(0, 0, n, n).data
  const ink = getInkBuffer(W, H)
  const buf = ink.buf
  const SQ = Math.SQRT1_2
  const rMax = cellS * 0.72 * press
  // Deepest reachable rung for this frame's widest dot.
  const maxLvl = Math.min(
    MAX_RUNGS,
    Math.max(0, Math.floor(Math.log(rMax * INV_R_MIN) / LOG_RUNG)),
  )
  let dots = 0
  for (let j = 0; j < n; j++) {
    const gy = (j + 0.5 - n / 2) * cellS
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 4
      if (data[k + 3] < 120) continue // outside the rotated frame footprint
      const lum = (0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]) / 255
      if (lum >= range) continue // lighter than the threshold → untouched
      const depth = (range - lum) / range // 0 at threshold → 1 at pure black
      const r = Math.sqrt(depth) * cellS * 0.72 * press // ink area grows with darkness
      if (r < 0.4) continue
      const gx = (i + 0.5 - n / 2) * cellS
      // Stamp position: R(45°)·(gx, gy) + center, snapped to the pixel grid
      // with the sub-pixel residue carried by the sprite variant at 1/4 px
      // steps (≤ 0.125 px center error). The old 1/2 px steps left a periodic
      // position error whose beat against the pixel grid aligned dot
      // columns/rows into faint stripes at small dot sizes — half the
      // quantization error removes the beat's contrast, and the dot LATTICE
      // stays just as true.
      const fx = W / 2 + (gx - gy) * SQ
      const fy = H / 2 + (gx + gy) * SQ
      const sx = Math.round(fx)
      const sy = Math.round(fy)
      // Residue ∈ [−0.5, 0.5); ×4 rounding yields indices 0..4 ⇔ offsets
      // {−0.5, −0.25, 0, 0.25, 0.5} — every value is a legitimate sub-pixel
      // stamp position, so NO wrapping/folding of the residue (folding here
      // once silently displaced a quarter of the dots by up to a full pixel).
      const oxIdx = Math.round((fx - sx) * 4) + 2
      const oyIdx = Math.round((fy - sy) * 4) + 2
      // Continuous ladder position of this dot's radius (tabulated — see the
      // LADDER_LUT note); round to the nearest rung — the ~2%-area rung
      // spacing keeps that quantization below the eye's contrast step on any
      // gradient.
      const lr = LADDER_LUT[(r * LADDER_LUT_STEP) | 0]
      const lvl = Math.min(maxLvl, Math.round(lr))
      const sp = getSprite(lvl, oxIdx, oyIdx)
      const box = sp.box
      const x0 = sx - box
      const y0 = sy - box
      if (x0 >= W || y0 >= H || x0 + 2 * box < 0 || y0 + 2 * box < 0) continue
      const a = sp.a
      const stride = 2 * box + 1
      const yy0 = Math.max(0, y0)
      const yy1 = Math.min(H - 1, y0 + 2 * box)
      const xx0 = Math.max(0, x0)
      const xx1 = Math.min(W - 1, x0 + 2 * box)
      for (let yy = yy0; yy <= yy1; yy++) {
        let o = (yy * W + xx0) * 4 + 3 // alpha byte of black RGBA
        let s = (yy - y0) * stride + (xx0 - x0)
        for (let xx = xx0; xx <= xx1; xx++) {
          const v = a[s++]
          if (v > buf[o]) buf[o] = v // alpha-max = the Path2D dot union
          o += 4
        }
      }
      dots++
    }
  }
  if (!dots) {
    // Nothing dark enough to print → the frame is just the (optionally
    // negative) picture.
    if (invert) flipNegative()
    finishFlip()
    return
  }

  // 3) Lift the ink onto the frame: one putImageData into the offscreen ink
  //    canvas, optional recolor, one drawImage at the dialed ink strength
  //    (same alpha math as the old Path2D fill: ink at coverage × strength,
  //    source-over).
  const inkCanvas = getWork('ht:ink', W, H)
  const ictx = resetWork(inkCanvas.getContext('2d')!)
  ictx.putImageData(ink.img, 0, 0)
  const inkColor = cfg.inkColor ?? '#000000'
  if (cfg.gradient || inkColor !== '#000000') {
    // Recolor the coverage silhouette with one 'source-in' fill. Black (the
    // default) skips this — the buffer is already black, so the classic look
    // pays zero extra GPU work.
    ictx.globalCompositeOperation = 'source-in'
    if (cfg.gradient) {
      // Gradient angle = slow constant drift + a swing driven by the song's
      // low end, both scaled by the motion dial (0 = static gradient). All
      // inputs are song time / audio fields, so exports match the preview
      // frame-exactly.
      const motion = clamp01(cfg.gradientMotion ?? 0.5)
      const ang = motion * 2 * Math.PI * (0.05 * (frame.time ?? 0) + 0.75 * bass)
      const R = diag / 2
      const grad = ictx.createLinearGradient(
        W / 2 - Math.cos(ang) * R,
        H / 2 - Math.sin(ang) * R,
        W / 2 + Math.cos(ang) * R,
        H / 2 + Math.sin(ang) * R,
      )
      grad.addColorStop(0, inkColor)
      grad.addColorStop(1, cfg.inkColor2 ?? '#f59e0b')
      ictx.fillStyle = grad
    } else {
      ictx.fillStyle = inkColor
    }
    ictx.fillRect(0, 0, W, H)
    ictx.globalCompositeOperation = 'source-over'
  }
  ctx.save()
  ctx.globalAlpha = strength
  ctx.drawImage(inkCanvas, 0, 0)
  ctx.restore()

  // 4) The negative, LAST: flip the finished print — picture and ink
  //    together — so the print's contrast (and visibility) is exactly what
  //    it was before the flip, for any ink color and any scene. The screen
  //    sampled the pre-flip picture back in step 1, so the dot placement is
  //    untouched by the flip.
  if (invert) flipNegative()
  finishFlip()
}
