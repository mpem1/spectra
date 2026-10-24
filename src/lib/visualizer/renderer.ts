/**
 * Pulse Studio — the central pure render function.
 *
 * renderFrame(rc, frame, config) is DETERMINISTIC: no Math.random, no
 * Date.now, no state kept between calls. Same (rc, frame, config) → same
 * pixels, which is what makes the offline MP4 export frame-exact.
 *
 * All pixel metrics are designed against a 1280×720 canvas and multiplied by
 * S = height / 720 so 1080p / square / portrait exports look identical.
 */
import type {
  AudioFrame,
  BackgroundConfig,
  RenderContext,
  StudioConfig,
  VisualizerConfig,
} from './types'
import { buildGradient, gradientLine, parseColor, sampleGradient, withAlpha } from './gradients'
import { drawLyrics } from './lyrics'

/* --------------------------------- Utilities -------------------------------- */

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

/** Deterministic seeded PRNG (mulberry32) — replaces Math.random everywhere. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function roundRectFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/** Fill a rounded rect using ctx.roundRect when available, else a manual path. */
function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius)
  } else {
    roundRectFallback(ctx, x, y, w, h, radius)
  }
  ctx.fill()
}

/* --------------------------------- renderFrame ------------------------------- */

export function renderFrame(rc: RenderContext, frame: AudioFrame, config: StudioConfig): void {
  const S = rc.height / 720
  rc.ctx.save()
  drawBackground(rc, frame, config.background, S)
  drawVisualizer(rc, frame, config.visualizer, S)
  if (config.lyrics.enabled && config.lyrics.lines.length > 0) {
    drawLyrics(rc, frame, config.lyrics)
  }
  rc.ctx.restore()
}

/* --------------------------------- Background ------------------------------- */

function drawBackground(
  rc: RenderContext,
  frame: AudioFrame,
  bg: BackgroundConfig,
  S: number,
): void {
  const { ctx, width: W, height: H } = rc

  if (bg.mode === 'solid') {
    ctx.fillStyle = bg.color
    ctx.fillRect(0, 0, W, H)
  } else if (bg.mode === 'gradient') {
    const g = bg.gradient
    const line = gradientLine(g.angle, W, H)
    ctx.fillStyle = buildGradient(
      ctx,
      line.x0,
      line.y0,
      line.x1,
      line.y1,
      g.stops,
      frame.time,
      g.cycleColors,
      g.cycleSpeed,
    )
    ctx.fillRect(0, 0, W, H)
  }
  // 'transparent': leave the canvas alpha untouched.

  // Vignette overlay (skip when strength is 0).
  const vignette = clamp01(bg.vignette)
  if (vignette > 0) {
    const cx = W / 2
    const cy = H / 2
    const inner = Math.min(W, H) * 0.35
    const outer = Math.hypot(W, H) * 0.6
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer)
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)')
    grad.addColorStop(0.55, `rgba(0, 0, 0, ${vignette * 0.35})`)
    grad.addColorStop(1, `rgba(0, 0, 0, ${vignette})`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
  }

  // Film grain (skip when 0) — deterministic per frame index.
  const grain = clamp01(bg.grain)
  if (grain > 0) drawGrain(rc, grain, S)
}

function drawGrain(rc: RenderContext, grain: number, S: number): void {
  const { ctx, width: W, height: H, frame } = rc
  const rand = mulberry32(frame)
  const alpha = grain * 0.15
  const count = 2000
  const size = Math.max(1, Math.round(S))
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * W)
    const y = Math.floor(rand() * H)
    ctx.fillRect(x, y, size, size)
  }
}

/* --------------------------------- Visualizer -------------------------------- */

function drawVisualizer(
  rc: RenderContext,
  frame: AudioFrame,
  cfg: VisualizerConfig,
  S: number,
): void {
  const { ctx } = rc
  ctx.save()
  switch (cfg.style) {
    case 'bars':
      drawBars(rc, frame, cfg, S)
      break
    case 'wave':
      drawWave(rc, frame, cfg, S)
      break
    case 'radial':
      drawRadial(rc, frame, cfg, S)
      break
    case 'particles':
      drawParticles(rc, frame, cfg, S)
      break
    case 'blob':
      drawBlob(rc, frame, cfg, S)
      break
    case 'grid':
      drawGrid(rc, frame, cfg, S)
      break
    default:
      break
  }
  ctx.restore()
}

