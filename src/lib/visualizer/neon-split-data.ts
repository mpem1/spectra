/**
 * Neon Split — the real effect.app "Neon split" preset data, extracted from
 * the site's own published preset definition and effect shaders (the preset
 * JSON at /api/presets/shared/neon-split plus the decrypted gradient-map /
 * bloom / noise / curves GLSL sources). Every constant here is
 * the preset's own value, not an eyeballed one:
 *
 *   gradient stops   #000000 @0 → #002266 @0.406 → #D55FEC @0.857 → #FFD6FA @1
 *   master curve     (0.1295,0.0357) (0.5625,0.4911) (0.7813,0.7857) (1,1), node opacity 0.54
 *   bloom            threshold 0.1, knee 0.29, intensity 3, factor 0.65, screen blend
 *   noise            strength 1.78, grainSize 0.5, minGrain 0.14, chroma 0.69,
 *                    shadow/mid/highlight weights 0.25/0.4/0.53, speed 0 (static)
 *   split (invert)   Levels [1,0] = full inversion behind a vertical gradient
 *                    mask (center 0.074,-0.094, width 0.3, rotation 90, smooth)
 *
 * The preset's two paper-texture layers are NOT reproduced — they were
 * removed from this port by design choice (they added little to the look).
 */

/* --------------------------- the gradient ramps ---------------------------- */

export type RampStop = { t: number; c: string }

/** 'violet' is the real preset's gradient (verbatim stops). The siblings keep
 *  the exact same stop positions and luminance geometry, recolored. */
export const RAMPS: Record<string, RampStop[]> = {
  violet: [
    { t: 0, c: '#000000' },
    { t: 0.406, c: '#002266' },
    { t: 0.857, c: '#d55fec' },
    { t: 1, c: '#ffd6fa' },
  ],
  uv: [
    { t: 0, c: '#01000a' },
    { t: 0.406, c: '#0b1030' },
    { t: 0.857, c: '#8a45ff' },
    { t: 1, c: '#f4ecff' },
  ],
  acid: [
    { t: 0, c: '#000000' },
    { t: 0.406, c: '#06240f' },
    { t: 0.857, c: '#3fce54' },
    { t: 1, c: '#e8ffc4' },
  ],
  ember: [
    { t: 0, c: '#000000' },
    { t: 0.406, c: '#260607' },
    { t: 0.857, c: '#f57b21' },
    { t: 1, c: '#ffedc9' },
  ],
  ice: [
    { t: 0, c: '#000000' },
    { t: 0.406, c: '#041a2c' },
    { t: 0.857, c: '#4fc3e8' },
    { t: 1, c: '#eafcff' },
  ],
}

/** Ramp CSS for the UI swatches (keep in sync with the section component). */
export function rampCss(ramp: string): string {
  const stops = RAMPS[ramp] ?? RAMPS.violet
  return `linear-gradient(90deg,${stops.map((s) => `${s.c} ${Math.round(s.t * 100)}%`).join(',')})`
}

/* ----------------------------- the master curve ---------------------------- */

/** The preset's master curve points (from the preset JSON's d_curve meta). */
export const CURVE_POINTS: [number, number][] = [
  [0.1295, 0.0357],
  [0.5625, 0.4911],
  [0.7813, 0.7857],
  [1, 1],
]

/** Monotone cubic (Fritsch–Carlson) through the curve points, clamped at the
 *  ends — the standard curve-editor spline. Returns a 256-entry LUT. */
export function buildCurveLut(points: [number, number][]): Float32Array {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const n = xs.length - 1
  const delta: number[] = []
  for (let i = 0; i < n; i++) delta.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]))
  const m = new Array<number>(n + 1)
  m[0] = delta[0]
  m[n] = delta[n - 1]
  for (let i = 1; i < n; i++) m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2
  for (let i = 0; i < n; i++) {
    if (delta[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / delta[i]
    const b = m[i + 1] / delta[i]
    const s = a * a + b * b
    if (s > 9) {
      const tau = 3 / Math.sqrt(s)
      m[i] = tau * a * delta[i]
      m[i + 1] = tau * b * delta[i]
    }
  }
  const lut = new Float32Array(256)
  for (let k = 0; k < 256; k++) {
    const t = k / 255
    if (t <= xs[0]) {
      lut[k] = ys[0]
      continue
    }
    if (t >= xs[n]) {
      lut[k] = ys[n]
      continue
    }
    let i = 0
    while (i < n - 1 && t > xs[i + 1]) i++
    const h = xs[i + 1] - xs[i]
    const u = (t - xs[i]) / h
    const u2 = u * u
    const u3 = u2 * u
    lut[k] =
      (2 * u3 - 3 * u2 + 1) * ys[i] +
      (u3 - 2 * u2 + u) * m[i] * h +
      (-2 * u3 + 3 * u2) * ys[i + 1] +
      (u3 - u2) * m[i + 1] * h
    if (lut[k] < 0) lut[k] = 0
    else if (lut[k] > 1) lut[k] = 1
  }
  return lut
}

/* ------------------------------ LUT textures ------------------------------- */

/** Gradient LUT as RGBA pixels — the preset's stops, linear-interpolated
 *  across 256 entries (how the engine's gradient texture behaves). */
export function gradientLutPixels(ramp: string): Uint8Array {
  const stops = RAMPS[ramp] ?? RAMPS.violet
  const px = new Uint8Array(256 * 4)
  const cols = stops.map((s) => {
    const n = parseInt(s.c.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  })
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let j = 0
    while (j < cols.length - 2 && t > stops[j + 1].t) j++
    const [x0, c0] = [stops[j].t, cols[j]]
    const [x1, c1] = [stops[j + 1].t, cols[j + 1]]
    const f = x1 > x0 ? Math.min(1, Math.max(0, (t - x0) / (x1 - x0))) : 0
    px[i * 4] = Math.round(c0[0] + (c1[0] - c0[0]) * f)
    px[i * 4 + 1] = Math.round(c0[1] + (c1[1] - c0[1]) * f)
    px[i * 4 + 2] = Math.round(c0[2] + (c1[2] - c0[2]) * f)
    px[i * 4 + 3] = 255
  }
  return px
}

/** LUT texture with a scalar curve in the alpha channel (how the engine's
 *  curve / ramp-curve textures sample: .a), RGB left white. */
export function scalarLutPixels(lut: Float32Array): Uint8Array {
  const px = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    px[i * 4] = 255
    px[i * 4 + 1] = 255
    px[i * 4 + 2] = 255
    px[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, lut[i])) * 255)
  }
  return px
}

