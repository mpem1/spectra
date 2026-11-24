/**
 * Texture — the finished picture printed onto a physical material. The
 * user's ask: "under filters can we add a section called texture where we
 * can add different textures i think its called displacement where we can
 * see the flaws and texture through the image". Eight procedural surfaces:
 * film grain, paper, canvas weave, concrete, frosted glass, crumpled foil,
 * rust and dirt. Each one is a HEIGHT field (the surface's bumps): the
 * slope of that field
 *   1. DISPLACES the picture — every pixel samples a few pixels away,
 *      toward the bump, so the surface's flaws warp the image (literal
 *      displacement mapping — the texture reads THROUGH the image),
 *   2. SHADES it like a lit relief (light from the upper left, so bumps
 *      catch a highlight on their lit flank and sink into shadow on the
 *      far side), and
 *   3. blends the material's own tone over it (warm paper fibers, orange
 *      rust patches, dark grime…).
 * `amount` scales all three together, so the material fades in as ONE
 * coherent surface; `scale` sizes the features (fibers, pits, wrinkles)
 * relative to the frame, resolution-independent (720p reference).
 *
 * Structure: every material's height + albedo field is generated ONCE per
 * (type, size, scale bucket) at HALF resolution (the surfaces are organic;
 * the apply loop bilinear-upsamples) and cached, so per-frame work is one
 * pass over the pixels: a nearest-gradient read, one bilinear source
 * sample and one bilinear material sample each — the same cost class as
 * the Gradient Map pass. Grain is cheaper still: no displacement, no
 * shading — it reads one of eight pre-built 256×256 monochrome noise
 * tiles through a bilinear wrap and blends overlay-style, re-picking the
 * tile on the 24 fps film-frame clock (the Film filter's dust cadence) so
 * the grain flickers like real film instead of sitting as a fixed pattern.
 *
 * Determinism: every "random" value comes from integer lattice hashing
 * (hash01 — the filter-utils contract), so the same config produces the
 * exact same texture every frame, and preview and offline exports agree
 * frame-exactly. The material fields are static surfaces — only grain
 * animates. Skipped on transparent backgrounds like every full-frame
 * filter, so alpha recordings stay clean.
 */
import type { AudioFrame, RenderContext, TextureFilterConfig, TextureFilterType } from './types'
import { clamp01, frameSeed, getWork, hash01, resetWork } from './filter-utils'

/* ------------------------------ noise toolkit ------------------------------ */

/** 2D lattice value noise — deterministic integer hashing at the lattice
 *  corners, smoothstep-faded between them. Pure integer math → every
 *  browser computes the identical field. */
function lattice(ix: number, iy: number, seed: number): number {
  return hash01(Math.imul(ix, 7919) + seed, Math.imul(iy, 104729) - seed)
}

function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = lattice(xi, yi, seed)
  const b = lattice(xi + 1, yi, seed)
  const c = lattice(xi, yi + 1, seed)
  const d = lattice(xi + 1, yi + 1, seed)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** Fractal Brownian motion — layered value noise, the generic "organic
 *  surface" base every material's recipe starts from. */
function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let fx = x
  let fy = y
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(fx, fy, seed + o * 1013)
    norm += amp
    amp *= 0.5
    fx *= 2
    fy *= 2
  }
  return sum / norm
}

/** 0..1 smoothstep with clamped edges — patch thresholds land softly. */
function smooth01(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x
  return t * t * (3 - 2 * t)
}

/* ------------------------------ material specs ------------------------------ */

interface TexSpec {
  /** Displacement amplitude (720-reference px, full amount) — how far a
   *  full-slope bump pushes the picture. */
  disp: number
  /** Relief-shading strength (1 = flat surface; slopes swing ± this). */
  shade: number
  /** How much of the material's own tone blends over the displaced
   *  picture (0 = shading only, 1 = full material color). */
  albMix: number
  /** Blend mode for the material tone over the picture. */
  blend: 'multiply' | 'soft'
  /** Base feature size on the 720p reference canvas (px). */
  feature: number
}

