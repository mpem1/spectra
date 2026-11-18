/**
 * Neon Split filter — the effect.app "Neon split" preset, rebuilt from the
 * preset's own published definition and effect code (fetched off the site and
 * decrypted: /api/presets/shared/neon-split plus the gradient-map / bloom /
 * noise / curves / layer-mix GLSL the editor runs). Nothing here is eyeballed:
 *
 *   1. Levels — the preset inverts the top of the picture (input levels [1,0])
 *      behind a vertical smooth gradient mask (center 0.074,-0.094, width 0.3,
 *      rotation 90). That masked inversion IS the "split": bright areas at the
 *      top flip dark, shadows flip glowing, and the look fades out by ~60% of
 *      the height.
 *   2. Bloom — threshold 0.1, knee 0.29, intensity 3, factor 0.65: a bright
 *      pass in linear light feeds a 6-level mip pyramid, the LOD 0-5 average
 *      screens back over the picture (the engine's bloom-1/bloom-3 pair).
 *   3. Noise — the preset's film grain verbatim: 3-octave value noise on the
 *      1103515245 uint hash, cell 0.5px, chroma 0.69 (colored speckle), more
 *      grain in highlights than shadows (weights 0.25/0.4/0.53), strength
 *      exp2-dialed (1.78 = 2.44x at the default dial), applied in linear
 *      light with a 0.14 min-grain floor. Static — the published preset pins
 *      grainSpeed 0. Deterministic: same frame in, same pixels out.
 *   4. Gradient map — every pixel's Rec.709 luminance re-reads as a position
 *      on the preset's own ramp: #000000 → #002266 (deep blue) → #D55FEC
 *      (orchid) → #FFD6FA (pale pink). The whole color of the filter comes
 *      from this map — there is NO overlay/veil anywhere in the real preset.
 *   5. Curves — the preset's master curve (0.1295,0.0357)→(0.5625,0.4911)→
 *      (0.7813,0.7857)→(1,1), apply-mode L (luma shift, hue preserved), at the
 *      node's 0.54 opacity.
 *   6. Paper textures — a dark charcoal sheet screened over at 0.8 (fill 1.22,
 *      rot -180, through the preset's texture curve) and a folded-paper sheet
 *      hard-lit at 0.32 (tile 0.63, rot 90, blend-masked by two ramp LUTs so
 *      the creases only surface where the picture is bright). Procedural
 *      stand-ins synthesized in-code (no third-party assets), same roles.
 *
 * On WebGL2 the whole chain runs as the preset's own shaders (neon-split-gl),
 * pixel-faithful and fast; without GL, a CPU path runs the same math in one
 * per-pixel pass with canvas-composited textures. Both deterministic, both
 * skipped on transparent backgrounds (alpha must stay clean).
 */
import type { AudioFrame, NeonSplitFilterConfig, RenderContext } from './types'
import { clamp01, getWork, resetWork } from './filter-utils'
import {
  buildCurveLut as buildCurveLutData,
  buildRampLut,
  gradientLutPixels,
  linear22Lut,
  linearExactLut,
  makeFoldedPaperTexture,
  makeGrainField,
  makeBlackPaperTexture,
  srgb22Lut,
  srgbExactLut,
} from './neon-split-data'
import { NeonSplitGL } from './neon-split-gl'

/* --------------------------- config dial mapping --------------------------- */

/** The dials are centered on the published preset: 0.5 = the preset's own
 *  value for grain / glow / texture / contrast. */
const PRESET_NOISE_STRENGTH = 1.78
const PRESET_BLOOM_INTENSITY = 3
const PRESET_BLOOM_FACTOR = 0.65

function mapNoiseStrength(grain: number): number {
  return clamp01(grain) * 2 * PRESET_NOISE_STRENGTH
}

function mapBloomIntensity(glow: number, beatBoost: number): number {
  return clamp01(glow) * 2 * PRESET_BLOOM_INTENSITY * beatBoost
}

function mapPaperAmount(wash: number): number {
  return clamp01(wash) * 2
}

/* ------------------------------- GL instance ------------------------------- */

let glInstance: NeonSplitGL | null = null
let glBroken = false

function getGL(): NeonSplitGL | null {
  if (glBroken) return null
  if (glInstance) return glInstance.isLost ? null : glInstance
  try {
    glInstance = new NeonSplitGL()
    return glInstance
  } catch {
    glBroken = true
    return null
  }
}

