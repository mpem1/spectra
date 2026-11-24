/**
 * Texture — the finished picture printed onto a physical material. The
 * user's ask: "under filters can we add a section called texture where we
 * can add different textures i think its called displacement where we can
 * see the flaws and texture through the image" — and, after the first cut
 * shifted brightness with the dial: "why do they darken or lighten the
 * image based on the amount? it should change the whole image based on
 * the texture being used". Eight procedural surfaces: film grain, paper,
 * canvas weave, concrete, frosted glass, crumpled foil, rust and dirt.
 * Each one is a HEIGHT field (the surface's bumps) whose slope
 * DISPLACES the picture — every pixel samples a chunk of the frame away,
 * toward the bump, so the surface's flaws warp the WHOLE image (literal
 * displacement mapping — the texture reads THROUGH the image) — and the
 * slopes catch a MEAN-ZERO lit relief (light from the upper left: a
 * bump's lit flank brightens exactly as much as its far flank sinks, so
 * local highlights and shadows sell the physical surface while the
 * image's AVERAGE brightness never moves). The material's own tone blend
 * is gone on purpose: the old multiply/soft-light albedo pass WAS the
 * darkening/lightening the user reported (rust mulched the frame toward
 * orange-brown, dirt sank toward grime) — a texture should BEND the
 * picture, not tint it. `amount` is now the displacement dial: the
 * picture warps harder as it rises, its colors stay its own. `scale`
 * sizes the features (fibers, pits, wrinkles) relative to the frame,
 * resolution-independent (720p reference).
 *
 * The ninth material is the user's own picture ('custom'): its luminance
 * IS the height field — a Photoshop-Displace-style HEIGHT shift (bright
 * pushes one way, dark pulls the other, bounded and predictable even for
 * smooth photos) — drawn tiled under Size / Move X / Move Y / Rotate
 * transforms with a Contrast dial multiplying the bumps around mid-gray.
 * See customFieldFor below.
 *
 * Structure: every material's height field is generated ONCE per (type,
 * size, scale bucket) at HALF resolution (the surfaces are organic; the
 * apply loop bilinear-upsamples) and cached, so per-frame work is one
 * pass over the pixels: a nearest gradient read plus one bilinear source
 * sample — cheaper than the old pass, which also read a material albedo
 * per pixel. Grain is its own cheaper thing: no displacement, no shading
 * — it reads one of eight pre-built 256×256 monochrome noise tiles
 * through a bilinear wrap and blends overlay-style (gray 128 is neutral,
 * so the wash pushes and pulls local tone without shifting the average),
 * re-picking the tile on the 24 fps film-frame clock (the Film filter's
 * dust cadence) so the grain flickers like real film instead of sitting
 * as a fixed pattern.
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
import { getBackgroundImage } from './image-cache'

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
  /** Displacement amplitude — how far a FULL-SLOPE bump (gradient 1.0)
   *  pushes the picture, in 720-reference px at full amount. Real slopes
   *  on these fields run 0.05–0.5 per texel, so the effective warp is a
   *  few px on gentle undulations and 10–30 px on fiber/crease/pit
   *  edges — the whole image bends. */
  disp: number
  /** Relief-shading strength at full amount — the slopes' lit flanks
   *  brighten and far flanks sink around this much. Mean-zero across the
   *  surface, so the image's average brightness never shifts. */
  shade: number
  /** Base feature size on the 720p reference canvas (px). */
  feature: number
}

