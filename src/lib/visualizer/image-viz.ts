/**
 * Image visualizer — a custom PNG the whole style renders around. Three
 * music-reactive effects stack on one artwork:
 *
 *  · Inner visualizer — the REAL style renderers (bars / wave / radial /
 *    particles / blob / grid / ribbon) painted at the artwork's box on a
 *    scratch canvas and clipped to the artwork's own alpha silhouette with
 *    a 'destination-in' mask, so only the part inside the picture shows.
 *  · Glowing edges — a thin contour BAND carved out of the alpha silhouette
 *    (morphological dilate − erode), tinted per frame and bloomed in two
 *    widths (tight + wide, both blurred from the band itself, so the glow
 *    hugs the artwork's actual edge instead of sitting behind it as a
 *    round cloud). All three passes breathe with the bass/energy drive.
 *  · Electricity — fractal lightning (recursive midpoint displacement,
 *    with branching forks and thin surface crackle arcs) spawning from
 *    points sampled on the artwork's alpha edge with their OUTWARD NORMALS
 *    (an alpha-gradient scan), flickering with the music and vanishing at
 *    silence.
 *  · Motion — optional (on by default, dialable): the artwork swells with
 *    the drive and drifts on a slow bob/sway/tilt; off pins it still.
 *
 * Deterministic: every bolt and wobble derives from styleTime (which equals
 * song time in offline exports), so exports are frame-exact. Scratch
 * canvases and edge scans cache per image (WeakMap) — uploading a new PNG
 * builds fresh ones.
 */
import type { AudioFrame, VisualizerConfig, RenderContext } from './types'
import { getBackgroundImage } from './image-cache'
import { sampleGradient } from './gradients'
// The real style renderers reused as the inner visualizer. Module cycle with
// renderer.ts is safe: every binding is a hoisted function declaration used
// at call time only (see the note at the export site in renderer.ts).
import { drawBars, drawWave, drawRadial, drawParticles, drawBlob, drawGrid, drawRibbon } from './renderer'

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

/** Deterministic seeded PRNG (mulberry32) — same contract as the renderer. */
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

/* --------------------------- per-image edge assets -------------------------- */

/** Contour masks' max dimension in px — smooth blurs, low res is plenty. */
const WORK_MAX = 384
/** Edge scan resolution (max dimension) for the anchor point extraction. */
const SCAN_MAX = 96
/** Max anchor points kept for the bolts. */
const ANCHOR_COUNT = 40
/** Rim band stamp directions (morphological disk). */
const RIM_DIRS = 24

/** One bolt anchor on the silhouette rim, with its outward normal. */
interface AnchorPt {
  x: number
  y: number
  nx: number
  ny: number
}

/** A cached glow layer: a colorless alpha mask + its per-frame tint scratch. */
interface GlowLayer {
  canvas: HTMLCanvasElement
  scratch: HTMLCanvasElement
}

interface EdgeAssets {
  /** Thin contour band (dilate − erode of the alpha silhouette). */
  rim: GlowLayer
  /** Tight bloom: the band blurred a little (keeps its crisp core). */
  rimSoft: GlowLayer
  /** Wide bloom: the band blurred far — a cloud that still follows the edge. */
  rimWide: GlowLayer
  /** The silhouette→layers build scale (work px per natural px). */
  m: number
  /** Bolt spawn points (with outward normals) in NATURAL image coordinates. */
  anchors: AnchorPt[]
}

const edgeAssets = new WeakMap<HTMLImageElement, EdgeAssets>()

/** Bounding-ellipse fallback: 40 points around the image's outline, normals
 *  pointing outward. Used when pixels can't be read (CORS-tainted canvases,
 *  headless mocks). */
function fallbackAnchors(nw: number, nh: number): AnchorPt[] {
  const anchors: AnchorPt[] = []
  const rx = Math.max(1, nw) / 2
  const ry = Math.max(1, nh) / 2
  for (let k = 0; k < ANCHOR_COUNT; k++) {
    const a = (k / ANCHOR_COUNT) * Math.PI * 2
    const nx = Math.cos(a)
    const ny = Math.sin(a)
    anchors.push({ x: nw / 2 + nx * rx, y: nh / 2 + ny * ry, nx, ny })
  }
  return anchors
}