/* ------------------------------ grain field -------------------------------- */

/**
 * The preset's static film-grain field (grainSpeed 0 — the published preset
 * keeps the grain still), ported 1:1 from the decrypted noise shader: 3-octave
 * value noise on the 1103515245 integer hash, cell = grainSize px, mono↔chroma
 * mixed at the given chroma (the published 0.69) with the shader's fixed
 * chroma offsets. Deterministic — the same field every run, in preview and
 * export.
 */
export function makeGrainField(w: number, h: number, cell: number, chroma = 0.69): Float32Array {
  const field = new Float32Array(w * h * 3)
  const f32 = new Float32Array(1)
  const u32 = new Uint32Array(f32.buffer)
  const hash = (px: number, py: number): number => {
    u32[0] = 0
    f32[0] = px
    let x = u32[0] >>> 0
    u32[0] = 0
    f32[0] = py
    let y = u32[0] >>> 0
    const K = 1103515245
    // 32-bit wrap-around multiply — Math.imul keeps the low 32 bits exact
    x = Math.imul((x >>> 8) ^ y, K) >>> 0
    y = Math.imul((y >>> 8) ^ x, K) >>> 0
    x = Math.imul((x >>> 8) ^ y, K) >>> 0
    y = Math.imul((y >>> 8) ^ x, K) >>> 0
    u32[0] = (x & 0x007fffff) | 0x3f800000
    return f32[0] - 1
  }
  const valueNoise = (px: number, py: number, c: number): number => {
    const gx = px / c
    const gy = py / c
    const ix = Math.floor(gx)
    const iy = Math.floor(gy)
    const fx = gx - ix
    const fy = gy - iy
    const n00 = hash(ix, iy)
    const n10 = hash(ix + 1, iy)
    const n01 = hash(ix, iy + 1)
    const n11 = hash(ix + 1, iy + 1)
    return n00 * (1 - fx) * (1 - fy) + n10 * fx * (1 - fy) + n01 * (1 - fx) * fy + n11 * fx * fy
  }
  const fractal = (px: number, py: number): number => {
    let sum = 0
    let amp = 1
    let freq = 1
    let norm = 0
    for (let o = 0; o < 3; o++) {
      sum += (valueNoise(px, py, cell * freq) * 2 - 1) * amp
      norm += amp
      freq *= 2
      amp *= 0.5
    }
    return sum / norm
  }
  const CHROMA = Math.min(1, Math.max(0, chroma))
  for (let y = 0; y < h; y++) {
    const py = y + 0.5
    for (let x = 0; x < w; x++) {
      const px = x + 0.5
      const n = fractal(px, py)
      const nr = fractal(px + 19.3, py + 37.7)
      const ng = fractal(px + 73.1, py + 11.9)
      const nb = fractal(px + 45.4, py + 62.3)
      const o = (y * w + x) * 3
      field[o] = n * (1 - CHROMA) + nr * CHROMA
      field[o + 1] = n * (1 - CHROMA) + ng * CHROMA
      field[o + 2] = n * (1 - CHROMA) + nb * CHROMA
    }
  }
  return field
}

/* ------------------------------ color spaces ------------------------------- */

/** The noise shader's gamma (pow 2.2) and the bloom's exact sRGB transfer. */
export function linear22Lut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) lut[i] = Math.round(Math.pow(i / 255, 2.2) * 255)
  return lut
}

export function srgb22Lut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) lut[i] = Math.round(Math.pow(i / 255, 1 / 2.2) * 255)
  return lut
}

/** Exact sRGB transfer functions (the bloom shaders' sRGBToLinear). */
export function linearExactLut(): Float32Array {
  const lut = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const c = i / 255
    lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return lut
}

export function srgbExactLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) {
    const c = i
    lut[i] = Math.round(
      (c <= 0.0031308 * 255 ? (c / 255) * 12.92 : 1.055 * Math.pow(c / 255, 1 / 2.4) - 0.055) * 255,
    )
  }
  return lut
}
