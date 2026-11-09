/**
 * Halftone filter — newspaper print over the whole frame.
 *
 * The picture is resampled onto a 45°-rotated dot grid (the classic newspaper
 * screen angle) and BLACK DOTS are laid over it — but only where the tone is
 * dark enough: `dotRange` sets the luminance threshold ("only halftone the
 * darker colors, leave the rest intact"). Inside the dotted range the dot
 * AREA grows with darkness (dot radius ∝ √depth), so deep shadows merge into
 * solid ink exactly like real halftone print. Lighter areas never get a dot.
 *
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

export function drawHalftoneFilter(
  rc: RenderContext,
  cfg: HalftoneFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  const S = H / 720
  // Beat reactive: on a kick the print LIFTS — dots shrink back, the ink
  // fades and the shadow range narrows, so the clean picture pops through
  // for a moment; between beats the print rests exactly as dialed in.
  const beatOn = !!cfg.beatReactive
  const punch = clamp01(cfg.beatStrength ?? 0.5)
  const bass = clamp01(frame.bass)
  const lift = beatOn ? punch * bass : 0 // 0..1 print-reveal amount
  const press = 1 - 0.45 * lift // dots back off on the kick (ink lifts off the page)
  const cell = Math.max(
    3,
    Math.round(Math.max(3, Math.min(14, cfg.dotSize)) * S * (1 + 0.22 * lift)),
  )
  const range = Math.max(0.001, clamp01(cfg.dotRange) - 0.28 * lift)
  const strength = Math.min(1, clamp01(cfg.strength) * (1 - 0.75 * lift))
  if (range <= 0.001 || strength <= 0.001) return

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
  if (!dots) return // nothing dark enough → the frame stays untouched

  // 3) Lift the ink onto the frame: one putImageData into the offscreen ink
  //    canvas, one drawImage at the dialed ink strength (same alpha math as
  //    the old Path2D fill: black at coverage × strength, source-over).
  const inkCanvas = getWork('ht:ink', W, H)
  const ictx = resetWork(inkCanvas.getContext('2d')!)
  ictx.putImageData(ink.img, 0, 0)
  ctx.save()
  ctx.globalAlpha = strength
  ctx.drawImage(inkCanvas, 0, 0)
  ctx.restore()
}
