/**
 * Image visualizer — a custom PNG the whole style renders around. Three
 * music-reactive effects stack on one artwork:
 *
 *  · Inner visualizer — a spectrum (bars / wave / radial) painted on a
 *    scratch canvas and clipped to the artwork's own alpha silhouette with a
 *    'destination-in' mask, so the visualizer only shows inside the picture.
 *  · Glowing edges — a tinted halo blurred from the silhouette plus a rim
 *    light tucked under the artwork, both breathing with the bass/energy
 *    drive (the same drive the pulse image and blob use).
 *  · Electricity — jagged lightning bolts spawning from points sampled on
 *    the artwork's alpha edge (a one-off pixel scan per image, with a
 *    bounding-ellipse fallback when pixels can't be read), flickering with
 *    the music and vanishing at silence.
 *
 * Deterministic: every bolt is seeded from styleTime (which equals song time
 * in offline exports), so exports are frame-exact. Scratch canvases and edge
 * scans cache per image (WeakMap) — uploading a new PNG builds fresh ones.
 */
import type { AudioFrame, VisualizerConfig, RenderContext } from './types'
import { getBackgroundImage } from './image-cache'
import { sampleGradient } from './gradients'

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

/** Halo mask max dimension in px — the blur is smooth, low res is plenty. */
const WORK_MAX = 384
/** Edge scan resolution (max dimension) for the anchor point extraction. */
const SCAN_MAX = 96
/** Max anchor points kept for the bolts. */
const ANCHOR_COUNT = 40

interface EdgeAssets {
  /** Alpha silhouette at work scale (color irrelevant — alpha matters). */
  sil: HTMLCanvasElement
  /** Outward-only blurred halo mask at work scale. */
  halo: HTMLCanvasElement
  /** The silhouette→halo build scale (work px per natural px). */
  m: number
  /** Bolt spawn points in NATURAL image coordinates. */
  anchors: Array<{ x: number; y: number }>
}

const edgeAssets = new WeakMap<HTMLImageElement, EdgeAssets>()

/** Bounding-ellipse fallback: 40 points around the image's outline. Used
 *  when pixels can't be read (CORS-tainted canvases, headless mocks). */
function fallbackAnchors(nw: number, nh: number): Array<{ x: number; y: number }> {
  const anchors: Array<{ x: number; y: number }> = []
  const rx = Math.max(1, nw) / 2
  const ry = Math.max(1, nh) / 2
  for (let k = 0; k < ANCHOR_COUNT; k++) {
    const a = (k / ANCHOR_COUNT) * Math.PI * 2
    anchors.push({ x: nw / 2 + Math.cos(a) * rx, y: nh / 2 + Math.sin(a) * ry })
  }
  return anchors
}

/**
 * One-off edge scan: downscale the artwork, walk the alpha channel and keep
 * opaque cells with at least one transparent 4-neighbor (the silhouette's
 * rim), then stride-pick a spread of up to 40 points in natural coords.
 */
function extractAnchors(img: HTMLImageElement): Array<{ x: number; y: number }> {
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
    const alphaAt = (x: number, y: number): number => d[(y * w + x) * 4 + 3]
    const rim: Array<{ x: number; y: number }> = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (alphaAt(x, y) < 96) continue
        const outside =
          (x === 0 || alphaAt(x - 1, y) < 32) ||
          (x === w - 1 || alphaAt(x + 1, y) < 32) ||
          (y === 0 || alphaAt(x, y - 1) < 32) ||
          (y === h - 1 || alphaAt(x, y + 1) < 32)
        if (outside) rim.push({ x, y })
      }
    }
    if (rim.length === 0) return fallbackAnchors(nw, nh)
    const step = Math.max(1, Math.floor(rim.length / ANCHOR_COUNT))
    const anchors: Array<{ x: number; y: number }> = []
    for (let i = 0; i < rim.length && anchors.length < ANCHOR_COUNT; i += step) {
      anchors.push({ x: ((rim[i].x + 0.5) / w) * nw, y: ((rim[i].y + 0.5) / h) * nh })
    }
    return anchors
  } catch {
    return fallbackAnchors(nw, nh)
  }
}

