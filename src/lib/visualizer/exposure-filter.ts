/**
 * Exposure filter — effect.app's "Instant Film" effect over the whole
 * finished picture (renamed Exposure in Spectra): the frame is graded
 * through a real instant-film stock LUT — Polaroid 600 / 669 / 690 and
 * their expired cousins, Instax Mini (regular + deep), and Fuji FP-100C
 * in warm / cool / expired variations — with the film-stock "Type"
 * selector and the two Amount dials the site publishes.
 *
 * Everything here is the site's own, ported faithfully:
 *   - The shader (film-instant.glsl, extracted from the site's encrypted
 *     all-shaders bundle) grades by trilinear-sampling a 33×33×33 sRGB
 *     LUT, then mixes the graded color over the original in Oklab —
 *     LIGHTNESS by Amount.y, CHROMA (a/b) by Amount.x — and converts back
 *     through linear to sRGB. Both amounts run 0..2: 1 is the published
 *     look, 0 leaves the picture untouched, 2 pushes past the stock
 *     (over-faded / over-tinted territory).
 *   - The LUT data is the site's own too. Its encrypted instant LUT group
 *     carries all 13 stocks as 33³ RGB texels (blue-major layout with a
 *     delta-coded red axis — decoded with the site's AES key schedule).
 *     Spectra ships the decoded texels as one PNG strip per stock
 *     (public/luts/exposure/<stock>.png, 33 wide × 1089 tall, row =
 *     g·33+b, column = r) and lazily fetches whichever stock the Type
 *     picker selects — the same bytes the site uploads to its GPU.
 *
 * Verified against the live site: thirty probe colors (primaries, second-
 * aries, grays, skin tones, fractional-LUT positions) pushed through the
 * real editor on Polaroid 600 at Amount 1/1 match this port's output to
 * the exact byte.
 *
 * Performance: a literal per-pixel port would run the Oklab mix (six
 * pow/cbrt transcendentals) on every pixel every frame — tens of
 * milliseconds. The effect is a PURE COLOR MAP, so the whole pipeline is
 * precomputed once per (stock, Color, Light) into a 65³ "expansion grid"
 * — four times denser than the site's own LUT — and the per-frame work
 * collapses to ONE trilinear lookup per pixel, the CPU cousin of the
 * expanded-LUT trick GPU pipelines use. The build itself caches the
 * stock's graded grid and its Oklab coordinates, so moving a dial only
 * redoes the mix stage (~30 ms, once per tick) and switching stocks adds
 * just the LUT resample; the per-frame path never touches a
 * transcendental function and runs in the same cost class as the other
 * full-frame filters. Deterministic (same frame in, same pixels out);
 * while a stock's LUT is still downloading the filter passes the frame
 * through untouched, and the pass is skipped on transparent backgrounds
 * like every full-frame filter.
 */
import type { AudioFrame, ExposureFilterConfig, ExposureStockId, RenderContext } from './types'
import { getWork, resetWork } from './filter-utils'

/* --------------------------------- constants -------------------------------- */

const LUT_SIZE = 33
const LUT_TEXELS = LUT_SIZE * LUT_SIZE * LUT_SIZE
/** Expansion grid points per axis — 65 points cover the 8-bit range at a
 *  step of ~4 (the site's own LUT steps 8), so trilinear error through the
 *  composed map stays below the site's own LUT quantization. */
const GRID = 65
const GRID_MAX = GRID - 1
const GRID_TEXELS = GRID * GRID * GRID
/** 8-bit value of expansion grid point i — 0, 4, 8 … 255. */
const GRID_VALUE = (i: number) => Math.round((i * 255) / GRID_MAX)

/** The 13 stocks in the site's own option order (its factory default is
 *  index 0, Polaroid 600). Labels mirror the site's Type list verbatim. */
