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
 * `beatFlip` (Flip on kick) swaps the whole look on the beat: the print
 * rests on the frame between kicks, and on a solid low-end hit the entire
 * print — and the negative, if on — dissolves into the untouched regular
 * picture, then settles back as the kick decays.
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
 * quantized to ~24 invisible steps (≤ 0.35 px on a several-px dot) and each
 * (radius × sub-pixel offset) variant is rasterized EXACTLY ONCE into a tiny
 * coverage sprite; stamping is then a max-blend copy (~3 ms for the whole
 * frame, measured), and alpha-max reproduces the same dot-union a nonzero
 * Path2D fill paints.
 */
import type { AudioFrame, HalftoneFilterConfig, RenderContext } from './types'
import { clamp01, getWork, resetWork } from './filter-utils'

/* --------------------------------- ink sprites --------------------------------- */

/** A pre-rasterized anti-aliased dot: coverage bytes over a (2·box+1)² square. */
interface DotSprite {
  a: Uint8Array
  box: number
}

const SPRITE_LEVELS = 24 // radius steps across [0.4, rMax] — ≤ ~0.35 px quantization
const sprites = new Map<string, DotSprite>()

/**
 * Coverage sprite for a dot of radius `r` centered at (ox, oy) sub-pixel
 * offset from the integer stamp position. Coverage ramps linearly over the
 * same ~1 px band canvas AA uses, so dot edges keep the exact same softness
 * the old Path2D fill produced — just computed deterministically in JS.
 */
function getSprite(r: number, ox: number, oy: number): DotSprite {
  const key = `${Math.round(r * 32)}|${ox}|${oy}`
  let s = sprites.get(key)
  if (!s) {
    const box = Math.ceil(r) + 1
    const a = new Uint8Array((2 * box + 1) * (2 * box + 1))
    let p = 0
    for (let dy = -box; dy <= box; dy++) {
      const ddy = dy + 0.5 - oy
      for (let dx = -box; dx <= box; dx++) {
        const ddx = dx + 0.5 - ox
        const d = Math.sqrt(ddx * ddx + ddy * ddy)
        const cov = Math.min(1, Math.max(0, r + 0.5 - d))
        a[p++] = Math.round(cov * 255)
      }
    }
    s = { a, box }
    if (sprites.size > 512) sprites.clear() // beat swings can't grow this forever
    sprites.set(key, s)
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

/** Smooth 0→1 ramp for the flip's kick gate: 0 below `e0`, 1 at `e1`,
 *  eased at both ends. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
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
  // Between kicks the frame rests as the dialed-in halftone print; on a
  // solid low-end hit the whole look (print and, if on, the negative)
  // dissolves into the untouched regular picture, then settles back as
  // the kick decays. Driven by the same smoothed bass field as every
  // other beat reaction — no state, no wall clock — so exports match the
  // preview frame-exactly. At rest (and with the toggle off) everything
  // below costs exactly what it cost before.
  const bass = clamp01(frame.bass)
  const flipOn = !!cfg.beatFlip
  const flipT = flipOn ? smoothstep(0.5, 0.75, bass) : 0
  if (flipT >= 0.999) {
    // Kick peak: the regular picture alone — even the picture
    // conditioning below is skipped, so the flash shows the frame exactly
    // as the earlier filters left it.
    return
  }
  let raw: HTMLCanvasElement | null = null
  if (flipOn && flipT > 0.001) {
    // Keep the untouched frame around so the swap can dissolve the print
    // state back into the regular picture (one full-frame GPU copy, and
    // only while a kick is landing or fading).
    raw = getWork('ht:raw', W, H)
    resetWork(raw.getContext('2d')!).drawImage(ctx.canvas, 0, 0, W, H)
  }
  // The swap itself: the regular picture dissolves in over the finished
  // print state — the last step of every exit below while the flip is
  // mid-swap. The negative dissolves with it, so the flash is always the
  // true regular picture even when Invert is on.
  const finishFlip = () => {
    if (!raw) return
    ctx.save()
    ctx.globalAlpha = flipT
    ctx.drawImage(raw, 0, 0)
    ctx.restore()
  }

  // 0) Picture conditioning, part 1 — grayscale + contrast, always applied
  //    while the filter is on (independent of the ink dials below). One GPU
  //    pass: draw the live frame onto a work canvas through the CSS filter
  //    chain, draw it straight back. These two shape the picture AND the
  //    print (the screen samples what they produce). Defaults skip this.
  const grayscale = !!cfg.grayscale
  const invert = !!cfg.invert
  const contrast = clamp01(cfg.contrast ?? 0.5)
  const preF: string[] = []
  if (grayscale) preF.push('grayscale(1)')
  if (Math.abs(contrast - 0.5) > 1e-3)
    preF.push(`contrast(${(contrast * 2).toFixed(4)})`) // 0.5 → 1.0 = untouched
  if (preF.length) {
    const cond = getWork('ht:cond', W, H)
    const cctx = resetWork(cond.getContext('2d')!)
    cctx.filter = preF.join(' ')
    cctx.drawImage(ctx.canvas, 0, 0, W, H)
    cctx.filter = 'none'
    ctx.drawImage(cond, 0, 0, W, H)
  }

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
  // While Flip on kick is on, a kick drives the lift all the way to the
  // clean-off ceiling (1.35) no matter where the Beat pop dial sits — the
  // swap IS the full pop. Toggle off → this is exactly the old lift.
  const effLift = Math.max(lift, flipT * 1.35)
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
  smCtx.imageSmoothingQuality = 'low'
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
  // Radius ladder anchored at 0.4 with ABSOLUTE rungs (step rounded to 1/16 px,
  // independent of rMax) so the sprite keys stay stable while beat-reactive
  // press swings every frame — the cache never churns mid-song.
  const stepQ = Math.max(1 / 16, Math.round(((rMax - 0.4) / (SPRITE_LEVELS - 1)) * 16) / 16)
  const maxLvl = Math.max(0, Math.floor((rMax - 0.4) / stepQ))
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
      // with the sub-pixel residue carried by the sprite variant (≤ 0.25 px
      // center error — invisible, and the dot LATTICE stays true).
      const fx = W / 2 + (gx - gy) * SQ
      const fy = H / 2 + (gx + gy) * SQ
      const sx = Math.round(fx)
      const sy = Math.round(fy)
      const ox = Math.round((fx - sx) * 2) / 2 // −0.5 | 0 | 0.5
      const oy = Math.round((fy - sy) * 2) / 2
      const lvl = Math.min(maxLvl, Math.round((r - 0.4) / stepQ))
      const sp = getSprite(0.4 + lvl * stepQ, ox, oy)
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
