/**
 * Neon Split filter — the effect.app "Neon split" preset, rebuilt from the
 * preset's own published definition and effect code (fetched off the site and
 * decrypted: /api/presets/shared/neon-split plus the gradient-map / bloom /
 * noise / curves / layer-mix GLSL the editor runs). Nothing here is eyeballed:
 *
 *   1. Levels — the preset inverts the lower part of the picture (input levels
 *      [1,0]) behind a vertical smooth gradient mask (center 0.074,-0.094,
 *      width 0.3, rotation 90). That masked inversion IS the "split": bright
 *      areas at the bottom flip dark, shadows flip glowing, and the look fades
 *      out upward, gone by ~40% of the height from the bottom (matches the
 *      preset's own cover render — the frame is processed in the engine's
 *      Y-up space after the GL chain's flip-at-upload).
 *   2. Bloom — threshold 0.1, knee 0.29, intensity 3, factor 0.65: a bright
 *      pass in linear light feeds a 6-level mip pyramid, the LOD 0-5 average
 *      screens back over the picture (the engine's bloom-1/bloom-3 pair).
 *   3. Noise — the preset's film grain verbatim: 3-octave value noise on the
 *      1103515245 uint hash, cell 0.5px, chroma 0.69 (colored speckle), more
 *      grain in highlights than shadows (weights 0.25/0.4/0.53), strength
 *      exp2-dialed (1.78 = 2.44x at the default dial), applied in linear
 *      light with a 0.14 min-grain floor. Still like the published preset
 *      (grainSpeed 0) — the speed dial rolls the noise lookup per film-frame
 *      (deterministic hashed offsets) when the user wants living grain.
 *      Deterministic: same frame in, same pixels out.
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
 *
 * Infrastructure notes:
 *  - One GL instance per source canvas (preview and export each get their
 *    own), so a live preview running next to an export can't thrash one
 *    shared instance's framebuffers between two resolutions every frame —
 *    that churn is what made the filter take the whole app down. A lost
 *    context is disposed and retried on a fresh canvas after a cooldown,
 *    instead of pinning the app to the CPU path forever.
 *  - The live preview may drop the chain's internal resolution (adaptive
 *    scale 1 → 0.75 → 0.5) when the GPU can't keep up (software GL); exports
 *    always render at full scale so every frame stays faithful.
 *  - The grain is the preset's own noise field; a speed dial offsets the
 *    noise lookup per film-frame so the speckle churns (0 = the published
 *    still grain). Offsets derive from song/style time via integer hashing —
 *    deterministic, so exports match the preview frame for frame. */
import type { AudioFrame, NeonSplitFilterConfig, RenderContext } from './types'
import { clamp01, getWork, hash01, resetWork } from './filter-utils'
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

/* ------------------------------- GL instances ------------------------------ */

/** One GL chain per source canvas — the preview canvas and the exporter's
 *  canvas each own an instance, so rendering an export can't resize a shared
 *  instance's framebuffers back and forth between two resolutions. */
type GlEntry = {
  inst: NeonSplitGL
  /** Internal render scale (1 = full res; the live preview may drop it) */
  scale: number
  /** EMA of render+composite cost, ms */
  ema: number
  /** Consecutive cheap frames (scale-up hysteresis) */
  cool: number
}
const glEntries = new WeakMap<HTMLCanvasElement, GlEntry>()
let glBroken = false
/** performance.now() of the last context loss / construction failure — new
 *  instances wait this out so a dead GPU can't spin a recreate-storm. */
let lastGlFailAt = -Infinity
const GL_FAIL_COOLDOWN_MS = 4000

