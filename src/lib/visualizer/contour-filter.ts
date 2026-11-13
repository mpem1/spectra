/**
 * Contour filter — the woven-thread waveform look (the Netflix "3 Body
 * Problem" poster / polygon1993 "Clair Obscur" aesthetic): the picture is
 * resampled into a grid of horizontal luminance profiles and every profile
 * is redrawn as a thin glowing CURVE whose points BEND with the image's
 * smoothed luminance gradient (bright silhouettes warp the lines around
 * themselves — the contour effect) and RIPPLE with the music (each line is
 * driven by its own frequency bin, so the whole field rides the spectrum
 * like a woven waveform). Bright areas shine through the weave, shadows
 * sink into the dark tube.
 *
 * Smoothness is engineered, not hoped for: the luminance field is blurred
 * before its gradient is taken, the gradient uses a wide stencil, the
 * finished displacement melts through one more blur, and the print strokes
 * glide through the midpoints of their samples as quadratic curves — the
 * lines flow like the reference instead of zig-zagging between cells.
 *
 * Static — the broken-signal grain: TV noise materializes at the picture's
 * focal points (silhouette edges + bright cores) and, dialed wider, leaks
 * outward into the negative space around them, flickering deterministically
 * at ~14 Hz. The speckles ride the same displacement as the lines, so the
 * grain weaves with the picture.
 *
 * Set any picture as the background, switch this on, and the image becomes
 * a moving glowing waveform — lines sway on their own (drift), pulse with
 * the song's frequencies (reactivity), and flare on the low end (react to
 * beat).
 *
 * Layers, bottom to top (the phosphor filter's proven stack):
 *   1. The dark tube — the frame darkened and multiplied by the tube color.
 *   2. The print — the displaced curves + static grain, stroked/filled in
 *      shade-ladder colors, batched by luminance band (~4 strokes total).
 *   3. The glow — the print's alpha filled with the PURE ink color, blurred
 *      at two radii and drawn back additively (real halos around the
 *      bright threads; the print itself never changes color).
 *   4. Below 100% strength the untouched frame fades back through.
 *
 * Deterministic: everything derives from the frame's luminance, the
 * frequency bins and the style clock (styleTime free-runs in the live
 * preview and equals song time in exports) — no Math.random, same frame in,
 * same pixels out, so live preview and offline exports agree frame-exactly.
 * Transparent backgrounds skip the pass.
 */
import type { AudioFrame, ContourFilterConfig, RenderContext } from './types'
import { beatBoost, clamp01, getWork, resetWork } from './filter-utils'
import { buildShadeLadder, parseHexRGB } from './shade-ladder'

/** Field defaults — the electric-blue contour look of the references. */
const CONTOUR_INK_CSS = '#49b6ff'
const CONTOUR_PAPER_CSS = '#030a24'

/** Per-size scratch buffers for the luminance + displacement grids. */
const rowBuffers = new Map<
  string,
  { lum: Float32Array; disp: Float32Array; tmp: Float32Array; sharp: Float32Array; energy: Float32Array; ys: Float32Array }
>()

function rowGrids(cols: number, rows: number) {
  const key = `${cols}x${rows}`
  let g = rowBuffers.get(key)
  if (!g) {
    g = {
      lum: new Float32Array(cols * rows),
      disp: new Float32Array(cols * rows),
      tmp: new Float32Array(cols * rows),
      sharp: new Float32Array(cols * rows),
      energy: new Float32Array(cols * rows),
      ys: new Float32Array(rows),
    }
    rowBuffers.set(key, g)
  }
  return g
}

/** In-place separable box blur of a cols×rows field with clamped edges.
 *  Two+ passes read gaussian-smooth. tmp must be the same size as f. */
