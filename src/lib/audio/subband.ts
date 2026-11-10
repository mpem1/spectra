/**
 * Spectra — clean sub-band energy for onset detection.
 *
 * The spectrum meters (freq bars / `bass`) are dB-compressed and hard-clipped
 * at −30 dB to match the AnalyserNode's byte mapping — great for visuals, fatal
 * for beat detection: in a loud master the low bins pin at the clip ceiling, so
 * a kick landing in a loud section moves the number by exactly zero and the
 * detector sees a flat line. This helper listens to the RAW samples instead
 * (no dB mapping, no clip ceiling): a light 30–130 Hz band-pass followed by a
 * short-window RMS — a faithful, unsaturated "how hard did the low end just
 * hit" envelope.
 *
 * Pure function of the sample window: the live engine and the offline export
 * analyzer call it with their respective 2048-sample windows, so preview and
 * export agree, and the same frame sequence always yields the same numbers.
 */

const TWO_PI = Math.PI * 2

/** Band edges of the kick-listening channel (Hz). */
const HIGH_HZ = 130
const LOW_HZ = 30

/**
 * RMS energy of the ~30–130 Hz band in `samples`, 0..1-ish (never clipped, but
 * full-scale material lands well under 1).
 *
 * The one-pole pair starts from silence, so the first half of the window is
 * spent warming the filters up and is DISCARDED — the RMS covers the second
 * half only. That keeps a sustained note's window-start transient out of the
 * number (no fake "rise" every frame) at the cost of ~half a window (≈23 ms at
 * 2048 samples) of latency — imperceptible next to the flip's own release.
 */
export function subBandRms(samples: Float32Array, sampleRate: number): number {
  const n = samples.length
  if (n < 16) return 0
  const aHi = 1 - Math.exp((-TWO_PI * HIGH_HZ) / sampleRate)
  const aLo = 1 - Math.exp((-TWO_PI * LOW_HZ) / sampleRate)
  let lpHi = 0
  let lpLo = 0
  const warm = n >> 1
  for (let i = 0; i < warm; i++) {
    const x = samples[i]
    lpHi += (x - lpHi) * aHi
    lpLo += (x - lpLo) * aLo
  }
  let sum = 0
  for (let i = warm; i < n; i++) {
    const x = samples[i]
    lpHi += (x - lpHi) * aHi
    lpLo += (x - lpLo) * aLo
    const band = lpHi - lpLo
    sum += band * band
  }
  const count = n - warm
  return Math.sqrt(sum / Math.max(1, count))
}
