/**
 * Spectra — Canvas 2D visualizer render engine.
 *
 * Six stateful renderers (bars / wave / radial / particles / blob / grid) that
 * react to live analyser data. Renderers draw ONLY the foreground: the calling
 * component paints the background, text overlays and the progress bar itself.
 *
 * Design constraints:
 *  - Allocation-light per frame: scratch buffers live in module/closure state
 *    and are reused across frames; the only per-frame allocations are tiny
 *    gradients and a handful of small color strings.
 *  - All geometry is derived from width/height — any aspect ratio works.
 *  - No DOM / window / document access; pure Canvas 2D + Math.
 *  - Safe on empty / all-zero input (idle attract state): `freq.length || 1`
 *    style guards everywhere, clamped amplitudes so silence stays near-invisible.
 */

import type { VisualizerConfig, VisualizerType } from '@/lib/types'

export { VISUALIZER_META } from '@/lib/types'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RenderContext {
  ctx: CanvasRenderingContext2D
  /** Logical canvas width */
  width: number
  /** Logical canvas height */
  height: number
  /** Seconds since the render loop started (monotonically increasing) */
  time: number
  /** Seconds since the previous frame */
  dt: number
  /** Frequency bins, raw 0..255 values (already smoothed by the AnalyserNode) */
  freq: Uint8Array
  /** Time-domain samples, 0..255 with 128 = silence center */
  wave: Uint8Array
  /** 0..1 smoothed bass energy */
  bass: number
  /** 0..1 smoothed mid energy */
  mid: number
  /** 0..1 smoothed treble energy */
  treble: number
  /** 0..1 smoothed overall loudness */
  level: number
  /** Full current config */
  config: VisualizerConfig
}

export type VisualizerRenderer = (rc: RenderContext) => void

/** Create a stateful renderer for the given type. Caller re-creates it when type changes. */
export function createVisualizer(type: VisualizerType): VisualizerRenderer {
  switch (type) {
    case 'wave':
      return createWaveRenderer()
    case 'radial':
      return createRadialRenderer()
    case 'particles':
      return createParticlesRenderer()
    case 'blob':
      return createBlobRenderer()
    case 'grid':
      return createGridRenderer()
    case 'bars':
    default:
      return createBarsRenderer()
  }
}

// ---------------------------------------------------------------------------
// Shared constants & helpers (module-private)
// ---------------------------------------------------------------------------

const MAX_GROUPS = 160
/** Log-ish bin mapping exponent: boundary(g) = usableBins * (g/G)^EXP */
const LOG_BIN_EXPONENT = 2.0
/** Ignore the top ~8% of FFT bins — usually empty at music cutoffs */
const BIN_TOP_SKIP = 0.92
/** Hard ceiling for sensitivity-scaled amplitudes */
const MAX_AMP = 1.5
const TAU = Math.PI * 2

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Clamped sensitivity multiplier from config */
function sensOf(config: VisualizerConfig): number {
  return clamp(config.sensitivity, 0.05, 4)
}

/**
 * Group frequency bins into `groups` perceptual buckets (log-ish mapping:
 * low frequencies get fewer bins, higher ones progressively more) and return
 * the averaged, normalized (0..1) values.
 *
 * Uses a single module-level scratch buffer reused across frames — callers
 * must consume the result before the next call. Never allocates.
 */
function groupBins(freq: Uint8Array, groups: number): Float32Array {
  const g = Math.max(1, Math.min(MAX_GROUPS, Math.floor(groups)))
  const len = freq.length || 1
  if (len < 1 || freq.length === 0) {
    // empty input (idle attract fallback) — keep the frame NaN-free
    groupScratch.fill(0, 0, g)
    return groupScratch
  }
  const usable = Math.max(1, Math.floor(len * BIN_TOP_SKIP))
  for (let i = 0; i < g; i++) {
    const t0 = i / g
    const t1 = (i + 1) / g
    let b0 = Math.floor(Math.pow(t0, LOG_BIN_EXPONENT) * usable)
    let b1 = Math.floor(Math.pow(t1, LOG_BIN_EXPONENT) * usable)
    if (b1 <= b0) b1 = b0 + 1
    if (b1 > usable) b1 = usable
    if (b0 >= b1) {
      groupScratch[i] = 0
      continue
    }
    let sum = 0
    for (let b = b0; b < b1; b++) sum += freq[b] || 0
    groupScratch[i] = sum / (b1 - b0) / 255
  }
  return groupScratch
}

const groupScratch = new Float32Array(MAX_GROUPS)

/** Linearly interpolate between neighboring grouped-bin values at t in 0..1 */
function sampleGroups(vals: Float32Array, count: number, t: number): number {
  if (count <= 0) return 0
  const x = clamp(t, 0, 1) * (count - 1)
  const i0 = Math.floor(x)
  const i1 = i0 + 1 < count ? i0 + 1 : i0
  const f = x - i0
  return vals[i0] * (1 - f) + vals[i1] * f
}