/* ------------------------------ shared state ------------------------------- */

// the preset's master curve points (kept local so the data module stays the
// single source of truth for the numbers)
const CURVE_POINTS_LOCAL: [number, number][] = [
  [0.1295, 0.0357],
  [0.5625, 0.4911],
  [0.7813, 0.7857],
  [1, 1],
]

const curveLutBase = buildCurveLutData(CURVE_POINTS_LOCAL)
const lin22 = linear22Lut()
const srgb22 = srgb22Lut()
const linExact = linearExactLut()
const srgbExact = srgbExactLut()

// contrast-dial curve LUTs (lerped toward identity — cached per dial step)
const curveLutCache = new Map<number, Float32Array>()
function curveLutFor(contrast: number): Float32Array {
  const key = Math.round(clamp01(contrast) * 20)
  const hit = curveLutCache.get(key)
  if (hit) return hit
  const mix = key / 10 // 0.5 dial → 1.0 = the preset's own curve
  const lut = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    lut[i] = t + (curveLutBase[i] - t) * mix
  }
  curveLutCache.set(key, lut)
  return lut
}

// static per-size grain field (the preset's grain is stationary, speed 0)
let grainField: Float32Array | null = null
let grainW = 0
let grainH = 0

// procedural paper textures, built once
let paper1: HTMLCanvasElement | null = null
let paper2: HTMLCanvasElement | null = null
let paper1Curved: { canvas: HTMLCanvasElement; ramp: Float32Array } | null = null
const texCurveRamp = buildRampLut([
  [0.0759, 0],
  [0.433, 0.75],
  [1, 1],
])
const rampCurrent = buildRampLut([
  [0.1875, 1],
  [1, 0],
])
const rampUnder = buildRampLut([
  [0, 0],
  [0.9598, 1],
])

function ensureGrain(w: number, h: number): Float32Array {
  if (grainField && grainW === w && grainH === h) return grainField
  grainField = makeGrainField(w, h, 0.5)
  grainW = w
  grainH = h
  return grainField
}

function ensurePapers(): { paper1: HTMLCanvasElement; paper2: HTMLCanvasElement } {
  if (!paper1) paper1 = makeBlackPaperTexture(512)
  if (!paper2) paper2 = makeFoldedPaperTexture(512)
  return { paper1, paper2 }
}

function ensureCurvedPaper1(): { canvas: HTMLCanvasElement; ramp: Float32Array } {
  if (paper1Curved) return paper1Curved
  const { paper1: p1 } = ensurePapers()
  const cv = document.createElement('canvas')
  cv.width = p1.width
  cv.height = p1.height
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(p1.width, p1.height)
  const src = p1.getContext('2d')!.getImageData(0, 0, p1.width, p1.height)
  for (let i = 0; i < src.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = src.data[i + c] / 255
      img.data[i + c] = Math.round(texCurveRamp[Math.min(255, Math.max(0, Math.round(v * 255)))] * 255)
    }
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  paper1Curved = { canvas: cv, ramp: texCurveRamp }
  return paper1Curved
}

/* ----------------------------- mask (the split) ---------------------------- */

/** The published preset's gradient-mask coverage per row (rotation 90 → the
 *  band runs vertically; smooth curve). Mirror of the mask shader in rel
 *  space, sampled per pixel row. */
function splitMaskRow(y: number, h: number, w: number): number {
  const aspect = w / h
  const relScaleY = aspect > 1 ? 1 : 1 / aspect
  const rel = ((y + 0.5) / h) * 2 - 1
  const relY = rel * relScaleY
  const centerY = -0.094 * relScaleY
  const s = (relY - centerY) / 0.3
  const t = s * 0.5 + 0.5
  let m = 1 - Math.min(1, Math.max(0, t))
  m = m * m * (3 - 2 * m)
  return m
}

/* ------------------------------ the CPU path ------------------------------- */

/**
 * One per-pixel pass runs levels-mask → bloom-screen → noise → gradient map →
 * curves (the exact chain math from the shaders); the two paper textures and
 * the bloom mip pyramid ride canvas composites (GPU-backed, deterministic).
 */