/**
 * One-off edge scan: downscale the artwork, walk the alpha channel and keep
 * opaque cells with at least one transparent 4-neighbor (the silhouette's
 * rim). Each rim cell's outward normal comes from the alpha gradient (the
 * direction alpha falls off toward transparency), so bolts leave the edge
 * perpendicular to the actual shape instead of fanning from the center.
 * Stride-picks up to 40 spread points in natural coords.
 */
function extractAnchors(img: HTMLImageElement): AnchorPt[] {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (nw <= 0 || nh <= 0) return fallbackAnchors(nw, nh)
  try {
    const scale = Math.min(1, SCAN_MAX / Math.max(nw, nh))
    const sw = Math.max(2, Math.round(nw * scale))
    const sh = Math.max(2, Math.round(nh * scale))
    const c = document.createElement('canvas')
    c.width = sw
    c.height = sh
    const g = c.getContext('2d')
    if (!g) return fallbackAnchors(nw, nh)
    g.drawImage(img, 0, 0, sw, sh)
    const px = g.getImageData(0, 0, sw, sh)
    const d = px.data
    const w = px.width
    const h = px.height
    const alphaAt = (x: number, y: number): number => {
      const cx2 = clamp(x, 0, w - 1)
      const cy2 = clamp(y, 0, h - 1)
      return d[(cy2 * w + cx2) * 4 + 3]
    }
    const rim: Array<{ x: number; y: number; nx: number; ny: number }> = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (alphaAt(x, y) < 96) continue
        const outside =
          (x === 0 || alphaAt(x - 1, y) < 32) ||
          (x === w - 1 || alphaAt(x + 1, y) < 32) ||
          (y === 0 || alphaAt(x, y - 1) < 32) ||
          (y === h - 1 || alphaAt(x, y + 1) < 32)
        if (!outside) continue
        // Alpha gradient: points toward higher alpha (inward) → the outward
        // normal is its negation. Near-flat gradients (flat edges) fall back
        // to the center-radial direction.
        let nx = -(alphaAt(x + 1, y) - alphaAt(x - 1, y))
        let ny = -(alphaAt(x, y + 1) - alphaAt(x, y - 1))
        const nl = Math.hypot(nx, ny)
        if (nl < 8) {
          nx = x - w / 2
          ny = y - h / 2
          const rl = Math.hypot(nx, ny) || 1
          nx /= rl
          ny /= rl
        } else {
          nx /= nl
          ny /= nl
        }
        rim.push({ x, y, nx, ny })
      }
    }
    if (rim.length === 0) return fallbackAnchors(nw, nh)
    const step = Math.max(1, Math.floor(rim.length / ANCHOR_COUNT))
    const anchors: AnchorPt[] = []
    for (let i = 0; i < rim.length && anchors.length < ANCHOR_COUNT; i += step) {
      const r = rim[i]
      anchors.push({
        x: ((r.x + 0.5) / w) * nw,
        y: ((r.y + 0.5) / h) * nh,
        nx: r.nx,
        ny: r.ny,
      })
    }
    return anchors
  } catch {
    return fallbackAnchors(nw, nh)
  }
}

/** Morphological dilate/erode of a mask by stamping it along a disk of
 *  directions. Dilation stamps OUT from the shape; erosion cuts shifted
 *  copies out of it. `radius` in px, at the source's own scale. */
function stampDisk(
  g: CanvasRenderingContext2D,
  sil: HTMLCanvasElement,
  dx: number,
  dy: number,
  radius: number,
  mode: 'dilate' | 'erode',
): void {
  const step = radius > 8 ? 2 : 1
  if (mode === 'erode') g.globalCompositeOperation = 'destination-out'
  for (let r = step; r <= radius; r += step) {
    for (let k = 0; k < RIM_DIRS; k++) {
      const a = (k / RIM_DIRS) * Math.PI * 2
      g.drawImage(sil, dx + Math.cos(a) * r, dy + Math.sin(a) * r)
    }
  }
  if (mode === 'erode') g.globalCompositeOperation = 'source-over'
}