/** Shared bar-color sampler: gradient sampled by bar position. */
function barColorAt(cfg: VisualizerConfig, frame: AudioFrame, index: number, count: number): string {
  const g = cfg.gradient
  const t = count > 1 ? index / (count - 1) : 0
  return sampleGradient(g.stops, t, frame.time, g.cycleColors, g.cycleSpeed)
}

/* ------------------------------------ bars ---------------------------------- */

function drawBars(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const n = Math.max(1, Math.floor(cfg.barCount))
  const freq = frame.freq
  const gap = clamp01(cfg.gap)
  const slot = W / n
  const barW = Math.max(1, slot * (1 - gap))
  const maxH = H * 0.72
  const minH = 3 * S
  const radius = clamp01(cfg.roundness) * (barW / 2)
  const sens = clamp(cfg.sensitivity, 0, 3)
  const centerY = H / 2

  for (let i = 0; i < n; i++) {
    const v = clamp01((i < freq.length ? freq[i] : 0) * sens)
    const h = Math.max(minH, v * maxH)
    const x = i * slot + (slot - barW) / 2
    const color = barColorAt(cfg, frame, i, n)

    ctx.fillStyle = color
    if (cfg.glow) {
      ctx.shadowColor = color
      ctx.shadowBlur = 18 * S
    } else {
      ctx.shadowBlur = 0
    }

    if (cfg.mirror === 'center') {
      // Bars grow from the vertical center both ways.
      fillRoundRect(ctx, x, centerY - h, barW, h * 2, radius)
    } else {
      // Bottom bars grow up from the floor.
      fillRoundRect(ctx, x, H - h, barW, h, radius)
      if (cfg.mirror === 'mirror') {
        // Flipped copy growing down from the ceiling.
        fillRoundRect(ctx, x, 0, barW, h, radius)
      }
    }
  }
  ctx.shadowBlur = 0
}

/* ------------------------------------ wave ---------------------------------- */

function drawWave(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const wave = frame.wave
  const count = wave.length
  if (count < 2) return
  const centerY = H / 2
  const amp = Math.min(H * 0.22 * clamp(cfg.sensitivity, 0, 3), H * 0.42)
  const g = cfg.gradient
  const line = gradientLine(g.angle, W, H)
  const stroke = buildGradient(
    ctx,
    line.x0,
    line.y0,
    line.x1,
    line.y1,
    g.stops,
    frame.time,
    g.cycleColors,
    g.cycleSpeed,
  )

  const tracePath = (sign: number): void => {
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1)) * W
      const y = centerY + wave[i] * amp * sign
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
  }

  ctx.lineWidth = 3 * S
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = stroke
  if (cfg.glow) {
    ctx.shadowColor = sampleGradient(g.stops, 0.5, frame.time, g.cycleColors, g.cycleSpeed)
    ctx.shadowBlur = 18 * S
  } else {
    ctx.shadowBlur = 0
  }

  tracePath(1)
  ctx.stroke()
  if (cfg.mirror !== 'none') {
    // Vertically mirrored copy for a symmetric envelope.
    tracePath(-1)
    ctx.stroke()
  }
  ctx.shadowBlur = 0
}

/* ----------------------------------- radial ---------------------------------- */