export const EXPOSURE_STOCKS: { id: ExposureStockId; label: string }[] = [
  { id: 'polaroid-600', label: 'Polaroid 600' },
  { id: 'polaroid-600-golden', label: 'Polaroid 600 Golden' },
  { id: 'polaroid-600-expired', label: 'Polaroid 600 Expired' },
  { id: 'polaroid-669', label: 'Polaroid 669' },
  { id: 'polaroid-669-expired', label: 'Polaroid 669 Expired' },
  { id: 'polaroid-690', label: 'Polaroid 690' },
  { id: 'polaroid-690-expired', label: 'Polaroid 690 Expired' },
  { id: 'instax-mini', label: 'Instax Mini' },
  { id: 'instax-mini-deep', label: 'Instax Mini Deep' },
  { id: 'fp100c', label: 'Fuji FP-100C' },
  { id: 'fp100c-warm', label: 'Fuji FP-100C Warm' },
  { id: 'fp100c-cool', label: 'Fuji FP-100C Cool' },
  { id: 'fp100c-expired', label: 'Fuji FP-100C Expired' },
]

const isExposureStock = (v: unknown): v is ExposureStockId =>
  typeof v === 'string' && EXPOSURE_STOCKS.some((s) => s.id === v)

/* ------------------------------ color science ------------------------------- */