/** Builds (and caches) the silhouette, halo mask and bolt anchors per image. */
function assetsOf(img: HTMLImageElement): EdgeAssets | null {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (nw <= 0 || nh <= 0) return null // SVG without intrinsic size — skip
  const cached = edgeAssets.get(img)
  if (cached) return cached

  const m = Math.min(1, WORK_MAX / Math.max(nw, nh))
  const w = Math.max(2, Math.round(nw * m))
  const h = Math.max(2, Math.round(nh * m))

  // The silhouette itself (alpha mask — the fill color is irrelevant).
  const sil = document.createElement('canvas')
  sil.width = w
  sil.height = h
  const sg = sil.getContext('2d')
  if (!sg) return null
  sg.drawImage(img, 0, 0, w, h)

  // The halo: blur the silhouette, then cut it back out — what remains is
  // the outward-only glow hugging the artwork's contour.
  const blurPx = 0.34 * Math.max(w, h)
  const pad = Math.ceil(blurPx * 0.75)
  const halo = document.createElement('canvas')
  halo.width = w + 2 * pad
  halo.height = h + 2 * pad
  const hg = halo.getContext('2d')
  if (!hg) return null
  hg.shadowColor = 'rgba(0,0,0,1)'
  hg.shadowBlur = blurPx
  hg.drawImage(sil, pad, pad)
  hg.globalCompositeOperation = 'destination-out'
  hg.drawImage(sil, pad, pad)
  hg.globalCompositeOperation = 'source-over'

  const built: EdgeAssets = { sil, halo, m, anchors: extractAnchors(img) }
  edgeAssets.set(img, built)
  return built
}

/** One scratch canvas per source image for the per-frame tint recolors. */
const tintScratch = new WeakMap<HTMLImageElement, HTMLCanvasElement>()