const SPECS: Record<TextureFilterType, TexSpec> = {
  grain: { disp: 0, shade: 0, feature: 1.2 },
  paper: { disp: 32, shade: 0.5, feature: 7 },
  canvas: { disp: 22, shade: 0.55, feature: 6 },
  concrete: { disp: 30, shade: 0.5, feature: 11 },
  glass: { disp: 52, shade: 0.5, feature: 9 },
  foil: { disp: 52, shade: 0.55, feature: 13 },
  rust: { disp: 26, shade: 0.4, feature: 14 },
  dirt: { disp: 22, shade: 0.45, feature: 10 },
  // 'custom' never generates a procedural field (its height comes from
  // the user's image) — here `disp` is the HEIGHT-SHIFT amplitude: the
  // map's full deviation from mid-gray moves the picture ±disp/2 px at
  // full amount (Photoshop-Displace semantics — bounded no matter how
  // smooth the uploaded image is, unlike slope-based displacement which
  // barely moves a smooth photo). feature is unused.
  custom: { disp: 64, shade: 0.5, feature: 0 },
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

/** A generated material surface: the height field (0..1 bumps) at HALF
 *  the canvas resolution — the surfaces are organic, so the apply loop
 *  bilinear-upsamples with no visible loss and generation stays 4×
 *  cheaper. (The old albedo field is gone — the material no longer tints
 *  the picture, it only warps it.) */
interface TexField {
  h: Float32Array
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
  // Scale MULTIPLIES: 3.0× = three-times-bigger wrinkles (the Grain tile
  // read already worked that way), 0.4× = fine grain.
  const cell = ((SPECS[type].feature * minWH) / 720) * q
  const field = generateField(type, tw, th, 2 / cell)
  if (fieldCache.size > 20) fieldCache.clear()
  fieldCache.set(key, field)
  return field
}

/** One material's recipe — u/v are texture units (one feature ≈ 1 unit).
 *  Each fills the height field (the bumps the displacement and the
 *  relief shading ride on). */
function generateField(type: TextureFilterType, tw: number, th: number, k: number): TexField {
  const h = new Float32Array(tw * th)
  const s = TEX_SEEDS[type]
  for (let y = 0; y < th; y++) {
    const v = y * k
    for (let x = 0; x < tw; x++) {
      const u = x * k
      let hv = 0.5
      switch (type) {
        case 'paper': {
          // Soft laid-paper undulation + short horizontal fibers.
          const body = fbm(u * 0.45, v * 0.45, s, 3)
          const fibers = fbm(u * 0.6, v * 3.0, s + 41, 2)
          hv = 0.62 * body + 0.38 * fibers
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
          break
        }
        case 'concrete': {
          // Mineral blotches + crisp little pits (dents below the surface).
          const body = fbm(u * 0.2, v * 0.2, s, 4)
          const pit = lattice(Math.floor(u * 1.9), Math.floor(v * 1.9), s + 5)
          const pitH = pit < 0.05 ? (-0.42 * (0.05 - pit)) / 0.05 : 0
          hv = Math.min(1, Math.max(0, 0.55 + (body - 0.5) * 0.9 + pitH))
          break
        }
        case 'glass': {
          // Long horizontal cleaning smears + a fine drag bump.
          const smear = fbm(u * 0.08, v * 0.55, s, 3)
          const fine = fbm(u * 1.3, v * 1.3, s + 13, 2)
          hv = 0.72 * smear + 0.28 * fine
          break
        }
        case 'foil': {
          // Crumpled metal: ridged noise (sharp crease lines) + a micro
          // brush so the flat cells still glint unevenly.
          const crumple = fbm(u * 0.3, v * 0.3, s, 3)
          const ridge = 1 - Math.abs(2 * crumple - 1)
          const micro = fbm(u * 2.2, v * 2.2, s + 21, 2)
          hv = Math.min(1, Math.pow(ridge, 1.6) * 0.88 + micro * 0.12)
          break
        }
        case 'rust': {
          // Oxidation blooms over bare steel — raised blotchy patches
          // with a grainy interior.
          const blotch = fbm(u * 0.24, v * 0.24, s, 4)
          const patch = smooth01((blotch - 0.46) / 0.18)
          const grainy = fbm(u * 1.5, v * 1.5, s + 31, 2)
          hv = Math.min(1, patch * (0.42 + 0.58 * grainy))
          break
        }
        case 'dirt': {
          // Grime settling into blotches, plus crisp specks.
          const blotch = fbm(u * 0.28, v * 0.28, s, 4)
          const grime = smooth01((blotch - 0.44) / 0.22)
          const speck = lattice(Math.floor(u * 2.7), Math.floor(v * 2.7), s + 7)
          hv = Math.min(1, grime * grime * 0.9 + (speck < 0.05 ? 0.75 : 0))
          break
        }
        default:
          break // 'grain' renders from its own tile set, never a field
      }
      h[y * tw + x] = hv
    }
  }
  return { h, tw, th }
}

/* ------------------------- custom texture field ------------------------- */

/** The custom texture's field, built from the user's own image: the image
 *  is drawn TILE-REPEATED into the half-res field canvas under the Size /
 *  Move / Rotate transform (tiling, so nudging never runs out of texture),
 *  each pixel's luminance becomes the raw height, and Contrast
 *  multiplies the bumps around mid-gray (0 = a perfectly flat sheet — no
 *  warp at all). One tile cover-fits the frame at Size 1, resolution-
 *  independent. Cached per (image, quantized size/position/rotation/
 *  contrast) so dragging a slider regenerates at most a handful of times;
 *  the generation itself is one half-res drawImage + read, so even a
 *  cache miss is a couple of milliseconds. Returns null while the image
 *  is still decoding (the pass skips that frame — the live preview
 *  repaints every frame, so the texture appears the moment it lands). */
const customCache = new Map<string, TexField>()

function customFieldFor(cfg: TextureFilterConfig, W: number, H: number): TexField | null {
  const src = cfg.customSrc ?? ''
  if (!src) return null
  const img = getBackgroundImage(src)
  if (!img) return null
  // Quantize the transforms into the cache key so dragging a dial
  // regenerates at most a handful of times across its travel.
  const qs = Math.round(Math.min(4, Math.max(0.2, cfg.customSize ?? 1)) * 10) / 10
  const qx = Math.round(Math.min(1, Math.max(-1, cfg.customX ?? 0)) * 50) / 50
  const qy = Math.round(Math.min(1, Math.max(-1, cfg.customY ?? 0)) * 50) / 50
  const qr = Math.round(Math.min(180, Math.max(-180, cfg.customRotate ?? 0)) / 2) * 2
  const qc = Math.round(Math.min(2, Math.max(0, cfg.customContrast ?? 1)) * 10) / 10
  const key = `custom|${img.naturalWidth}x${img.naturalHeight}|${W}|${H}|${qs}|${qx}|${qy}|${qr}|${qc}`
  const hit = customCache.get(key)
  if (hit) return hit
  const tw = Math.max(24, W >> 1)
  const th = Math.max(24, H >> 1)
  const work = getWork('texture:custom', tw, th)
  const g = resetWork(work.getContext('2d', { willReadFrequently: true })!)
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  // Base sizing: one tile cover-fits the frame at Size 1. Then the pivot
  // (frame center + Move nudge), the rotation around that pivot, and the
  // Size zoom — the 'repeat' pattern keeps every combination covered.
  const s0 = Math.max(tw / iw, th / ih) * qs
  g.translate(tw / 2 + qx * tw, th / 2 + qy * th)
  g.rotate((qr * Math.PI) / 180)
  g.scale(s0, s0)
  // Center the tile on the pivot, so Size 1 / unrotated / unmoved shows
  // the image COVER-fitting the frame like a normal background — the
  // tiling only becomes visible when Size shrinks or the image moves.
  g.translate(-iw / 2, -ih / 2)
  const pat = g.createPattern(img, 'repeat')
  if (!pat) return null
  g.fillStyle = pat
  // Fill far enough to cover the rotated + nudged frame from the tile
  // center (worst case 1.5 frame diagonals in image units, plus a ring
  // of margin — the repeat handles everything inside).
  const R = Math.ceil((Math.hypot(tw, th) * 1.5) / s0) + iw + ih
  g.fillRect(-R, -R, 2 * R, 2 * R)
  const d = g.getImageData(0, 0, tw, th).data
  const h = new Float32Array(tw * th)
  const n = tw * th
  for (let i = 0, k = 0; k < n; i += 4, k++) {
    const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
    let hv = 0.5 + (lum - 0.5) * qc
    if (hv < 0) hv = 0
    else if (hv > 1) hv = 1
    h[k] = hv
  }
  const field: TexField = { h, tw, th }
  if (customCache.size > 12) customCache.clear()
  customCache.set(key, field)
  return field
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

  if (type === 'grain') {
    // Film grain — no displacement, no shading: one bilinear wrap read of
    // the frame's noise tile per pixel, overlay-blended at the amount.
    // Overlay with a tile centered on gray 128 is mean-neutral: shadows
    // and highlights push and pull locally, the frame's average holds.
    const ia = 1 - amount
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
    // Material surfaces — displacement IS the effect. The picture is
    // sampled dispAmp·slope pixels away from each pixel, toward the
    // bump: fibers, wrinkles, pits, smears and creases drag the whole
    // image around them while its colors stay its own. ('custom' builds
    // its height field from the user's uploaded texture image — same
    // displacement + mean-zero relief loop underneath.)
    const field = type === 'custom' ? customFieldFor(cfg, W, H) : fieldFor(type, W, H, scale)
    if (!field) return // custom image missing / still decoding — untouched frame
    const { h, tw, th } = field
    // Displacement amplitude in canvas px: the spec's full-slope px
    // scaled to the frame and the amount. Amount 0 → 0 → the exact
    // source picture; amount 1 → the spec's full warp. For 'custom' it
    // is the HEIGHT-shift amplitude instead (Photoshop-Displace style).
    const dispAmp = spec.disp * (minWH / 720) * amount
    const heightShift = type === 'custom'
    // Relief shading rides the amount too and is MEAN-ZERO: the slope
    // terms average ~0 across the surface, so a bump's bright flank is
    // paid for by its far side sinking — local highlights and shadows
    // without moving the image's average brightness (the old tone blend
    // darkened it — gone).
    const shadeK = spec.shade * amount * 2.4
    for (let y = 0; y < H; y++) {
      // Per-row texture indices (half-res, clamped into the field).
      const ty = Math.min(th - 1, y >> 1)
      const ty1 = Math.min(th - 1, ty + 1)
      const tyP = ty > 0 ? ty - 1 : 0
      const hRow = ty * tw
      const hRowN = ty1 * tw
      const hRowP = tyP * tw
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

        // The displacement — sample the picture dispAmp·slope pixels
        // away, toward the bump (clamped to the frame — bumps near the
        // edge just pull the picture, no wrap). 'custom' shifts by the
        // map's own HEIGHT instead (bright pushes one way, dark pulls
        // the other), so smooth uploaded photos warp as hard as
        // hard-edged graphics — their per-texel slope is tiny, their
        // height isn't.
        const dx = heightShift ? (h[hRow + tx] - 0.5) * dispAmp : gx * dispAmp
        const dy = heightShift ? (h[hRowN + tx] - 0.5) * dispAmp : gy * dispAmp
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

        // Relief shading — light from the upper left: a bump's left
        // flank (rising toward the light) brightens, its far side sinks.
        let shd = 1 + shadeK * (gx * 0.55 + gy * 0.7)
        if (shd < 0.35) shd = 0.35
        else if (shd > 1.75) shd = 1.75

        od[i] = sr * shd
        od[i + 1] = sg * shd
        od[i + 2] = sb * shd
        od[i + 3] = 255
      }
    }
  }

  wctx.putImageData(out, 0, 0)
  ctx.drawImage(work, 0, 0)
}
