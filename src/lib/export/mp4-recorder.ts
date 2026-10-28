/**
 * Direct-to-MP4 canvas recording via the WebCodecs API.
 *
 * Why this exists: `canvas.captureStream()` only feeds MediaRecorder, which
 * produces WebM (VP8/VP9) — a container DaVinci Resolve, Premiere and most
 * NLEs cannot import, forcing a conversion step (server ffmpeg or slow wasm).
 * This recorder instead encodes H.264 video (hardware-accelerated where
 * available) plus AAC audio straight from the live canvas and audio graph,
 * and muxes a real MP4 in the page with mp4-muxer. The result drops directly
 * into DaVinci Resolve — no conversion ever needed, nothing leaves the device.
 *
 * Timing: frames arrive from the rAF render loop via the frame sink
 * (frame-sink.ts) and are gated to a constant frame rate. Video timestamps
 * derive from the frame index (clean CFR that NLEs interpret correctly);
 * audio timestamps accumulate from the ScriptProcessor tap's sample count,
 * so both tracks stay sample-accurate with respect to real playback time.
 *
 * Browser support: Chrome/Edge 94+, Firefox 130+, Safari 16.4+. When
 * `VideoEncoder` is missing the app falls back to the WebM MediaRecorder path.
 */

import { ArrayBufferTarget, Muxer, type MuxerOptions } from 'mp4-muxer'

export interface Mp4RecorderOptions {
  /** Constant output frame rate (typically 30) */
  fps: number
  /** Canvas backing-store dimensions (H.264 requires even numbers) */
  width: number
  height: number
  /** AudioContext sample rate for the AAC track */
  sampleRate: number
}

export interface Mp4StartResult {
  started: boolean
  audio: boolean
  codec: string | null
  reason?: string
}

export interface Mp4FinishResult {
  blob: Blob | null
  frames: number
  audio: boolean
  droppedFrames: number
  /** True when the canvas dimensions changed mid-recording (those frames were skipped) */
  sizeMismatch: boolean
  error?: string
}

/** AVC profile/level candidates, probed in order with `isConfigSupported`.
 *  Level 5.2 covers every canvas size the editor can produce at 60fps. */
const AVC_CANDIDATES = [
  'avc1.640034', // High 5.2
  'avc1.640033', // High 5.1
  'avc1.64002a', // High 4.2
  'avc1.640029', // High 4.1
  'avc1.640028', // High 4.0
  'avc1.4d0034', // Main 5.2
  'avc1.4d0028', // Main 4.0
  'avc1.42e034', // Baseline 5.2
  'avc1.42e028', // Baseline 4.0
]

const AAC_BITRATE = 192_000

