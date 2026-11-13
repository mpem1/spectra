/**
 * Contour filter — the woven-thread waveform look (the Netflix "3 Body
 * Problem" poster / polygon1993 "Clair Obscur" aesthetic): the picture is
 * resampled into a grid of horizontal luminance profiles and every profile
 * is redrawn as a thin glowing line whose points BEND with the image's
 * horizontal luminance gradient (bright silhouettes warp the lines around
 * themselves — the contour effect) and RIPPLE with the music (each line is
 * driven by its own frequency bin, so the whole field rides the spectrum
 * like a woven waveform). Bright areas shine through the weave, shadows
 * sink into the dark tube.
 *
 * Set any picture as the background, switch this on, and the image becomes
 * a moving glowing waveform — lines sway on their own (drift), pulse with
 * the song's frequencies (reactivity), and flare on the low end (react to
 * beat).
 *
 * Layers, bottom to top (the phosphor filter's proven stack):
 *   1. The dark tube — the frame darkened and multiplied by the tube color.
 *   2. The print — the displaced lines stroked in shade-ladder colors,
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
const rowBuffers = new Map<string, { lum: Float32Array; disp: Float32Array; ys: Float32Array }>()

function rowGrids(cols: number, rows: number) {
  const key = `${cols}x${rows}`
  let g = rowBuffers.get(key)
  if (!g) {
    g = {
      lum: new Float32Array(cols * rows),
      disp: new Float32Array(cols * rows),
      ys: new Float32Array(rows),
    }
    rowBuffers.set(key, g)
  }
  return g
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
  // Beat flare: the glow and the ripple swell on the low end.
  const boost = beatBoost(cfg, clamp01(frame.bass ?? 0), 1.2)
  const glowAmt = clamp01(cfg.glow ?? 0.6) * boost

  const inkCss = cfg.inkColor ?? CONTOUR_INK_CSS
  const paperCssRaw = cfg.paperColor ?? CONTOUR_PAPER_CSS
  const paperCss = parseHexRGB(paperCssRaw) ? paperCssRaw : CONTOUR_PAPER_CSS
  const ladder = buildShadeLadder(inkCss, paperCssRaw)

  // Sample columns — wide enough to keep silhouettes' edges crisp, capped so
  // the band strokes stay cheap.
  const cols = Math.max(64, Math.min(220, Math.round(W / 6)))

  // 1) Resample the live frame onto a cols×rows canvas — one proper area
  //    average per cell, one small getImageData.
  const sample = getWork('contour:sample', cols, rows)
  const smCtx = resetWork(sample.getContext('2d', { willReadFrequently: true })!)
  smCtx.imageSmoothingEnabled = true
  smCtx.imageSmoothingQuality = 'high'
  smCtx.drawImage(ctx.canvas, 0, 0, cols, rows)
  const src = smCtx.getImageData(0, 0, cols, rows).data

  const { lum, disp, ys } = rowGrids(cols, rows)

  // 2) Luminance per cell + each line's rest position.
  for (let j = 0; j < rows; j++) {
    ys[j] = ((j + 0.5) / rows) * H
    for (let x = 0; x < cols; x++) {
      const k = (j * cols + x) * 4
      lum[j * cols + x] = (0.2126 * src[k] + 0.7152 * src[k + 1] + 0.0722 * src[k + 2]) / 255
    }
  }

  // 3) Displacement per cell — three voices summed:
  //    · the contour bend: the horizontal luminance gradient (bright
  //      silhouettes warp the lines around themselves) + a slight lift over
  //      bright areas (the waveform mountain feel);
  //    · the ambient drift: a slow traveling weave, alive even when paused;
  //    · the music: each line rides its own frequency bin, so on a song the
  //      field literally becomes a moving spectrum waveform.
  const time = frame.styleTime ?? 0
  const freq = frame.freq
  const binCount = freq?.length ?? 0
  const bass = clamp01(frame.bass ?? 0)
  const bendScale = warp * 46 * S
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
      const l = lum[rowOff + x]
      const lPrev = lum[rowOff + Math.max(0, x - 1)]
      const lNext = lum[rowOff + Math.min(cols - 1, x + 1)]
      const px = ((x + 0.5) / cols) * W
      const bend = (lNext - lPrev) * bendScale + l * liftScale
      const drift =
        Math.sin(px * kDrift + time * 0.55 + j * 0.55) * driftAmp +
        Math.sin(px * kRipple - time * 1.7 + j * 0.35) * (motion * 2.5 * S + rippleAmp)
      disp[rowOff + x] = bend + drift
    }
  }

  // 4) The print — every line stroked as a polyline through its displaced
  //    points, batched by luminance band (each cell belongs to exactly one
  //    band, so the whole frame is ~4 strokes no matter how many lines).
  const print = getWork('contour:print', W, H)
  const pctx = resetWork(print.getContext('2d')!)
  pctx.clearRect(0, 0, W, H)
  pctx.lineWidth = Math.max(1, 1.3 * S)
  pctx.lineJoin = 'round'
  pctx.lineCap = 'round'
  for (let b = 0; b < BANDS; b++) {
    pctx.beginPath()
    pctx.strokeStyle = `rgb(${ladder.lut[Math.min(63, Math.floor(((b + 1) / BANDS) * 63))][0]},${ladder.lut[Math.min(63, Math.floor(((b + 1) / BANDS) * 63))][1]},${ladder.lut[Math.min(63, Math.floor(((b + 1) / BANDS) * 63))][2]})`
    pctx.globalAlpha = BAND_ALPHAS[b]
    for (let j = 0; j < rows; j++) {
      const rowOff = j * cols
      const yBase = ys[j]
      let started = false
      for (let x = 0; x < cols; x++) {
        const l = lum[rowOff + x]
        if (b === 0 ? l < 0.05 : Math.min(BANDS - 1, (l * BANDS) | 0) !== b) {
          started = false
          continue
        }
        const px = ((x + 0.5) / cols) * W
        const y = yBase + disp[rowOff + x]
        if (started) pctx.lineTo(px, y)
        else {
          pctx.moveTo(px, y)
          started = true
        }
      }
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
    const inkCssSafe = parseHexRGB(inkCss) ? inkCss : CONTOUR_INK_CSS
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
