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
import { buildGradient, gradientLine, sampleGradient, withAlpha } from './gradients'
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
 * Organic blob: closed smooth path around the center whose radius is
 * modulated by harmonic sums of the spectrum — fully deterministic
 * (phases derive from frame.time, never the wall clock).
 */
function drawBlob(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const cx = W / 2
  const cy = H / 2
  const sens = clamp(cfg.sensitivity, 0, 3)
  const bass = clamp01(frame.bass)
  const energy = clamp01(frame.energy)
  const g = cfg.gradient

  const baseR = H * 0.16 * (1 + bass * 0.22 * sens + energy * 0.08)
  const HARMONICS = 5
  const K = 96

  const line = gradientLine(g.angle, W, H)
  const fill = buildGradient(
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

  const path = new Path2D()
  for (let i = 0; i <= K; i++) {
    const a = (i / K) * Math.PI * 2
    let r = baseR
    for (let h = 1; h <= HARMONICS; h++) {
      const bin = Math.min(
        frame.freq.length - 1,
        Math.floor(((h - 1) / HARMONICS) * frame.freq.length),
      )
      const v = clamp01((frame.freq[bin] ?? 0) * sens)
      r += Math.sin(a * h + frame.time * (0.4 + h * 0.17)) * v * baseR * (0.55 / Math.sqrt(h))
    }
    r = Math.max(baseR * 0.35, r)
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    if (i === 0) path.moveTo(x, y)
    else path.lineTo(x, y)
  }
  path.closePath()

  if (cfg.glow) {
    ctx.shadowColor = sampleGradient(g.stops, 0.5, frame.time, g.cycleColors, g.cycleSpeed)
    ctx.shadowBlur = 30 * S
  } else {
    ctx.shadowBlur = 0
  }
  ctx.fillStyle = fill
  ctx.fill(path)

  ctx.shadowBlur = 0
  ctx.lineWidth = Math.max(1.5, 2.5 * S)
  ctx.strokeStyle = sampleGradient(g.stops, 0.85, frame.time, g.cycleColors, g.cycleSpeed)
  ctx.stroke(path)
}

/* ------------------------------------ grid ----------------------------------- */

/**
 * LED-matrix grid: columns map onto the spectrum, cells light bottom-up when
 * their band magnitude crosses the row threshold.
 */
function drawGrid(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const cols = Math.round(clamp(cfg.barCount / 4, 8, 48))
  const rows = 12
  const margin = W * 0.055
  const cellW = (W - margin * 2) / cols
  const cellH = (H - margin * 2) / rows
  const gapRatio = clamp(cfg.gap, 0, 0.8)
  const sens = clamp(cfg.sensitivity, 0, 3)
  const radius = clamp01(cfg.roundness) * Math.min(cellW, cellH) * 0.45

  for (let c = 0; c < cols; c++) {
    const bin = Math.floor((c / cols) * frame.freq.length)
    const v = clamp01((frame.freq[bin] ?? 0) * sens)
    const litRows = Math.round(v * rows)
    const color = barColorAt(cfg, frame, c, cols)
    const x = margin + c * cellW

    for (let r = 0; r < rows; r++) {
      const rowFromBottom = rows - 1 - r
      const lit = rowFromBottom < litRows
      const y = margin + r * cellH
      const w = cellW * (1 - gapRatio)
      const h = cellH * (1 - gapRatio)

      ctx.fillStyle = lit ? color : withAlpha(color, 0.07)
      if (lit && cfg.glow) {
        ctx.shadowColor = color
        ctx.shadowBlur = 10 * S
      } else {
        ctx.shadowBlur = 0
      }
      fillRoundRect(ctx, x + (cellW - w) / 2, y + (cellH - h) / 2, w, h, radius)
    }
  }
  ctx.shadowBlur = 0
}