// --- color utilities -------------------------------------------------------

interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

const colorParseCache = new Map<string, RGBA>()
const FALLBACK_RGBA: RGBA = { r: 255, g: 255, b: 255, a: 1 }

/** Parse #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() — cached per string */
function parseColor(str: string): RGBA | null {
  const cached = colorParseCache.get(str)
  if (cached) return cached
  const s = str.trim().toLowerCase()
  let out: RGBA | null = null
  if (s.charCodeAt(0) === 35 /* '#' */) {
    const hex = s.slice(1)
    let r = -1
    let g = -1
    let b = -1
    let a = 1
    if (hex.length === 3 || hex.length === 4) {
      r = parseInt(hex[0] + hex[0], 16)
      g = parseInt(hex[1] + hex[1], 16)
      b = parseInt(hex[2] + hex[2], 16)
      if (hex.length === 4) a = parseInt(hex[3] + hex[3], 16) / 255
    } else if (hex.length === 6 || hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16)
      g = parseInt(hex.slice(2, 4), 16)
      b = parseInt(hex.slice(4, 6), 16)
      if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16) / 255
    }
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b) && r >= 0 && g >= 0 && b >= 0) {
      out = { r, g, b, a: clamp(a, 0, 1) }
    }
  } else {
    const m = /^rgba?\(([^)]+)\)$/.exec(s)
    if (m) {
      const parts = m[1].split(/[,/\s]+/).filter((p) => p.length > 0)
      if (parts.length >= 3) {
        const ch = (tok: string): number => {
          const v = parseFloat(tok)
          if (Number.isNaN(v)) return -1
          return tok.endsWith('%') ? v * 2.55 : v
        }
        const r = ch(parts[0])
        const g = ch(parts[1])
        const b = ch(parts[2])
        const a = parts.length >= 4 ? parseFloat(parts[3]) : 1
        if (r >= 0 && g >= 0 && b >= 0 && !Number.isNaN(a)) {
          out = { r, g, b, a: clamp(a, 0, 1) }
        }
      }
    }
  }
  if (out) colorParseCache.set(str, out)
  return out
}

/** Mix two CSS colors (hex or rgb/rgba) into an `rgba(...)` string */
function mixColor(a: string, b: string, t: number): string {
  const tt = clamp(t, 0, 1)
  const ca = parseColor(a)
  const cb = parseColor(b)
  const from = ca ?? cb ?? FALLBACK_RGBA
  const to = cb ?? ca ?? FALLBACK_RGBA
  const r = Math.round(from.r + (to.r - from.r) * tt)
  const g = Math.round(from.g + (to.g - from.g) * tt)
  const bl = Math.round(from.b + (to.b - from.b) * tt)
  const al = Math.round((from.a + (to.a - from.a) * tt) * 1000) / 1000
  return 'rgba(' + r + ',' + g + ',' + bl + ',' + al + ')'
}

/** Same color with a replaced alpha channel */
function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color) ?? FALLBACK_RGBA
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + clamp(alpha, 0, 1) + ')'
}

/** Rotate a color's hue by `deg` degrees (non-parseable colors pass through). */
function hueRotate(color: string, deg: number): string {
  const c = parseColor(color)
  if (!c || deg === 0) return color
  const rf = c.r / 255
  const gf = c.g / 255
  const bf = c.b / 255
  const max = Math.max(rf, gf, bf)
  const min = Math.min(rf, gf, bf)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d !== 0) {
    if (max === rf) h = ((gf - bf) / d) % 6
    else if (max === gf) h = (bf - rf) / d + 2
    else h = (rf - gf) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  h = (h + deg) % 360
  const cc = (1 - Math.abs(2 * l - 1)) * s
  const x = cc * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - cc / 2
  let rr = 0
  let gg = 0
  let bb = 0
  if (h < 60) [rr, gg, bb] = [cc, x, 0]
  else if (h < 120) [rr, gg, bb] = [x, cc, 0]
  else if (h < 180) [rr, gg, bb] = [0, cc, x]
  else if (h < 240) [rr, gg, bb] = [0, x, cc]
  else if (h < 300) [rr, gg, bb] = [x, 0, cc]
  else [rr, gg, bb] = [cc, 0, x]
  const to8 = (v: number) => Math.round(clamp(v + m, 0, 1) * 255)
  return 'rgba(' + to8(rr) + ',' + to8(gg) + ',' + to8(bb) + ',' + c.a + ')'
}

/**
 * One resolved gradient stop: color (already hue-shifted when cycling) and its
 * clamped position along the gradient axis.
 */
