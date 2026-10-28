/**
 * Offline per-frame audio analysis for the offline exporter.
 *
 * Replicates the live AnalyserNode pipeline (Web Audio spec) so exported
 * frames react to the music exactly like the real-time preview:
 *
 * - Blackman window of `fftSize` samples
 * - radix-2 FFT → per-bin magnitude → dB → byte normalization (-100..-30 dB)
 * - smoothingTimeConstant blending across consecutive frames
 * - time-domain bytes (0..255, 128 = silence)
 * - bass/mid/treble/level band energies with the engine's attack/release curve
 *
 * Unlike the live engine, everything is computed from the decoded PCM at
 * exact sample offsets — no clock, no real time, fully deterministic.
 */

import type { FftSize } from '@/lib/types'

const MIN_DB = -100
const MAX_DB = -30

export class OfflineAnalyzer {
  /** Frequency bins 0..255 (length = fftSize/2) — mirrors engine.freq */
  readonly freq: Uint8Array
  /** Time-domain samples 0..255, 128 = silence (length = fftSize) — mirrors engine.wave */
  readonly wave: Uint8Array

  /** Smoothed normalized band energies 0..1 — mirrors engine.bass/mid/treble/level */
  bass = 0
  mid = 0
  treble = 0
  level = 0

  private readonly mono: Float32Array
  private readonly sampleRate: number
  private readonly fftSize: number
  private readonly smoothing: number
  private readonly re: Float32Array
  private readonly im: Float32Array
  private readonly window: Float32Array
  private readonly prev: Float32Array

  constructor(mono: Float32Array, sampleRate: number, fftSize: FftSize, smoothing: number) {
    this.mono = mono
    this.sampleRate = sampleRate
    this.fftSize = fftSize
    this.smoothing = Math.min(0.95, Math.max(0, smoothing))
    const bins = fftSize >> 1
    this.freq = new Uint8Array(bins)
    this.wave = new Uint8Array(fftSize)
    this.re = new Float32Array(fftSize)
    this.im = new Float32Array(fftSize)
    this.prev = new Float32Array(bins)

    // Blackman window — the exact window the Web Audio spec mandates
    this.window = new Float32Array(fftSize)
    for (let i = 0; i < fftSize; i++) {
      this.window[i] =
        0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1)) +
        0.08 * Math.cos((4 * Math.PI * i) / (fftSize - 1))
    }
  }

  /** Advance the analysis to song position `timeSec`, updating freq/wave/bands.
   *  Uses the last `fftSize` samples ending at the position (the same window
   *  the live AnalyserNode holds when the playhead is at `timeSec`). */
  step(timeSec: number): void {
    const N = this.fftSize
    const end = Math.min(this.mono.length, Math.max(0, Math.floor(timeSec * this.sampleRate)))
    const start = Math.max(0, end - N)

    // Windowed FFT frame (zero-padded before the track starts)
    for (let i = 0; i < N; i++) {
      const s = start + i < end ? this.mono[start + i] : 0
      this.re[i] = s * this.window[i]
      this.im[i] = 0
    }
    this.transform(this.re, this.im)

    const bins = N >> 1
    const norm = N / 4 // full-scale sine ≈ 2.0 → saturates just above MAX_DB
    const scale = 255 / (MAX_DB - MIN_DB)
    const tau = this.smoothing
    for (let k = 0; k < bins; k++) {
      const mag = Math.sqrt(this.re[k] * this.re[k] + this.im[k] * this.im[k]) / norm
      const db = 20 * Math.log10(mag + 1e-12)
      const byte = Math.max(0, Math.min(255, (db - MIN_DB) * scale))
      const sm = tau * this.prev[k] + (1 - tau) * byte
      this.prev[k] = sm
      this.freq[k] = sm
    }

    // Time-domain bytes (same mapping as AnalyserNode.getByteTimeDomainData)
    for (let i = 0; i < N; i++) {
      const s = start + i < end ? this.mono[start + i] : 0
      const v = s < -1 ? -1 : s > 1 ? 1 : s
      this.wave[i] = v * 128 + 128
    }

    // Band energies — same bands and attack/release smoothing as AudioEngine.update()
    const hzPerBin = this.sampleRate / 2 / bins
    const bandAvg = (loHz: number, hiHz: number) => {
      const a = Math.max(0, Math.floor(loHz / hzPerBin))
      const b = Math.min(bins - 1, Math.ceil(hiHz / hzPerBin))
      let sum = 0
      let n = 0
      for (let i = a; i <= b; i++) {
        sum += this.freq[i]
        n++
      }
      return n > 0 ? sum / n / 255 : 0
    }
    const b = bandAvg(20, 250)
    const m = bandAvg(250, 2000)
    const t = bandAvg(2000, 12000)
    const lvl = (b * 1.2 + m + t * 0.6) / 2.8
    const smooth = (cur: number, next: number) =>
      cur + (next - cur) * (next > cur ? 0.45 : 0.16)
    this.bass = smooth(this.bass, b)
    this.mid = smooth(this.mid, m)
    this.treble = smooth(this.treble, t)
    this.level = smooth(this.level, lvl)
  }

  /** In-place iterative radix-2 Cooley–Tukey FFT. */
  private transform(re: Float32Array, im: Float32Array): void {
    const n = re.length
    // Bit-reversal permutation
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
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len
      const wr = Math.cos(ang)
      const wi = Math.sin(ang)
      const half = len >> 1
      for (let i = 0; i < n; i += len) {
        let cwr = 1
        let cwi = 0
        for (let k = 0; k < half; k++) {
          const a = i + k
          const bidx = a + half
          const vr = re[bidx] * cwr - im[bidx] * cwi
          const vi = re[bidx] * cwi + im[bidx] * cwr
          re[bidx] = re[a] - vr
          im[bidx] = im[a] - vi
          re[a] += vr
          im[a] += vi
          const nwr = cwr * wr - cwi * wi
          cwi = cwr * wi + cwi * wr
          cwr = nwr
        }
      }
    }
  }
}

/** Downmix a decoded AudioBuffer to mono (same down-mix the spec applies). */
export function mixToMono(buffer: AudioBuffer): Float32Array {
  const len = buffer.length
  const channels = buffer.numberOfChannels
  if (channels === 1) return buffer.getChannelData(0).slice()
  const out = new Float32Array(len)
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < len; i++) out[i] += data[i]
  }
  for (let i = 0; i < len; i++) out[i] /= channels
  return out
}
