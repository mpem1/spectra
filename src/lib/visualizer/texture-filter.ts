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
 * The ninth material is the user's own picture ('custom') — and its pass
 * is a LIGHTING overlay, not a displacement: the map is drawn tiled under
 * the Size / Move X / Move Y / Rotate transforms, its luminance sampled
 * 1:1 at full frame resolution, its BRIGHTER parts lift a small
 * screen-blend highlight into the frame and its DARKER parts sink a small
 * multiply-blend shadow. The neutral point is the map's OWN average
 * luminance, not fixed mid-gray — light is RELATIVE — so an overall-light
 * upload (a bright photo, white artwork) lights from its own average
 * instead of washing the whole frame white, and a uniform image of ANY
 * gray level lights nothing at all. The pass is fully tintable: the
 * highlight and shadow COLORS are user dials (defaults white/black keep
 * it neutral), the two strengths dial the white and the black
 * separately, Contrast shapes the response CURVE (Amount stays the
 * amplitude) so the two do different jobs, and an opt-in WARP switch
 * lets the map's contours also displace the picture (bright bulges out,
 * dark dents in, wide-footprint gradients + smooth bilinear sampling —
 * no per-texel noise, no offset ghost, no blocks). The picture itself is
 * never resampled while the warp is off. See customLightFor below.
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
  // 'custom' is its own LIGHTING pass (the uploaded map adds highlights
  // where it is bright, shadows where it is dark — see customLightFor)
  // and never reaches this table; the zeros are placeholders the Record
  // type requires.
  custom: { disp: 0, shade: 0, feature: 0 },
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
  // 'custom' builds its field from the user's image — no lattice noise,
  // no seed (the Record type just requires the key).
  custom: 0,
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

/* ------------------------- custom texture light map ------------------------- */

/** The custom texture's LIGHT map, built from the user's own image — and
 *  the pass is a lighting overlay, not a displacement: the map's brighter
 *  parts lift a small HIGHLIGHT into the frame (toward the highlight
 *  color), its darker parts sink a small SHADOW (toward the shadow
 *  color). (The earlier contour-warp passes displaced the picture
 *  unconditionally; the user's verdict: it read as noise and a shifted
 *  double-exposure, and the resampling pixelated the frame — so lighting
 *  is the default and the warp is an opt-in switch.)
 *
 *  The image is drawn TILE-REPEATED at FULL frame resolution under the
 *  Size / Move / Rotate transform (tiling, so nudging never runs out of
 *  texture), each frame pixel's luminance stored 0..255, aligned 1:1
 *  with the frame — the highlights and shadows follow the map's own
 *  shapes at native resolution with nothing between them and the
 *  picture. One tile cover-fits the frame at Size 1,
 *  resolution-independent.
 *
 *  NEUTRAL = THE MAP'S OWN MEAN, not mid-gray. The pass measures the
 *  field's average luminance once at build time and the sample loop
 *  reads deviations from THAT: bright is brighter than the map's own
 *  average, dark is darker than it. The fixed-mid-gray version washed
 *  overall-light uploads toward white (every pixel sat far above 0.5 →
 *  the whole frame screened up — the user's "the white still overpowers
 *  the image when overall lighter images are used"); measured against
 *  its own average, a light photo highlights only its brightest parts
 *  and shadows its dimmer ones, and a uniform sheet of ANY gray level
 *  (plain white, plain gray) lights nothing — a flat sheet of light is
 *  not a lighting map. The mean is measured on the RAW field (before
 *  any dial), cached with it, and honors Size/Move/Rotate for free —
 *  cover-fit crops and tile shifts change which pixels are visible and
 *  each cached field carries the mean of exactly those pixels.
 *
 *  Contrast is a response-CURVE shaper on the deviation (the amplitude
 *  dial is Amount — the user reported the old linear multiplier felt
 *  identical to Amount, so Contrast now stretches the curve around the
 *  mean: higher lights more of the mid-tones, lower only the extremes,
 *  0 = flat), and so are the Highlights / Shadows strengths and both
 *  colors — none of them force a rebuild. Cached per (image, quantized
 *  size/position/rotation); a miss is one full-res drawImage + read plus
 *  one half-res blur + gradient pass, a couple of milliseconds on slider
 *  drops. Returns null while the image is still decoding (the pass skips
 *  that frame — the live preview repaints every frame, so the texture
 *  appears the moment it lands). */