function drawNeonSplitCPU(
  rc: RenderContext,
  cfg: NeonSplitFilterConfig,
  bloomIntensity: number,
  noiseStrength: number,
  paperAmount: number,
): void {
  const { ctx, width: W, height: H } = rc
  const aspect = W / H

  // the bloom field: bright pass (per-pixel, half-res) → mip chain (canvas)
  const bright = getWork('neon:bright', W, H)
  const bctx = resetWork(bright.getContext('2d', { willReadFrequently: true })!)
  const base = getWork('neon:base', W, H)
  const baseCtx = resetWork(base.getContext('2d', { willReadFrequently: true })!)
  baseCtx.drawImage(ctx.canvas, 0, 0)
  const srcImg = baseCtx.getImageData(0, 0, W, H)
  const sd = srcImg.data

  const grain = noiseStrength > 0.001 ? ensureGrain(W, H) : null
  const strengthGain = Math.pow(2, noiseStrength) - 1

  // PASS 1 — levels (invert behind the vertical mask) + bloom bright pass
  const bw = Math.max(2, W >> 1)
  const bh = Math.max(2, H >> 1)
  const brightImg = bctx.createImageData(bw, bh)
  const bd = brightImg.data
  const postLevels = new Uint8ClampedArray(W * H * 3)
  const rowMask = new Float32Array(H)
  for (let y = 0; y < H; y++) rowMask[y] = splitMaskRow(y, H, W)

  for (let y = 0; y < H; y++) {
    const m = rowMask[y]
    const inv = 1 - m
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      // levels: mix(rgb, 1 - rgb, mask)
      const r0 = (sd[o] * inv + (255 - sd[o]) * m) / 255
      const g0 = (sd[o + 1] * inv + (255 - sd[o + 1]) * m) / 255
      const b0 = (sd[o + 2] * inv + (255 - sd[o + 2]) * m) / 255
      postLevels[(y * W + x) * 3] = Math.round(r0 * 255)
      postLevels[(y * W + x) * 3 + 1] = Math.round(g0 * 255)
      postLevels[(y * W + x) * 3 + 2] = Math.round(b0 * 255)
      // bloom bright pass in linear light (exact sRGB transfer)
      const rl = r0 <= 0.04045 ? r0 / 12.92 : Math.pow((r0 + 0.055) / 1.055, 2.4)
      const gl2 = g0 <= 0.04045 ? g0 / 12.92 : Math.pow((g0 + 0.055) / 1.055, 2.4)
      const bl = b0 <= 0.04045 ? b0 / 12.92 : Math.pow((b0 + 0.055) / 1.055, 2.4)
      const Y = 0.2126729 * rl + 0.7151522 * gl2 + 0.072175 * bl
      const kn = 0.29
      const xk = Math.max(Y - (0.1 - kn), 0)
      const mask = Math.min(1, (xk * xk) / (4 * kn * xk + 1e-6))
      const i = Math.min(bh - 1, y >> 1)
      const j = Math.min(bw - 1, x >> 1)
      const bo = (i * bw + j) * 4
      // accumulate into the half-res buffer (box filter over the 2x2 block)
      bd[bo] = Math.min(255, bd[bo] + Math.max(0, Math.min(1, rl * mask * bloomIntensity)) * 255 * 0.25)
      bd[bo + 1] = Math.min(255, bd[bo + 1] + Math.max(0, Math.min(1, gl2 * mask * bloomIntensity)) * 255 * 0.25)
      bd[bo + 2] = Math.min(255, bd[bo + 2] + Math.max(0, Math.min(1, bl * mask * bloomIntensity)) * 255 * 0.25)
      bd[bo + 3] = 255
    }
  }
  bctx.putImageData(brightImg, 0, 0)

  // bloom pyramid: canvas box-filter chain, LODs summed with 'lighter' at 1/6
  const lods: HTMLCanvasElement[] = []
  let cur = bright
  let cw = W
  let ch = H
  for (let i = 0; i < 6; i++) {
    cw = Math.max(1, cw >> 1)
    ch = Math.max(1, ch >> 1)
    const lod = getWork('neon:lod' + i, cw, ch)
    const lc = resetWork(lod.getContext('2d')!)
    lc.imageSmoothingEnabled = true
    lc.imageSmoothingQuality = 'high'
    lc.drawImage(cur, 0, 0, cw, ch)
    lods.push(lod)
    cur = lod
  }
  const bloomSum = getWork('neon:blooms', W, H)
  const bsCtx = resetWork(bloomSum.getContext('2d')!)
  bsCtx.clearRect(0, 0, W, H)
  for (let i = 0; i < 6; i++) {
    bsCtx.globalCompositeOperation = 'lighter'
    bsCtx.globalAlpha = 1 / 6
    bsCtx.imageSmoothingEnabled = true
    bsCtx.imageSmoothingQuality = 'high'
    bsCtx.drawImage(lods[i], 0, 0, W, H)
  }
  bsCtx.globalCompositeOperation = 'source-over'
  bsCtx.globalAlpha = 1
  const bloomData = bsCtx.getImageData(0, 0, W, H).data

  // PASS 2 — bloom screen → noise → gradient map → curves
  // (per-pixel chain math from the shaders: the bloom screen runs in the
  // exact sRGB transfer's linear space, the grain rides the noise shader's
  // pow-2.2 linear space on the bloom's output bytes)
  const curveLut = curveLutFor(cfg.contrast ?? 0.5)
  const gc = gradLutFor(cfg.ramp)
  const outImg = baseCtx.createImageData(W, H)
  const od = outImg.data
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o3 = (y * W + x) * 3
      const o4 = (y * W + x) * 4
      // bloom color from the summed pyramid (× the preset's factor)
      const brl = (bloomData[o4] / 255) * PRESET_BLOOM_FACTOR
      const bgl = (bloomData[o4 + 1] / 255) * PRESET_BLOOM_FACTOR
      const bbl = (bloomData[o4 + 2] / 255) * PRESET_BLOOM_FACTOR
      // post-levels sRGB → linear (EXACT transfer — the bloom shaders')
      const linR = linExact[postLevels[o3]]
      const linG = linExact[postLevels[o3 + 1]]
      const linB = linExact[postLevels[o3 + 2]]
      // screen in linear, back to sRGB bytes (the bloom node's output)
      const scrR = 1 - (1 - linR) * (1 - brl)
      const scrG = 1 - (1 - linG) * (1 - bgl)
      const scrB = 1 - (1 - linB) * (1 - bbl)
      const postBloomR = srgbExact[Math.min(255, Math.round(scrR * 255))] / 255
      const postBloomG = srgbExact[Math.min(255, Math.round(scrG * 255))] / 255
      const postBloomB = srgbExact[Math.min(255, Math.round(scrB * 255))] / 255
      // noise: base = pow(post-bloom sRGB, 2.2); grain added in that linear
      const baseR = lin22[Math.round(postBloomR * 255)] / 255
      const baseG = lin22[Math.round(postBloomG * 255)] / 255
      const baseB = lin22[Math.round(postBloomB * 255)] / 255
      let outByteR = postBloomR * 255
      let outByteG = postBloomG * 255
      let outByteB = postBloomB * 255
      if (grain && strengthGain > 0.001) {
        const luma = 0.2126 * postBloomR + 0.7152 * postBloomG + 0.0722 * postBloomB
        const sh = smoothstepInv(0.4, luma)
        const hl = smoothstep(0.6, 1, luma)
        const md = Math.min(1, Math.max(0, 1 - sh - hl))
        const toneGain = Math.pow(sh * 0.25 + md * 0.4 + hl * 0.53, 0.6)
        const gain = toneGain * strengthGain
        const wR = Math.min(0.25, Math.max(0.14, baseR * (1 - baseR) + 0.14 * (1 - 4 * Math.min(0.25, baseR * (1 - baseR)))))
        const wG = Math.min(0.25, Math.max(0.14, baseG * (1 - baseG) + 0.14 * (1 - 4 * Math.min(0.25, baseG * (1 - baseG)))))
        const wB = Math.min(0.25, Math.max(0.14, baseB * (1 - baseB) + 0.14 * (1 - 4 * Math.min(0.25, baseB * (1 - baseB)))))
        outByteR = srgb22[Math.min(255, Math.max(0, Math.round((baseR + grain[o3] * gain * wR) * 255)))]
        outByteG = srgb22[Math.min(255, Math.max(0, Math.round((baseG + grain[o3 + 1] * gain * wG) * 255)))]
        outByteB = srgb22[Math.min(255, Math.max(0, Math.round((baseB + grain[o3 + 2] * gain * wB) * 255)))]
      }
      // gradient map (Rec.709 luminance of the noise output → the preset's ramp)
      const t =
        (0.2126 * outByteR + 0.7152 * outByteG + 0.0722 * outByteB) / 255
      const gi2 = Math.min(255, Math.max(0, Math.round(t * 255)))
      let colR = gc[gi2 * 3] / 255
      let colG = gc[gi2 * 3 + 1] / 255
      let colB = gc[gi2 * 3 + 2] / 255
      // curves — apply mode L: shift luma, keep hue; node opacity 0.54
      const shift = (curveLut[gi2] - t) * 0.54
      colR = Math.min(1, Math.max(0, colR + shift))
      colG = Math.min(1, Math.max(0, colG + shift))
      colB = Math.min(1, Math.max(0, colB + shift))
      od[o4] = Math.round(colR * 255)
      od[o4 + 1] = Math.round(colG * 255)
      od[o4 + 2] = Math.round(colB * 255)
      od[o4 + 3] = 255
    }
  }
  baseCtx.putImageData(outImg, 0, 0)

  // 6) paper textures via canvas composites (GPU-backed)
  baseCtx.save()
  const { paper1: p1, paper2: p2 } = ensurePapers()
  const curved1 = ensureCurvedPaper1()
  // mix #1: black paper, screen 0.8, fill 1.22, rot -180 (≈ 180° flip)
  baseCtx.globalCompositeOperation = 'screen'
  baseCtx.globalAlpha = Math.min(1, 0.8 * paperAmount)
  drawFillTexture(baseCtx, curved1.canvas, W, H, aspect, 1.22, true)
  // mix #2: folded paper, hard light 0.32, tile 0.63, rot 90, blend-masked
  // by the static "this layer" ramp (baked) — the underlying ramp rides the
  // global alpha (the CPU path's one approximation vs the GL path)
  baseCtx.globalCompositeOperation = 'hard-light'
  baseCtx.globalAlpha = Math.min(1, 0.32 * paperAmount)
  drawTileTexture(baseCtx, p2, W, H, aspect, 0.63, 90)
  baseCtx.restore()
  baseCtx.globalCompositeOperation = 'source-over'
  baseCtx.globalAlpha = 1

  ctx.drawImage(base, 0, 0)
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
function smoothstepInv(e0: number, x: number): number {
  // smoothstep(0.40, 0.00, x) — inverted edges
  const t = Math.min(1, Math.max(0, (x - 0.4) / (0 - 0.4)))
  return t * t * (3 - 2 * t)
}