/** Shadow-trick blur: draw the mask with an opaque shadow → the canvas ends
 *  up holding the crisp mask plus its blurred halo (works in every browser,
 *  no ctx.filter needed). */
function blurredCopy(src: HTMLCanvasElement, blurPx: number): { canvas: HTMLCanvasElement; pad: number } {
  const pad = Math.max(1, Math.ceil(blurPx * 0.75))
  const c = document.createElement('canvas')
  c.width = src.width + 2 * pad
  c.height = src.height + 2 * pad
  const g = c.getContext('2d')
  if (g) {
    g.shadowColor = 'rgba(0,0,0,1)'
    g.shadowBlur = blurPx
    g.drawImage(src, pad, pad)
    g.shadowBlur = 0
  }
  return { canvas: c, pad }
}

function glowLayerOf(canvas: HTMLCanvasElement): GlowLayer {
  const scratch = document.createElement('canvas')
  scratch.width = canvas.width
  scratch.height = canvas.height
  return { canvas, scratch }
}

/** Builds (and caches) the contour band, its two blooms and the bolt anchors. */
function assetsOf(img: HTMLImageElement): EdgeAssets | null {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (nw <= 0 || nh <= 0) return null // SVG without intrinsic size — skip
  const cached = edgeAssets.get(img)
  if (cached) return cached

  const m = Math.min(1, WORK_MAX / Math.max(nw, nh))
  const w = Math.max(2, Math.round(nw * m))
  const h = Math.max(2, Math.round(nh * m))

  // The alpha silhouette at work scale (the fill color is irrelevant).
  const sil = document.createElement('canvas')
  sil.width = w
  sil.height = h
  const sg = sil.getContext('2d')
  if (!sg) return null
  sg.drawImage(img, 0, 0, w, h)

  // The contour band: dilate the silhouette outward, erode it inward, then
  // subtract the eroded core — what remains is a thin ring STRADDLING the
  // artwork's real edge, which every glow pass is blurred from.
  const band = Math.max(2, Math.round(0.013 * Math.max(w, h)))
  const pad = band + 1

  const dil = document.createElement('canvas')
  dil.width = w + 2 * pad
  dil.height = h + 2 * pad
  const dg = dil.getContext('2d')
  if (!dg) return null
  dg.drawImage(sil, pad, pad)
  stampDisk(dg, sil, pad, pad, band, 'dilate')

  const ero = document.createElement('canvas')
  ero.width = w
  ero.height = h
  const eg = ero.getContext('2d')
  if (!eg) return null
  eg.drawImage(sil, 0, 0)
  stampDisk(eg, sil, 0, 0, band, 'erode')

  const rimC = document.createElement('canvas')
  rimC.width = dil.width
  rimC.height = dil.height
  const rg = rimC.getContext('2d')
  if (!rg) return null
  rg.drawImage(dil, 0, 0)
  rg.globalCompositeOperation = 'destination-out'
  rg.drawImage(ero, pad, pad)
  rg.globalCompositeOperation = 'source-over'

  // Two blooms baked ONCE from the band: a tight one (crisp core + small
  // blur) and a wide one — both inherit the band's contour, so even the
  // far glow follows the artwork's shape instead of reading as a sphere.
  const soft = blurredCopy(rimC, band * 2.2)
  const wide = blurredCopy(rimC, 0.085 * Math.max(w, h))

  const built: EdgeAssets = {
    rim: glowLayerOf(rimC),
    rimSoft: glowLayerOf(soft.canvas),
    rimWide: glowLayerOf(wide.canvas),
    m,
    anchors: extractAnchors(img),
  }
  edgeAssets.set(img, built)
  return built
}

/** Recolors a layer's colorless mask with this frame's color into its scratch. */
function tinted(layer: GlowLayer, color: string): HTMLCanvasElement | null {
  const tg = layer.scratch.getContext('2d')
  if (!tg) return null
  tg.clearRect(0, 0, layer.scratch.width, layer.scratch.height)
  tg.drawImage(layer.canvas, 0, 0)
  tg.globalCompositeOperation = 'source-in'
  tg.fillStyle = color
  tg.fillRect(0, 0, layer.scratch.width, layer.scratch.height)
  tg.globalCompositeOperation = 'source-over'
  return layer.scratch
}