interface CustomLightMap {
  /** Per-frame-pixel luminance 0..255, aligned 1:1 with the frame. */
  lum: Uint8Array
  /** The field's own mean luminance 0..1 — the pass's neutral point. */
  mean: number
  /** Half-res X/Y contours of the map for the opt-in warp — the height
   *  RISE over a wide blurred footprint, pre-normalized so soft photos
   *  bend as visibly as hard-edged graphics. Built on every map build so
   *  the warp switch and its strength slider never force a rebuild. */
  gw: Float32Array
  gh: Float32Array
  /** Half-res field dimensions (tw × th texels). */
  tw: number
  th: number
}

const customCache = new Map<string, CustomLightMap>()

/** Content fingerprint for the cache key. The key must NOT distinguish
 *  uploads by dimensions alone: two different pictures of the same
 *  natural size (the overwhelmingly common case) would otherwise share
 *  one cached light map and a replaced texture would keep lighting the
 *  frame like the OLD image. The data URL itself is the identity — its
 *  length plus a sparse char hash separates any two uploads in practice
 *  — but hashing a multi-megabyte string every frame would be rude, so
 *  the token is computed once per src and memoized. */
const customImgToken = new Map<string, string>()

function customTokenFor(src: string): string {
  let t = customImgToken.get(src)
  if (!t) {
    let h = src.length | 0
    const step = Math.max(1, Math.floor(src.length / 97))
    for (let i = 0; i < src.length; i += step) h = (Math.imul(h, 31) + src.charCodeAt(i)) | 0
    t = `${src.length}x${h >>> 0}`
    if (customImgToken.size > 8) customImgToken.clear()
    customImgToken.set(src, t)
  }
  return t
}

/** #rrggbb → channel triple, parsed once per hex (the dials are read
 *  every frame; the memo keeps that free). Falls back to `fb` when the
 *  string is missing or malformed. */
const hexCache = new Map<string, [number, number, number]>()

function hexRgb(hex: string | undefined, fb: [number, number, number]): [number, number, number] {
  const h = (hex ?? '').trim()
  const hit = hexCache.get(h)
  if (hit) return hit
  const m = /^#?([0-9a-fA-F]{6})/.exec(h)
  const out: [number, number, number] = m
    ? [(parseInt(m[1], 16) >> 16) & 255, (parseInt(m[1], 16) >> 8) & 255, parseInt(m[1], 16) & 255]
    : fb
  if (hexCache.size > 32) hexCache.clear()
  hexCache.set(h, out)
  return out
}

/** Separable box blur with clamped edges (sliding-window sum, O(n) in
 *  the radius) — smooths the map's height so the warp's contours come
 *  from broad SHAPES, not per-texel edges (the original warp failure:
 *  1-texel gradients turned every photo into violent noise). */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const win = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = src[row] * (r + 1)
    for (let k = 1; k <= r; k++) acc += src[row + Math.min(w - 1, k)]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win
      const add = src[row + Math.min(w - 1, x + r + 1)]
      const sub = src[row + Math.max(0, x - r)]
      acc += add - sub
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = tmp[x] * (r + 1)
    for (let k = 1; k <= r; k++) acc += tmp[Math.min(h - 1, k) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x]
      const sub = tmp[Math.max(0, y - r) * w + x]
      acc += add - sub
    }
  }
  return out
}

