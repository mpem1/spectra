/**
 * Pulse Studio — live playback engine.
 *
 * Wraps an AudioContext + AnalyserNode for browser preview playback and turns
 * the analyser output into the shared `AudioFrame` shape consumed by the
 * renderer. The deterministic offline analyzer (src/lib/audio/offline.ts)
 * reproduces the exact same numbers frame-by-frame for MP4 export.
 *
 * All analysis options (barCount / smoothing) are pushed in from the UI via
 * setAnalysisOptions so the preview reacts to settings changes live.
 */
import type { AudioFrame } from '../visualizer/types'
import {
  FFT_SIZE,
  computeBands,
  resampleSpectrumLog,
  rmsEnergy,
} from './fft'

export interface AudioEngineLoadResult {
  duration: number
  name: string
}

export interface AnalysisOptions {
  barCount: number
  smoothing: number
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export class AudioEngine {
  /** Lazily created on first user gesture (browser autoplay policy). */
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null

  private trackName = ''
  private trackDuration = 0

  /** Buffer position playback started from (or is parked at when paused). */
  private offset = 0
  /** ctx.currentTime captured when the current source started. */
  private startCtxTime = 0
  private playing = false

  private barCount = 64
  private smoothing = 0.7

  private byteFreq = new Uint8Array(FFT_SIZE / 2)
  private normFreq = new Float32Array(FFT_SIZE / 2)
  private floatTime = new Float32Array(FFT_SIZE)
  private outFreq = new Float32Array(this.barCount)
  private outWave = new Float32Array(FFT_SIZE)

  /** Reused frame object — consumers must read it synchronously. */
  private liveFrame: AudioFrame = {
    time: 0,
    freq: this.outFreq,
    wave: this.outWave,
    energy: 0,
    bass: 0,
    treble: 0,
  }

  private endedCallbacks: Array<() => void> = []

  /* --------------------------------- Loading -------------------------------- */

  async loadFile(file: File): Promise<AudioEngineLoadResult> {
    const raw = await file.arrayBuffer()
    const ctx = this.ensureContext()
    const decoded = await ctx.decodeAudioData(raw)

    this.stopSource()
    this.buffer = decoded
    this.trackName = file.name
    this.trackDuration = decoded.duration
    this.offset = 0
    this.playing = false
    return { duration: decoded.duration, name: file.name }
  }

  get audioBuffer(): AudioBuffer | null {
    return this.buffer
  }

  /* -------------------------------- Transport ------------------------------- */

  play(): void {
    if (!this.buffer) return
    const ctx = this.ensureContext()
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined)
    }
    if (this.playing) return
    // Restart from the top after a natural end.
    if (this.offset >= this.trackDuration - 1e-3) this.offset = 0
    this.startSource(this.offset)
  }

  pause(): void {
    if (!this.playing) return
    this.offset = this.currentTime
    this.stopSource()
  }

  /** Recreates the source node at the new position; keeps playing if playing. */
  seek(t: number): void {
    const target = clamp(t, 0, this.trackDuration || 0)
    if (this.playing) {
      this.startSource(target)
    } else {
      this.offset = target
    }
  }

  stop(): void {
    this.stopSource()
    this.offset = 0
  }

  /** Fire `cb` when the source reaches the end naturally (not on pause/stop). */
  onEnded(cb: () => void): void {
    if (!this.endedCallbacks.includes(cb)) this.endedCallbacks.push(cb)
  }

  /* --------------------------------- Getters -------------------------------- */

  get currentTime(): number {
    let t: number
    if (this.playing && this.ctx) {
      t = this.offset + (this.ctx.currentTime - this.startCtxTime)
    } else {
      t = this.offset
    }
    if (this.trackDuration > 0) t = Math.min(t, this.trackDuration)
    return Math.max(0, t)
  }

  get isPlaying(): boolean {
    return this.playing
  }

  get isLoaded(): boolean {
    return this.buffer !== null
  }

  get duration(): number {
    return this.trackDuration
  }

  get name(): string {
    return this.trackName
  }

  /* -------------------------------- Analysis -------------------------------- */

  setAnalysisOptions(opts: Partial<AnalysisOptions>): void {
    if (typeof opts.barCount === 'number' && Number.isFinite(opts.barCount) && opts.barCount >= 1) {
      this.barCount = Math.floor(opts.barCount)
      this.outFreq = new Float32Array(this.barCount)
      this.liveFrame.freq = this.outFreq
    }
    if (typeof opts.smoothing === 'number' && Number.isFinite(opts.smoothing)) {
      this.smoothing = clamp(opts.smoothing, 0, 1)
      if (this.analyser) this.analyser.smoothingTimeConstant = this.smoothing
    }
  }

  /**
   * Current analysis snapshot. Never throws; when nothing is playing it still
   * returns a valid frame (zeros + current transport time). The returned
   * object is reused between calls — read it synchronously.
   */
  getLiveFrame(): AudioFrame {
    const frame = this.liveFrame
    frame.time = this.currentTime

    if (!this.playing || !this.analyser || !this.ctx) {
      frame.freq.fill(0)
      frame.wave.fill(0)
      frame.energy = 0
      frame.bass = 0
      frame.treble = 0
      return frame
    }

    const analyser = this.analyser
    analyser.getByteFrequencyData(this.byteFreq)
    analyser.getFloatTimeDomainData(this.floatTime)

    for (let i = 0; i < this.byteFreq.length; i++) {
      this.normFreq[i] = this.byteFreq[i] / 255
    }
    resampleSpectrumLog(this.normFreq, this.ctx.sampleRate / FFT_SIZE, this.barCount, frame.freq)

    frame.wave.set(this.floatTime.subarray(0, frame.wave.length))
    frame.energy = rmsEnergy(frame.wave)
    const bands = computeBands(frame.freq)
    frame.bass = bands.bass
    frame.treble = bands.treble
    return frame
  }

  /* --------------------------------- Cleanup -------------------------------- */

  dispose(): void {
    this.stopSource()
    this.endedCallbacks = []
    this.buffer = null
    this.trackDuration = 0
    if (this.ctx) {
      const ctx = this.ctx
      this.ctx = null
      this.analyser = null
      void ctx.close().catch(() => undefined)
    }
  }

  /* -------------------------------- Internals ------------------------------- */

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx
    const Ctor: typeof AudioContext | undefined =
      typeof window !== 'undefined'
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined
    if (!Ctor) throw new Error('Web Audio API is not supported in this environment')

    const ctx = new Ctor()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = FFT_SIZE
    analyser.smoothingTimeConstant = clamp(this.smoothing, 0, 1)
    // Analyser passes audio through to the speakers.
    analyser.connect(ctx.destination)

    this.ctx = ctx
    this.analyser = analyser
    this.byteFreq = new Uint8Array(analyser.frequencyBinCount)
    this.normFreq = new Float32Array(analyser.frequencyBinCount)
    this.floatTime = new Float32Array(analyser.fftSize)
    return ctx
  }

  private startSource(offset: number): void {
    if (!this.buffer || !this.ctx || !this.analyser) return
    this.stopSource()

    const src = this.ctx.createBufferSource()
    src.buffer = this.buffer
    src.connect(this.analyser)
    src.onended = () => {
      // Natural end only — manual stops clear `this.source` first.
      if (this.source === src && this.playing) {
        this.source = null
        this.playing = false
        this.offset = this.trackDuration
        this.fireEnded()
      }
    }
    src.start(0, clamp(offset, 0, this.trackDuration))

    this.source = src
    this.startCtxTime = this.ctx.currentTime
    this.offset = offset
    this.playing = true
  }

  private stopSource(): void {
    if (this.source) {
      const src = this.source
      this.source = null
      src.onended = null
      try {
        src.stop()
      } catch {
        // Already stopped — nothing to do.
      }
      src.disconnect()
    }
    this.playing = false
  }

  private fireEnded(): void {
    const cbs = this.endedCallbacks
    for (let i = 0; i < cbs.length; i++) {
      try {
        cbs[i]()
      } catch {
        // Listener errors must not break the engine.
      }
    }
  }
}
