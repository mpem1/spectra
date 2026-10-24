/**
 * Pulse Studio — deterministic offline analyzer.
 *
 * Reproduces, frame by frame, exactly what the live preview shows so the MP4
 * exporter can render frame-exact video: mono mixdown → 2048-sample
 * Hann-windowed slice at the frame's sample offset → own FFT → dB
 * normalization (same constants as the AnalyserNode path) → log-spaced bar
 * resampling → analyser-style temporal smoothing.
 */
import type { AudioFrame } from '../visualizer/types'
import {
  FFT_SIZE,
  computeBands,
  computeSpectrum,
  hannWindow,
  normalizeMagnitudesDb,
  resampleSpectrumLog,
  rmsEnergy,
} from './fft'

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export class OfflineAnalyzer {
  /** Mono mixdown (average of all channels), length = audioBuffer.length. */
  private readonly mono: Float32Array
  private readonly rate: number
  private readonly fps: number
  private readonly trackDuration: number

  private readonly window: Float32Array
  private readonly re = new Float32Array(FFT_SIZE)
  private readonly im = new Float32Array(FFT_SIZE)
  private readonly mags = new Float32Array(FFT_SIZE / 2)
  private readonly waveOut = new Float32Array(FFT_SIZE)

  /** Scratch for the current (unsmoothed) bar spectrum, sized on demand. */
  private cur: Float32Array = new Float32Array(1)
  private curBarCount = -1
  /** Previous smoothed bar spectrum (temporal smoothing state). */
  private prev: Float32Array | null = null
  private prevBarCount = -1

  /** Reused output frame — consumers must read it before the next frame() call. */
  private out: AudioFrame = {
    time: 0,
    styleTime: 0,
    freq: new Float32Array(1),
    wave: this.waveOut,
    energy: 0,
    bass: 0,
    treble: 0,
  }

  constructor(audioBuffer: AudioBuffer, fps: number) {
    const channels = audioBuffer.numberOfChannels
    const length = audioBuffer.length
    this.mono = new Float32Array(length)
    for (let c = 0; c < channels; c++) {
      const data = audioBuffer.getChannelData(c)
      for (let i = 0; i < length; i++) this.mono[i] += data[i]
    }
    if (channels > 0) {
      for (let i = 0; i < length; i++) this.mono[i] /= channels
    }
    this.rate = audioBuffer.sampleRate
    this.fps = clamp(fps, 1, 240)
    this.trackDuration = length / this.rate
    this.window = hannWindow(FFT_SIZE)
  }

  /** Song duration in seconds. */
  get duration(): number {
    return this.trackDuration
  }

  /** ceil(duration * fps) — number of frames the exporter must render. */
  get totalFrames(): number {
    return Math.ceil(this.trackDuration * this.fps)
  }

  /** Mono mixdown used for analysis (also handy for audio encoding paths). */
  get monoChannelData(): Float32Array {
    return this.mono
  }

  get sampleRate(): number {
    return this.rate
  }

  get framesPerSecond(): number {
    return this.fps
  }

  /**
   * Analysis for frame `index` (time = index / fps).
   *
   * IMPORTANT: must be called with strictly increasing indices starting at 0
   * (0, 1, 2, …) — the temporal smoothing is a lerp from the previous frame's
   * smoothed spectrum, mirroring AnalyserNode.smoothingTimeConstant. Jumping
   * around breaks that continuity (call resetSmoothing() when seeking).
   *
   * The returned frame aliases internal buffers; render it before advancing.
   */
  frame(index: number, barCount: number, smoothing: number): AudioFrame {
    const bc = Math.max(1, Math.floor(barCount))
    const time = clamp(index / this.fps, 0, this.trackDuration)
    const start = Math.floor(time * this.rate)

    // --- Spectrum: 2048-sample Hann-windowed slice at the frame offset. ---
    this.re.fill(0)
    this.im.fill(0)
    const end = Math.min(start + FFT_SIZE, this.mono.length)
    for (let i = start; i < end; i++) {
      this.re[i - start] = this.mono[i] * this.window[i - start]
    }
    computeSpectrum(this.re, this.im, this.mags)
    normalizeMagnitudesDb(this.mags, this.mags)
    if (this.curBarCount !== bc) {
      this.cur = new Float32Array(bc)
      this.curBarCount = bc
    }
    resampleSpectrumLog(this.mags, this.rate / FFT_SIZE, bc, this.cur)

    // --- Analyser-style temporal smoothing: prev + (cur - prev) * (1 - τ). ---
    const tau = clamp(smoothing, 0, 1)
    if (!this.prev || this.prevBarCount !== bc) {
      this.prev = new Float32Array(bc) // AnalyserNode also starts from silence.
      this.prevBarCount = bc
    }
    const prev = this.prev
    const follow = 1 - tau
    for (let i = 0; i < bc; i++) {
      prev[i] = prev[i] + (this.cur[i] - prev[i]) * follow
    }

    // --- Waveform: raw 2048-sample slice, -1..1 (zero-padded past the end). ---
    this.waveOut.fill(0)
    for (let i = start; i < end; i++) {
      this.waveOut[i - start] = this.mono[i]
    }

    const frame = this.out
    frame.time = time
    // Exports must be deterministic: decorative motion is locked to song time.
    frame.styleTime = time
    if (frame.freq.length !== bc) frame.freq = new Float32Array(bc)
    frame.freq.set(prev)
    frame.energy = rmsEnergy(frame.wave)
    const bands = computeBands(frame.freq)
    frame.bass = bands.bass
    frame.treble = bands.treble
    return frame
  }

  /** Drop the temporal-smoothing state (call after seeking to another frame). */
  resetSmoothing(): void {
    this.prev = null
  }
}