function customLightFor(cfg: TextureFilterConfig, W: number, H: number): CustomLightMap | null {
  const src = cfg.customSrc ?? ''
  if (!src) return null
  const img = getBackgroundImage(src)
  if (!img) return null
  // Quantize the transforms into the cache key so dragging a dial
  // regenerates at most a handful of times across its travel. (Contrast
  // is deliberately NOT in the key — the pass multiplies it in at sample
  // time, so its slider never forces a rebuild.)
  const qs = Math.round(Math.min(4, Math.max(0.2, cfg.customSize ?? 1)) * 10) / 10
  const qx = Math.round(Math.min(1, Math.max(-1, cfg.customX ?? 0)) * 50) / 50
  const qy = Math.round(Math.min(1, Math.max(-1, cfg.customY ?? 0)) * 50) / 50
  const qr = Math.round(Math.min(180, Math.max(-180, cfg.customRotate ?? 0)) / 2) * 2
  const key = `custom|${customTokenFor(src)}|${W}|${H}|${qs}|${qx}|${qy}|${qr}`
  const hit = customCache.get(key)
  if (hit) return hit
  const work = getWork('texture:custom', W, H)
  const g = resetWork(work.getContext('2d', { willReadFrequently: true })!)
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  // Base sizing: one tile cover-fits the frame at Size 1. Then the pivot
  // (frame center + Move nudge), the rotation around that pivot, and the
  // Size zoom — the 'repeat' pattern keeps every combination covered.
  const s0 = Math.max(W / iw, H / ih) * qs
  g.translate(W / 2 + qx * W, H / 2 + qy * H)
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
  const R = Math.ceil((Math.hypot(W, H) * 1.5) / s0) + iw + ih
  g.fillRect(-R, -R, 2 * R, 2 * R)
  const d = g.getImageData(0, 0, W, H).data
  const n = W * H
  const lum = new Uint8Array(n)
  // Raw mean over the same pass that stores the luminances — the pass's
  // neutral point ("bright" = brighter than the map's own average).
  let sum = 0
  for (let i = 0, k = 0; k < n; i += 4, k++) {
    const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) | 0
    lum[k] = l
    sum += l
  }
  // The opt-in warp's contours: half-res height, box-blurred (broad
  // shapes, not texel edges), then the height RISE over a wide footprint
  // stored as the per-texel X/Y gradients, normalized so a smooth photo
  // bends as visibly as a hard-edged graphic (mean |rise| lifted to
  // 0.24, the normalization clamped 1..6 — mostly-flat maps stay flat,
  // hard graphics stay at full strength). Built on EVERY map build so
  // flipping the warp switch or dragging its strength never rebuilds.
  const tw = Math.max(2, W >> 1)
  const th = Math.max(2, H >> 1)
  const hs = new Float32Array(tw * th)
  for (let ty = 0; ty < th; ty++) {
    const y0 = ty << 1
    const y1 = Math.min(H - 1, y0 + 1)
    for (let tx = 0; tx < tw; tx++) {
      const x0 = tx << 1
      const x1 = Math.min(W - 1, x0 + 1)
      hs[ty * tw + tx] =
        (lum[y0 * W + x0] + lum[y0 * W + x1] + lum[y1 * W + x0] + lum[y1 * W + x1]) / (4 * 255)
    }
  }
  // Footprint ≈ 28 frame px at 720p (radius in half-res texels, each of
  // which spans 2 frame px), scaling with the frame like the materials.
  const r = Math.max(1, Math.round((14 * Math.min(W, H)) / 720))
  const blur = boxBlur(hs, tw, th, r)
  const gw = new Float32Array(tw * th)
  const gh = new Float32Array(tw * th)
  let absSum = 0
  for (let ty = 0; ty < th; ty++) {
    const row = ty * tw
    const xr = Math.min(tw - 1, r)
    for (let tx = 0; tx < tw; tx++) {
      const xl = tx < r ? 0 : tx - r
      const xrr = tx + xr > tw - 1 ? tw - 1 : tx + xr
      const yr = ty < r ? 0 : ty - r
      const yrr = ty + r > th - 1 ? th - 1 : ty + r
      const rx = blur[row + xrr] - blur[row + xl]
      const ry = blur[yrr * tw + tx] - blur[yr * tw + tx]
      gw[row + tx] = rx
      gh[row + tx] = ry
      absSum += Math.abs(rx) + Math.abs(ry)
    }
  }
  const norm = Math.min(6, Math.max(1, 0.24 / Math.max(absSum / (tw * th * 2), 1e-4)))
  for (let k = 0; k < gw.length; k++) {
    gw[k] *= norm
    gh[k] *= norm
  }
  const map: CustomLightMap = { lum, mean: sum / (n * 255), gw, gh, tw, th }
  if (customCache.size > 4) customCache.clear()
  customCache.set(key, map)
  return map
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
  } else if (type === 'custom') {
    // The uploaded picture as a LIGHT map — the map's brighter parts
    // lift a small highlight into the frame (toward the highlight
    // COLOR), its darker parts sink a small shadow (toward the shadow
    // COLOR), and the neutral point is the map's OWN average luminance
    // (see customLightFor): light is relative, so an overall-light
    // upload highlights only its brightest parts instead of washing the
    // whole frame white, and a uniform sheet lights nothing at all. An
    // opt-in warp switch additionally lets the map's contours displace
    // the picture (bright bulges out, dark dents in — the material-
    // grade bend, sampled smoothly).
    const light = customLightFor(cfg, W, H)
    if (!light) return // custom image missing / still decoding — untouched frame
    const { lum, mean, gw, gh, tw, th } = light
    // Sample-time dials — plain reads on the deviation and its two
    // directions, so none of them force a light-map rebuild:
    // Contrast shapes the response CURVE (see curve() below — amplitude
    // is Amount's job, the user reported the old linear multiplier felt
    // identical to it); Highlights and Shadows dial the white and the
    // black SEPARATELY (on a light-toned upload the user drops
    // Highlights and keeps the sculpting); the two colors tint each
    // half — defaults white/black reproduce the neutral pass exactly.
    const ck = Math.min(2, Math.max(0, cfg.customContrast ?? 1))
    const hx = Math.min(2, Math.max(0, cfg.customHighlights ?? 1))
    const sx = Math.min(2, Math.max(0, cfg.customShadows ?? 1))
    const hc = hexRgb(cfg.customHighlightColor, [255, 255, 255])
    const sc = hexRgb(cfg.customShadowColor, [0, 0, 0])
    // The response curve: |dev|/0.5 raised to 1/contrast, anchored at
    // the full-scale ±0.5. Contrast 1 = linear (exactly the deviation);
    // 2 stretches the mid-range so more of the map lights up; 0.5
    // compresses it so only the strongest features light; 0 = a flat
    // sheet. It moves the SHAPE of the response, not its size.
    const curve = (dev: number): number => {
      if (ck <= 0.001) return 0
      const a = dev < 0 ? -dev : dev
      let s = Math.pow(a * 2, 1 / ck) * 0.5
      if (s > 0.5) s = 0.5
      return dev < 0 ? -s : s
    }
    // The highlight/shadow ceiling: a map region at the FULL relative
    // deviation (0.5 away from the map's own average) at amount 1 moves
    // the picture ~40% of the way toward the highlight/shadow color —
    // the small, tasteful lighting pass the user described; Amount,
    // Contrast and the strength dials shape it from there.
    const STR = 0.4
    // The optional warp: the contours drag the picture toward the map's
    // high ground (bright bulges out, dark dents in — the same toward-
    // the-bump convention as the procedural materials), 44 reference px
    // at the strength ceiling scaled by the frame and the Amount master.
    const warpAmp =
      cfg.customWarp ? 44 * Math.min(1, Math.max(0, cfg.customWarpStrength ?? 0.35)) * (minWH / 720) * amount : 0
    const warp = warpAmp > 0.01
    if (warp) {
      // Warped path: per pixel, the half-res contour drag (nearest
      // texel, like the materials) pulls a bilinear sample of the
      // picture, and the lighting pass tints it at the map's own
      // position — the surface lights the picture printed on it.
      for (let y = 0; y < H; y++) {
        const lrow = y * W
        const ty = Math.min(th - 1, y >> 1)
        const gRow = ty * tw
        let i = y * W * 4
        for (let x = 0; x < W; x++, i += 4) {
          const tx = Math.min(tw - 1, x >> 1)
          let dx = gw[gRow + tx] * warpAmp
          let dy = gh[gRow + tx] * warpAmp
          if (dx > warpAmp) dx = warpAmp
          else if (dx < -warpAmp) dx = -warpAmp
          if (dy > warpAmp) dy = warpAmp
          else if (dy < -warpAmp) dy = -warpAmp
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
          let sr = src[r00] * w00 + src[r01] * w01 + src[r10] * w10 + src[r11] * w11
          let sg = src[r00 + 1] * w00 + src[r01 + 1] * w01 + src[r10 + 1] * w10 + src[r11 + 1] * w11
          let sb = src[r00 + 2] * w00 + src[r01 + 2] * w01 + src[r10 + 2] * w10 + src[r11 + 2] * w11
          // The map's contrasted deviation from ITS OWN average, curved
          // and dialed by amount: positive = highlight (blend toward
          // the highlight color — light added), negative = shadow
          // (blend toward the shadow color — darkness absorbed).
          const dv = curve(lum[lrow + x] / 255 - mean) * amount
          if (dv > 0) {
            const w = dv * 2 * STR * hx
            sr += (hc[0] - sr) * w
            sg += (hc[1] - sg) * w
            sb += (hc[2] - sb) * w
          } else if (dv < 0) {
            const k = -dv * 2 * STR * sx
            sr += (sc[0] - sr) * k
            sg += (sc[1] - sg) * k
            sb += (sc[2] - sb) * k
          }
          od[i] = sr
          od[i + 1] = sg
          od[i + 2] = sb
          od[i + 3] = 255
        }
      }
    } else {
      // Crisp path — the shipped lighting pass: every pixel adjusted IN
      // PLACE, no resampling (nothing can pixelate the picture), no
      // offset double-exposure, no warp noise.
      for (let y = 0; y < H; y++) {
        const lrow = y * W
        let i = y * W * 4
        for (let x = 0; x < W; x++, i += 4) {
          const dv = curve(lum[lrow + x] / 255 - mean) * amount
          if (dv > 0) {
            const w = dv * 2 * STR * hx
            od[i] = src[i] + (hc[0] - src[i]) * w
            od[i + 1] = src[i + 1] + (hc[1] - src[i + 1]) * w
            od[i + 2] = src[i + 2] + (hc[2] - src[i + 2]) * w
          } else if (dv < 0) {
            const k = -dv * 2 * STR * sx
            od[i] = src[i] + (sc[0] - src[i]) * k
            od[i + 1] = src[i + 1] + (sc[1] - src[i + 1]) * k
            od[i + 2] = src[i + 2] + (sc[2] - src[i + 2]) * k
          } else {
            od[i] = src[i]
            od[i + 1] = src[i + 1]
            od[i + 2] = src[i + 2]
          }
          od[i + 3] = 255
        }
      }
    }
  } else {
    // Material surfaces — displacement IS the effect. The picture is
    // sampled dispAmp·slope pixels away from each pixel, toward the
    // bump: fibers, wrinkles, pits, smears and creases drag the whole
    // image around them while its colors stay its own.
    const field = fieldFor(type, W, H, scale)
    const { h, tw, th } = field
    // Displacement amplitude in canvas px: the spec's full-slope px
    // scaled to the frame and the amount. Amount 0 → 0 → the exact
    // source picture; amount 1 → the spec's full warp.
    const dispAmp = spec.disp * (minWH / 720) * amount
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
        // The surface's slope — the nearest ±1 texel gradient of the
        // height field.
        let gx = h[hRow + tx1] - h[hRow + txP]
        let gy = h[hRowN + tx] - h[hRowP + tx]
        if (gx > 1) gx = 1
        else if (gx < -1) gx = -1
        if (gy > 1) gy = 1
        else if (gy < -1) gy = -1

        // The displacement — sample the picture dispAmp·slope pixels
        // away, toward the bump (clamped to the frame — bumps near the
        // edge just pull the picture, no wrap): fibers push the picture
        // outward like a raised bump, pits pull it inward like a dent.
        const dx = gx * dispAmp
        const dy = gy * dispAmp
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