/** Draws one cached glow layer over the artwork's box (scaled from the build
 *  scale, padding included), tinted with `color`, at `alpha`, composited
 *  with `op`. */
function drawGlowLayer(
  ctx: CanvasRenderingContext2D,
  layer: GlowLayer,
  img: HTMLImageElement,
  m: number,
  w: number,
  h: number,
  cx: number,
  cy: number,
  alpha: number,
  color: string,
  op: GlobalCompositeOperation,
): void {
  const t = tinted(layer, color)
  if (!t) return
  const lw = (w * layer.canvas.width) / (img.naturalWidth * m)
  const lh = (h * layer.canvas.height) / (img.naturalHeight * m)
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.globalCompositeOperation = op
  ctx.drawImage(t, cx - lw / 2, cy - lh / 2, lw, lh)
  ctx.restore()
}

/* --------------------------- the inner visualizer --------------------------- */

/**
 * Paints one of the REAL style renderers into a display-sized scratch canvas
 * (a sanitized config pins it centered, horizontal, unmired and opaque),
 * then cuts everything outside the artwork's alpha with a 'destination-in'
 * mask. The caller draws the returned canvas at the artwork's box.
 */
function paintInner(
  rc: RenderContext,
  img: HTMLImageElement,
  boxW: number,
  boxH: number,
  frame: AudioFrame,
  cfg: VisualizerConfig,
): HTMLCanvasElement | null {
  const scratch = document.createElement('canvas')
  scratch.width = Math.max(2, Math.round(boxW))
  scratch.height = Math.max(2, Math.round(boxH))
  const g = scratch.getContext('2d')
  if (!g) return null

  const bw = scratch.width
  const bh = scratch.height
  const inner = cfg.imgvizInner ?? 'bars'
  // The inner render gets the shared dials (bar count, roundness, gap,
  // gradient, glow) but a pinned layout: centered, horizontal, unmirrored,
  // fully opaque — and the Inner gain folds into its sensitivity.
  const innerCfg: VisualizerConfig = {
    ...cfg,
    style: inner,
    orientation: 'horizontal',
    anchor: 'right',
    mirror: 'none',
    mirrorOffset: 0.5,
    positionX: 50,
    positionY: 50,
    scale: 1,
    transparency: 0,
    sensitivity: clamp((cfg.sensitivity ?? 1.2) * (cfg.imgvizInnerGain ?? 1), 0.05, 3),
  }
  const innerRc: RenderContext = { ctx: g, width: bw, height: bh, frame: rc.frame }
  const innerS = Math.max(0.4, bh / 720)
  switch (inner) {
    case 'wave':
      drawWave(innerRc, frame, innerCfg, innerS)
      break
    case 'radial':
      drawRadial(innerRc, frame, innerCfg, innerS)
      break
    case 'particles':
      drawParticles(innerRc, frame, innerCfg, innerS)
      break
    case 'blob':
      drawBlob(innerRc, frame, innerCfg, innerS)
      break
    case 'grid':
      drawGrid(innerRc, frame, innerCfg, innerS)
      break
    case 'ribbon':
      drawRibbon(innerRc, frame, innerCfg, innerS)
      break
    default:
      drawBars(innerRc, frame, innerCfg, innerS)
      break
  }

  // The mask cut: keep the spectrum only where the artwork is opaque.
  g.globalCompositeOperation = 'destination-in'
  g.drawImage(img, 0, 0, bw, bh)
  g.globalCompositeOperation = 'source-over'
  return scratch
}

/* ------------------------------- electricity -------------------------------- */

/**
 * Fractal lightning: recursive midpoint displacement between the anchor and
 * the tip — the amplitude decays per split, so the channel starts wild at
 * the edge and settles toward its tip (the opposite of the old uniform
 * wiggle, which read as a tame spring).
 */