interface ResolvedStop {
  color: string
  position: number
}

/**
 * Resolve the config's gradient palette at render time. `gradientStops` is the
 * source of truth; when cycling is on every stop's hue rotates by
 * time × cycleSpeed (deterministic — offline exports reproduce it exactly).
 */
function stopsOf(config: VisualizerConfig, time: number): ResolvedStop[] {
  const raw = config.gradientStops
  let stops: ResolvedStop[]
  if (Array.isArray(raw) && raw.length > 0) {
    stops = raw.map((s) => ({ color: s.color, position: clamp(s.position, 0, 1) }))
  } else {
    stops = [
      { color: config.colorA, position: 0 },
      { color: config.colorB, position: 1 },
    ]
  }
  if (config.gradientCycle && config.gradientCycleSpeed > 0) {
    const shift = (time * config.gradientCycleSpeed) % 360
    if (shift !== 0) stops = stops.map((s) => ({ ...s, color: hueRotate(s.color, shift) }))
  }
  return stops.sort((a, b) => a.position - b.position)
}

function firstStopColor(stops: ResolvedStop[]): string {
  return stops[0]?.color ?? '#ffffff'
}

function lastStopColor(stops: ResolvedStop[]): string {
  return stops[stops.length - 1]?.color ?? '#ffffff'
}

/** Piecewise-linear sample across the resolved stops (positions clamped). */
function sampleStops(stops: ResolvedStop[], t: number): string {
  if (stops.length === 1) return stops[0].color
  const tt = clamp(t, 0, 1)
  if (tt <= stops[0].position) return stops[0].color
  const last = stops[stops.length - 1]
  if (tt >= last.position) return last.color
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (tt >= a.position && tt <= b.position) {
      const span = b.position - a.position
      if (span <= 1e-6) return b.color
      return mixColor(a.color, b.color, (tt - a.position) / span)
    }
  }
  return last.color
}

/** Fill a gradient with the full multi-stop palette (extending end colors). */
function fillStops(grad: CanvasGradient, stops: ResolvedStop[]): void {
  if (stops.length === 0) return
  if (stops.length === 1) {
    grad.addColorStop(0, stops[0].color)
    grad.addColorStop(1, stops[0].color)
    return
  }
  if (stops[0].position > 0) grad.addColorStop(0, stops[0].color)
  for (const s of stops) grad.addColorStop(s.position, s.color)
  const last = stops[stops.length - 1]
  if (last.position < 1) grad.addColorStop(1, last.color)
}

/**
 * Canvas-wide linear gradient running at the user's angle (0° = left → right,
 * 90° = top → bottom, 270° = bottom → top). Every renderer samples the same
 * angled palette, so the Angle slider restyles the whole scene at once.
 */
function angledGradient(rc: RenderContext): CanvasGradient {
  const { ctx, width, height, config, time } = rc
  const rad = (clamp(config.gradientAngle, 0, 360) * Math.PI) / 180
  const len = Math.abs(width * Math.cos(rad)) + Math.abs(height * Math.sin(rad))
  const cx = width / 2
  const cy = height / 2
  const grad = ctx.createLinearGradient(
    cx - (Math.cos(rad) * len) / 2,
    cy - (Math.sin(rad) * len) / 2,
    cx + (Math.cos(rad) * len) / 2,
    cy + (Math.sin(rad) * len) / 2,
  )
  fillStops(grad, stopsOf(config, time))
  return grad
}

/**
 * A cached color interpolation table across the gradient stops. Rebuilt only
 * when the resolved palette changes — per-frame lookups are array reads.
 */
function createColorRamp(steps: number) {
  const colors = new Array<string>(steps).fill('#ffffff')
  let key = ''
  return {
    colors,
    ensure(stops: ResolvedStop[]): void {
      if (stops.length === 0) return
      const k = stops.map((s) => s.position + '=' + s.color).join('|')
      if (k === key) return
      key = k
      for (let i = 0; i < steps; i++) {
        const raw = steps === 1 ? 0 : i / (steps - 1)
        colors[i] = sampleStops(stops, raw)
      }
    },
  }
}

/** Tiny deterministic PRNG (mulberry32) — fixed seeds keep initialization stable */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Rectangle with rounded top corners only (bottom sits flush on the baseline) */
function roundTopRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h)
  ctx.beginPath()
  ctx.moveTo(x, y + h)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h)
  ctx.closePath()
}

// ---------------------------------------------------------------------------
// 1. bars — classic spectrum bars with peak caps
// ---------------------------------------------------------------------------