function blurField(f: Float32Array, tmp: Float32Array, cols: number, rows: number, rH: number, rV: number, passes: number): void {
  for (let p = 0; p < passes; p++) {
    // Horizontal — each row into tmp.
    for (let j = 0; j < rows; j++) {
      const off = j * cols
      let sum = 0
      for (let k = -rH; k <= rH; k++) sum += f[off + Math.min(cols - 1, Math.max(0, k))]
      const inv = 1 / (2 * rH + 1)
      for (let x = 0; x < cols; x++) {
        tmp[off + x] = sum * inv
        sum += f[off + Math.min(cols - 1, x + rH + 1)] - f[off + Math.max(0, x - rH)]
      }
    }
    // Vertical — each column of tmp back into f.
    for (let x = 0; x < cols; x++) {
      let sum = 0
      for (let k = -rV; k <= rV; k++) sum += tmp[Math.min(rows - 1, Math.max(0, k)) * cols + x]
      const inv = 1 / (2 * rV + 1)
      for (let j = 0; j < rows; j++) {
        f[j * cols + x] = sum * inv
        sum += tmp[Math.min(rows - 1, j + rV + 1) * cols + x] - tmp[Math.max(0, j - rV) * cols + x]
      }
    }
  }
}

/** Deterministic 0..1 hash — the static flicker and speckle placement are
 *  pure functions of cell, index and styleTime, so exports match preview. */
function hash01(n: number): number {
  let t = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35)
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296
}

/** Luminance bands — the print is stroked once per band (one path across
 *  all lines), band 0 = the faint deep threads, band 3 = the ice cores. */
const BANDS = 4
const BAND_ALPHAS = [0.5, 0.85, 1, 1]

/* -------------------------------- the filter -------------------------------- */