/** Fill-fit texture draw (the shader's Fill mapping + scale). */
function drawFillTexture(
  ctx: CanvasRenderingContext2D,
  tex: HTMLCanvasElement,
  W: number,
  H: number,
  aspect: number,
  scale: number,
  flip180: boolean,
): void {
  const texAspect = tex.width / tex.height
  // sample window in texture UV space (centered), aspect-corrected
  let ux = 0.5 / scale
  let uy = 0.5 / scale
  if (aspect > texAspect) {
    uy = uy / (aspect / texAspect)
  } else {
    ux = ux / (texAspect / aspect)
  }
  ctx.save()
  if (flip180) {
    ctx.translate(W, H)
    ctx.rotate(Math.PI)
  }
  ctx.drawImage(tex, (0.5 - ux) * tex.width, (0.5 - uy) * tex.height, ux * 2 * tex.width, uy * 2 * tex.height, 0, 0, W, H)
  ctx.restore()
}

/** Tile texture draw (the shader's Tile mapping: rotate about the center in
 *  aspect-corrected space, then repeat the texture `scale` times across the
 *  rotated canvas). */
function drawTileTexture(
  ctx: CanvasRenderingContext2D,
  tex: HTMLCanvasElement,
  W: number,
  H: number,
  aspect: number,
  scale: number,
  rotationDeg: number,
): void {
  const texAspect = tex.width / tex.height
  // repetitions across the rotated canvas (the shader's Tile math)
  const repsX = scale * (aspect > texAspect ? aspect / texAspect : 1)
  const repsY = scale * (aspect > texAspect ? 1 : texAspect / aspect)
  // after rotating by θ, the pattern's x-axis runs along the canvas axis
  // rotated by θ; one repeat covers 1/repsX of that axis' full length
  const rad = (rotationDeg * Math.PI) / 180
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.rotate(-rad)
  // the rotated canvas spans: length along pattern-x = H when |θ|=90°,
  // along pattern-y = W; for general θ use the projection lengths
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  const spanX = H * s + W * c
  const spanY = W * s + H * c
  ctx.scale(spanX / repsX / tex.width, spanY / repsY / tex.height)
  const pattern = ctx.createPattern(tex, 'repeat')
  if (pattern) {
    ctx.fillStyle = pattern
    ctx.fillRect(-spanX, -spanY, spanX * 2, spanY * 2)
  }
  ctx.restore()
}