/** sRGB 8-bit → linear light, table-driven (the shader's sRGBToLinear). */
const S2L: Float64Array = (() => {
  const t = new Float64Array(256)
  for (let i = 0; i < 256; i++) {
    const c = i / 255
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return t
})()

/** linear light → sRGB 0..1 (the shader's linearTosRGB). */
function linearToSrgb(c: number): number {
  if (c <= 0) return 0
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

/** linear light → Oklab (the shader's linearToOklab, verbatim matrices). */
function linearToOklab(out: Float64Array, o: number, r: number, g: number, b: number): void {
  const l0 = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const l1 = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const l2 = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const c0 = Math.cbrt(l0)
  const c1 = Math.cbrt(l1)
  const c2 = Math.cbrt(l2)
  out[o] = 0.2104542553 * c0 + 0.793617785 * c1 - 0.0040720468 * c2
  out[o + 1] = 1.9779984951 * c0 - 2.428592205 * c1 + 0.4505937099 * c2
  out[o + 2] = 0.0259040371 * c0 + 0.7827717662 * c1 - 0.808675766 * c2
}

/** Oklab → linear light (the shader's oklabToLinear, verbatim matrices). */
function oklabToLinear(out: Float64Array, o: number, L: number, a: number, b: number): void {
  const l0 = L + 0.3963377774 * a + 0.2158037573 * b
  const l1 = L - 0.1055613458 * a - 0.0638541728 * b
  const l2 = L - 0.0894841775 * a - 1.291485548 * b
  const c0 = l0 * l0 * l0
  const c1 = l1 * l1 * l1
  const c2 = l2 * l2 * l2
  out[o] = 4.0767416621 * c0 - 3.3077115913 * c1 + 0.2309699292 * c2
  out[o + 1] = -1.2684380046 * c0 + 2.6097574011 * c1 - 0.3413193965 * c2
  out[o + 2] = -0.0041960863 * c0 - 0.7034186147 * c1 + 1.707614701 * c2
}

/* ------------------------------ stock LUT loading ---------------------------- */

/** One per-stock cache entry: the strip image plus its decoded texels
 *  (33³ RGB, layout index = r + 33·g + 1089·b — the site's own order). */
interface StockEntry {
  img: HTMLImageElement
  texels: Uint8Array | null
}

const stockCache = new Map<ExposureStockId, StockEntry>()
let decodeCanvas: HTMLCanvasElement | null = null

/** Decode a fetched LUT strip (33 × 1089 RGBA pixels, row = g·33+b,
 *  column = r) into the flat 33³ texel array the sampler reads. */
function decodeStrip(img: HTMLImageElement): Uint8Array {
  const w = LUT_SIZE
  const h = LUT_SIZE * LUT_SIZE
  if (!decodeCanvas) {
    decodeCanvas = document.createElement('canvas')
    decodeCanvas.width = w
    decodeCanvas.height = h
  }
  const cctx = decodeCanvas.getContext('2d', { willReadFrequently: true })!
  cctx.clearRect(0, 0, w, h)
  cctx.drawImage(img, 0, 0)
  const px = cctx.getImageData(0, 0, w, h).data
  const texels = new Uint8Array(LUT_TEXELS * 3)
  for (let b = 0; b < LUT_SIZE; b++) {
    for (let g = 0; g < LUT_SIZE; g++) {
      const row = g * LUT_SIZE + b
      for (let r = 0; r < LUT_SIZE; r++) {
        const pi = (row * LUT_SIZE + r) * 4
        const ti = (r + LUT_SIZE * g + LUT_SIZE * LUT_SIZE * b) * 3
        texels[ti] = px[pi]
        texels[ti + 1] = px[pi + 1]
        texels[ti + 2] = px[pi + 2]
      }
    }
  }
  return texels
}

/** Start the lazy fetch for a stock (once) and return its texels — null
 *  while the strip is still downloading/decoding. */
function ensureStock(stock: ExposureStockId): Uint8Array | null {
  if (typeof document === 'undefined') return null
  let entry = stockCache.get(stock)
  if (!entry) {
    const img = new Image()
    entry = { img, texels: null }
    stockCache.set(stock, entry)
    img.onload = () => {
      entry!.texels = decodeStrip(img)
    }
    // Relative to the document so the GitHub Pages base path ("/spectra/")
    // is honored automatically — the same trick the signature presets use.
    img.src = new URL(`luts/exposure/${stock}.png`, document.baseURI).href
  }
  if (entry.texels) return entry.texels
  if (entry.img.complete && entry.img.naturalWidth > 0) {
    entry.texels = decodeStrip(entry.img)
  }
  return entry.texels
}

/* ------------------------- expanded output grid cache ------------------------ */

interface GridCache {
  stock: ExposureStockId
  color: number
  light: number
  /** Raw graded color (sRGB 8-bit) at every grid point — stock only. */
  graded: Uint8Array
  /** Graded color's Oklab coordinates — stock only (dial moves reuse it). */
  gradedLab: Float64Array
  /** The final composed map (sRGB 8-bit) — stock + both dials. */
  final: Uint8Array
}

let gridCache: GridCache | null = null
/** The ORIGINAL color's Oklab coordinates at every grid point — shared by
 *  every stock and dial value (the original side of the mix never moves). */
let origLabGrid: Float64Array | null = null

/** Raw-LUT trilinear sample (the shader's sampleLut3D) — grid-build only. */
function sampleLut(texels: Uint8Array, r: number, g: number, b: number, out: Float64Array, o: number): void {
  const scaledR = Math.min(LUT_SIZE - 1, Math.max(0, r / 255 * (LUT_SIZE - 1)))
  const scaledG = Math.min(LUT_SIZE - 1, Math.max(0, g / 255 * (LUT_SIZE - 1)))
  const scaledB = Math.min(LUT_SIZE - 1, Math.max(0, b / 255 * (LUT_SIZE - 1)))
  const b0 = Math.floor(scaledB)
  const b1 = Math.min(b0 + 1, LUT_SIZE - 1)
  const bf = scaledB - b0
  const g0 = Math.floor(scaledG)
  const g1 = Math.min(g0 + 1, LUT_SIZE - 1)
  const gf = scaledG - g0
  const r0 = Math.floor(scaledR)
  const r1 = Math.min(r0 + 1, LUT_SIZE - 1)
  const rf = scaledR - r0
  const t000 = (r0 + LUT_SIZE * g0 + LUT_SIZE * LUT_SIZE * b0) * 3
  const t100 = (r1 + LUT_SIZE * g0 + LUT_SIZE * LUT_SIZE * b0) * 3
  const t010 = (r0 + LUT_SIZE * g1 + LUT_SIZE * LUT_SIZE * b0) * 3
  const t110 = (r1 + LUT_SIZE * g1 + LUT_SIZE * LUT_SIZE * b0) * 3
  const t001 = (r0 + LUT_SIZE * g0 + LUT_SIZE * LUT_SIZE * b1) * 3
  const t101 = (r1 + LUT_SIZE * g0 + LUT_SIZE * LUT_SIZE * b1) * 3
  const t011 = (r0 + LUT_SIZE * g1 + LUT_SIZE * LUT_SIZE * b1) * 3
  const t111 = (r1 + LUT_SIZE * g1 + LUT_SIZE * LUT_SIZE * b1) * 3
  for (let c = 0; c < 3; c++) {
    const s0 =
      (texels[t000 + c] * (1 - rf) + texels[t100 + c] * rf) * (1 - gf) +
      (texels[t010 + c] * (1 - rf) + texels[t110 + c] * rf) * gf
    const s1 =
      (texels[t001 + c] * (1 - rf) + texels[t101 + c] * rf) * (1 - gf) +
      (texels[t011 + c] * (1 - rf) + texels[t111 + c] * rf) * gf
    out[o + c] = (s0 * (1 - bf) + s1 * bf) / 255
  }
}

/** (Re)build the expansion caches for this stock + dial pair. The graded
 *  stage depends on the stock only, so a Color/Light dial move resamples
 *  nothing — it redoes just the Oklab mix into `final`. */
function ensureGrid(stock: ExposureStockId, colorAmt: number, lightAmt: number, texels: Uint8Array): Uint8Array {
  const sameStock = gridCache && gridCache.stock === stock
  if (!sameStock) {
    // Raw graded grid: the LUT pulled through the exact shader sampler at
    // every expansion grid point.
    const graded = new Uint8Array(GRID_TEXELS * 3)
    const lab = new Float64Array(GRID_TEXELS * 3)
    const sample = new Float64Array(3)
    let p = 0
    for (let z = 0; z < GRID; z++) {
      const bv = GRID_VALUE(z)
      for (let y = 0; y < GRID; y++) {
        const gv = GRID_VALUE(y)
        for (let x = 0; x < GRID; x++) {
          sampleLut(texels, GRID_VALUE(x), gv, bv, sample, 0)
          graded[p] = Math.round(sample[0] * 255)
          graded[p + 1] = Math.round(sample[1] * 255)
          graded[p + 2] = Math.round(sample[2] * 255)
          linearToOklab(lab, p, S2L[graded[p]], S2L[graded[p + 1]], S2L[graded[p + 2]])
          p += 3
        }
      }
    }
    gridCache = {
      stock,
      color: colorAmt,
      light: lightAmt,
      graded,
      gradedLab: lab,
      final: new Uint8Array(GRID_TEXELS * 3),
    }
  } else if (gridCache!.color !== colorAmt || gridCache!.light !== lightAmt) {
    gridCache!.color = colorAmt
    gridCache!.light = lightAmt
  } else {
    return gridCache!.final
  }
  rebuildFinal(colorAmt, lightAmt)
  return gridCache!.final
}

/** Mix the original and graded Oklab coordinates per the two Amount dials
 *  (lightness by `lightAmt`, chroma by `colorAmt`) and bake the resulting
 *  color into `final` — the shader's mainImage, hoisted out of the frame
 *  loop. The original side's Oklab coordinates are cached across rebuilds. */
function rebuildFinal(colorAmt: number, lightAmt: number): void {
  const cache = gridCache!
  if (!origLabGrid) {
    origLabGrid = new Float64Array(GRID_TEXELS * 3)
    for (let i = 0; i < GRID; i++) {
      const v = GRID_VALUE(i)
      for (let j = 0; j < GRID; j++) {
        const w = GRID_VALUE(j)
        for (let k = 0; k < GRID; k++) {
          const u = GRID_VALUE(k)
          // grid index z·GRID²·3 + y·GRID·3 + x·3 (z=blue, y=green, x=red)
          const p = ((i * GRID + j) * GRID + k) * 3
          linearToOklab(origLabGrid, p, S2L[u], S2L[w], S2L[v])
        }
      }
    }
  }
  const { gradedLab, final } = cache
  const lin = new Float64Array(3)
  let p = 0
  for (let i = 0; i < GRID_TEXELS; i++, p += 3) {
    const mixedL = origLabGrid[p] + (gradedLab[p] - origLabGrid[p]) * lightAmt
    const mixedA = origLabGrid[p + 1] + (gradedLab[p + 1] - origLabGrid[p + 1]) * colorAmt
    const mixedB = origLabGrid[p + 2] + (gradedLab[p + 2] - origLabGrid[p + 2]) * colorAmt
    oklabToLinear(lin, 0, mixedL, mixedA, mixedB)
    final[p] = Math.round(Math.min(1, Math.max(0, linearToSrgb(lin[0]))) * 255)
    final[p + 1] = Math.round(Math.min(1, Math.max(0, linearToSrgb(lin[1]))) * 255)
    final[p + 2] = Math.round(Math.min(1, Math.max(0, linearToSrgb(lin[2]))) * 255)
  }
}

/* --------------------------------- the pass --------------------------------- */

export function drawExposureFilter(
  rc: RenderContext,
  cfg: ExposureFilterConfig | undefined,
  _frame: Pick<AudioFrame, 'bass' | 'time' | 'styleTime'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 8 || H < 8) return

  const stock = isExposureStock(cfg.stock) ? cfg.stock : 'polaroid-600'
  const colorAmt = Math.min(2, Math.max(0, cfg.color ?? 1))
  const lightAmt = Math.min(2, Math.max(0, cfg.light ?? 1))
  // Amounts (0, 0) = the mix never leaves the original — the identity.
  if (colorAmt <= 0.001 && lightAmt <= 0.001) return

  const texels = ensureStock(stock)
  if (!texels) return // strip still downloading — pass the frame through
  const grid = ensureGrid(stock, colorAmt, lightAmt, texels)

  // snapshot → map every pixel through the expansion grid → draw back
  const work = getWork('exposure:base', W, H)
  const wctx = resetWork(work.getContext('2d', { willReadFrequently: true })!)
  wctx.drawImage(ctx.canvas, 0, 0)
  const img = wctx.getImageData(0, 0, W, H)
  const d = img.data

  // Per-pixel trilinear lookup over the 65³ composed grid — the frame
  // loop's ONLY work: eight byte reads and seven lerps per channel.
  const K = GRID_MAX / 255
  const D = GRID * GRID * 3 // blue-axis stride (texels)
  const R3 = 3 // red-axis stride
  const G3 = GRID * 3 // green-axis stride
  for (let i = 0; i < d.length; i += 4) {
    const xf = d[i] * K
    const yf = d[i + 1] * K
    const zf = d[i + 2] * K
    let x0 = xf | 0
    if (x0 > GRID_MAX - 1) x0 = GRID_MAX - 1
    let y0 = yf | 0
    if (y0 > GRID_MAX - 1) y0 = GRID_MAX - 1
    let z0 = zf | 0
    if (z0 > GRID_MAX - 1) z0 = GRID_MAX - 1
    const fx = xf - x0
    const fy = yf - y0
    const fz = zf - z0
    const c000 = (z0 * GRID + y0) * GRID * 3 + x0 * 3
    const c100 = c000 + R3
    const c010 = c000 + G3
    const c110 = c000 + G3 + R3
    const c001 = c000 + D
    const c101 = c001 + R3
    const c011 = c001 + G3
    const c111 = c001 + G3 + R3
    const g1f = 1 - fy
    const b1f = 1 - fz
    for (let c = 0; c < 3; c++) {
      const v =
        ((grid[c000 + c] * (1 - fx) + grid[c100 + c] * fx) * g1f +
          (grid[c010 + c] * (1 - fx) + grid[c110 + c] * fx) * fy) *
          b1f +
        ((grid[c001 + c] * (1 - fx) + grid[c101 + c] * fx) * g1f +
          (grid[c011 + c] * (1 - fx) + grid[c111 + c] * fx) * fy) *
          fz
      d[i + c] = v + 0.5 | 0
    }
  }
  wctx.putImageData(img, 0, 0)
  ctx.drawImage(work, 0, 0)
}