const SPECS: Record<TextureFilterType, TexSpec> = {
  grain: { disp: 0, shade: 0, albMix: 0.6, blend: 'soft', feature: 1.2 },
  paper: { disp: 3.0, shade: 0.5, albMix: 0.5, blend: 'multiply', feature: 7 },
  canvas: { disp: 2.3, shade: 0.62, albMix: 0.55, blend: 'multiply', feature: 6 },
  concrete: { disp: 3.4, shade: 0.75, albMix: 0.42, blend: 'multiply', feature: 11 },
  glass: { disp: 6.5, shade: 0.55, albMix: 0.4, blend: 'soft', feature: 9 },
  foil: { disp: 8.0, shade: 1.05, albMix: 0.32, blend: 'multiply', feature: 13 },
  rust: { disp: 2.0, shade: 0.45, albMix: 0.85, blend: 'multiply', feature: 14 },
  dirt: { disp: 1.5, shade: 0.5, albMix: 0.8, blend: 'multiply', feature: 10 },
}

const TEX_SEEDS: Record<TextureFilterType, number> = {
  grain: 0,
  paper: 11,
  canvas: 23,
  concrete: 37,
  glass: 51,
  foil: 67,
  rust: 83,
  dirt: 97,
}

/* --------------------------- material field cache --------------------------- */

/** A generated material surface: the height field (0..1 bumps) and the
 *  material's albedo (rgb), both at HALF the canvas resolution — the
 *  surfaces are organic, so the apply loop bilinear-upsamples with no
 *  visible loss and generation stays 4× cheaper. */
interface TexField {
  h: Float32Array
  alb: Uint8ClampedArray
  tw: number
  th: number
}

const fieldCache = new Map<string, TexField>()

function fieldFor(type: TextureFilterType, W: number, H: number, scale: number): TexField {
  // Quantize the scale into the cache key so dragging the Scale slider
  // regenerates at most a handful of times across its travel.
  const q = Math.round(Math.min(3, Math.max(0.4, scale)) * 5) / 5
  const key = `${type}|${W}|${H}|${q}`
  const hit = fieldCache.get(key)
  if (hit) return hit
  const tw = Math.max(24, W >> 1)
  const th = Math.max(24, H >> 1)
  const minWH = Math.min(W, H)
  // Feature size in canvas px at this scale (720p reference — features
  // grow with the frame so a 1080p export shows the same physical paper).
  const cell = (SPECS[type].feature * minWH) / 720 / q
  const field = generateField(type, tw, th, 2 / cell)
  if (fieldCache.size > 20) fieldCache.clear()
  fieldCache.set(key, field)
  return field
}

/** One material's recipe — u/v are texture units (one feature ≈ 1 unit).
 *  Each fills the height (the bumps displacement + shading ride) and the
 *  material's albedo rgb. */
