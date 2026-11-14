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
 *
 * Background-video audio (opt-in): a looping background clip's own sound can
 * be routed into the same graph — attachVideoElement binds the render element
 * with a MediaElementSource into the shared analyser, so the visualizer
 * reacts to the video and the track together and both play through the
 * master gain. Detaching disconnects the bind (created binds are kept per
 * element — an element can only ever be bound once per context).
 */
import type { AudioFrame } from '../visualizer/types'
import {
  FFT_SIZE,
  computeBands,
  resampleSpectrumLog,
  rmsEnergy,
} from './fft'
import { subBandRms } from './subband'

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
  private gain: GainNode | null = null
  private buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null

  /** Background-video audio binds, per media element. Created once per
   *  element (a second createMediaElementSource would throw) and kept so a
   *  re-attach is just a connect(). */
  private videoSources = new Map<HTMLMediaElement, MediaElementAudioSourceNode>()
  /** The currently routed video element (null = video audio off). */
  private videoEl: HTMLMediaElement | null = null

  private trackName = ''
  private trackDuration = 0

  /** Output volume 0..1 (player bar slider). */
  private volume = 1
  /** Loop playback (player bar repeat toggle). */
  private loop = false

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
    styleTime: 0,
    freq: this.outFreq,
    wave: this.outWave,
    energy: 0,
    bass: 0,
    treble: 0,
    sub: 0,
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

  /** Output volume 0..1. Applies immediately (gain node persists). */
  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1)
    if (this.gain) this.gain.gain.value = this.volume
  }

  get getVolume(): number {
    return this.volume
  }

  /** When true, natural end restarts playback from the top. */
  setLoop(loop: boolean): void {
    this.loop = loop
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

  /* --------------------------- Background video audio ----------------------- */

  /**
   * Route a background video element's audio into the engine: the sound is
   * analysed together with the track (the visualizer reacts to both) and
   * plays through the master gain. Unmute the element (`el.muted = false`)
   * before/after calling — a muted element delivers silence to the graph.
   * Safe to call repeatedly with the same element; attaching a different one
   * disconnects the previous bind.
   */
  attachVideoElement(el: HTMLMediaElement): void {
    const ctx = this.ensureContext()
    if (this.videoEl === el) return
    if (this.videoEl) {
      try {
        this.videoSources.get(this.videoEl)?.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    this.videoEl = el
    let bind = this.videoSources.get(el)
    if (!bind) {
      try {
        bind = ctx.createMediaElementSource(el)
      } catch {
        // Element can't feed the graph (unsupported/cross-tainted) — leave
        // everything unrouted; the element keeps its own mute state.
        this.videoEl = null
        return
      }
      this.videoSources.set(el, bind)
    }
    // Duplicate connects are ignored (not an error), the try is belt+braces.
    try {
      bind.connect(this.analyser!)
    } catch {
      /* already connected */
    }
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined)
    }
  }

  /** Unroute the video audio (toggle off / video replaced / mode switch).
   *  The bind stays in the map so a later re-attach is a plain connect. */
  detachVideoElement(): void {
    const el = this.videoEl
    if (!el) return
    try {
      this.videoSources.get(el)?.disconnect()
    } catch {
      /* already disconnected */
    }
    this.videoEl = null
  }

  /** True while the routed video element is actually delivering audio into
   *  the graph (attached, unmuted, playing, decodable). */
  get isVideoAudioLive(): boolean {
    const el = this.videoEl
    return !!el && !el.paused && !el.muted && el.readyState >= 2
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
    // Decorative clock free-runs on the wall clock (playing or paused) so
    // gradient cycling / ambient motion stay alive while styling. Exports
    // use the deterministic offline analyzer instead, where styleTime = time.
    frame.styleTime = performance.now() / 1000

    // Analyze while the track plays OR while routed video audio is live —
    // the analyser hears the mix of whatever is connected (track, video, or
    // both), so the visuals react to the video even with the track paused.
    if ((!this.playing && !this.isVideoAudioLive) || !this.analyser || !this.ctx) {
      frame.freq.fill(0)
      frame.wave.fill(0)
      frame.energy = 0
      frame.bass = 0
      frame.treble = 0
      frame.sub = 0
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
    // Clean kick-listening channel: 30–130 Hz RMS straight off the raw
    // samples — the byte spectrum above is dB-clipped and pins in loud
    // sections, where a kick would move `bass` by exactly zero.
    frame.sub = subBandRms(this.floatTime, this.ctx.sampleRate)
    return frame
  }

  /* --------------------------------- Cleanup -------------------------------- */

  dispose(): void {
    this.stopSource()
    this.endedCallbacks = []
    this.buffer = null
    this.trackDuration = 0
    for (const bind of this.videoSources.values()) {
      try {
        bind.disconnect()
      } catch {
        /* context going away */
      }
    }
    this.videoSources.clear()
    this.videoEl = null
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
    // Analyser → gain → speakers (gain drives the volume slider).
    const gain = ctx.createGain()
    gain.gain.value = this.volume
    analyser.connect(gain)
    gain.connect(ctx.destination)

    this.ctx = ctx
    this.analyser = analyser
    this.gain = gain
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
        if (this.loop) {
          // Repeat: wrap to the top and keep going.
          this.offset = 0
          this.startSource(0)
          return
        }
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
