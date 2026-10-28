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
import { buildGradient, buildRadialGradient, gradientLine, sampleGradient, withAlpha } from './gradients'
import { getBackgroundImage } from './image-cache'
import { drawLyrics } from './lyrics'
import { drawTitle } from './title'

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
    drawLyrics(rc, frame, config.lyrics, config.visualizer.gradient)
  }
  // Optional chaining: configs from very old saves (pre-title) merge over
  // defaults in setConfig, but stay defensive here anyway.
  if (config.title?.enabled && config.title.text.trim().length > 0) {
    drawTitle(rc, frame, config.title, config.visualizer.gradient)
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

  if (bg.mode === 'image') {
    const img = getBackgroundImage(bg.imageSrc)
    if (img) {
      // Cover-fit base scale, then user zoom on top. Position is a normalized
      // offset from the canvas center (0/0 = centered) so previews and exports
      // at any resolution land identically.
      const fit = Math.max(W / img.naturalWidth, H / img.naturalHeight)
      const zoom = Math.max(0.05, bg.scale ?? 1)
      const scale = fit * zoom
      const dw = img.naturalWidth * scale
      const dh = img.naturalHeight * scale
      const cx = W / 2 + (bg.x ?? 0) * W
      const cy = H / 2 + (bg.y ?? 0) * H
      // Mirror around the image center (flipX/flipY, old configs default off).
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(bg.flipX ? -1 : 1, bg.flipY ? -1 : 1)
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
      ctx.restore()
      // Shade fader — darkens the photo so the visualizer pops.
      const shade = clamp01(bg.shade ?? 0)
      if (shade > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${shade})`
        ctx.fillRect(0, 0, W, H)
      }
    } else {
      // Image still decoding — dark fallback, next frame picks it up.
      ctx.fillStyle = '#0a0a0a'
      ctx.fillRect(0, 0, W, H)
    }
  } else if (bg.mode === 'solid') {
    ctx.fillStyle = bg.color
    ctx.fillRect(0, 0, W, H)
  } else if (bg.mode === 'gradient') {
    const g = bg.gradient
    if (g.shape === 'radial') {
      // Palette radiates from the canvas center out to the farthest corner.
      ctx.fillStyle = buildRadialGradient(
        ctx,
        W / 2,
        H / 2,
        Math.hypot(W, H) / 2,
        g.stops,
        frame.styleTime,
        g.cycleColors,
        g.cycleSpeed,
      )
    } else {
      const line = gradientLine(g.angle, W, H)
      ctx.fillStyle = buildGradient(
        ctx,
        line.x0,
        line.y0,
        line.x1,
        line.y1,
        g.stops,
        frame.styleTime,
        g.cycleColors,
        g.cycleSpeed,
      )
    }
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

/** Shared bar-color sampler: gradient sampled at a canvas point (glow tints).
 *  Radial shape: the point's distance from the canvas center picks the palette
 *  position (concentric color rings). Linear shape: the point is PROJECTED
 *  onto the gradient line, so glow tints sweep at the same angle as the fill —
 *  without this, glows always swept left→right and at 180° the "top" palette
 *  color leaked into the bottom glow. Falls back to index-based sampling when
 *  no point is given. */
function barColorAt(
  cfg: VisualizerConfig,
  frame: AudioFrame,
  index: number,
  count: number,
  at?: { x: number; y: number; W: number; H: number },
): string {
  const g = cfg.gradient
  let t = count > 1 ? index / (count - 1) : 0
  if (at) {
    if (g.shape === 'radial') {
      const maxR = Math.hypot(at.W, at.H) / 2
      t = clamp01(Math.hypot(at.x - at.W / 2, at.y - at.H / 2) / maxR)
    } else {
      // Same direction + length math as gradientLine, evaluated as a scalar
      // projection: t = 0 at the gradient line's start, 1 at its end.
      const rad = (g.angle * Math.PI) / 180
      const dx = Math.sin(rad)
      const dy = -Math.cos(rad)
      const len = Math.abs(at.W * dx) + Math.abs(at.H * dy)
      const proj = (at.x - at.W / 2) * dx + (at.y - at.H / 2) * dy
      t = clamp01(proj / len + 0.5)
    }
  }
  return sampleGradient(g.stops, t, frame.styleTime, g.cycleColors, g.cycleSpeed)
}

/**
 * Gradient fill across the whole canvas for every visualizer style: LINEAR
 * sweeps at the configured angle, RADIAL radiates from the canvas center —
 * which is what makes the Shape switch visibly restyle the coloring.
 */
function visualizerFill(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig): CanvasGradient {
  const { ctx, width: W, height: H } = rc
  const g = cfg.gradient
  if (g.shape === 'radial') {
    return buildRadialGradient(
      ctx,
      W / 2,
      H / 2,
      Math.hypot(W, H) / 2,
      g.stops,
      frame.styleTime,
      g.cycleColors,
      g.cycleSpeed,
    )
  }
  const line = gradientLine(g.angle, W, H)
  return buildGradient(
    ctx,
    line.x0,
    line.y0,
    line.x1,
    line.y1,
    g.stops,
    frame.styleTime,
    g.cycleColors,
    g.cycleSpeed,
  )
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
  // Mirror/center anchor: H * mirrorOffset (0 = top edge, 0.5 = middle, 1 = bottom).
  const anchor = H * clamp01(cfg.mirrorOffset ?? 0.5)
  // One canvas-space gradient for all bars → the Angle slider rotates the
  // coloring across the whole visualizer (fill is continuous in canvas space).
  const fill = visualizerFill(rc, frame, cfg)
  ctx.fillStyle = fill

  for (let i = 0; i < n; i++) {
    const v = clamp01((i < freq.length ? freq[i] : 0) * sens)
    const h = Math.max(minH, v * maxH)
    const x = i * slot + (slot - barW) / 2
    const color = barColorAt(cfg, frame, i, n, {
      x: x + barW / 2,
      y: cfg.mirror === 'center' ? anchor : H - h / 2,
      W,
      H,
    })

    if (cfg.glow) {
      ctx.shadowColor = color
      ctx.shadowBlur = 18 * S
    } else {
      ctx.shadowBlur = 0
    }

    if (cfg.mirror === 'center') {
      // Bars grow from the anchor line both ways.
      fillRoundRect(ctx, x, anchor - h, barW, h * 2, radius)
    } else {
      // Bottom bars grow up from the floor.
      fillRoundRect(ctx, x, H - h, barW, h, radius)
      if (cfg.mirror === 'mirror') {
        // Flipped copy = the floor bars reflected across the offset axis
        // (at the default 0.5 axis this is the ceiling copy).
        const refY = 2 * anchor - H
        if (refY < H && refY + h > 0) fillRoundRect(ctx, x, refY, barW, h, radius)
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
  // Mirror/center anchor: the waveform folds around H * mirrorOffset
  // (plain 'none' waves stay canvas-centered).
  const centerY =
    cfg.mirror !== 'none' ? H * clamp01(cfg.mirrorOffset ?? 0.5) : H / 2
  const amp = Math.min(H * 0.22 * clamp(cfg.sensitivity, 0, 3), H * 0.42)
  const g = cfg.gradient
  const stroke = visualizerFill(rc, frame, cfg)

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
    ctx.shadowColor = sampleGradient(g.stops, 0.5, frame.styleTime, g.cycleColors, g.cycleSpeed)
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
  const rotation = frame.styleTime * 0.15
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
  // Angle-aware gradient across the canvas (rotates with the Angle slider).
  ctx.strokeStyle = visualizerFill(rc, frame, cfg)

  for (let i = 0; i < n; i++) {
    const t = i / n
    const angle = rotation + t * Math.PI * 2
    const v = clamp01((i < freq.length ? freq[i] : 0) * sens)
    const len = Math.min(4 * S + v * H * 0.22, maxLen)
    const color = barColorAt(cfg, frame, i, n, {
      x: cx + Math.cos(angle) * (baseRadius + len / 2),
      y: cy + Math.sin(angle) * (baseRadius + len / 2),
      W,
      H,
    })

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
    frame.styleTime,
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
  // Angle-aware canvas gradient — particle colors follow their position.
  const fill = visualizerFill(rc, frame, cfg)
  const midColor = sampleGradient(g.stops, 0.5, frame.styleTime, g.cycleColors, g.cycleSpeed)
  ctx.fillStyle = fill

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Seeded constants per particle — identical every frame.
    const rnd = mulberry32(i * 1013 + 7)
    const baseAngle = rnd() * Math.PI * 2
    const baseR = (0.2 + rnd() * 0.28) * H
    const speed = (rnd() - 0.5) * 0.9
    const size = (1.5 + rnd() * 2.5) * S

    const angle = baseAngle + frame.styleTime * speed * (0.2 + energy * 1.5)
    const r = baseR * (1 + bass * 0.25 * sens)
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r

    ctx.shadowColor = midColor
    ctx.shadowBlur = cfg.glow ? 12 * S : 0
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()
  }

  // Soft center glow reacting to overall energy.
  ctx.shadowBlur = 0
  const glowRadius = Math.max(1, H * (0.06 + energy * 0.12 * sens))
  const glowColor = midColor
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius)
  glow.addColorStop(0, withAlpha(glowColor, 0.5))
  glow.addColorStop(1, withAlpha(glowColor, 0))
  ctx.fillStyle = glow
  ctx.fillRect(cx - glowRadius, cy - glowRadius, glowRadius * 2, glowRadius * 2)
}

/* ------------------------------------ blob ----------------------------------- */

/**
 * Organic audio blob — a liquid, breathing form. The spectrum is folded into
 * six zones, each driving one LOW-order harmonic (k = 2..7) around the
 * outline, which keeps the silhouette smooth and elegant instead of spiky.
 * Harmonic phases drift slowly so the deformation travels around the body,
 * an idle wobble keeps it alive in silence, and the whole shape rotates
 * gently. The body carries the full palette as a linear sweep (angle-aware)
 * or a radial center-out fade, finished with a soft aura, one halo echo, rim
 * shading, a specular highlight and a rim light. Fully deterministic — every
 * phase derives from frame.styleTime (song time in exports, wall clock in
 * preview).
 */
function drawBlob(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const cx = W / 2
  const cy = H / 2
  const sens = clamp(cfg.sensitivity, 0, 3)
  const bass = clamp01(frame.bass)
  const energy = clamp01(frame.energy)
  const g = cfg.gradient
  const t = frame.styleTime

  /* ---- fold the (log) spectrum into six zones → harmonic amplitudes ---- */
  const freq = frame.freq
  const len = Math.max(1, freq.length)
  const HARMONICS = [
    { k: 2, drift: 0.55, amp: 0.5 }, // bass zone — the biggest, slowest swell
    { k: 3, drift: -0.75, amp: 0.42 },
    { k: 4, drift: 0.95, amp: 0.34 },
    { k: 5, drift: -1.15, amp: 0.26 },
    { k: 6, drift: 1.3, amp: 0.18 },
    { k: 7, drift: -1.5, amp: 0.12 }, // treble zone — fine shimmer
  ]
  const zones = new Float32Array(HARMONICS.length)
  for (let z = 0; z < HARMONICS.length; z++) {
    const a = Math.floor((z / HARMONICS.length) * len)
    const b = Math.max(a + 1, Math.floor(((z + 1) / HARMONICS.length) * len))
    let sum = 0
    for (let i = a; i < b; i++) sum += freq[i] ?? 0
    zones[z] = clamp01((sum / (b - a)) * sens)
  }

  /* ---- radial deformation at angle a: harmonics + idle breathing ---- */
  const sampleDef = (a: number): number => {
    let def = 0
    for (let z = 0; z < HARMONICS.length; z++) {
      const h = HARMONICS[z]
      def += zones[z] * h.amp * Math.cos(h.k * a + t * h.drift)
    }
    // The blob stays alive even in total silence.
    def += 0.045 * Math.sin(2 * a + t * 0.8)
    def += 0.03 * Math.sin(3 * a - t * 0.5)
    def += 0.018 * Math.sin(5 * a + t * 0.33)
    return clamp(def, -0.35, 0.6)
  }

  const baseR = H * (0.185 + bass * 0.05 * sens + energy * 0.025)
  const rot = t * 0.1

  /* ---- smooth closed spline through K samples (quadratic midpoints) ---- */
  const K = 140
  const buildPath = (scale: number): Path2D => {
    const pts: Array<[number, number]> = []
    for (let i = 0; i < K; i++) {
      const a = (i / K) * Math.PI * 2
      const r = Math.min(baseR * (1 + sampleDef(a)), H * 0.44) * scale
      const ang = a + rot
      pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r])
    }
    const p = new Path2D()
    const mx = (pts[K - 1][0] + pts[0][0]) / 2
    const my = (pts[K - 1][1] + pts[0][1]) / 2
    p.moveTo(mx, my)
    for (let i = 0; i < K; i++) {
      const cur = pts[i]
      const nxt = pts[(i + 1) % K]
      p.quadraticCurveTo(cur[0], cur[1], (cur[0] + nxt[0]) / 2, (cur[1] + nxt[1]) / 2)
    }
    p.closePath()
    return p
  }

  const cMid = sampleGradient(g.stops, 0.5, t, g.cycleColors, g.cycleSpeed)
  const cHigh = sampleGradient(g.stops, 0.9, t, g.cycleColors, g.cycleSpeed)

  /* ---- soft aura behind everything ---- */
  const auraR = baseR * 2.1
  const aura = ctx.createRadialGradient(cx, cy, baseR * 0.35, cx, cy, auraR)
  aura.addColorStop(0, withAlpha(cMid, 0.2))
  aura.addColorStop(0.55, withAlpha(cMid, 0.07))
  aura.addColorStop(1, withAlpha(cMid, 0))
  ctx.fillStyle = aura
  ctx.fillRect(cx - auraR, cy - auraR, auraR * 2, auraR * 2)

  /* ---- single halo echo — clean depth without a blurry mess ---- */
  ctx.fillStyle = withAlpha(cMid, 0.1)
  ctx.fill(buildPath(1.16))

  /* ---- main body: the full palette across the blob — LINEAR sweeps it at
   * the configured angle (gradient line spans the body's bounding square) so
   * the Angle slider rotates the colors; RADIAL radiates from the blob's
   * center out to its rim (stop 0 = core, stop 100 = edge). ---- */
  const mainPath = buildPath(1)
  const span = Math.min(baseR * 1.35, H * 0.44)
  if (cfg.glow) {
    ctx.shadowColor = withAlpha(cMid, 0.8)
    ctx.shadowBlur = 30 * S
  } else {
    ctx.shadowBlur = 0
  }
  if (g.shape === 'radial') {
    ctx.fillStyle = buildRadialGradient(ctx, cx, cy, span, g.stops, t, g.cycleColors, g.cycleSpeed)
  } else {
    const line = gradientLine(g.angle, span * 2, span * 2)
    ctx.fillStyle = buildGradient(
      ctx,
      cx - span + line.x0,
      cy - span + line.y0,
      cx - span + line.x1,
      cy - span + line.y1,
      g.stops,
      t,
      g.cycleColors,
      g.cycleSpeed,
    )
  }
  ctx.fill(mainPath)
  ctx.shadowBlur = 0

  /* ---- rim shading for sphere-like depth ---- */
  const depth = ctx.createRadialGradient(cx, cy, baseR * 0.2, cx, cy, baseR * 1.02)
  depth.addColorStop(0.6, 'rgba(0, 0, 0, 0)')
  depth.addColorStop(1, withAlpha(cHigh, 0.4))
  ctx.fillStyle = depth
  ctx.fill(mainPath)

  /* ---- specular highlight ---- */
  const sheen = ctx.createRadialGradient(
    cx - baseR * 0.22,
    cy - baseR * 0.28,
    0,
    cx,
    cy,
    baseR * 1.1,
  )
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.26)')
  sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0.07)')
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = sheen
  ctx.fill(mainPath)

  /* ---- rim light ---- */
  ctx.lineWidth = Math.max(1, 1.8 * S)
  ctx.strokeStyle = withAlpha(cHigh, 0.8)
  ctx.stroke(mainPath)
}

/* ------------------------------------ grid ----------------------------------- */

/**
 * Dot-matrix equalizer (the original "Matrix" look): small round dots in a
 * square grid, one column per spectrum band. Columns light bottom-up — or
 * outward from the vertical center when Mirror = center (as in the
 * reference screenshot). Dot colors come from the angle-based canvas
 * gradient; unlit cells are skipped entirely so the background shows through.
 */
function drawGrid(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const cols = Math.round(clamp(cfg.barCount, 8, 256))
  const marginX = W * 0.045
  const cell = (W - marginX * 2) / cols
  const rows = Math.max(4, Math.floor((H * 0.9) / cell))
  const gridW = cols * cell
  const gridH = rows * cell
  const x0 = (W - gridW) / 2
  const y0 = (H - gridH) / 2
  const sens = clamp(cfg.sensitivity, 0, 3)
  const radius = cell * (0.1 + 0.18 * clamp01(cfg.roundness)) * (1 - 0.5 * clamp01(cfg.gap))
  const freq = frame.freq
  // Mirror/center axis row: (rows-1) * mirrorOffset (0 = top row, 0.5 = middle).
  const axisRow = (rows - 1) * clamp01(cfg.mirrorOffset ?? 0.5)
  const fill = visualizerFill(rc, frame, cfg)

  ctx.fillStyle = fill

  for (let c = 0; c < cols; c++) {
    const bin = Math.min(freq.length - 1, Math.floor((c / cols) * freq.length))
    const v = clamp01((freq[bin] ?? 0) * sens)
    if (v <= 0.001) continue
    const level = v * rows

    if (cfg.glow) {
      // Sample the glow tint at the center of this column's LIT extent (not
      // the canvas middle) so it matches the dots that are actually showing —
      // e.g. at 180° the bottom-lit columns glow with their own fill color.
      let midRow: number
      if (cfg.mirror === 'none') {
        midRow = (Math.max(0, rows - 1 - level) + (rows - 1)) / 2
      } else {
        // Lit extent is symmetric around the axis for center/mirror modes.
        midRow = clamp(axisRow, 0, rows - 1)
      }
      ctx.shadowColor = barColorAt(cfg, frame, c, cols, {
        x: x0 + c * cell + cell / 2,
        y: y0 + midRow * cell + cell / 2,
        W,
        H,
      })
      ctx.shadowBlur = 7 * S
    } else {
      ctx.shadowBlur = 0
    }

    // Batch all fully-lit dots of this column into one path; the frontier
    // dot(s) fade in smoothly via globalAlpha.
    const path = new Path2D()
    const frontier: Array<{ x: number; y: number; alpha: number }> = []

    for (let r = 0; r < rows; r++) {
      // coverage: ≥1 fully lit · 0..1 frontier fade · ≤0 dark
      let coverage: number
      if (cfg.mirror === 'center') {
        coverage = level / 2 - Math.abs(r - axisRow)
      } else if (cfg.mirror === 'mirror') {
        // Bottom-up growth plus its reflection across the offset axis
        // (at the default 0.5 axis this is the top-down copy).
        coverage = Math.max(level - (rows - 1 - r), level - rows + 1 + 2 * axisRow - r)
      } else {
        coverage = level - (rows - 1 - r)
      }
      if (coverage <= 0) continue
      const x = x0 + c * cell + cell / 2
      const y = y0 + r * cell + cell / 2
      if (coverage >= 1) {
        path.moveTo(x + radius, y)
        path.arc(x, y, radius, 0, Math.PI * 2)
      } else {
        frontier.push({ x, y, alpha: coverage })
      }
    }

    ctx.fill(path)
    for (const f of frontier) {
      ctx.globalAlpha = clamp01(f.alpha)
      ctx.beginPath()
      ctx.arc(f.x, f.y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
  ctx.shadowBlur = 0
}
