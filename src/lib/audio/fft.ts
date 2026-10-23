/**
 * Pulse Studio — audio analysis primitives.
 *
 * A tiny, dependency-free radix-2 iterative FFT plus the shared spectrum
 * helpers used by BOTH the live engine (AnalyserNode path) and the offline
 * deterministic analyzer (own FFT path). Keeping the normalization constants
 * and the log-spaced resampling in one place guarantees that the canvas
 * preview and the exported MP4 look the same.
 */

/** FFT size used everywhere (AnalyserNode.fftSize is set to this too). */
export const FFT_SIZE = 2048

/** Matches the Web Audio AnalyserNode defaults so preview ≈ export. */
export const MIN_DECIBELS = -100
export const MAX_DECIBELS = -30

const TWO_PI = Math.PI * 2

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/* ------------------------------- Hann window -------------------------------- */

const windowCache = new Map<number, Float32Array>()

/**
 * Hann window table for `size` samples (cached — callers may request it every
 * frame). w[n] = 0.5 * (1 - cos(2πn / (size - 1))) — periodic-friendly and
 * cheap; exact variant choice is irrelevant for visualization purposes.
 */
export function hannWindow(size: number): Float32Array {
  if (size < 2) return new Float32Array(Math.max(0, size))
  const cached = windowCache.get(size)
  if (cached) return cached
  const w = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((TWO_PI * i) / (size - 1)))
  }
  windowCache.set(size, w)
  return w
}

/* --------------------------------- FFT core --------------------------------- */

/**
 * In-place iterative radix-2 Cooley–Tukey FFT (decimation in time).
 * `re`/`im` must have the same power-of-two length; both are mutated.
 */
function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length
  if (n < 2 || (n & (n - 1)) !== 0) return

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }

  // Butterfly passes.
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const ang = (-TWO_PI) / len
    const wStepRe = Math.cos(ang)
    const wStepIm = Math.sin(ang)
    for (let base = 0; base < n; base += len) {
      let wRe = 1
      let wIm = 0
      for (let k = 0; k < half; k++) {
        const aIdx = base + k
        const bIdx = aIdx + half
        const bRe = re[bIdx] * wRe - im[bIdx] * wIm
        const bIm = re[bIdx] * wIm + im[bIdx] * wRe
        const aRe = re[aIdx]
        const aIm = im[aIdx]
        re[aIdx] = aRe + bRe
        im[aIdx] = aIm + bIm
        re[bIdx] = aRe - bRe
        im[bIdx] = aIm - bIm
        const nextRe = wRe * wStepRe - wIm * wStepIm
        wIm = wRe * wStepIm + wIm * wStepRe
        wRe = nextRe
      }
    }
  }
}

/**
 * Real-input FFT → magnitude spectrum.
 *
 * `re` holds the (optionally windowed) real samples of length N (power of 2)
 * and is mutated; `im` (length N) must be zeroed by the caller and is mutated;
 * `out` (length N/2) receives |X_k| for bins k = 0..N/2-1. Scratch buffers may
 * be reused across frames to avoid allocations.
 */
export function computeSpectrum(re: Float32Array, im: Float32Array, out: Float32Array): void {
  const n = re.length
  fftInPlace(re, im)
  const half = n >> 1
  for (let k = 0; k < half && k < out.length; k++) {
    out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
  }
}

/* ------------------------------ Normalization ------------------------------- */

/**
 * Map raw FFT magnitudes to the 0..1 unit that the AnalyserNode byte path
 * produces, so the offline renderer matches the live preview:
 * magnitude is scaled by 4/N (compensates the Hann window coherent gain so a
 * full-scale sine lands at 0 dB), converted to dB and normalized into
 * [MIN_DECIBELS, MAX_DECIBELS] → [0, 1].
 */
export function normalizeMagnitudesDb(mags: Float32Array, out: Float32Array): void {
  const half = mags.length
  const scale = 4 / (half * 2) // 1 / (N/4) where N = 2 * half
  const range = MAX_DECIBELS - MIN_DECIBELS
  for (let i = 0; i < half; i++) {
    const db = 20 * Math.log10(Math.max(mags[i] * scale, 1e-8))
    out[i] = clamp01((db - MIN_DECIBELS) / range)
  }
}

/**
 * Resample a normalized (0..1) spectrum onto `barCount` bars using
 * logarithmic frequency mapping — low bars cover few FFT bins, high bars many.
 * Per bar we take the MAX of the covered bins for a punchy look.
 *
 * @param src     normalized spectrum, length = fftSize / 2
 * @param binHz   frequency per bin = sampleRate / fftSize
 * @param barCount number of output bars
 * @param out     output buffer, length >= barCount
 */
export function resampleSpectrumLog(
  src: Float32Array,
  binHz: number,
  barCount: number,
  out: Float32Array,
): void {
  const n = src.length
  if (n === 0 || barCount <= 0) return
  const nyquist = binHz * n
  const minF = 30
  const maxF = Math.min(nyquist, 16000)
  if (maxF <= minF) {
    out.fill(0, 0, barCount)
    return
  }
  const logMin = Math.log(minF)
  const logMax = Math.log(maxF)
  for (let i = 0; i < barCount; i++) {
    const f0 = Math.exp(logMin + (logMax - logMin) * (i / barCount))
    const f1 = Math.exp(logMin + (logMax - logMin) * ((i + 1) / barCount))
    let b0 = Math.floor(f0 / binHz)
    let b1 = Math.ceil(f1 / binHz)
    if (b1 <= b0) b1 = b0 + 1
    if (b0 < 0) b0 = 0
    if (b0 > n - 1) b0 = n - 1
    if (b1 > n) b1 = n
    if (b1 <= b0) b1 = b0 + 1
    let peak = 0
    for (let b = b0; b < b1; b++) {
      if (src[b] > peak) peak = src[b]
    }
    out[i] = peak
  }
}

/* ------------------------------ Frame metrics ------------------------------- */

/** RMS energy (0..1) of a normalized (-1..1) waveform slice. */
export function rmsEnergy(wave: Float32Array): number {
  let sum = 0
  for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i]
  const rms = Math.sqrt(sum / Math.max(1, wave.length))
  return clamp01(rms)
}

/**
 * Band averages over the resampled bar spectrum:
 * bass = first 10% of bars, treble = last 30% of bars.
 * Shared by engine + offline analyzer so both agree on the numbers.
 */
export function computeBands(freq: Float32Array): { bass: number; treble: number } {
  const n = freq.length
  if (n === 0) return { bass: 0, treble: 0 }
  const bassEnd = Math.min(n, Math.max(1, Math.ceil(n * 0.1)))
  const trebleStart = Math.floor(n * 0.7)
  let bassSum = 0
  for (let i = 0; i < bassEnd; i++) bassSum += freq[i]
  let trebleSum = 0
  for (let i = trebleStart; i < n; i++) trebleSum += freq[i]
  return {
    bass: bassSum / bassEnd,
    treble: trebleSum / Math.max(1, n - trebleStart),
  }
}