export function drawContourFilter(
  rc: RenderContext,
  cfg: ContourFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass' | 'freq' | 'styleTime'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 16 || H < 16) return
  const S = H / 720

  const strength = clamp01(cfg.strength ?? 1)
  // How many horizontal lines the picture is woven into.
  const rows = Math.round(Math.min(160, Math.max(24, cfg.lines ?? 96)))
  // Contour warp: how hard the picture's bright shapes bend the lines.
  const warp = clamp01(cfg.warp ?? 0.55)
  // Ambient drift: how much the lines sway on their own.
  const motion = clamp01(cfg.motion ?? 0.35)
  // Audio reactivity: how hard the spectrum ripples the lines.
  const reactivity = clamp01(cfg.reactivity ?? 0.6)
  // Beat flare: the glow, ripple and static swell on the low end.
  const boost = beatBoost(cfg, clamp01(frame.bass ?? 0), 1.2)
  const glowAmt = clamp01(cfg.glow ?? 0.6) * boost
  const staticAmt = clamp01(cfg.static ?? 0.5) * boost
  const staticSpread = clamp01(cfg.staticSpread ?? 0.6)

  const inkCss = cfg.inkColor ?? CONTOUR_INK_CSS
  const inkCssSafe = parseHexRGB(inkCss) ? inkCss : CONTOUR_INK_CSS
  const paperCssRaw = cfg.paperColor ?? CONTOUR_PAPER_CSS
  const paperCss = parseHexRGB(paperCssRaw) ? paperCssRaw : CONTOUR_PAPER_CSS
  const ladder = buildShadeLadder(inkCss, paperCssRaw)

  // Sample columns — dense enough that the quadratic curves glide (the
  // smoother print needs finer sampling than straight segments did).
  const cols = Math.max(96, Math.min(280, Math.round(W / 4.5)))

  // 1) Resample the live frame onto a cols×rows canvas — one proper area
  //    average per cell, one small getImageData.
  const sample = getWork('contour:sample', cols, rows)
  const smCtx = resetWork(sample.getContext('2d', { willReadFrequently: true })!)
  smCtx.imageSmoothingEnabled = true
  smCtx.imageSmoothingQuality = 'high'
  smCtx.drawImage(ctx.canvas, 0, 0, cols, rows)
  const src = smCtx.getImageData(0, 0, cols, rows).data

  const { lum, disp, tmp, sharp, energy, ys } = rowGrids(cols, rows)

  // 2) Luminance per cell + each line's rest position, then a smoothing
  //    pass over the field — every voice downstream reads the blurred
  //    luminance, so the curves bend around silhouettes instead of jitter
  //    along their noisy pixels.
  for (let j = 0; j < rows; j++) {
    ys[j] = ((j + 0.5) / rows) * H
    for (let x = 0; x < cols; x++) {
      const k = (j * cols + x) * 4
      lum[j * cols + x] = (0.2126 * src[k] + 0.7152 * src[k + 1] + 0.0722 * src[k + 2]) / 255
    }
  }
  blurField(lum, tmp, cols, rows, 2, 1, 1)

  // 3) Displacement per cell — three voices summed, all reading the
  //    smoothed field:
  //    · the contour bend: the horizontal luminance gradient over a wide
  //      stencil (bright silhouettes warp the lines around themselves) + a
  //      slight lift over bright areas (the waveform mountain feel);
  //    · the ambient drift: a slow traveling weave, alive even when paused;
  //    · the music: each line rides its own frequency bin, so on a song the
  //      field literally becomes a moving spectrum waveform.
  //    One last melt pass over the finished displacement erases any
  //    residual per-cell kinks.
  const time = frame.styleTime ?? 0
  const freq = frame.freq
  const binCount = freq?.length ?? 0
  const bass = clamp01(frame.bass ?? 0)
  const bendScale = warp * 52 * S
  const liftScale = warp * 9 * S
  const driftAmp = motion * 7 * S
  const kDrift = (Math.PI * 2 * 1.6) / W
  const kRipple = (Math.PI * 2 * 3.2) / W
  for (let j = 0; j < rows; j++) {
    const rowOff = j * cols
    // Each line's frequency bin — bottom lines get the low end.
    const bin = binCount > 0 ? Math.min(binCount - 1, Math.floor(((rows - 1 - j) / rows) * binCount)) : -1
    const v = bin >= 0 ? clamp01(freq[bin]) : 0
    const rippleAmp = reactivity * 20 * S * v * boost
    for (let x = 0; x < cols; x++) {
      const bl = lum[rowOff + x]
      const gx =
        (lum[rowOff + Math.min(cols - 1, x + 2)] - lum[rowOff + Math.max(0, x - 2)]) * 0.25
      const bend = gx * bendScale + bl * liftScale
      const px = ((x + 0.5) / cols) * W
      const drift =
        Math.sin(px * kDrift + time * 0.55 + j * 0.55) * driftAmp +
        Math.sin(px * kRipple - time * 1.7 + j * 0.35) * (motion * 2.5 * S + rippleAmp)
      disp[rowOff + x] = bend + drift
    }
  }
  blurField(disp, tmp, cols, rows, 1, 0, 1)

  // 4) The print — every line stroked as ONE smooth path per band across
  //    ALL rows: runs of same-band cells glide through their midpoints as
  //    quadratic curves (silk, not sawtooth), still ~4 strokes per frame.
  const print = getWork('contour:print', W, H)
  const pctx = resetWork(print.getContext('2d')!)
  pctx.clearRect(0, 0, W, H)
  pctx.lineWidth = Math.max(1, 1.3 * S)
  pctx.lineJoin = 'round'
  pctx.lineCap = 'round'

  const pxOf = (x: number) => ((x + 0.5) / cols) * W
  // One run of consecutive same-band cells → one smooth subpath.
  const emitRun = (rowOff: number, yBase: number, s: number, e: number): void => {
    const n = e - s
    if (n <= 0) return
    const yOf = (x: number) => yBase + disp[rowOff + x]
    if (n === 1) {
      // A lone cell still deserves its grain of light.
      const px = pxOf(s)
      pctx.moveTo(px, yOf(s))
      pctx.lineTo(px + 0.75, yOf(s))
      return
    }
    pctx.moveTo(pxOf(s), yOf(s))
    if (n === 2) {
      pctx.lineTo(pxOf(e - 1), yOf(e - 1))
      return
    }
    // Quadratic midpoint smoothing: the control point is each sample, the
    // curve passes through the midpoints — C1-soft, no corner kinks.
    for (let x = s + 1; x < e - 1; x++) {
      const cx = pxOf(x)
      const cy = yOf(x)
      pctx.quadraticCurveTo(cx, cy, (cx + pxOf(x + 1)) / 2, (cy + yOf(x + 1)) / 2)
    }
    pctx.lineTo(pxOf(e - 1), yOf(e - 1))
  }

  for (let b = 0; b < BANDS; b++) {
    pctx.beginPath()
    const c = ladder.lut[Math.min(63, Math.floor(((b + 1) / BANDS) * 63))]
    pctx.strokeStyle = `rgb(${c[0]},${c[1]},${c[2]})`
    pctx.globalAlpha = BAND_ALPHAS[b]
    for (let j = 0; j < rows; j++) {
      const rowOff = j * cols
      const yBase = ys[j]
      let s = -1
      for (let x = 0; x < cols; x++) {
        const l = lum[rowOff + x]
        const inBand = b === 0 ? l >= 0.05 : Math.min(BANDS - 1, (l * BANDS) | 0) === b
        if (inBand) {
          if (s < 0) s = x
        } else if (s >= 0) {
          emitRun(rowOff, yBase, s, x)
          s = -1
        }
      }
      if (s >= 0) emitRun(rowOff, yBase, s, cols)
    }
    pctx.stroke()
  }
  pctx.globalAlpha = 1

  // 4b) Static — the broken-signal grain. Focal energy = silhouette edges
  //     (gradient magnitude) + bright cores; blurred wide, it leaks out of
  //     the focal points into the negative space around them. Speckles are
  //     hashed per cell/index/flicker-step (deterministic), ride the same
  //     displacement as the lines, and re-scatter ~14 Hz like TV noise.
  if (staticAmt > 0.004) {
    for (let j = 0; j < rows; j++) {
      const rowOff = j * cols
      for (let x = 0; x < cols; x++) {
        const bl = lum[rowOff + x]
        const gx =
          (lum[rowOff + Math.min(cols - 1, x + 2)] - lum[rowOff + Math.max(0, x - 2)]) * 0.25
        const gy =
          (lum[Math.min(rows - 1, j + 2) * cols + x] - lum[Math.max(0, j - 2) * cols + x]) * 0.25
        sharp[rowOff + x] = Math.min(1, Math.abs(gx) * 3.4 + Math.abs(gy) * 1.6 + bl * bl * 0.45)
        energy[rowOff + x] = sharp[rowOff + x]
      }
    }
    // The wide halo — two box passes at a spread-scaled radius make the
    // static breathe outward into the empty areas.
    const r = Math.max(2, Math.round(3 + 13 * staticSpread))
    blurField(energy, tmp, cols, rows, r, r, 2)
    const leak = 0.55 + 1.35 * staticSpread
    const flick = Math.floor(time * 14)
    const cellW = W / cols
    const cellH = H / rows
    pctx.fillStyle = inkCssSafe
    for (let j = 0; j < rows; j++) {
      const rowOff = j * cols
      const by = ys[j]
      for (let x = 0; x < cols; x++) {
        const i = rowOff + x
        const d = Math.min(1, sharp[i] * 0.45 + energy[i] * leak) * staticAmt
        if (d < 0.02) continue
        const n = Math.min(4, (d * 6) | 0)
        const bx = pxOf(x)
        const byD = by + disp[i]
        for (let k = 0; k < n; k++) {
          const base = (i * 8 + k) * 97 + flick * 7919
          const h0 = hash01(base)
          const h1 = hash01(base + 1)
          const h2 = hash01(base + 2)
          const h3 = hash01(base + 3)
          const px = bx + (h0 - 0.5) * cellW * 1.6
          const py = byD + (h1 - 0.5) * cellH * 1.7
          const sz = Math.max(1, (h3 < 0.22 ? 2 : 1) * S)
          // Some speckles stretch into short broken-signal dashes.
          const dash = h2 < 0.3
          pctx.globalAlpha = (0.16 + h3 * 0.55) * Math.min(1, 0.3 + d * 1.5)
          pctx.fillRect(dash ? px - sz : px, py, dash ? sz * 3 : sz, sz)
        }
      }
    }
    pctx.globalAlpha = 1
  }

  // 5) The dark tube — the frame darkened and multiplied by the tube color:
  //    the picture's structure survives as a deep paper-toned shadow behind
  //    the threads.
  const bg = getWork('contour:bg', W, H)
  const bctx = resetWork(bg.getContext('2d')!)
  bctx.filter = 'brightness(0.32)'
  bctx.drawImage(ctx.canvas, 0, 0)
  bctx.filter = 'none'
  bctx.globalCompositeOperation = 'multiply'
  bctx.fillStyle = paperCss
  bctx.fillRect(0, 0, W, H)
  bctx.globalCompositeOperation = 'source-over'

  // 6) Glow bake — the print's alpha filled with the PURE ink color (never
  //    a brightened copy of the print), blurred at two radii and drawn back
  //    additively: real halos radiating from the bright threads into the
  //    dark tube. Radii swell with the glow dial like a tube breathing.
  let glowA: HTMLCanvasElement | null = null
  let glowB: HTMLCanvasElement | null = null
  if (glowAmt > 0.004) {
    const ink = getWork('contour:ink', W, H)
    const ictx = resetWork(ink.getContext('2d')!)
    ictx.clearRect(0, 0, W, H)
    ictx.fillStyle = inkCssSafe
    ictx.fillRect(0, 0, W, H)
    ictx.globalCompositeOperation = 'destination-in'
    ictx.drawImage(print, 0, 0)
    ictx.globalCompositeOperation = 'source-over'
    const spread = 0.7 + 0.6 * Math.min(1, glowAmt)
    glowA = getWork('contour:glowA', W, H)
    const actx = resetWork(glowA.getContext('2d')!)
    actx.clearRect(0, 0, W, H)
    actx.filter = `blur(${Math.max(1.5, 2.4 * S * spread).toFixed(2)}px)`
    actx.drawImage(ink, 0, 0)
    actx.filter = 'none'
    glowB = getWork('contour:glowB', W, H)
    const gbctx = resetWork(glowB.getContext('2d')!)
    gbctx.clearRect(0, 0, W, H)
    gbctx.filter = `blur(${Math.max(4, 7.5 * S * spread).toFixed(2)}px)`
    gbctx.drawImage(ink, 0, 0)
    gbctx.filter = 'none'
  }

  // 7) Composite — the tube replaces the frame, the print sits on top, the
  //    glow draws back additively, and below 100% strength the untouched
  //    frame fades back through.
  let base: HTMLCanvasElement | null = null
  if (strength < 0.999) {
    base = getWork('contour:base', W, H)
    const pbctx = resetWork(base.getContext('2d')!)
    pbctx.drawImage(ctx.canvas, 0, 0, W, H)
  }

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  ctx.drawImage(bg, 0, 0)
  ctx.drawImage(print, 0, 0)
  if (glowAmt > 0.004 && glowA && glowB) {
    ctx.globalCompositeOperation = 'lighter'
    // Alpha clamps: canvas silently ignores globalAlpha > 1 — saturate.
    ctx.globalAlpha = Math.min(1, glowAmt * 0.9)
    ctx.drawImage(glowA, 0, 0)
    ctx.globalAlpha = Math.min(1, glowAmt * 0.5)
    ctx.drawImage(glowB, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }
  if (base) {
    ctx.globalAlpha = 1 - strength
    ctx.drawImage(base, 0, 0, W, H)
    ctx.globalAlpha = 1
  }
  ctx.restore()
}