function lightningPoints(
  rng: () => number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  offset: number,
): Array<{ x: number; y: number }> {
  let pts = [
    { x: ax, y: ay },
    { x: bx, y: by },
  ]
  let disp = offset
  // Guard against pathological lengths — 12 splits is already ~4k points.
  for (let d = 0; d < 12 && disp > 1.2; d++) {
    const next: Array<{ x: number; y: number }> = []
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i]
      const q = pts[i + 1]
      const dx = q.x - p.x
      const dy = q.y - p.y
      const dl = Math.hypot(dx, dy) || 1
      const j = (rng() * 2 - 1) * disp
      next.push(p, { x: (p.x + q.x) / 2 + (-dy / dl) * j, y: (p.y + q.y) / 2 + (dx / dl) * j })
    }
    next.push(pts[pts.length - 1])
    pts = next
    disp *= 0.52
  }
  return pts
}

/** Strokes one polyline (a channel or a branch) in the three lightning
 *  passes: wide colored glow, tight colored mid, white-hot core. */
function strokeBolt(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  color: string,
  width: number,
  alpha: number,
  S: number,
): void {
  if (pts.length < 2 || alpha < 0.02) return
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y)
  // Pass 1 — the electric halo.
  ctx.shadowColor = color
  ctx.shadowBlur = 16 * S
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.6, 3 * width * S)
  ctx.stroke()
  // Pass 2 — the tight mid channel.
  ctx.shadowBlur = 5 * S
  ctx.lineWidth = Math.max(0.9, 1.5 * width * S)
  ctx.globalAlpha *= 0.9
  ctx.stroke()
  // Pass 3 — the white-hot core.
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)'
  ctx.lineWidth = Math.max(0.5, 0.7 * width * S)
  ctx.globalAlpha *= 0.85
  ctx.stroke()
  ctx.restore()
}