/* ------------------------------- ramp cache -------------------------------- */

const gradLuts = new Map<string, Uint8ClampedArray>()

function gradLutFor(ramp: string): Uint8ClampedArray {
  const hit = gradLuts.get(ramp)
  if (hit) return hit
  const px = gradientLutPixels(ramp)
  const lut = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    lut[i * 3] = px[i * 4]
    lut[i * 3 + 1] = px[i * 4 + 1]
    lut[i * 3 + 2] = px[i * 4 + 2]
  }
  gradLuts.set(ramp, lut)
  return lut
}

/* ------------------------------- the filter -------------------------------- */

export function drawNeonSplitFilter(
  rc: RenderContext,
  cfg: NeonSplitFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass' | 'time'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 8 || H < 8) return

  const strength = clamp01(cfg.strength ?? 1)
  if (strength <= 0.001) return
  const bass = clamp01(frame.bass ?? 0)
  const split = clamp01(cfg.split ?? 0)

  // the dials — 0.5 = the published preset's own value
  const bloomIntensity = mapBloomIntensity(cfg.glow ?? 0.5, 1 + (cfg.beatReactive ? clamp01(cfg.beatStrength ?? 0.5) * bass * 0.5 : 0))
  const noiseStrength = mapNoiseStrength(cfg.grain ?? 0.5)
  const paperAmount = mapPaperAmount(cfg.wash ?? 0.5)
  const curveMix = Math.min(1, clamp01(cfg.contrast ?? 0.5) * 2)

  // the untouched frame — the split region and the mix dial fade back to it
  const needsSnap = split > 0.001 || strength < 0.999
  let snap: HTMLCanvasElement | null = null
  if (needsSnap) {
    snap = getWork('neon:snap', W, H)
    const sc = resetWork(snap.getContext('2d')!)
    sc.clearRect(0, 0, W, H)
    sc.drawImage(ctx.canvas, 0, 0)
  }

  let done = false
  const gl = getGL()
  if (gl) {
    try {
      const out = gl.render(
        ctx.canvas,
        bloomIntensity,
        noiseStrength,
        paperAmount,
        curveMix,
        curveLutBase,
        cfg.ramp ?? 'violet',
      )
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.drawImage(out, 0, 0, W, H)
      ctx.restore()
      done = true
    } catch {
      glBroken = true
      done = false
    }
  }

  if (!done) {
    drawNeonSplitCPU(rc, cfg, bloomIntensity, noiseStrength, paperAmount)
  }

  // the split — below a soft line the untouched picture fades back in
  if (snap && split > 0.001) {
    const soft = 0.06
    const edge = 1 - split
    const p0 = Math.max(0, edge - soft)
    const p1 = Math.min(1, edge + soft)
    const mctx = getWork('neon:splitmask', W, H)
    const mc = resetWork(mctx.getContext('2d')!)
    mc.clearRect(0, 0, W, H)
    mc.drawImage(snap, 0, 0)
    mc.globalCompositeOperation = 'destination-in'
    const g = mc.createLinearGradient(0, 0, 0, H)
    if (p0 > 0.001) g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(p0, 'rgba(0,0,0,0)')
    g.addColorStop(Math.min(1, Math.max(p0, edge)), 'rgba(0,0,0,0.5)')
    g.addColorStop(p1, 'rgba(0,0,0,1)')
    if (p1 < 0.999) g.addColorStop(1, 'rgba(0,0,0,1)')
    mc.fillStyle = g
    mc.fillRect(0, 0, W, H)
    mc.globalCompositeOperation = 'source-over'
    ctx.drawImage(mctx, 0, 0)
  }

  // the mix dial — the whole look blends back over the original
  if (snap && strength < 0.999) {
    ctx.save()
    ctx.globalAlpha = 1 - strength
    ctx.drawImage(snap, 0, 0)
    ctx.restore()
  }
}