function drawRadial(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const n = Math.max(1, Math.floor(cfg.barCount))
  const freq = frame.freq
  const cx = W / 2
  const cy = H / 2
  const baseRadius = H * 0.18
  const maxLen = H * 0.48 - baseRadius
  const rotation = frame.time * 0.15
  const sens = clamp(cfg.sensitivity, 0, 3)
  const lineWidth = Math.max(2, 3 * S)

  const drawSpoke = (angle: number, len: number): void => {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    ctx.beginPath()
    ctx.moveTo(cx + cos * baseRadius, cy + sin * baseRadius)
    ctx.lineTo(cx + cos * (baseRadius + len), cy + sin * (baseRadius + len))
    ctx.stroke()
  }

  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'

  for (let i = 0; i < n; i++) {
    const t = i / n
    const angle = rotation + t * Math.PI * 2
    const v = clamp01((i < freq.length ? freq[i] : 0) * sens)
    const len = Math.min(4 * S + v * H * 0.22, maxLen)
    const color = barColorAt(cfg, frame, i, n)

    ctx.strokeStyle = color
    if (cfg.glow) {
      ctx.shadowColor = color
      ctx.shadowBlur = 18 * S
    } else {
      ctx.shadowBlur = 0
    }

    drawSpoke(angle, len)
    if (cfg.mirror === 'mirror') {
      // Reflected across the vertical axis for left/right symmetry.
      drawSpoke(Math.PI - angle, len)
    } else if (cfg.mirror === 'center') {
      // Inward copy of the same spoke.
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      ctx.beginPath()
      ctx.moveTo(cx + cos * baseRadius, cy + sin * baseRadius)
      ctx.lineTo(cx + cos * (baseRadius - len), cy + sin * (baseRadius - len))
      ctx.stroke()
    }
  }
  ctx.shadowBlur = 0

  // Thin inner ring + center dot (signature radial look).
  const midColor = sampleGradient(
    cfg.gradient.stops,
    0.5,
    frame.time,
    cfg.gradient.cycleColors,
    cfg.gradient.cycleSpeed,
  )
  ctx.globalAlpha = 0.85
  ctx.lineWidth = Math.max(1, 1.5 * S)
  ctx.strokeStyle = midColor
  ctx.beginPath()
  ctx.arc(cx, cy, baseRadius * 0.82, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = midColor
  ctx.beginPath()
  ctx.arc(cx, cy, Math.max(2, 3.5 * S), 0, Math.PI * 2)
  ctx.fill()
}

const PARTICLE_COUNT = 90

function drawParticles(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const cx = W / 2
  const cy = H / 2
  const g = cfg.gradient
  const sens = clamp(cfg.sensitivity, 0, 3)
  const energy = clamp01(frame.energy)
  const bass = clamp01(frame.bass)

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Seeded constants per particle — identical every frame.
    const rnd = mulberry32(i * 1013 + 7)
    const baseAngle = rnd() * Math.PI * 2
    const baseR = (0.2 + rnd() * 0.28) * H
    const speed = (rnd() - 0.5) * 0.9
    const size = (1.5 + rnd() * 2.5) * S

    const angle = baseAngle + frame.time * speed * (0.2 + energy * 1.5)
    const r = baseR * (1 + bass * 0.25 * sens)
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r

    const color = sampleGradient(g.stops, i / PARTICLE_COUNT, frame.time, g.cycleColors, g.cycleSpeed)
    ctx.fillStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = cfg.glow ? 12 * S : 0
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()
  }

  // Soft center glow reacting to overall energy.
  ctx.shadowBlur = 0
  const glowRadius = Math.max(1, H * (0.06 + energy * 0.12 * sens))
  const glowColor = sampleGradient(g.stops, 0.5, frame.time, g.cycleColors, g.cycleSpeed)
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius)
  glow.addColorStop(0, withAlpha(glowColor, 0.5))
  glow.addColorStop(1, withAlpha(glowColor, 0))
  ctx.fillStyle = glow
  ctx.fillRect(cx - glowRadius, cy - glowRadius, glowRadius * 2, glowRadius * 2)
}

/* ------------------------------------ blob ----------------------------------- */

/**
 * Organic audio blob: a smooth closed spline around the center whose radius
 * is driven by the log spectrum (mirrored for left/right symmetry), plus a
 * gentle idle breathing motion. Layered aurora echoes + a radial-gradient
 * core give it depth. Fully deterministic — phases derive from frame.time.
 */