export class Mp4CanvasRecorder {
  static get supported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof (window as { VideoEncoder?: unknown }).VideoEncoder === 'function'
    )
  }

  private muxer: Muxer<ArrayBufferTarget> | null = null
  private videoEncoder: VideoEncoder | null = null
  private audioEncoder: AudioEncoder | null = null

  private readonly fps: number
  private readonly frameDurMs: number
  private readonly frameDurUs: number
  private readonly sampleRate: number
  private readonly width: number
  private readonly height: number
  private readonly bitrate: number

  private startedAtMs = 0
  private nextFrameMs = 0
  private frameIndex = 0
  private audioFrames = 0
  private droppedFrames = 0
  private sizeMismatch = false
  private encoderError: string | null = null
  private finished = false
  private codec: string | null = null

  constructor(opts: Mp4RecorderOptions) {
    this.fps = Math.max(1, Math.min(60, Math.round(opts.fps)))
    this.frameDurMs = 1000 / this.fps
    this.frameDurUs = 1e6 / this.fps
    this.sampleRate = opts.sampleRate
    // H.264 yuv420p requires even dimensions
    this.width = opts.width - (opts.width % 2)
    this.height = opts.height - (opts.height % 2)
    // Scale bitrate with pixel rate, clamped to sane TV/streaming quality
    this.bitrate = Math.min(
      24_000_000,
      Math.max(6_000_000, Math.round(this.width * this.height * this.fps * 0.2))
    )
  }

  get frames(): number {
    return this.frameIndex
  }

  get hasAudio(): boolean {
    return this.audioEncoder !== null
  }

  /** Configure the muxer + encoders. `withAudio` is true when the engine's
   *  audio tap is live. Returns whether an H.264 encoder could be set up. */
  async start(withAudio: boolean): Promise<Mp4StartResult> {
    if (this.muxer) {
      return { started: true, audio: this.audioEncoder !== null, codec: this.codec }
    }
    if (!Mp4CanvasRecorder.supported) {
      return {
        started: false,
        audio: false,
        codec: null,
        reason: 'This browser has no WebCodecs VideoEncoder (try Chrome, Edge, Firefox 130+ or Safari 16.4+).',
      }
    }

    let codec: string | null = null
    for (const candidate of AVC_CANDIDATES) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec: candidate,
          width: this.width,
          height: this.height,
          bitrate: this.bitrate,
          framerate: this.fps,
          avc: { format: 'avc' },
          latencyMode: 'realtime',
        })
        if (support.supported) {
          codec = candidate
          break
        }
      } catch {
        /* probe next candidate */
      }
    }
    if (!codec) {
      return {
        started: false,
        audio: false,
        codec: null,
        reason: 'No H.264 encoder is available in this browser — use the WebM recording and the Convert dialog instead.',
      }
    }
    this.codec = codec

    // Probe AAC; a missing encoder degrades to a silent (video-only) MP4
    let useAudio = false
    if (withAudio && typeof window.AudioEncoder === 'function' && typeof window.AudioData === 'function') {
      try {
        const support = await AudioEncoder.isConfigSupported({
          codec: 'mp4a.40.2',
          sampleRate: this.sampleRate,
          numberOfChannels: 2,
          bitrate: AAC_BITRATE,
        })
        useAudio = !!support.supported
      } catch {
        useAudio = false
      }
    }

    const muxerOptions: MuxerOptions<ArrayBufferTarget> = {
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: this.width, height: this.height, frameRate: this.fps },
      fastStart: 'in-memory',
    }
    if (useAudio) {
      muxerOptions.audio = { codec: 'aac', sampleRate: this.sampleRate, numberOfChannels: 2 }
    }
    this.muxer = new Muxer(muxerOptions)

    this.videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        this.muxer?.addVideoChunk(chunk, meta)
      },
      error: (err) => {
        this.encoderError = err instanceof Error ? err.message : String(err)
      },
    })
    this.videoEncoder.configure({
      codec,
      width: this.width,
      height: this.height,
      bitrate: this.bitrate,
      framerate: this.fps,
      avc: { format: 'avc' },
      latencyMode: 'realtime',
    })

    if (useAudio) {
      this.audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
          this.muxer?.addAudioChunk(chunk, meta)
        },
        error: (err) => {
          this.encoderError = err instanceof Error ? err.message : String(err)
        },
      })
      this.audioEncoder.configure({
        codec: 'mp4a.40.2',
        sampleRate: this.sampleRate,
        numberOfChannels: 2,
        bitrate: AAC_BITRATE,
      })
    }

    return { started: true, audio: useAudio, codec }
  }

  /** Called once per rendered frame from the render loop. Gates to CFR and
   *  encodes one VideoFrame per elapsed frame slot (duplicates on stall). */
  handleFrame(canvas: HTMLCanvasElement, nowMs: number): void {
    const enc = this.videoEncoder
    if (!enc || enc.state !== 'configured' || this.finished) return
    if (canvas.width !== this.width || canvas.height !== this.height) {
      // Aspect switched mid-recording — the encoder config is fixed, skip
      this.sizeMismatch = true
      return
    }
    if (!this.startedAtMs) this.startedAtMs = nowMs
    const elapsed = nowMs - this.startedAtMs

    let due = 0
    while (this.nextFrameMs <= elapsed) {
      this.nextFrameMs += this.frameDurMs
      due++
    }
    if (due <= 0) return

    // rAF stalled (hidden tab): keep timestamps continuous with real time so
    // audio stays in sync, but cap how many duplicate frames get encoded
    if (due > this.fps) {
      this.frameIndex += due - this.fps
      this.droppedFrames += due - this.fps
      due = this.fps
    }
    // Backpressure valve for pathological software encoders
    if (enc.encodeQueueSize > 10) {
      this.frameIndex += due
      this.droppedFrames += due
      return
    }

    for (let i = 0; i < due; i++) {
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(this.frameIndex * this.frameDurUs),
        duration: Math.round(this.frameDurUs),
      })
      enc.encode(frame, { keyFrame: this.frameIndex % (this.fps * 2) === 0 })
      frame.close()
      this.frameIndex++
    }
  }

  /** Feed one stereo PCM block from the engine's audio tap (planar f32). */
  audioChunk(ch0: Float32Array, ch1: Float32Array): void {
    const enc = this.audioEncoder
    if (!enc || enc.state !== 'configured' || this.finished) return
    const n = Math.min(ch0.length, ch1.length)
    if (n <= 0) return
    const planar = new Float32Array(n * 2)
    planar.set(ch0.subarray(0, n), 0)
    planar.set(ch1.subarray(0, n), n)
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate: this.sampleRate,
      numberOfFrames: n,
      numberOfChannels: 2,
      timestamp: Math.round((this.audioFrames * 1e6) / this.sampleRate),
      data: planar,
    })
    this.audioFrames += n
    enc.encode(data)
    data.close()
  }

  /** Flush encoders, finalize the MP4 and return the muxed file. */
  async finish(): Promise<Mp4FinishResult> {
    const muxer = this.muxer
    const video = this.videoEncoder
    const audio = this.audioEncoder
    const base = {
      frames: this.frameIndex,
      audio: audio !== null,
      droppedFrames: this.droppedFrames,
      sizeMismatch: this.sizeMismatch,
    }
    if (this.finished || !muxer || !video) {
      return { blob: null, ...base, error: this.encoderError ?? 'Recorder was not started.' }
    }
    this.finished = true

    try {
      if (video.state === 'configured') await video.flush()
    } catch {
      /* finalize whatever was encoded */
    }
    try {
      video.close()
    } catch {
      /* already closed */
    }
    if (audio) {
      try {
        if (audio.state === 'configured') await audio.flush()
      } catch {
        /* finalize whatever was encoded */
      }
      try {
        audio.close()
      } catch {
        /* already closed */
      }
    }

    if (this.encoderError) {
      return { blob: null, ...base, error: `Encoder error: ${this.encoderError}` }
    }
    try {
      muxer.finalize()
      const { buffer } = muxer.target
      const blob = new Blob([buffer], { type: 'video/mp4' })
      return { blob: blob.size > 0 ? blob : null, ...base, error: blob.size > 0 ? undefined : 'Nothing was encoded.' }
    } catch (err) {
      return {
        blob: null,
        ...base,
        error: err instanceof Error ? err.message : 'Failed to finalize the MP4.',
      }
    }
  }

  /** Abort without producing a file. */
  cancel(): void {
    this.finished = true
    try {
      this.videoEncoder?.close()
    } catch {
      /* already closed */
    }
    try {
      this.audioEncoder?.close()
    } catch {
      /* already closed */
    }
    this.videoEncoder = null
    this.audioEncoder = null
    this.muxer = null
  }
}