function createBarsRenderer(): VisualizerRenderer {
  let peaks = new Float32Array(0)
  let peaksForCount = 0

  return function render(rc: RenderContext): void {
    const { ctx, width, height, freq, config, dt, time } = rc
    if (width < 4 || height < 4) return

    const n = Math.max(1, Math.min(MAX_GROUPS, Math.floor(config.barCount)))
    if (peaksForCount !== n) {
      peaks = new Float32Array(n)
      peaksForCount = n
    }
    const sens = sensOf(config)
    const vals = groupBins(freq, n)

    // With mirror on, lift the baseline so the reflection below it is visible.
    const mirror = config.mirror
    const baseline = mirror ? height * 0.62 : height
    const maxH = (mirror ? baseline : height) * 0.86
    const slot = width / n
    const gap = slot * 0.3
    const bw = Math.max(1, slot - gap)
    const radius = Math.min(bw / 2, 1.2 + config.lineWidth * 1.4)

    const stops = stopsOf(config, time)
    const endColor = lastStopColor(stops)
    const grad = angledGradient(rc)

    const capH = Math.max(2, bw * 0.14)
    const peakFall = 0.35 * dt // normalized gravity, units/s
    const peakColor = mixColor(endColor, '#ffffff', 0.45)

    // --- main bars (single glow batch) ---
    if (config.glow > 0) {
      ctx.shadowBlur = config.glow
      ctx.shadowColor = endColor
    }
    ctx.fillStyle = grad
    for (let i = 0; i < n; i++) {
      const h = Math.max(2, Math.min(vals[i] * sens, MAX_AMP) * maxH)
      const x = i * slot + (slot - bw) / 2
      roundTopRect(ctx, x, baseline - h, bw, h, radius)
      ctx.fill()
    }
    ctx.shadowBlur = 0

    // --- falling peak caps ---
    ctx.fillStyle = peakColor
    for (let i = 0; i < n; i++) {
      const v = Math.min(vals[i] * sens, MAX_AMP)
      const p = v > peaks[i] ? v : Math.max(0, peaks[i] - peakFall)
      peaks[i] = p
      const x = i * slot + (slot - bw) / 2
      ctx.fillRect(x, baseline - Math.max(2, p * maxH) - capH, bw, capH)
    }

    // --- mirrored reflection below the baseline ---
    if (mirror) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, baseline, width, height - baseline)
      ctx.clip()
      ctx.globalAlpha = 0.25
      ctx.translate(0, baseline)
      ctx.scale(1, -1)
      ctx.translate(0, -baseline)
      ctx.fillStyle = grad
      for (let i = 0; i < n; i++) {
        const h = Math.max(2, Math.min(vals[i] * sens, MAX_AMP) * maxH)
        const x = i * slot + (slot - bw) / 2
        roundTopRect(ctx, x, baseline - h, bw, h, radius)
        ctx.fill()
      }
      ctx.restore()
    }
  }
}

// ---------------------------------------------------------------------------
// 2. wave — oscilloscope curve
// ---------------------------------------------------------------------------

