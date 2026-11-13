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
 * Stillness & wave spread — the motion field: the lines hold nearly still
 * around the picture's focal features (silhouette edges + bright cores —
 * faces, subjects) while the waves swing wider and wider through the
 * negative space beyond, out past the image's shapes. One blurred focal
 * field drives both voices: movement fades where the picture is hot,
 * amplifies where it's empty, and the still-to-wild transition widens
 * with the spread dial.
 *
 * Set any picture as the background, switch this on, and the image becomes
 * a moving glowing waveform — lines sway on their own (drift), pulse with
 * the song's frequencies (reactivity), and flare on the low end (react to
 * beat).
 *
 * Layers, bottom to top (the phosphor filter's proven stack):
 *   1. The dark tube — the frame darkened and multiplied by the tube color.
 *   2. The print — the displaced curves stroked in shade-ladder colors,
 *      batched by luminance band (one path per band across ALL lines, so
 *      the whole frame is ~4 strokes).
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
  { lum: Float32Array; disp: Float32Array; tmp: Float32Array; energy: Float32Array; ys: Float32Array }
>()

function rowGrids(cols: number, rows: number) {
  const key = `${cols}x${rows}`
  let g = rowBuffers.get(key)
  if (!g) {
    g = {
      lum: new Float32Array(cols * rows),
      disp: new Float32Array(cols * rows),
      tmp: new Float32Array(cols * rows),
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

/** Luminance bands — the print is stroked once per band (one path across
 *  all lines), band 0 = the faint deep threads, band 7 = the ice cores.
 *  Eight bands keep the subject's edge steps fine enough to read as a
 *  smooth dissolve into the field. */
const BANDS = 8
const BAND_ALPHAS = [0.42, 0.55, 0.68, 0.8, 0.9, 1, 1, 1]

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
  // Beat flare: the glow and ripple swell on the low end.
  const boost = beatBoost(cfg, clamp01(frame.bass ?? 0), 1.2)
  const glowAmt = clamp01(cfg.glow ?? 0.6) * boost
  // Stillness: how stationary the lines hold around the focal features.
  const stillness = clamp01(cfg.stillness ?? 0.6)
  // Wave spread: how much wider the waves swing through the negative
  // space beyond the features (the still-to-wild transition widens too).
  const waveSpread = clamp01(cfg.waveSpread ?? 0.6)

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

  const { lum, disp, tmp, energy, ys } = rowGrids(cols, rows)

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
  blurField(lum, tmp, cols, rows, 3, 1, 1)

  // 2b) The stillness field — focal energy (silhouette edges + bright
  //     cores) blurred wide, then normalized to the picture's own peak so
  //     ANY image — bright or near-black — yields a full-contrast field:
  //     motion fades where the picture is hot and amplifies where it's
  //     empty, with the still-to-wild transition widening as the spread
  //     dial rises.
  for (let j = 0; j < rows; j++) {
    const rowOff = j * cols
    for (let x = 0; x < cols; x++) {
      const bl = lum[rowOff + x]
      const gx =
        (lum[rowOff + Math.min(cols - 1, x + 2)] - lum[rowOff + Math.max(0, x - 2)]) * 0.25
      const gy =
        (lum[Math.min(rows - 1, j + 2) * cols + x] - lum[Math.max(0, j - 2) * cols + x]) * 0.25
      energy[rowOff + x] = Math.min(
        1,
        Math.abs(gx) * 3.4 + Math.abs(gy) * 1.6 + bl * 0.55 + bl * bl * 0.45,
      )
    }
  }
  const wReach = Math.max(2, Math.round(2 + 8 * waveSpread))
  blurField(energy, tmp, cols, rows, wReach, wReach, 2)
  // Peak normalization + pool boost — the blurred rim energy must reach
  // deep into the subject, and the hottest pool must read as 1.0 no matter
  // how dark the picture is, otherwise the stillness dial has nothing to
  // push against.
  let peak = 0
  for (let i = 0; i < energy.length; i++) if (energy[i] > peak) peak = energy[i]
  const wScale = peak > 0.1 ? 1 / peak : 0
  for (let i = 0; i < energy.length; i++) energy[i] = Math.min(1, energy[i] * wScale * 1.15)

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
  //
  //    Band mapping reads a range-normalized copy of the field: on a dark
  //    moody picture the raw luminance spans only 0..0.4, which would leave
  //    the whole subject in the faint bands. Dividing by the picture's own
  //    90th percentile (floored so near-black frames stay quiet) makes the
  //    subject glow at the top of the ladder on ANY image, like the
  //    reference; bright pictures divide by ~0.8 and barely change.
  let p90 = 0.22
  {
    const hist = new Uint32Array(256)
    for (let i = 0; i < lum.length; i++) hist[Math.min(255, (lum[i] * 255) | 0)]++
    const target = lum.length * 0.9
    let acc = 0
    for (let b = 0; b < 256; b++) {
      acc += hist[b]
      if (acc >= target) {
        p90 = Math.max(0.22, (b + 1) / 255)
        break
      }
    }
  }
  const bandNorm = 1 / (p90 * 1.05)
  const time = frame.styleTime ?? 0
  const freq = frame.freq
  const binCount = freq?.length ?? 0
  const bass = clamp01(frame.bass ?? 0)
  const bendScale = warp * 68 * S
  const liftScale = warp * 9 * S
  const driftAmp = motion * 7 * S
  const kDrift = (Math.PI * 2 * 1.6) / W
  const kRipple = (Math.PI * 2 * 3.2) / W
  // Bend gradient: wide ±3 stencil + a soft knee — hard silhouette edges
  // would otherwise flip the gradient sign between neighboring cells and
  // tear the line apart (vertical black channels). The knee keeps small
  // gradients honest and gently saturates the big ones.
  const bendKnee = 0.22
  for (let j = 0; j < rows; j++) {
    const rowOff = j * cols
    // Each line's frequency bin — bottom lines get the low end.
    const bin = binCount > 0 ? Math.min(binCount - 1, Math.floor(((rows - 1 - j) / rows) * binCount)) : -1
    const v = bin >= 0 ? clamp01(freq[bin]) : 0
    const rippleAmp = reactivity * 20 * S * v * boost
    for (let x = 0; x < cols; x++) {
      const bl = lum[rowOff + x]
      const gxRaw =
        (lum[rowOff + Math.min(cols - 1, x + 3)] - lum[rowOff + Math.max(0, x - 3)]) / 6
      const gx = (gxRaw * bendKnee) / (bendKnee + Math.abs(gxRaw))
      const bend = gx * bendScale + bl * liftScale
      const px = ((x + 0.5) / cols) * W
      const drift =
        Math.sin(px * kDrift + time * 0.55 + j * 0.55) * driftAmp +
        Math.sin(px * kRipple - time * 1.7 + j * 0.35) * (motion * 2.5 * S + rippleAmp)
      // Motion variance — still around the features, wide in the void:
      // the focal field damps the drift/ripple where it's hot (the lines
      // stay partially stationary, holding the contour) and lets them
      // swing wider through the empty space beyond the image's shapes.
      const w = energy[rowOff + x]
      const motionK = (1 - 0.85 * stillness * w) * (1 + 1.8 * waveSpread * (1 - w))
      disp[rowOff + x] = bend + drift * motionK
    }
  }
  blurField(disp, tmp, cols, rows, 2, 0, 1)

  // 3b) One more smoothing pass over the luminance, purely for banding:
  //     the print's band runs must not flip on the picture's texture
  //     noise (fine flips shred the weave into lonely stub cells — black
  //     tears). The bends already ran on the sharper field above, so the
  //     contour keeps its edge snap; only the band mapping softens.
  blurField(lum, tmp, cols, rows, 3, 2, 1)

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
      // A lone cell rides its base thread already — add a visible bead of
      // light (the round caps turn the stub into a ~1.6px dot).
      const px = pxOf(s)
      pctx.moveTo(px, yOf(s))
      pctx.lineTo(px + 0.5, yOf(s) + 0.01)
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

  // 4a) The base fabric — EVERY row drawn as one continuous smooth curve
  //     (all cells, zero band fragmentation): the faint thread fabric that
  //     carries the whole weave edge to edge. Bright runs fragment on the
  //     picture's texture noise (41% of runs measured ≤2 cells), but they
  //     now sit ON this fabric, so a shredded bright run reads as a dim
  //     thread — never a black tear.
  pctx.beginPath()
  const cBase = ladder.lut[Math.min(63, Math.floor((1 / BANDS) * 63))]
  pctx.strokeStyle = `rgb(${cBase[0]},${cBase[1]},${cBase[2]})`
  pctx.globalAlpha = BAND_ALPHAS[0]
  for (let j = 0; j < rows; j++) {
    const rowOff = j * cols
    const yBase = ys[j]
    pctx.moveTo(pxOf(0), yBase + disp[rowOff])
    for (let x = 1; x < cols - 1; x++) {
      const cx = pxOf(x)
      const cy = yBase + disp[rowOff + x]
      pctx.quadraticCurveTo(cx, cy, (cx + pxOf(x + 1)) / 2, (cy + yBase + disp[rowOff + x + 1]) / 2)
    }
    pctx.lineTo(pxOf(cols - 1), yBase + disp[rowOff + cols - 1])
  }
  pctx.stroke()

  // 4b) The bright materialization — runs of same-band cells (band 1 up)
  //     glide over the fabric as smooth subpaths, batched per band (~7
  //     strokes). Bands read the range-normalized luminance so dark
  //     pictures still reach the bright ladder shades.
  for (let b = 1; b < BANDS; b++) {
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
        const inBand = Math.min(BANDS - 1, ((l * bandNorm) * BANDS) | 0) === b
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