function drawBolts(
  ctx: CanvasRenderingContext2D,
  assets: EdgeAssets,
  img: HTMLImageElement,
  frame: AudioFrame,
  cfg: VisualizerConfig,
  cx: number,
  cy: number,
  w: number,
  h: number,
  H: number,
  drive: number,
  treble: number,
  S: number,
  grad: VisualizerConfig['gradient'],
): void {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  const kx = nw > 0 ? w / nw : 1
  const ky = nh > 0 ? h / nh : 1
  const density = clamp01(cfg.imgvizBoltDensity ?? 0.5)
  const lenMul = clamp(cfg.imgvizBoltLength ?? 1, 0.3, 2)
  const sens = clamp(cfg.sensitivity ?? 1, 0.1, 3)
  // The seed: styleTime equals song time in exports (frame-exact) and
  // free-runs on the preview wall clock, so bolts flicker ~30×/s there.
  const rng = mulberry32((Math.floor(frame.styleTime * 30) * 1013904223) ^ 0x9e3779b9)
  const count = Math.max(1, Math.round(1 + density * 7 * (0.25 + 0.75 * drive)))
  const diag = Math.hypot(w, h)
  const anchors = assets.anchors
  const alpha = clamp01(drive * 1.6) * clamp01(0.35 + sens / 3)
  if (alpha < 0.04) return

  for (let b = 0; b < count; b++) {
    const pick = anchors[Math.floor(rng() * anchors.length) % anchors.length]
    if (!pick) continue
    // Anchor in canvas coords; the outward normal is transformed through the
    // same non-uniform box scale, then fanned with angular jitter.
    const ax = cx + (pick.x - nw / 2) * kx
    const ay = cy + (pick.y - nh / 2) * ky
    let dx = pick.nx * kx
    let dy = pick.ny * ky
    const dl = Math.hypot(dx, dy) || 1
    dx /= dl
    dy /= dl
    const rot = (rng() * 2 - 1) * 0.7
    const rdx = dx * Math.cos(rot) - dy * Math.sin(rot)
    const rdy = dx * Math.sin(rot) + dy * Math.cos(rot)
    const len = diag * (0.14 + 0.32 * drive) * lenMul * (0.55 + 0.75 * rng())
    const tipX = ax + rdx * len
    const tipY = ay + rdy * len
    const pts = lightningPoints(rng, ax, ay, tipX, tipY, len * 0.3)

    // The bolt's color: the palette at the anchor's height, or its own.
    const color =
      (cfg.imgvizBoltMode ?? 'palette') === 'custom'
        ? cfg.imgvizBoltColor || '#7df9ff'
        : sampleGradient(grad.stops, clamp01(ay / (H || 1)), frame.styleTime, grad.cycleColors, grad.cycleSpeed)

    // Per-bolt brightness flicker — bolts don't all burn equally.
    const bright = 0.55 + 0.45 * rng()
    strokeBolt(ctx, pts, color, 1, alpha * bright, S)

    // Forks off the main channel: 1–3 of them, from random points along the
    // upper half of the channel, angled away and thinner.
    const forks = 1 + Math.floor(rng() * 3)
    for (let f = 0; f < forks && pts.length > 4; f++) {
      const idx = Math.max(1, Math.floor(pts.length * (0.2 + 0.6 * rng())))
      const from = pts[idx]
      const spread = (rng() < 0.5 ? 1 : -1) * (0.35 + 0.55 * rng())
      const fdx = rdx * Math.cos(spread) - rdy * Math.sin(spread)
      const fdy = rdx * Math.sin(spread) + rdy * Math.cos(spread)
      const flen = len * (0.18 + 0.3 * rng())
      const fpts = lightningPoints(rng, from.x, from.y, from.x + fdx * flen, from.y + fdy * flen, flen * 0.3)
      strokeBolt(ctx, fpts, color, 0.55, alpha * bright * 0.75, S)
    }
  }

  // Surface crackle: short arcs jumping between NEIGHBORING anchors when the
  // highs sizzle — electricity crawling ON the edge, not just shooting out.
  if (anchors.length > 4 && treble > 0.06) {
    const sparks = Math.round(1 + treble * 5 * density)
    for (let s = 0; s < sparks; s++) {
      const i = Math.floor(rng() * anchors.length)
      // Nearest anchor to anchors[i] (by canvas distance) — a short hop.
      const a = anchors[i]
      const ax = cx + (a.x - nw / 2) * kx
      const ay = cy + (a.y - nh / 2) * ky
      let best = -1
      let bestD = Infinity
      for (let j = 0; j < anchors.length; j++) {
        if (j === i) continue
        const bx = cx + (anchors[j].x - nw / 2) * kx
        const by = cy + (anchors[j].y - nh / 2) * ky
        const d = Math.hypot(bx - ax, by - ay)
        if (d < bestD) {
          bestD = d
          best = j
        }
      }
      if (best < 0 || bestD > diag * 0.24) continue
      const b = anchors[best]
      const color =
        (cfg.imgvizBoltMode ?? 'palette') === 'custom'
          ? cfg.imgvizBoltColor || '#7df9ff'
          : sampleGradient(grad.stops, clamp01(ay / (H || 1)), frame.styleTime, grad.cycleColors, grad.cycleSpeed)
      const pts = lightningPoints(rng, ax, ay, cx + (b.x - nw / 2) * kx, cy + (b.y - nh / 2) * ky, bestD * 0.24)
      strokeBolt(ctx, pts, color, 0.4, alpha * 0.5 * (0.5 + 0.5 * treble), S)
    }
  }
}

/* -------------------------------- the style -------------------------------- */