function createWaveRenderer(): VisualizerRenderer {
  const MAX_POINTS = 220
  const px = new Float32Array(MAX_POINTS)
  const py = new Float32Array(MAX_POINTS)
  let nPts = 0

  /** Replays the sampled polyline through ctx as a midpoint-smoothed path */
  function emitPath(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath()
    ctx.moveTo(px[0], py[0])
    for (let i = 1; i < nPts - 1; i++) {
      const mx = (px[i] + px[i + 1]) / 2
      const my = (py[i] + py[i + 1]) / 2
      ctx.quadraticCurveTo(px[i], py[i], mx, my)
    }
    ctx.lineTo(px[nPts - 1], py[nPts - 1])
  }

  return function render(rc: RenderContext): void {
    const { ctx, width, height, wave, config, time, level } = rc
    if (width < 4 || height < 4) return
    const len = wave.length
    if (len < 2) return

    const sens = sensOf(config)
    const centerY = height * 0.5
    const maxAmp = height * 0.48
    const step = Math.max(1, Math.floor(len / MAX_POINTS))

    nPts = 0
    for (let i = 0; i < len && nPts < MAX_POINTS; i += step) {
      let amp = ((wave[i] - 128) / 128) * height * 0.35 * sens
      amp = clamp(amp, -maxAmp, maxAmp)
      px[nPts] = (i / (len - 1)) * width
      py[nPts] = centerY + amp
      nPts++
    }
    if (nPts < MAX_POINTS && len > 0) {
      // include the very last sample so the curve reaches the right edge
      let amp = ((wave[len - 1] - 128) / 128) * height * 0.35 * sens
      amp = clamp(amp, -maxAmp, maxAmp)
      px[nPts] = width
      py[nPts] = centerY + amp
      nPts++
    }
    if (nPts < 2) return

    const lw = Math.max(0.75, (2 + 3 * level) * config.lineWidth)
    const stops = stopsOf(config, time)
    const endColor = lastStopColor(stops)
    const grad = angledGradient(rc)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    // under-fill down to the bottom edge
    emitPath(ctx)
    ctx.lineTo(px[nPts - 1], height)
    ctx.lineTo(px[0], height)
    ctx.closePath()
    ctx.globalAlpha = 0.1 + 0.15 * level
    ctx.fillStyle = endColor
    ctx.fill()
    ctx.globalAlpha = 1

    // echo layer (thicker, fainter) for glow depth
    emitPath(ctx)
    ctx.globalAlpha = 0.35
    ctx.lineWidth = lw * 1.5
    ctx.strokeStyle = grad
    ctx.stroke()
    ctx.globalAlpha = 1

    // main stroke
    emitPath(ctx)
    if (config.glow > 0) {
      ctx.shadowBlur = config.glow
      ctx.shadowColor = endColor
    }
    ctx.lineWidth = lw
    ctx.strokeStyle = grad
    ctx.stroke()
    ctx.shadowBlur = 0

    // vertically flipped mirror curve
    if (config.mirror) {
      for (let i = 0; i < nPts; i++) py[i] = height - py[i]
      emitPath(ctx)
      for (let i = 0; i < nPts; i++) py[i] = height - py[i] // restore scratch
      ctx.globalAlpha = 0.3
      ctx.lineWidth = lw * 0.75
      ctx.strokeStyle = grad
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }
}

// ---------------------------------------------------------------------------
// 3. radial — circular spectrum
// ---------------------------------------------------------------------------

function createRadialRenderer(): VisualizerRenderer {
  const RAMP_STEPS = 32
  const ramp = createColorRamp(RAMP_STEPS)

  return function render(rc: RenderContext): void {
    const { ctx, width, height, freq, config, time, bass, level } = rc
    if (width < 8 || height < 8) return

    const cx = width / 2
    const cy = height / 2
    const minDim = Math.min(width, height)
    const sens = sensOf(config)
    const n = Math.max(8, Math.min(MAX_GROUPS, Math.floor(config.barCount)))
    const vals = groupBins(freq, n)
    const stops = stopsOf(config, time)
    ramp.ensure(stops)

    const baseR = minDim * 0.22 * (1 + level * 0.18)
    const maxLen = minDim * 0.28
    // slow scene rotation + a subtle extra swirl proportional to bass energy
    const rot = config.rotation ? time * 0.15 + bass * time * 0.05 : 0

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rot)
    ctx.translate(-cx, -cy)

    const spokeLW = Math.max(1, 2 + 2.5 * config.lineWidth * (0.5 + level))
    ctx.lineCap = 'round'
    ctx.lineWidth = spokeLW
    if (config.glow > 0) {
      ctx.shadowBlur = config.glow
      ctx.shadowColor = lastStopColor(stops)
    }

    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - Math.PI / 2
      const len = Math.max(minDim * 0.01, Math.min(vals[i] * sens, MAX_AMP) * maxLen)
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      // inner → outer gradient approximated by the spoke's extension ratio
      const t = Math.min(1, len / maxLen)
      ctx.strokeStyle = ramp.colors[Math.round(t * (RAMP_STEPS - 1))]
      ctx.beginPath()
      ctx.moveTo(cx + ca * baseR, cy + sa * baseR)
      ctx.lineTo(cx + ca * (baseR + len), cy + sa * (baseR + len))
      ctx.stroke()
    }
    ctx.shadowBlur = 0

    // inner ring pulsing with bass
    const ringR = baseR * 0.86 + bass * minDim * 0.03
    ctx.beginPath()
    ctx.arc(cx, cy, ringR, 0, TAU)
    ctx.strokeStyle = firstStopColor(stops)
    ctx.lineWidth = Math.max(1, 0.8 + 1.2 * config.lineWidth)
    ctx.stroke()

    ctx.restore()

    // center dot: soft glow that breathes with level (drawn unrotated)
    const dotR = minDim * 0.032 * (0.8 + level * 0.8) + bass * minDim * 0.008
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, dotR))
    const dotColor = lastStopColor(stops)
    g.addColorStop(0, withAlpha(dotColor, 0.9))
    g.addColorStop(0.55, withAlpha(dotColor, 0.35))
    g.addColorStop(1, withAlpha(dotColor, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, Math.max(1, dotR), 0, TAU)
    ctx.fill()
  }
}

// ---------------------------------------------------------------------------
// 4. particles — free-roaming constellation that bounces off the walls and
//    the pulsing center circle
// ---------------------------------------------------------------------------

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  hueMix: number
}