function generateField(type: TextureFilterType, tw: number, th: number, k: number): TexField {
  const h = new Float32Array(tw * th)
  const alb = new Uint8ClampedArray(tw * th * 3)
  const s = TEX_SEEDS[type]
  for (let y = 0; y < th; y++) {
    const v = y * k
    for (let x = 0; x < tw; x++) {
      const u = x * k
      let hv = 0.5
      let r = 235
      let g = 231
      let b = 221
      switch (type) {
        case 'paper': {
          // Soft laid-paper undulation + short horizontal fibers.
          const body = fbm(u * 0.45, v * 0.45, s, 3)
          const fibers = fbm(u * 0.6, v * 3.0, s + 41, 2)
          hv = 0.62 * body + 0.38 * fibers
          const tone = 9 * (fibers - 0.5) + 7 * (body - 0.5)
          r = 238 + tone
          g = 234 + tone
          b = 222 + tone
          break
        }
        case 'canvas': {
          // Woven threads: two sine grids wobbling with noise, plus fuzz.
          const wob = fbm(u * 0.16, v * 0.16, s, 2) * 1.9
          const wx = 0.5 + 0.5 * Math.sin((u + wob) * Math.PI)
          const wy = 0.5 + 0.5 * Math.sin((v + wob * 0.7) * Math.PI)
          const thread = 0.5 * wx + 0.5 * wy
          const fuzz = fbm(u * 1.4, v * 1.4, s + 9, 2)
          hv = 0.68 * thread + 0.32 * fuzz
          const tone = 13 * (thread - 0.5) + 5 * (fuzz - 0.5)
          r = 230 + tone
          g = 223 + tone
          b = 206 + tone
          break
        }
        case 'concrete': {
          // Mineral blotches + crisp little pits (dents below the surface).
          const body = fbm(u * 0.2, v * 0.2, s, 4)
          const pit = lattice(Math.floor(u * 1.9), Math.floor(v * 1.9), s + 5)
          const pitH = pit < 0.05 ? (-0.42 * (0.05 - pit)) / 0.05 : 0
          hv = Math.min(1, Math.max(0, 0.55 + (body - 0.5) * 0.9 + pitH))
          const tone = 15 * (body - 0.5)
          r = 177 + tone
          g = 177 + tone
          b = 179 + tone
          break
        }
        case 'glass': {
          // Long horizontal cleaning smears + a fine drag bump.
          const smear = fbm(u * 0.08, v * 0.55, s, 3)
          const fine = fbm(u * 1.3, v * 1.3, s + 13, 2)
          hv = 0.72 * smear + 0.28 * fine
          const tone = 5 * (smear - 0.5)
          r = 243 + tone
          g = 246 + tone
          b = 250 + tone
          break
        }
        case 'foil': {
          // Crumpled metal: ridged noise (sharp crease lines) + a micro
          // brush so the flat cells still glint unevenly.
          const crumple = fbm(u * 0.3, v * 0.3, s, 3)
          const ridge = 1 - Math.abs(2 * crumple - 1)
          const micro = fbm(u * 2.2, v * 2.2, s + 21, 2)
          hv = Math.min(1, Math.pow(ridge, 1.6) * 0.88 + micro * 0.12)
          const tone = 9 * (hv - 0.5)
          r = 220 + tone
          g = 224 + tone
          b = 230 + tone
          break
        }
        case 'rust': {
          // Oxidation patches blooming over bare steel — the albedo blends
          // from the steel tone into orange-brown rust inside the patches.
          const blotch = fbm(u * 0.24, v * 0.24, s, 4)
          const patch = smooth01((blotch - 0.46) / 0.18)
          const grainy = fbm(u * 1.5, v * 1.5, s + 31, 2)
          hv = Math.min(1, patch * (0.42 + 0.58 * grainy))
          const rn = 26 * (grainy - 0.5)
          r = 198 + (158 + rn - 198) * patch
          g = 198 + (88 + rn * 0.6 - 198) * patch
          b = 194 + (46 + rn * 0.4 - 194) * patch
          break
        }
        case 'dirt': {
          // Dark grime settling into blotches, plus crisp specks.
          const blotch = fbm(u * 0.28, v * 0.28, s, 4)
          const grime = smooth01((blotch - 0.44) / 0.22)
          const speck = lattice(Math.floor(u * 2.7), Math.floor(v * 2.7), s + 7)
          hv = Math.min(1, grime * grime * 0.9 + (speck < 0.05 ? 0.75 : 0))
          const tone = 10 * (blotch - 0.5)
          r = 74 + tone
          g = 66 + tone
          b = 57 + tone
          break
        }
        default:
          break // 'grain' renders from its own tile set, never a field
      }
      const kk = y * tw + x
      h[kk] = hv
      alb[kk * 3] = r
      alb[kk * 3 + 1] = g
      alb[kk * 3 + 2] = b
    }
  }
  return { h, alb, tw, th }
}

/* -------------------------------- grain tiles ------------------------------- */

/** Eight pre-built 256×256 monochrome grain tiles (90..166, centered on
 *  the overlay-blend neutral 128). Built once; the frame clock just picks
 *  one, so the grain flickers instead of sitting as a fixed pattern. */
let grainTileCache: Uint8Array[] | null = null

function grainTiles(): Uint8Array[] {
  if (grainTileCache) return grainTileCache
  const tiles: Uint8Array[] = []
  for (let tI = 0; tI < 8; tI++) {
    const t = new Uint8Array(256 * 256)
    for (let k = 0; k < t.length; k++) t[k] = 90 + hash01(k, tI * 263 + 11) * 76
    tiles.push(t)
  }
  grainTileCache = tiles
  return tiles
}

/* ------------------------------ pooled ImageData ---------------------------- */

const imgPool = new Map<string, ImageData>()

function pooledImage(key: string, w: number, h: number): ImageData {
  const hit = imgPool.get(key)
  if (hit && hit.width === w && hit.height === h) return hit
  const img = new ImageData(w, h)
  if (imgPool.size > 8) imgPool.clear()
  imgPool.set(key, img)
  return img
}

/* --------------------------------- the pass --------------------------------- */