function tintScratchFor(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement | null {
  let sc = tintScratch.get(img)
  if (!sc) {
    sc = document.createElement('canvas')
    tintScratch.set(img, sc)
  }
  if (sc.width !== w || sc.height !== h) {
    sc.width = w
    sc.height = h
  }
  return sc
}

/** Recolors a mask canvas (silhouette or halo) with this frame's color. */
function tinted(mask: HTMLCanvasElement, scratch: HTMLCanvasElement, color: string): HTMLCanvasElement | null {
  const tg = scratch.getContext('2d')
  if (!tg) return null
  tg.clearRect(0, 0, scratch.width, scratch.height)
  tg.drawImage(mask, 0, 0)
  tg.globalCompositeOperation = 'source-in'
  tg.fillStyle = color
  tg.fillRect(0, 0, scratch.width, scratch.height)
  tg.globalCompositeOperation = 'source-over'
  return scratch
}

/* --------------------------- the inner visualizer --------------------------- */

/**
 * Paints the chosen spectrum into a display-sized scratch canvas, then cuts
 * everything outside the artwork's alpha with a 'destination-in' mask. The
 * caller draws the returned canvas at the artwork's box.
 */
function paintInner(
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
  const sens = clamp(cfg.sensitivity ?? 1.2, 0, 3)
  const gain = clamp(cfg.imgvizInnerGain ?? 1, 0.1, 3)
  const grad = cfg.gradient
  const colorAt = (t: number): string =>
    sampleGradient(grad.stops, t, frame.styleTime, grad.cycleColors, grad.cycleSpeed)
  const inner = cfg.imgvizInner ?? 'bars'

  if (inner === 'bars') {
    // Classic equalizer floor rising from the bottom of the box — the mask
    // keeps only the part inside the artwork.
    const n = Math.max(8, Math.min(256, Math.round(cfg.barCount ?? 64)))
    const slot = bw / n
    const barW = Math.max(1, slot * (1 - clamp01(cfg.gap ?? 0.35)))
    const maxH = bh * 0.66
    const radius = clamp01(cfg.roundness ?? 0.6) * (barW / 2)
    const paint = (heightScale: number, alphaScale: number): void => {
      const prev = g.globalAlpha
      g.globalAlpha = prev * alphaScale
      for (let i = 0; i < n; i++) {
        const f = frame.freq.length > 0 ? frame.freq[Math.min(i, frame.freq.length - 1)] : 0
        const amp = Math.pow(clamp01(f), 0.75)
        const bh2 = Math.max(bh * 0.015, amp * maxH * sens * gain * heightScale)
        if (bh2 < 0.5) continue
        const x = i * slot
        g.fillStyle = colorAt(n > 1 ? i / (n - 1) : 0)
        const r = Math.min(radius, barW / 2, bh2 / 2)
        g.beginPath()
        if (r > 0.5 && typeof g.roundRect === 'function') {
          g.roundRect(x, bh - bh2, barW, bh2, r)
        } else if (r > 0.5) {
          g.moveTo(x + r, bh - bh2)
          g.arcTo(x + barW, bh - bh2, x + barW, bh, r)
          g.arcTo(x, bh, x, bh - bh2, r)
          g.closePath()
        } else {
          g.rect(x, bh - bh2, barW, bh2)
        }
        g.fill()
      }
      g.globalAlpha = prev
    }
    if (cfg.glow) paint(1.3, 0.3)
    paint(1, 1)
  } else if (inner === 'wave') {
    // An oscilloscope line sweeping across the box, mirrored softly around
    // the vertical center so the silhouette fills top and bottom.
    const points = 256
    const amp = bh * 0.3 * sens * gain
    const trace = (width: number, alphaScale: number): void => {
      g.save()
      g.globalAlpha *= alphaScale
      g.lineWidth = width
      g.beginPath()
      for (let i = 0; i <= points; i++) {
        const t = i / points
        const s = frame.wave.length > 0 ? frame.wave[Math.floor(t * (frame.wave.length - 1))] : 0
        const y = bh / 2 - s * amp
        if (i === 0) g.moveTo(0, y)
        else g.lineTo(t * bw, y)
      }
      g.strokeStyle = colorAt(0.5)
      g.stroke()
      g.restore()
    }
    if (cfg.glow) trace(Math.max(3, bh / 90), 0.35)
    trace(Math.max(1.5, bh / 220), 1)
  } else {
    // Radial burst: bars radiating from the box center, one per band.
    const n = Math.max(16, Math.min(180, Math.round(cfg.barCount ?? 64)))
    const cx = bw / 2
    const cy = bh / 2
    const baseR = Math.min(bw, bh) * 0.14
    const maxLen = Math.min(bw, bh) * 0.34
    const paint = (heightScale: number, alphaScale: number): void => {
      const prev = g.globalAlpha
      g.globalAlpha = prev * alphaScale
      g.lineWidth = Math.max(1.5, ((2 * Math.PI * baseR) / n) * 0.55)
      for (let i = 0; i < n; i++) {
        const f = frame.freq.length > 0 ? frame.freq[Math.min(i, frame.freq.length - 1)] : 0
        const len = Math.pow(clamp01(f), 0.75) * maxLen * sens * gain * heightScale
        if (len < 0.5) continue
        const a = (i / n) * Math.PI * 2 - Math.PI / 2
        g.strokeStyle = colorAt(i / n)
        g.beginPath()
        g.moveTo(cx + Math.cos(a) * baseR, cy + Math.sin(a) * baseR)
        g.lineTo(cx + Math.cos(a) * (baseR + len), cy + Math.sin(a) * (baseR + len))
        g.stroke()
      }
      g.globalAlpha = prev
    }
    if (cfg.glow) paint(1.3, 0.3)
    paint(1, 1)
  }

  // The mask cut: keep the spectrum only where the artwork is opaque.
  g.globalCompositeOperation = 'destination-in'
  g.drawImage(img, 0, 0, bw, bh)
  g.globalCompositeOperation = 'source-over'
  return scratch
}

/* ------------------------------- electricity -------------------------------- */

/** One jagged bolt: anchor → outward run of segments with perpendicular
 *  midpoint displacement, optional fork. Returns polyline points. */
function boltPath(
  rng: () => number,
  ax: number,
  ay: number,
  dx: number,
  dy: number,
  len: number,
  segments: number,
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [{ x: ax, y: ay }]
  const px = -dy
  const py = dx
  for (let k = 1; k <= segments; k++) {
    const t = k / segments
    const envelope = Math.sin(Math.PI * t)
    const jitter = (rng() * 2 - 1) * len * 0.16 * envelope
    pts.push({ x: ax + dx * len * t + px * jitter, y: ay + dy * len * t + py * jitter })
  }
  // A fork off the middle third — the classic lightning afterthought.
  if (rng() < 0.45) {
    const from = pts[Math.max(1, Math.floor(segments / 2))]
    const spread = (rng() < 0.5 ? 1 : -1) * (0.4 + 0.5 * rng())
    const fdx = dx * Math.cos(spread) - dy * Math.sin(spread)
    const fdy = dx * Math.sin(spread) + dy * Math.cos(spread)
    const flen = len * (0.22 + 0.2 * rng())
    const fseg = Math.max(2, Math.floor(segments / 2))
    for (let k = 1; k <= fseg; k++) {
      const t = k / fseg
      const jitter = (rng() * 2 - 1) * flen * 0.18 * Math.sin(Math.PI * t)
      pts.push({ x: from.x + fdx * flen * t - dy * jitter, y: from.y + fdy * flen * t + dx * jitter })
    }
  }
  return pts
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
  S: number,
  grad: VisualizerConfig['gradient'],
): void {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  const kx = nw > 0 ? w / nw : 1
  const ky = nh > 0 ? h / nh : 1
  const density = clamp01(cfg.imgvizBoltDensity ?? 0.5)
  const sens = clamp(cfg.sensitivity ?? 1, 0.1, 3)
  // The seed: styleTime equals song time in exports (frame-exact) and
  // free-runs on the preview wall clock, so bolts flicker ~30×/s there.
  const rng = mulberry32((Math.floor(frame.styleTime * 30) * 1013904223) ^ 0x9e3779b9)
  const count = Math.max(1, Math.round(1 + density * 6 * (0.3 + 0.7 * drive)))
  const diag = Math.hypot(w, h)
  const anchors = assets.anchors
  const alpha = clamp01(drive * 1.5) * clamp01(0.4 + sens / 3)
  if (alpha < 0.04) return

  for (let b = 0; b < count; b++) {
    const pick = anchors[Math.floor(rng() * anchors.length) % anchors.length]
    if (!pick) continue
    // Anchor in canvas coords + outward direction (away from the center,
    // with angular jitter so bolts fan out instead of repeating).
    const ax = cx + (pick.x - nw / 2) * kx
    const ay = cy + (pick.y - nh / 2) * ky
    let dx = pick.x - nw / 2
    let dy = pick.y - nh / 2
    const dl = Math.hypot(dx, dy) || 1
    dx /= dl
    dy /= dl
    const rot = (rng() * 2 - 1) * 0.8
    const rdx = dx * Math.cos(rot) - dy * Math.sin(rot)
    const rdy = dx * Math.sin(rot) + dy * Math.cos(rot)
    const len = diag * (0.12 + 0.3 * drive) * (0.6 + 0.8 * rng()) * (0.7 + 0.3 * sens / 3)
    const pts = boltPath(rng, ax, ay, rdx, rdy, len, 6)

    // The bolt's color: the palette at the anchor's height, or its own.
    const color =
      (cfg.imgvizBoltMode ?? 'palette') === 'custom'
        ? cfg.imgvizBoltColor || '#7df9ff'
        : sampleGradient(grad.stops, clamp01(ay / (H || 1)), frame.styleTime, grad.cycleColors, grad.cycleSpeed)

    ctx.save()
    // Relative alpha: the Style tab's Transparency dial is already pinned
    // on the context — multiply, never replace.
    ctx.globalAlpha *= alpha
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // Glow pass — the electric halo around the bolt.
    ctx.shadowColor = color
    ctx.shadowBlur = 7 * S
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1.4, 2 * S)
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y)
    ctx.stroke()
    // The white-hot core.
    ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.lineWidth = Math.max(0.7, 0.9 * S)
    ctx.stroke()
    ctx.restore()
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

  // Layout: the artwork sits centered on the canvas (the Style tab's Layout
  // position/size transform wraps this), breathing with the shared drive.
  const drive = Math.min(1, 0.6 * frame.bass + 0.4 * frame.energy)
  const swell = 1 + 0.1 * drive * clamp(cfg.sensitivity ?? 1, 0, 2)
  const base = (clamp(cfg.imgvizSize ?? 55, 10, 100) / 100) * H * swell
  const aspect = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1
  const h = base
  const w = base * (Number.isFinite(aspect) && aspect > 0 ? Math.min(4, aspect) : 1)
  const cx = W / 2
  const cy = H / 2

  // Glow color: the palette at the artwork's height, or its own.
  const glowOn = !!cfg.imgvizGlow && (cfg.imgvizGlowStrength ?? 0.6) > 0.01
  const aura =
    (cfg.imgvizGlowMode ?? 'palette') === 'custom'
      ? cfg.imgvizGlowColor || '#ffffff'
      : sampleGradient(grad.stops, cy / (H || 1), frame.styleTime, grad.cycleColors, grad.cycleSpeed)
  const glowStrength = clamp01(cfg.imgvizGlowStrength ?? 0.6)

  if (glowOn) {
    // 1) The outward halo — the blurred silhouette mask, tinted per frame,
    //    swelling slightly on the drive.
    const scratch = tintScratchFor(img, assets.halo.width, assets.halo.height)
    const haloTinted = scratch ? tinted(assets.halo, scratch, aura) : null
    if (haloTinted) {
      const haloW = (w * assets.halo.width) / (img.naturalWidth * assets.m)
      const haloH = (h * assets.halo.height) / (img.naturalHeight * assets.m)
      ctx.save()
      ctx.globalAlpha *= glowStrength * (0.45 + 0.55 * drive)
      const grow = 1 + 0.05 * drive
      ctx.drawImage(haloTinted, cx - (haloW * grow) / 2, cy - (haloH * grow) / 2, haloW * grow, haloH * grow)
      ctx.restore()
    }
    // 2) The rim light — the tinted silhouette tucked UNDER the artwork, so
    //    translucent pixels pick it up while opaque pixels cover it.
    const rimScratch = tintScratchFor(img, assets.sil.width, assets.sil.height)
    const rimTinted = rimScratch ? tinted(assets.sil, rimScratch, aura) : null
    if (rimTinted) {
      ctx.save()
      ctx.globalAlpha *= glowStrength * (0.18 + 0.5 * drive)
      ctx.drawImage(rimTinted, cx - w / 2, cy - h / 2, w, h)
      ctx.restore()
    }
  }

  // 3) The artwork itself — dimmed on the Artwork dial so the inner
  //    spectrum reads (1 - dim keeps it at full brightness at 0).
  const dim = clamp01(cfg.imgvizDim ?? 0.35)
  if (dim < 0.995) {
    ctx.save()
    ctx.globalAlpha *= 1 - dim
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h)
    ctx.restore()
  }

  // 4) The inner visualizer — painted on a scratch canvas and masked to the
  //    silhouette, drawn over the artwork at the same box.
  const inner = paintInner(img, w, h, frame, cfg)
  if (inner) {
    ctx.drawImage(inner, cx - w / 2, cy - h / 2, w, h)
  }

  // 5) The electricity — bolts off the artwork's alpha edge (they live
  //    OUTSIDE the mask, so they spark off the shape freely).
  if (cfg.imgvizBolt && drive > 0.03) {
    drawBolts(ctx, assets, img, frame, cfg, cx, cy, w, h, H, drive, S, grad)
  }
}