function createParticlesRenderer(): VisualizerRenderer {
  const RAMP_STEPS = 9
  const ramp = createColorRamp(RAMP_STEPS)
  const SEED = 0x5eed1234
  let parts: Particle[] = []
  let initW = 0
  let initH = 0

  function seed(count: number, w: number, h: number): void {
    const rand = mulberry32(SEED)
    const minDim = Math.min(w, h)
    const rim = minDim * 0.28
    parts = new Array<Particle>(count)
    for (let i = 0; i < count; i++) {
      const ang = rand() * TAU
      const speed = (0.2 + rand() * 0.8) * minDim * 0.25
      let x = rand() * w
      let y = rand() * h
      // keep the initial field outside the central bounce circle
      const ddx = x - w / 2
      const ddy = y - h / 2
      const dd = Math.sqrt(ddx * ddx + ddy * ddy)
      if (dd < rim) {
        const a2 = dd < 1e-3 ? rand() * TAU : Math.atan2(ddy, ddx)
        x = w / 2 + Math.cos(a2) * rim
        y = h / 2 + Math.sin(a2) * rim
      }
      parts[i] = {
        x,
        y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        size: 0.4 + rand() * 1.6,
        hueMix: rand(),
      }
    }
    initW = w
    initH = h
  }

  return function render(rc: RenderContext): void {
    const { ctx, width, height, config, dt, time, bass, treble, level } = rc
    if (width < 8 || height < 8) return

    const stops = stopsOf(config, time)
    ramp.ensure(stops)
    const count = Math.max(4, Math.min(400, Math.floor(config.particleCount)))
    if (parts.length !== count || initW <= 0) {
      seed(count, width, height)
    } else if (
      Math.abs(width - initW) / initW > 0.25 ||
      Math.abs(height - initH) / initH > 0.25
    ) {
      // drastic canvas size change — rescale the field into the new space
      const sx = width / initW
      const sy = height / initH
      for (const p of parts) {
        p.x *= sx
        p.y *= sy
        p.vx *= sx
        p.vy *= sy
      }
      initW = width
      initH = height
    }

    const minDim = Math.min(width, height)
    const cx = width / 2
    const cy = height / 2
    const pdt = Math.min(dt, 0.05) // guard against tab-switch dt spikes
    const linkDist = minDim * 0.09
    const linkDist2 = linkDist * linkDist
    const jitter = treble * minDim * 0.6
    const minSpeed = minDim * 0.05
    const maxSpeed = minDim * 0.5
    // The pulsing center glow doubles as a solid circle the particles bounce off
    const glowR = minDim * (0.26 + bass * 0.16)
    const bounceR = glowR * 0.85

    // --- physics ---
    for (const p of parts) {
      // treble: random jitter keeps the field lively without directional bias
      p.vx += (Math.random() - 0.5) * jitter * pdt * 10
      p.vy += (Math.random() - 0.5) * jitter * pdt * 10
      // bass: gentle speed lift only — no outward force, so the constellation
      // roams the whole screen instead of being shoved to the edges
      const boost = 1 + bass * 0.35 * pdt
      p.vx *= boost
      p.vy *= boost
      // light drag; speed clamps keep the motion calm but always drifting
      const drag = Math.max(0, 1 - 0.25 * pdt)
      p.vx *= drag
      p.vy *= drag
      const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
      if (sp > maxSpeed) {
        const k = maxSpeed / sp
        p.vx *= k
        p.vy *= k
      } else if (sp < minSpeed && sp > 1e-4) {
        const k = minSpeed / sp
        p.vx *= k
        p.vy *= k
      }
      p.x += p.vx * pdt
      p.y += p.vy * pdt
      // bounce off the walls so particles keep circulating in view
      if (p.x < 0) {
        p.x = 0
        p.vx = Math.abs(p.vx)
      } else if (p.x > width) {
        p.x = width
        p.vx = -Math.abs(p.vx)
      }
      if (p.y < 0) {
        p.y = 0
        p.vy = Math.abs(p.vy)
      } else if (p.y > height) {
        p.y = height
        p.vy = -Math.abs(p.vy)
      }
      // bounce off the center circle: clamp back to the rim and mirror the
      // velocity about the surface normal (elastic specular bounce)
      let dx = p.x - cx
      let dy = p.y - cy
      let d = Math.sqrt(dx * dx + dy * dy)
      if (d < bounceR) {
        if (d < 1e-3) {
          const a2 = Math.random() * TAU
          dx = Math.cos(a2)
          dy = Math.sin(a2)
          d = 1
        }
        const nx = dx / d
        const ny = dy / d
        p.x = cx + nx * bounceR
        p.y = cy + ny * bounceR
        const vn = p.vx * nx + p.vy * ny
        if (vn < 0) {
          p.vx -= 2 * vn * nx
          p.vy -= 2 * vn * ny
        }
      }
    }

    // --- center glow swelling with bass (behind everything) ---
    const midColor = sampleStops(stops, 0.5)
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
    g.addColorStop(0, withAlpha(midColor, 1))
    g.addColorStop(1, withAlpha(midColor, 0))
    ctx.globalAlpha = 0.15 + bass * 0.25
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, glowR, 0, TAU)
    ctx.fill()
    ctx.globalAlpha = 1

    // --- proximity links ---
    const linkAlpha = 0.15 + level * 0.5
    ctx.lineWidth = 1
    ctx.strokeStyle = midColor
    for (let i = 0; i < parts.length; i++) {
      const a = parts[i]
      for (let j = i + 1; j < parts.length; j++) {
        const b = parts[j]
        const dx = a.x - b.x
        const dy = a.y - b.y
        const d2 = dx * dx + dy * dy
        if (d2 > linkDist2) continue
        const alpha = (1 - Math.sqrt(d2) / linkDist) * linkAlpha
        if (alpha < 0.01) continue
        ctx.globalAlpha = alpha
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1

    // --- glowing dots ---
    if (config.glow > 0) {
      ctx.shadowBlur = config.glow
      ctx.shadowColor = lastStopColor(stops)
    }
    for (const p of parts) {
      ctx.fillStyle = ramp.colors[Math.min(RAMP_STEPS - 1, Math.floor(p.hueMix * RAMP_STEPS))]
      ctx.beginPath()
      ctx.arc(p.x, p.y, 1.5 + p.size + level * 2, 0, TAU)
      ctx.fill()
    }
    ctx.shadowBlur = 0
  }
}

// ---------------------------------------------------------------------------
// 5. blob — organic liquid shape
// ---------------------------------------------------------------------------

function createBlobRenderer(): VisualizerRenderer {
  const POINTS = 84 // angular points (64..96)
  const GROUPS = 56
  const px = new Float32Array(POINTS)
  const py = new Float32Array(POINTS)
  const target = new Float32Array(POINTS)
  const smooth = new Float32Array(POINTS)
  let initialized = false

  /** Closed midpoint-smoothed path through the scratch points */
  function emitPath(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath()
    ctx.moveTo((px[POINTS - 1] + px[0]) / 2, (py[POINTS - 1] + py[0]) / 2)
    for (let i = 0; i < POINTS; i++) {
      const nxt = i + 1 === POINTS ? 0 : i + 1
      ctx.quadraticCurveTo(px[i], py[i], (px[i] + px[nxt]) / 2, (py[i] + py[nxt]) / 2)
    }
    ctx.closePath()
  }

  return function render(rc: RenderContext): void {
    const { ctx, width, height, freq, config, time, dt, level, mid, treble, bass } = rc
    if (width < 16 || height < 16) return

    const cx = width / 2
    const cy = height / 2
    const minDim = Math.min(width, height)
    const sens = sensOf(config)
    const baseR = minDim * 0.26
    const amp = minDim * 0.16 * sens * (0.85 + 0.3 * mid)
    const rot = config.rotation ? time * 0.2 : 0
    const vals = groupBins(freq, GROUPS)
    const follow = Math.min(1, dt * 12)

    for (let i = 0; i < POINTS; i++) {
      const angle = (i / POINTS) * TAU + rot
      // fold the spectrum around the half turn so left/right stay symmetric
      const k = i <= POINTS / 2 ? i : POINTS - i
      const s = sampleGroups(vals, GROUPS, k / (POINTS / 2))
      const wob =
        Math.sin(angle * 3 + time * 0.9) * 0.5 +
        Math.sin(angle * 5 - time * 1.25) * 0.3 +
        Math.sin(angle * 2 + time * 0.6) * 0.35
      target[i] = baseR * (1 + 0.25 * level) + Math.min(s * sens, MAX_AMP) * amp + wob * 0.03 * baseR
      if (!initialized) smooth[i] = target[i]
      else smooth[i] += (target[i] - smooth[i]) * follow
      px[i] = cx + Math.cos(angle) * smooth[i]
      py[i] = cy + Math.sin(angle) * smooth[i]
    }
    initialized = true

    const stops = stopsOf(config, time)
    const fillGrad = ctx.createRadialGradient(cx, cy, baseR * 0.1, cx, cy, baseR * 1.6)
    fillStops(fillGrad, stops)

    // echo layers behind the main fill (scaled copies around the center)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1.12, 1.12)
    ctx.translate(-cx, -cy)
    ctx.globalAlpha = 0.12
    ctx.fillStyle = fillGrad
    emitPath(ctx)
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1.06, 1.06)
    ctx.translate(-cx, -cy)
    ctx.globalAlpha = 0.25
    ctx.fillStyle = fillGrad
    emitPath(ctx)
    ctx.fill()
    ctx.restore()
    ctx.globalAlpha = 1

    // main fill + glowing stroke
    emitPath(ctx)
    ctx.globalAlpha = 0.85
    ctx.fillStyle = fillGrad
    ctx.fill()
    ctx.globalAlpha = 1
    if (config.glow > 0) {
      ctx.shadowBlur = config.glow
      ctx.shadowColor = lastStopColor(stops)
    }
    ctx.lineWidth = 2 + 2 * config.lineWidth
    ctx.strokeStyle = lastStopColor(stops)
    ctx.stroke()
    ctx.shadowBlur = 0

    // orbiting satellites; orbital radius reacts to treble
    if (config.glow > 0) {
      ctx.shadowBlur = config.glow * 0.6
      ctx.shadowColor = lastStopColor(stops)
    }
    for (let i = 0; i < 3; i++) {
      const ang = time * (0.45 + i * 0.21) + i * 2.0944
      const orbR =
        baseR * (1.28 + 0.07 * Math.sin(time * 0.8 + i * 1.7)) + treble * minDim * 0.05
      ctx.fillStyle = sampleStops(stops, i / 2)
      ctx.beginPath()
      ctx.arc(cx + Math.cos(ang) * orbR, cy + Math.sin(ang) * orbR, 2 + config.lineWidth, 0, TAU)
      ctx.fill()
    }
    ctx.shadowBlur = 0
  }
}