export function drawTextureFilter(
  rc: RenderContext,
  cfg: TextureFilterConfig | undefined,
  frame: Pick<AudioFrame, 'styleTime'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 16 || H < 16) return

  const amount = clamp01(cfg.amount ?? 0.6)
  if (amount <= 0.001) return // 0 = the untouched picture
  const type: TextureFilterType = cfg.type ?? 'paper'
  const scale = Math.min(3, Math.max(0.4, cfg.scale ?? 1))
  const spec = SPECS[type]
  const minWH = Math.min(W, H)

  // Snapshot the finished picture — the READ source every pixel samples
  // from while the filtered result lands in the pooled output buffer.
  const work = getWork('texture:base', W, H)
  const wctx = resetWork(work.getContext('2d', { willReadFrequently: true })!)
  wctx.drawImage(ctx.canvas, 0, 0)
  const src = wctx.getImageData(0, 0, W, H).data
  const out = pooledImage(`${W}x${H}`, W, H)
  const od = out.data
  const ia = 1 - amount

  if (type === 'grain') {
    // Film grain — no displacement, no shading: one bilinear wrap read of
    // the frame's noise tile per pixel, overlay-blended at the amount.
    const seed = frameSeed(frame.styleTime, 24)
    const tile = grainTiles()[seed % 8]
    // Grain texel size rides the Scale dial and the frame size, so the
    // grain reads the same physical size in previews and 1080p exports.
    const gs = Math.max(0.5, spec.feature * scale * (minWH / 720))
    const inv = 1 / gs
    for (let y = 0; y < H; y++) {
      const fy = ((y * inv) % 256 + 256) % 256
      const y0 = fy | 0
      const fy1 = (y0 + 1) & 255
      const wy = fy - y0
      const yR0 = y0 * 256
      const yR1 = fy1 * 256
      let i = y * W * 4
      for (let x = 0; x < W; x++, i += 4) {
        const fx = ((x * inv) % 256 + 256) % 256
        const x0 = fx | 0
        const x1 = (x0 + 1) & 255
        const wx = fx - x0
        const g =
          (tile[yR0 + x0] * (1 - wx) * (1 - wy) +
            tile[yR0 + x1] * wx * (1 - wy) +
            tile[yR1 + x0] * (1 - wx) * wy +
            tile[yR1 + x1] * wx * wy) /
          255
        // Overlay blend — gray 128 is neutral, deviations push/pull the
        // local tone: the classic grain read.
        for (let c = 0; c < 3; c++) {
          const s = src[i + c] / 255
          const o = s < 0.5 ? 2 * s * g : 1 - 2 * (1 - s) * (1 - g)
          od[i + c] = src[i + c] * ia + o * 255 * amount
        }
        od[i + 3] = 255
      }
    }
  } else {
    // Material surfaces — displacement + relief shading + material tone.
    const field = fieldFor(type, W, H, scale)
    const { h, alb, tw, th } = field
    // Displacement amplitude in canvas px: the spec's reference px scaled
    // to the frame, by the amount, with the slope→px gain folded in.
    const dispAmp = spec.disp * (minWH / 720) * amount * 1.6
    const shadeK = spec.shade
    // Albedo blend strength rides the amount too — the material fades in
    // as one surface, never tone-ahead-of-warp.
    const albMix = spec.albMix * amount
    const soft = spec.blend === 'soft'
    for (let y = 0; y < H; y++) {
      // Per-row texture indices (half-res, clamped into the field).
      const ty = Math.min(th - 1, y >> 1)
      const ty1 = Math.min(th - 1, ty + 1)
      const tyP = ty > 0 ? ty - 1 : 0
      const tY1 = ty1 * tw
      const hRow = ty * tw
      const hRowN = ty1 * tw
      const hRowP = tyP * tw
      const tfy = (y >> 1) - ty + (y & 1) * 0.5
      const wyA = 1 - tfy
      let i = y * W * 4
      for (let x = 0; x < W; x++, i += 4) {
        const tx = Math.min(tw - 1, x >> 1)
        const tx1 = Math.min(tw - 1, tx + 1)
        const txP = tx > 0 ? tx - 1 : 0
        // Nearest gradient of the height field — the surface's slope.
        let gx = h[hRow + tx1] - h[hRow + txP]
        let gy = h[hRowN + tx] - h[hRowP + tx]
        if (gx > 1) gx = 1
        else if (gx < -1) gx = -1
        if (gy > 1) gy = 1
        else if (gy < -1) gy = -1
        const dx = gx * dispAmp
        const dy = gy * dispAmp

        // Bilinear source sample at the displaced spot (clamped to the
        // frame — bumps near the edge just pull the picture, no wrap).
        let sxf = x + dx
        let syf = y + dy
        if (sxf < 0) sxf = 0
        else if (sxf > W - 1) sxf = W - 1
        if (syf < 0) syf = 0
        else if (syf > H - 1) syf = H - 1
        const x0 = sxf | 0
        const y0 = syf | 0
        const fxr = sxf - x0
        const fyr = syf - y0
        const x1 = x0 + 1 < W ? x0 + 1 : x0
        const y1 = y0 + 1 < H ? y0 + 1 : y0
        const r00 = (y0 * W + x0) << 2
        const r01 = (y0 * W + x1) << 2
        const r10 = (y1 * W + x0) << 2
        const r11 = (y1 * W + x1) << 2
        const w00 = (1 - fxr) * (1 - fyr)
        const w01 = fxr * (1 - fyr)
        const w10 = (1 - fxr) * fyr
        const w11 = fxr * fyr
        const sr = src[r00] * w00 + src[r01] * w01 + src[r10] * w10 + src[r11] * w11
        const sg = src[r00 + 1] * w00 + src[r01 + 1] * w01 + src[r10 + 1] * w10 + src[r11 + 1] * w11
        const sb = src[r00 + 2] * w00 + src[r01 + 2] * w01 + src[r10 + 2] * w10 + src[r11 + 2] * w11

        // Relief shading — light from the upper left: a bump's left flank
        // (rising toward the light) brightens, its far side sinks.
        let shd = 1 + shadeK * (dx * 0.55 + dy * 0.7)
        if (shd < 0.3) shd = 0.3
        else if (shd > 1.8) shd = 1.8

        // Bilinear material albedo at this spot, shaded by the relief.
        const a00 = (ty * tw + tx) * 3
        const a01 = (ty * tw + tx1) * 3
        const a10 = (ty1 * tw + tx) * 3
        const a11 = (ty1 * tw + tx1) * 3
        const tfx = (x >> 1) - tx + (x & 1) * 0.5
        const wxA = 1 - tfx
        const ar =
          (alb[a00] * wxA * wyA + alb[a01] * tfx * wyA + alb[a10] * wxA * tfy + alb[a11] * tfx * tfy) *
          shd
        const ag =
          (alb[a00 + 1] * wxA * wyA +
            alb[a01 + 1] * tfx * wyA +
            alb[a10 + 1] * wxA * tfy +
            alb[a11 + 1] * tfx * tfy) *
          shd
        const ab =
          (alb[a00 + 2] * wxA * wyA +
            alb[a01 + 2] * tfx * wyA +
            alb[a10 + 2] * wxA * tfy +
            alb[a11 + 2] * tfx * tfy) *
          shd

        // Material tone over the displaced picture (normalized 0..1).
        let mr: number
        let mg: number
        let mb: number
        if (soft) {
          // Soft-light: gentle — glass smears tint and shade without hard
          // darkening.
          const s0r = sr / 255
          const s0g = sg / 255
          const s0b = sb / 255
          const m0r = ar / 255
          const m0g = ag / 255
          const m0b = ab / 255
          mr =
            (m0r <= 0.5
              ? s0r - (1 - 2 * m0r) * s0r * (1 - s0r)
              : s0r + (2 * m0r - 1) * (softD(s0r) - s0r)) *
            255
          mg =
            (m0g <= 0.5
              ? s0g - (1 - 2 * m0g) * s0g * (1 - s0g)
              : s0g + (2 * m0g - 1) * (softD(s0g) - s0g)) *
            255
          mb =
            (m0b <= 0.5
              ? s0b - (1 - 2 * m0b) * s0b * (1 - s0b)
              : s0b + (2 * m0b - 1) * (softD(s0b) - s0b)) *
            255
        } else {
          // Multiply: the material's tone lands directly on the picture.
          mr = (sr * ar) / 255
          mg = (sg * ag) / 255
          mb = (sb * ab) / 255
        }

        // Amount fades between the untouched picture and the full material.
        od[i] = src[i] * ia + mr * amount
        od[i + 1] = src[i + 1] * ia + mg * amount
        od[i + 2] = src[i + 2] * ia + mb * amount
        od[i + 3] = 255
      }
    }
  }

  wctx.putImageData(out, 0, 0)
  ctx.drawImage(work, 0, 0)
}

/** Soft-light's highlight curve (the W3C blend-mode formula). */
function softD(s: number): number {
  return s <= 0.25 ? ((16 * s - 12) * s + 4) * s : Math.sqrt(s)
}