function drawBlob(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const cx = W / 2
  const cy = H / 2
  const sens = clamp(cfg.sensitivity, 0, 3)
  const bass = clamp01(frame.bass)
  const energy = clamp01(frame.energy)
  const g = cfg.gradient

  const baseR = H * (0.18 + bass * 0.05 * sens + energy * 0.02)
  const K = 128
  const freq = frame.freq
  const len = Math.max(1, freq.length)

  // Spectrum magnitude at each of K sample angles. The mapping is mirrored
  // (angle 0..π walks the spectrum forward, π..2π walks it back) so the blob
  // stays left/right symmetric, and small neighborhoods are averaged so a
  // single hot bin can't spike the outline.
  const radii = new Float32Array(K)
  for (let i = 0; i < K; i++) {
    const m = 1 - Math.abs((i / K) * 2 - 1)
    const bin = Math.min(len - 1, Math.floor(m * (len - 1)))
    const b0 = Math.max(0, bin - 1)
    const b1 = Math.min(len - 1, bin + 1)
    const v = ((freq[b0] ?? 0) + (freq[bin] ?? 0) + (freq[b1] ?? 0)) / 3
    radii[i] = clamp01(v * sens)
  }
  // Two circular-smoothing passes → silky silhouette.
  for (let pass = 0; pass < 2; pass++) {
    let prev = radii[K - 1]
    for (let i = 0; i < K; i++) {
      const cur = radii[i]
      const next = radii[(i + 1) % K]
      radii[i] = prev * 0.25 + cur * 0.5 + next * 0.25
      prev = cur
    }
  }
  for (let i = 0; i < K; i++) {
    const a = (i / K) * Math.PI * 2
    // Soft idle wobble so the blob breathes even in silence.
    const wobble =
      Math.sin(a * 2 + frame.time * 0.7) * 0.035 + Math.sin(a * 3 - frame.time * 0.45) * 0.02
    radii[i] = baseR * (1 + wobble + radii[i] * 0.75)
  }

  // Smooth closed spline through segment midpoints (quadratic midpoint
  // technique) — no polygon corners, no jagged edges.
  const buildPath = (scale: number, phase: number): Path2D => {
    const pts: Array<[number, number]> = []
    for (let i = 0; i < K; i++) {
      const a = (i / K) * Math.PI * 2 + phase
      const r = radii[i] * scale
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
    const p = new Path2D()
    const midX = (pts[K - 1][0] + pts[0][0]) / 2
    const midY = (pts[K - 1][1] + pts[0][1]) / 2
    p.moveTo(midX, midY)
    for (let i = 0; i < K; i++) {
      const cur = pts[i]
      const nxt = pts[(i + 1) % K]
      p.quadraticCurveTo(cur[0], cur[1], (cur[0] + nxt[0]) / 2, (cur[1] + nxt[1]) / 2)
    }
    p.closePath()
    return p
  }

  const cLow = sampleGradient(g.stops, 0.1, frame.time, g.cycleColors, g.cycleSpeed)
  const cMid = sampleGradient(g.stops, 0.5, frame.time, g.cycleColors, g.cycleSpeed)
  const cHigh = sampleGradient(g.stops, 0.9, frame.time, g.cycleColors, g.cycleSpeed)

  // Ambient aura pulsing behind everything.
  const auraR = baseR * 2.15
  const aura = ctx.createRadialGradient(cx, cy, baseR * 0.4, cx, cy, auraR)
  aura.addColorStop(0, withAlpha(cMid, 0.26))
  aura.addColorStop(0.55, withAlpha(cMid, 0.09))
  aura.addColorStop(1, withAlpha(cMid, 0))
  ctx.fillStyle = aura
  ctx.fillRect(cx - auraR, cy - auraR, auraR * 2, auraR * 2)

  // Echo layers — slightly larger, softly rotated copies fading outward.
  const echoes: Array<{ scale: number; alpha: number; phase: number }> = [
    { scale: 1.28, alpha: 0.16, phase: 0.05 },
    { scale: 1.58, alpha: 0.07, phase: -0.065 },
  ]
  for (const e of echoes) {
    ctx.fillStyle = withAlpha(cMid, e.alpha)
    ctx.fill(buildPath(e.scale, e.phase))
  }

  // Core: radial gradient (light center → saturated rim) for real depth.
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 1.5)
  core.addColorStop(0, withAlpha(cLow, 0.95))
  core.addColorStop(0.62, withAlpha(cMid, 0.9))
  core.addColorStop(1, withAlpha(cHigh, 0.92))
  const mainPath = buildPath(1, 0)
  if (cfg.glow) {
    ctx.shadowColor = withAlpha(cMid, 0.85)
    ctx.shadowBlur = 34 * S
  } else {
    ctx.shadowBlur = 0
  }
  ctx.fillStyle = core
  ctx.fill(mainPath)
  ctx.shadowBlur = 0

  // Thin bright rim to finish the silhouette.
  ctx.lineWidth = Math.max(1, 1.5 * S)
  ctx.strokeStyle = withAlpha(cHigh, 0.75)
  ctx.stroke(mainPath)
}