// ---------------------------------------------------------------------------
// 6. grid — dot-matrix spectrogram
// ---------------------------------------------------------------------------

function createGridRenderer(): VisualizerRenderer {
  const RAMP_STEPS = 24
  const ramp = createColorRamp(RAMP_STEPS)
  const lastRamp = RAMP_STEPS - 1

  /** One lit dot: color by height fraction, radius/alpha by local intensity */
  function drawLitDot(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    row: number,
    totalRows: number,
    value: number,
  ): void {
    const t = totalRows <= 1 ? 0 : row / (totalRows - 1)
    const intensity = clamp(value * totalRows - row, 0, 1)
    ctx.globalAlpha = 0.35 + 0.65 * intensity
    ctx.fillStyle = ramp.colors[Math.round(t * lastRamp)]
    ctx.beginPath()
    ctx.arc(x, y, 1.5 + intensity * 2, 0, TAU)
    ctx.fill()
  }

  return function render(rc: RenderContext): void {
    const { ctx, width, height, freq, config, time } = rc
    if (width < 16 || height < 16) return

    ramp.ensure(stopsOf(config, time))
    const sens = sensOf(config)
    const cols = Math.max(16, Math.min(96, Math.floor(config.barCount)))
    const minDim = Math.min(width, height)
    const scale = minDim / 720
    const rowGap = clamp(12 * scale, 8, 16)
    const padX = width * 0.05
    const top = height * 0.12
    const bottom = height * 0.16
    const availH = Math.max(rowGap, height - top - bottom)
    const rows = Math.max(4, Math.floor(availH / rowGap))
    const gap = availH / rows
    const colW = (width - padX * 2) / cols
    const vals = groupBins(freq, cols)
    const mirror = config.mirror
    const rowsUp = Math.ceil(rows / 2)
    const rowsDown = rows - rowsUp
    const baseY = top + availH
    const midY = top + availH / 2

    // --- unlit grid (single batched path, keeps the matrix always visible) ---
    ctx.beginPath()
    for (let c = 0; c < cols; c++) {
      const x = padX + (c + 0.5) * colW
      for (let r = 0; r < rows; r++) {
        const y = mirror
          ? r < rowsUp
            ? midY - (r + 0.5) * gap
            : midY + (r - rowsUp + 0.5) * gap
          : baseY - (r + 0.5) * gap
        ctx.moveTo(x + 1, y)
        ctx.arc(x, y, 1, 0, TAU)
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.05)'
    ctx.fill()

    // --- lit dots growing from the bottom edge (or from the center line) ---
    for (let c = 0; c < cols; c++) {
      const v = Math.min(vals[c] * sens, MAX_AMP)
      if (v <= 0.001) continue
      const x = padX + (c + 0.5) * colW
      if (mirror) {
        const litUp = Math.min(rowsUp, Math.round(v * rowsUp))
        const litDown = Math.min(rowsDown, Math.round(v * rowsDown))
        for (let d = 0; d < litUp; d++) {
          drawLitDot(ctx, x, midY - (d + 0.5) * gap, d, rowsUp, v)
        }
        for (let d = 0; d < litDown; d++) {
          drawLitDot(ctx, x, midY + (d + 0.5) * gap, d, rowsDown, v)
        }
      } else {
        const lit = Math.min(rows, Math.round(v * rows))
        for (let r = 0; r < lit; r++) {
          drawLitDot(ctx, x, baseY - (r + 0.5) * gap, r, rows, v)
        }
      }
    }
    ctx.globalAlpha = 1
  }
}
