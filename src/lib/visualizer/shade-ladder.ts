/**
 * Shared "glow shade ladder" — the navy → royal → electric → sky → ice ramp
 * that gives the dither Blue glow palette and the phosphor monitor their
 * bright-cell shading. The canonical ramp is anchored at the default glow
 * blue (#49b6ff): picking any other ink hue-rotates the whole ramp to that
 * hue and scales its saturation to the pick's, so deep or muted inks give
 * deep/muted ramps, near-neutral picks drop the ramp to glowing grays, and
 * the anchor pick itself reproduces the canonical ramp byte-for-byte.
 *
 * Deterministic pure math — same pick, same ramp, every run, so live preview
 * and offline exports agree frame-exactly.
 */

/** Parses #rgb / #rgba / #rrggbb / #rrggbbaa into RGB bytes (null if invalid). */
export function parseHexRGB(css: string): [number, number, number] | null {
  let h = css.trim().replace(/^#/, '')
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6 && h.length !== 8) return null
  if (!/^[0-9a-fA-F]+$/.test(h)) return null
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/** The anchor ink — every custom glow color rotates the ramp away from this
 *  hue, so this exact pick rebuilds the canonical ramp unchanged. */
export const ANCHOR_INK_CSS = '#49b6ff'
export const ANCHOR_INK_RGB: readonly [number, number, number] = [73, 182, 255]

/** The canonical ramp's default paper (near-black navy). */
export const ANCHOR_PAPER_RGB: readonly [number, number, number] = [3, 10, 36]

/** Bright-cell shade ladder stops (luminance → navy → royal → electric →
 *  sky → ice), the canonical ramp shape. With a custom glow color the whole
 *  ramp is hue-rotated to it (see buildShadeLadder). */
const CANON_STOPS: Array<readonly [number, number, number, number]> = [
  [0.0, 10, 30, 82],
  [0.28, 20, 71, 200],
  [0.52, 47, 125, 255],
  [0.74, 108, 196, 255],
  [1.0, 217, 246, 255],
]

const CANON_LUT: Array<readonly [number, number, number]> = (() => {
  const lut: Array<readonly [number, number, number]> = new Array(64)
  for (let k = 0; k < 64; k++) {
    const t = k / 63
    let a = CANON_STOPS[0]
    let b = CANON_STOPS[CANON_STOPS.length - 1]
    for (let s = 0; s < CANON_STOPS.length - 1; s++) {
      if (t >= CANON_STOPS[s][0] && t <= CANON_STOPS[s + 1][0]) {
        a = CANON_STOPS[s]
        b = CANON_STOPS[s + 1]
        break
      }
    }
    const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0])
    lut[k] = [
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f),
      Math.round(a[3] + (b[3] - a[3]) * f),
    ]
  }
  return lut
})()

/* --------------------------------- color math -------------------------------- */

/** RGB → HSL (h in degrees 0..360, s/l in 0..1). */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d > 1e-6) {
    s = Math.min(1, d / (1 - Math.abs(2 * l - 1)))
    if (max === rr) h = 60 * (((gg - bb) / d) % 6)
    else if (max === gg) h = 60 * ((bb - rr) / d + 2)
    else h = 60 * ((rr - gg) / d + 4)
    if (h < 0) h += 360
  }
  return [h, s, l]
}

/** HSL → RGB. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

/** The ink hue/sat the canonical ramp is anchored to (from the default
 *  '#49b6ff' pick, so picking it back gives a pure identity transform). */
const ANCHOR_HSL = rgbToHsl(ANCHOR_INK_RGB[0], ANCHOR_INK_RGB[1], ANCHOR_INK_RGB[2])

export interface ShadeLadder {
  /** Bright-cell shade for each luminance step 0..63. */
  lut: Array<readonly [number, number, number]>
  /** The paper behind the unlit cells. */
  paper: readonly [number, number, number]
}

/** Rebuilt ladders keyed by "ink|paper" — colors change rarely, frames
 *  render 60×/s, so the ramp is only recomputed when the pick changes. */
const ladderCache = new Map<string, ShadeLadder>()

/** One ramp color hue-rotated by `dh` degrees with its saturation scaled. */
function rampColor(
  c: readonly [number, number, number],
  dh: number,
  sat: number,
): [number, number, number] {
  const [h, s, l] = rgbToHsl(c[0], c[1], c[2])
  return hslToRgb(h + dh, Math.min(1, s * sat), l)
}

/** The glow shade ladder for the user's colors: the canonical navy → royal →
 *  electric → sky → ice ramp hue-rotated from the default blue to the picked
 *  ink color, with its saturation scaled to the pick's (clamped, so deep or
 *  muted inks give deeper/muted ramps; near-neutral picks drop the whole ramp
 *  to glowing grays), on the picked paper. Deterministic, and the anchor pick
 *  rebuilds the canonical ramp exactly. */
export function buildShadeLadder(inkCss: string, paperCss: string): ShadeLadder {
  const key = `${inkCss}|${paperCss}`
  const hit = ladderCache.get(key)
  if (hit) return hit
  const inkRGB = parseHexRGB(inkCss) ?? [
    ANCHOR_INK_RGB[0],
    ANCHOR_INK_RGB[1],
    ANCHOR_INK_RGB[2],
  ]
  const paperRGB = parseHexRGB(paperCss) ?? [
    ANCHOR_PAPER_RGB[0],
    ANCHOR_PAPER_RGB[1],
    ANCHOR_PAPER_RGB[2],
  ]
  const [inkH, inkS] = rgbToHsl(inkRGB[0], inkRGB[1], inkRGB[2])
  // Achromatic pick (white/gray/black): no hue to rotate to — desaturate the
  // whole ramp into neutral grays instead of leaving it blue.
  const achromatic = inkS < 0.05
  const dh = achromatic ? 0 : inkH - ANCHOR_HSL[0]
  const sat = achromatic ? 0 : Math.min(1.25, Math.max(0, inkS / ANCHOR_HSL[1]))
  const identity = Math.abs(dh) < 0.01 && Math.abs(sat - 1) < 0.005
  const ladder: ShadeLadder = {
    lut: identity ? CANON_LUT.slice() : CANON_LUT.map((c) => rampColor(c, dh, sat)),
    paper: paperRGB,
  }
  if (ladderCache.size > 12) ladderCache.clear()
  ladderCache.set(key, ladder)
  return ladder
}