/* ------------------------------------ grid ----------------------------------- */

/** Mix a CSS color toward white (t = 0..1). Falls back to the input color. */
function mixToWhite(color: string, t: number): string {
  const parsed = parseColor(color)
  if (!parsed) return color
  const k = clamp01(t)
  const r = Math.round(parsed.r + (255 - parsed.r) * k)
  const gg = Math.round(parsed.g + (255 - parsed.g) * k)
  const b = Math.round(parsed.b + (255 - parsed.b) * k)
  return `rgb(${r}, ${gg}, ${b})`
}

/**
 * LED-matrix equalizer: square cells, columns mapped onto the log spectrum.
 * Cells light bottom-up with a smooth frontier fade-in and a bright "hot
 * tip" on the topmost full cell; unlit cells fade with height for depth.
 */
function drawGrid(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const cols = Math.round(clamp(cfg.barCount / 2, 12, 28))
  const marginX = W * 0.06
  const cell = (W - marginX * 2) / cols
  const rows = Math.max(6, Math.floor((H - H * 0.1) / cell))
  const gridW = cols * cell
  const gridH = rows * cell
  const x0 = (W - gridW) / 2
  const y0 = (H - gridH) / 2
  const gapRatio = clamp(cfg.gap, 0, 0.8) * 0.55
  const sens = clamp(cfg.sensitivity, 0, 3)
  const radius = (0.18 + clamp01(cfg.roundness) * 0.32) * cell
  const w = cell * (1 - gapRatio)
  const h = w
  const off = (cell - w) / 2
  const freq = frame.freq

  for (let c = 0; c < cols; c++) {
    const bin = Math.min(freq.length - 1, Math.floor((c / cols) * freq.length))
    const v = clamp01((freq[bin] ?? 0) * sens)
    const level = v * rows
    const full = Math.floor(level)
    const frac = level - full
    const color = barColorAt(cfg, frame, c, cols)

    for (let r = 0; r < rows; r++) {
      const rowFromBottom = rows - 1 - r
      const x = x0 + c * cell + off
      const y = y0 + r * cell + off

      let alpha: number
      let hot = false
      if (rowFromBottom < full) {
        alpha = 1
        hot = rowFromBottom === full - 1 // topmost full cell = bright tip
      } else if (rowFromBottom === full) {
        alpha = frac * 0.85 // frontier cell fades in smoothly
      } else {
        // Unlit guiding dots, slightly brighter at the bottom for depth.
        alpha = 0.1 - 0.05 * (rowFromBottom / Math.max(1, rows - 1))
      }

      const cellColor = hot ? mixToWhite(color, 0.55) : color
      ctx.fillStyle = withAlpha(cellColor, alpha)
      if (hot && cfg.glow) {
        ctx.shadowColor = cellColor
        ctx.shadowBlur = 10 * S
      } else {
        ctx.shadowBlur = 0
      }
      fillRoundRect(ctx, x, y, w, h, radius)
    }
  }
  ctx.shadowBlur = 0
}