export function drawImageViz(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const src = cfg.imgvizSrc
  const grad = cfg.gradient

  if (!src) {
    // Placeholder — a dashed frame + hint while no artwork is uploaded.
    // Same deterministic shape every frame (what shows before an upload).
    const base = (clamp(cfg.imgvizSize ?? 55, 10, 100) / 100) * H
    const bw = base * 1.35
    const bh = base
    ctx.save()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
    ctx.lineWidth = Math.max(1, S)
    ctx.setLineDash([6 * S, 6 * S])
    ctx.strokeRect(W / 2 - bw / 2, H / 2 - bh / 2, bw, bh)
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
    ctx.font = `${Math.max(10, Math.round(13 * S))}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Add a PNG to power this style', W / 2, H / 2)
    ctx.restore()
    return
  }

  const img = getBackgroundImage(src)
  if (!img) return // still decoding — the next preview frame picks it up
  const assets = assetsOf(img)
  if (!assets) return

  // Motion: the shared bass/energy drive swells the artwork; a slow bob /
  // sway / tilt drifts it around. The whole thing is one toggle (React to
  // music) and one amount dial — off pins the artwork perfectly still.
  const drive = Math.min(1, 0.6 * frame.bass + 0.4 * frame.energy)
  const motionOn = cfg.imgvizMotion ?? true
  const amt = clamp01(cfg.imgvizMotionAmount ?? 0.5)
  const sens = clamp(cfg.sensitivity ?? 1, 0, 2)
  const swell = motionOn ? 1 + 0.16 * amt * drive * sens : 1
  const bob = motionOn ? Math.sin(frame.styleTime * 2.05) * H * 0.02 * amt * (0.2 + 0.8 * drive) : 0
  const sway = motionOn ? Math.sin(frame.styleTime * 1.31 + 1.7) * W * 0.014 * amt * (0.2 + 0.8 * drive) : 0
  const tilt = motionOn ? Math.sin(frame.styleTime * 0.77 + 0.6) * 0.055 * amt * (0.25 + 0.75 * drive) : 0

  const base = (clamp(cfg.imgvizSize ?? 55, 10, 100) / 100) * H * swell
  const aspect = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1
  const h = base
  const w = base * (Number.isFinite(aspect) && aspect > 0 ? Math.min(4, aspect) : 1)
  const cx = W / 2
  const cy = H / 2

  ctx.save()
  ctx.translate(cx + sway, cy + bob)
  ctx.rotate(tilt)
  ctx.translate(-cx, -cy)

  // Glow color: the palette at the artwork's height, or its own.
  const glowOn = !!cfg.imgvizGlow && (cfg.imgvizGlowStrength ?? 0.6) > 0.01
  const aura =
    (cfg.imgvizGlowMode ?? 'palette') === 'custom'
      ? cfg.imgvizGlowColor || '#ffffff'
      : sampleGradient(grad.stops, cy / (H || 1), frame.styleTime, grad.cycleColors, grad.cycleSpeed)
  const gs = clamp01(cfg.imgvizGlowStrength ?? 0.6)
  const breathe = 0.35 + 0.65 * drive

  // 1) The wide bloom — blurred from the contour BAND, so even this far
  //    glow follows the artwork's actual edge (not a round cloud behind it).
  if (glowOn) {
    drawGlowLayer(ctx, assets.rimWide, img, assets.m, w, h, cx, cy, gs * breathe * 0.55, aura, 'lighter')
  }

  // 2) The artwork itself — dimmed on the Artwork dial so the inner
  //    spectrum reads (1 - dim keeps it at full brightness at 0).
  const dim = clamp01(cfg.imgvizDim ?? 0.35)
  if (dim < 0.995) {
    ctx.save()
    ctx.globalAlpha *= 1 - dim
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h)
    ctx.restore()
  }

  // 3) The inner visualizer — a real style renderer clipped to the
  //    silhouette, drawn over the artwork at the same box.
  const inner = paintInner(rc, img, w, h, frame, cfg)
  if (inner) {
    ctx.drawImage(inner, cx - w / 2, cy - h / 2, w, h)
  }

  // 4) The edge glow itself — additive tight bloom + the crisp rim band ON
  //    the artwork's edge, pulsing with the drive.
  if (glowOn) {
    drawGlowLayer(ctx, assets.rimSoft, img, assets.m, w, h, cx, cy, gs * breathe * 0.8, aura, 'lighter')
    drawGlowLayer(ctx, assets.rim, img, assets.m, w, h, cx, cy, gs * (0.55 + 0.6 * drive), aura, 'lighter')
  }

  // 5) The electricity — fractal bolts off the artwork's alpha edge with
  //    surface crackle (they live OUTSIDE the mask, so they spark freely).
  if (cfg.imgvizBolt) {
    drawBolts(ctx, assets, img, frame, cfg, cx, cy, w, h, H, drive, frame.treble, S, grad)
  }

  ctx.restore()
}