function getGlEntry(source: HTMLCanvasElement): GlEntry | null {
  if (glBroken) return null
  let entry = glEntries.get(source)
  if (entry && entry.inst.isLost) {
    // The GPU dropped this context. Dispose it and wait out the cooldown
    // before building a fresh one — the CPU path covers the gap.
    entry.inst.dispose()
    glEntries.delete(source)
    lastGlFailAt = performance.now()
    entry = undefined
  }
  if (!entry) {
    if (performance.now() - lastGlFailAt < GL_FAIL_COOLDOWN_MS) return null
    try {
      entry = { inst: new NeonSplitGL(), scale: 1, ema: 0, cool: 0 }
      glEntries.set(source, entry)
    } catch {
      glBroken = true
      return null
    }
  }
  return entry
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

// post-levels byte buffer (CPU path), cached per size — 1.7 MB at 720p that
// used to be re-allocated every frame
let postLevelsBuf: Uint8ClampedArray | null = null
let postLevelsW = 0
let postLevelsH = 0

function ensurePostLevels(w: number, h: number): Uint8ClampedArray {
  if (postLevelsBuf && postLevelsW === w && postLevelsH === h) return postLevelsBuf
  postLevelsBuf = new Uint8ClampedArray(w * h * 3)
  postLevelsW = w
  postLevelsH = h
  return postLevelsBuf
}

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
 *  space, sampled per pixel row — row 0 is the TOP of the picture and the
 *  mask inverts the LOWER part of the frame (rel.y runs bottom = −1 → top =
 *  +1, exactly like the GL chain after its Y-flip upload). */
function splitMaskRow(y: number, h: number, w: number): number {
  const aspect = w / h
  const relScaleY = aspect > 1 ? 1 : 1 / aspect
  const rel = 1 - ((y + 0.5) / h) * 2
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
  grainOffsetX: number,
  grainOffsetY: number,
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
  // animated grain: the static field is sampled through a wrapping window
  // offset per film-frame (0/0 = the published preset's still grain)
  const ox = ((Math.round(grainOffsetX) % W) + W) % W
  const oy = ((Math.round(grainOffsetY) % H) + H) % H

  // PASS 1 — levels (invert behind the vertical mask) + bloom bright pass
  const bw = Math.max(2, W >> 1)
  const bh = Math.max(2, H >> 1)
  const brightImg = bctx.createImageData(bw, bh)
  const bd = brightImg.data
  const postLevels = ensurePostLevels(W, H)
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
      const p3 = (y * W + x) * 3
      const rByte = Math.round(r0 * 255)
      const gByte = Math.round(g0 * 255)
      const bByte = Math.round(b0 * 255)
      postLevels[p3] = rByte
      postLevels[p3 + 1] = gByte
      postLevels[p3 + 2] = bByte
      // bloom bright pass in linear light (exact sRGB transfer, LUT-speed)
      const rl = linExact[rByte]
      const gl2 = linExact[gByte]
      const bl = linExact[bByte]
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
    // animated grain: the static field is read through a wrapping window
    // shifted by the film-frame offset (same field, moving sample position —
    // the GL chain shifts the noise lookup the same way)
    const gRow = (((y + oy) % H) * W) * 3
    for (let x = 0; x < W; x++) {
      const o3 = (y * W + x) * 3
      const o4 = (y * W + x) * 4
      // grain samples at the offset position (wraps around the field)
      const g3 = gRow + ((x + ox) % W) * 3
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
        outByteR = srgb22[Math.min(255, Math.max(0, Math.round((baseR + grain[g3] * gain * wR) * 255)))]
        outByteG = srgb22[Math.min(255, Math.max(0, Math.round((baseG + grain[g3 + 1] * gain * wG) * 255)))]
        outByteB = srgb22[Math.min(255, Math.max(0, Math.round((baseB + grain[g3 + 2] * gain * wB) * 255)))]
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

/** Grain churn: the speed dial maps to film-frame steps per second (24 at
 *  full speed, 0 = the published preset's still grain); each step offsets the
 *  noise lookup by a deterministic hashed vector so the field re-rolls like
 *  film. Derived from style time (wall clock live, song time in exports), so
 *  exports stay frame-exact. */
function grainOffsetFor(speed: number, styleTime: number): { x: number; y: number } {
  const s = clamp01(speed)
  if (s <= 0.001) return { x: 0, y: 0 }
  const phase = Math.floor(styleTime * s * 24)
  if (phase <= 0) return { x: 0, y: 0 }
  // large prime-ish spreads; the value-noise lattice decorrelates after 1px,
  // so any integer offset reads as a fresh grain field
  return {
    x: Math.floor(hash01(phase, 911) * 65536),
    y: Math.floor(hash01(phase, 919) * 65536),
  }
}

export function drawNeonSplitFilter(
  rc: RenderContext,
  cfg: NeonSplitFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass' | 'time' | 'styleTime'>,
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
  const grainOff = grainOffsetFor(cfg.grainSpeed ?? 0.5, frame.styleTime ?? frame.time ?? 0)

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
  const entry = getGlEntry(ctx.canvas)
  if (entry) {
    const t0 = performance.now()
    try {
      const out = entry.inst.render({
        source: ctx.canvas,
        bloomIntensity,
        noiseStrength,
        paperAmount,
        curveMix,
        curveLut: curveLutBase,
        ramp: cfg.ramp ?? 'violet',
        grainOffsetX: grainOff.x,
        grainOffsetY: grainOff.y,
        scale: entry.scale,
      })
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.drawImage(out, 0, 0, W, H)
      ctx.restore()
      done = true
    } catch (err) {
      // The chain itself failed (lost context mid-frame, driver hiccup).
      // Drop the instance and let the cooldown decide when GL may retry —
      // never pin the app to a dead context.
      console.warn('[neon-split] WebGL chain failed this frame, CPU fallback:', err)
      entry.inst.dispose()
      glEntries.delete(ctx.canvas)
      lastGlFailAt = performance.now()
      done = false
    }

    // Adaptive internal resolution (live preview only): track render +
    // composite cost; step the scale down when the GPU can't keep up so the
    // app stays interactive (software GL / weak iGPUs), and back up once
    // frames are cheap again. Exports never set `interactive`, so exported
    // frames always render at full scale and stay faithful.
    if (done && rc.interactive) {
      const ms = performance.now() - t0
      entry.ema = entry.ema > 0 ? entry.ema * 0.85 + ms * 0.15 : ms
      if (entry.ema > 45 && entry.scale > 0.5) {
        entry.scale = entry.scale >= 0.85 ? 0.75 : 0.5
        entry.ema = 0
        entry.cool = 0
      } else if (entry.ema < 14) {
        entry.cool++
        if (entry.cool > 90 && entry.scale < 1) {
          entry.scale = entry.scale <= 0.55 ? 0.75 : 1
          entry.ema = 0
          entry.cool = 0
        }
      } else {
        entry.cool = 0
      }
    }
  }

  if (!done) {
    drawNeonSplitCPU(rc, cfg, bloomIntensity, noiseStrength, paperAmount, grainOff.x, grainOff.y)
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
