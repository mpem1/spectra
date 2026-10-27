/**
 * Pulse Studio — deterministic MP4 export pipeline.
 *
 * Browser-side, fully offline: renders every frame with the pure renderFrame()
 * at the export resolution, encodes H.264 (WebCodecs VideoEncoder) + AAC
 * (AudioEncoder) and muxes both into a single MP4 via mp4-muxer. The audio
 * track is the ORIGINAL loaded audio (mono mixdown duplicated to stereo), so
 * the result is sample-accurate to the source file.
 *
 * Determinism rules:
 *  - OfflineAnalyzer.frame() is called strictly sequentially 0,1,2,… so its
 *    temporal smoothing state advances exactly like the live preview.
 *  - renderFrame() is pure (no Math.random / Date.now / shared state).
 *  - VideoFrame timestamps are derived from the frame index, never the clock.
 *  - requestAnimationFrame is NEVER used (headless-tab safe; export works even
 *    when the preview canvas is unmounted).
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { OfflineAnalyzer } from '../audio/offline'
import { renderFrame } from '../visualizer/renderer'
import { loadBackgroundImage } from '../visualizer/image-cache'
import type {
  ExportProgress,
  ExportQuality,
  ExportResolution,
  ExportSettings,
  StudioConfig,
} from '../visualizer/types'

export interface ExportMP4Options {
  /** Studio configuration to render (visualizer/background/lyrics). */
  config: StudioConfig
  /** Export settings (format/fps/resolution/length) from the store. */
  settings: ExportSettings
  /** Decoded audio buffer from the AudioEngine (get audioBuffer()). */
  audioBuffer: AudioBuffer
  /** Optional progress callback, 0..1 overall with phase + song time. */
  onProgress?: (progress: ExportProgress) => void
  /** Cooperative cancel flag — polled between frames/chunks. */
  signal?: { cancelled: boolean }
  /** Optional non-fatal notice (e.g. "audio skipped — no encoder"). */
  onNotice?: (message: string) => void
}

/** Thrown when opts.signal.cancelled flips true mid-export. */
export class ExportCancelledError extends Error {
  constructor() {
    super('Export cancelled')
    this.name = 'ExportCancelledError'
  }
}

const RESOLUTIONS: Record<ExportResolution, { width: number; height: number }> = {
  '1280x720': { width: 1280, height: 720 },
  '1920x1080': { width: 1920, height: 1080 },
  '1080x1080': { width: 1080, height: 1080 },
  '720x1280': { width: 720, height: 1280 },
}

/**
 * Per-quality bitrate tuning, expressed as bits-per-pixel-per-frame (bpp).
 * Synthetic visualizer content (glow, gradients, saturated neon on dark)
 * compresses poorly at camera-style rates — banding shows up fast — so the
 * factors here are deliberately generous:
 *  - standard ≈ 0.10 bpp: 1080p30 →  6.2 Mbps (small files, still decent)
 *  - high     ≈ 0.20 bpp: 1080p30 → 12.4 Mbps (recommended default)
 *  - max      ≈ 0.35 bpp: 1080p30 → 21.8 Mbps (near transparent)
 * The clamp keeps short/low-res exports from dropping below usable rates and
 * full-length 1080p60 "max" runs from becoming absurdly large.
 */
const QUALITY_PRESETS: Record<ExportQuality, { bpp: number; min: number; max: number }> = {
  standard: { bpp: 0.1, min: 4_000_000, max: 16_000_000 },
  high: { bpp: 0.2, min: 6_000_000, max: 40_000_000 },
  max: { bpp: 0.35, min: 8_000_000, max: 80_000_000 },
}

/**
 * Smallest H.264 High-profile level that legally carries this stream
 * (macroblocks/second limits from Annex A). Encoding 1080p60 while declaring
 * level 4.0 makes strict decoders refuse or degrade the file, so the level is
 * derived from the actual resolution × fps.
 */
function h264LevelHex(width: number, height: number, fps: number): string {
  const macroblocksPerSec = ((width + 15) >> 4) * ((height + 15) >> 4) * fps
  if (macroblocksPerSec <= 245_760) return '28' // level 4.0 — 1080p30 and below
  if (macroblocksPerSec <= 522_240) return '2a' // level 4.2 — up to 1080p60
  return '33' // level 5.1 — headroom beyond
}

/** H.264 High profile configs tried in order, then a constrained-baseline fallback. */
function avcCodecCandidates(width: number, height: number, fps: number): string[] {
  const high = `avc1.6400${h264LevelHex(width, height, fps)}`
  return [high, 'avc1.640033', 'avc1.42001f']
}

/**
 * Rate-control option sets, tried in order. `latencyMode: 'quality'` tells the
 * encoder it is encoding offline (spend more time per frame) and VBR squeezes
 * visibly more quality out of dark, high-contrast content than a fixed rate.
 * Older WebCodecs builds that reject the extra knobs fall back to plain CBR.
 */
type EncoderConfig = VideoEncoderConfig & {
  bitrateMode?: 'constant' | 'variable' | 'quantitative'
}
const RATE_CONTROL_SETS: Array<Partial<EncoderConfig>> = [
  { latencyMode: 'quality', bitrateMode: 'variable' },
  { latencyMode: 'quality' },
  {},
]

/**
 * Audio codec negotiation, tried in order of compatibility:
 *  - AAC (best player support: DaVinci, QuickTime, VLC) — unavailable in some
 *    Chromium builds (headless, some Linux distros) because it is proprietary.
 *  - Opus (royalty-free, widely supported in Chromium) — but Opus only runs at
 *    8/12/16/24/48 kHz, so 44.1 kHz sources must be resampled to 48 kHz.
 * If neither is available the export continues with a silent video track.
 */
type NegotiatedAudio =
  | { kind: 'aac'; sampleRate: number; data: Float32Array }
  | { kind: 'opus'; sampleRate: number; data: Float32Array }
  | { kind: 'silent' }

/** Deterministic linear-interpolation resampler (mono). */
function resampleLinear(src: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate) return src
  const ratio = srcRate / dstRate
  const dstLen = Math.max(1, Math.floor(src.length / ratio))
  const out = new Float32Array(dstLen)
  for (let i = 0; i < dstLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, src.length - 1)
    const frac = pos - i0
    out[i] = src[i0] * (1 - frac) + src[i1] * frac
  }
  return out
}

async function negotiateAudioCodec(
  mono: Float32Array,
  sampleRate: number,
): Promise<NegotiatedAudio> {
  const aacConfig: AudioEncoderConfig = {
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels: 2,
    bitrate: 192_000,
  }
  try {
    const support = await AudioEncoder.isConfigSupported(aacConfig)
    if (support.supported) return { kind: 'aac', sampleRate, data: mono }
  } catch {
    /* fall through to Opus */
  }

  // Opus requires 48 kHz (or lower standard rates) — resample if needed.
  const opusRate = 48_000
  const opusData = resampleLinear(mono, sampleRate, opusRate)
  const opusConfig: AudioEncoderConfig = {
    codec: 'opus',
    sampleRate: opusRate,
    numberOfChannels: 2,
    bitrate: 192_000,
  }
  try {
    const support = await AudioEncoder.isConfigSupported(opusConfig)
    if (support.supported) return { kind: 'opus', sampleRate: opusRate, data: opusData }
  } catch {
    /* fall through to silent video */
  }
  return { kind: 'silent' }
}

/** Microtask-friendly sleep used for backpressure + event-loop yields. */
function sleep(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Renders + encodes the visualizer to a finished MP4 blob.
 * Progress mapping: preparing 0 → rendering 0..0.9 → encoding 0.9..0.97 →
 * muxing 0.97 → done 1.
 */
export async function exportMP4(opts: ExportMP4Options): Promise<Blob> {
  const { config, settings, audioBuffer, onProgress, signal, onNotice } = opts

  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') {
    throw new Error(
      'WebCodecs is not supported in this browser. Use Chrome or Edge for deterministic export.',
    )
  }

  const report = (p: ExportProgress): void => {
    onProgress?.(p)
  }
  const cancelled = (): boolean => signal?.cancelled === true

  report({ phase: 'preparing', progress: 0, time: 0 })

  // A configured background image must be fully decoded before frame 0 so
  // every rendered frame includes it (deterministic output).
  if (config.background.mode === 'image' && config.background.imageSrc) {
    try {
      await loadBackgroundImage(config.background.imageSrc)
    } catch {
      onNotice?.('Background image could not be loaded — exporting with a dark background.')
    }
  }

  const fps = settings.fps
  const analyzer = new OfflineAnalyzer(audioBuffer, fps)

  const previewFrames =
    settings.length === '30s' ? 30 * fps : settings.length === '15s' ? 15 * fps : null
  const totalFrames = Math.min(
    previewFrames === null ? analyzer.totalFrames : Math.ceil(previewFrames),
    analyzer.totalFrames,
  )
  if (totalFrames < 1) {
    throw new Error('Audio buffer is empty — nothing to export.')
  }

  const { width, height } = RESOLUTIONS[settings.resolution]
  const durationSeconds = totalFrames / fps

  // Negotiate the audio codec BEFORE creating the muxer (its config must match
  // the encoded chunks: AAC as-is, Opus resampled to 48 kHz, or video-only).
  const mono = analyzer.monoChannelData
  const audio = mono.length > 0 ? await negotiateAudioCodec(mono, analyzer.sampleRate) : { kind: 'silent' as const }
  if (audio.kind === 'silent') {
    onNotice?.(
      'No supported audio encoder (AAC/Opus) in this browser — exporting a silent video.',
    )
  }

  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    ...(audio.kind !== 'silent'
      ? {
          audio: {
            codec: audio.kind,
            sampleRate: audio.sampleRate,
            numberOfChannels: 2,
          },
        }
      : {}),
    fastStart: 'in-memory',
  })

  /* ------------------------------ video pass ------------------------------ */

  // A detached (never attached to the DOM) canvas: RenderContext requires a
  // CanvasRenderingContext2D, and rendering is invisible to the user anyway.
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) {
    throw new Error('Could not create a 2D canvas context for the export render.')
  }

  // Encoder errors arrive asynchronously — capture and rethrow at await points.
  let failure: Error | null = null
  const fail = (err: DOMException | Error): void => {
    if (!failure) failure = err instanceof Error ? err : new Error(String(err))
  }

  const bitratePreset = QUALITY_PRESETS[settings.quality ?? 'high']
  const requestedBitrate = Math.round(width * height * fps * bitratePreset.bpp)
  const encoderBitrate = Math.min(bitratePreset.max, Math.max(bitratePreset.min, requestedBitrate))
  const keyFrameInterval = Math.max(1, fps * 2) // one keyframe every 2 seconds
  const frameDurationMicros = Math.round(1e6 / fps)

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: fail,
  })

  // Pick the best supported (codec × rate-control) configuration up front via
  // isConfigSupported, so a browser that dislikes VBR/quality-latency still
  // gets the highest bitrate it can encode rather than a failed export.
  let chosenConfig: EncoderConfig | null = null
  for (const codec of avcCodecCandidates(width, height, fps)) {
    for (const rateControl of RATE_CONTROL_SETS) {
      const candidate: EncoderConfig = {
        codec,
        width,
        height,
        bitrate: encoderBitrate,
        framerate: fps,
        avc: { format: 'avc' },
        ...rateControl,
      }
      try {
        const support = await VideoEncoder.isConfigSupported(candidate)
        if (support.supported) {
          chosenConfig = candidate
          break
        }
      } catch {
        /* try the next, simpler configuration */
      }
    }
    if (chosenConfig) break
  }
  if (!chosenConfig) {
    videoEncoder.close()
    throw new Error('No supported H.264 encoder configuration available.')
  }
  videoEncoder.configure(chosenConfig)

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (cancelled()) throw new ExportCancelledError()
      if (failure) throw failure

      // MUST be sequential 0,1,2,… (temporal smoothing state depends on it).
      const frame = analyzer.frame(i, config.visualizer.barCount, config.visualizer.smoothing)

      // Clear first so 'transparent' backgrounds don't bleed the previous
      // frame's pixels; opaque modes repaint everything anyway.
      ctx.clearRect(0, 0, width, height)
      renderFrame({ ctx, width, height, frame: i }, frame, config)

      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1e6) / fps),
        duration: frameDurationMicros,
      })
      try {
        videoEncoder.encode(videoFrame, { keyFrame: i % keyFrameInterval === 0 })
      } finally {
        videoFrame.close()
      }

      // Backpressure: don't let the encode queue grow unbounded.
      while (videoEncoder.encodeQueueSize > 8) {
        if (failure) throw failure
        await sleep(2)
      }

      // Yield to the event loop every ~8 frames so UI + cancel flag stay live.
      if (i % 8 === 7 || i === totalFrames - 1) {
        await sleep()
        report({
          phase: 'rendering',
          progress: ((i + 1) / totalFrames) * 0.9,
          time: (i + 1) / fps,
        })
      }
    }
    if (failure) throw failure
    await videoEncoder.flush()
  } finally {
    if (videoEncoder.state !== 'closed') videoEncoder.close()
  }
  if (failure) throw failure

  /* ------------------------------ audio pass ------------------------------ */

  if (audio.kind !== 'silent') {
    const sampleRate = audio.sampleRate
    const samples = audio.data
    const totalSamples = samples.length

    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: fail,
    })
    audioEncoder.configure({
      codec: audio.kind === 'aac' ? 'mp4a.40.2' : 'opus',
      sampleRate,
      numberOfChannels: 2,
      bitrate: 192_000,
    })

    const CHUNK_FRAMES = 1024
    // Planar stereo scratch: channel planes are packed (ch1 directly after ch0).
    const planar = new Float32Array(CHUNK_FRAMES * 2)

    try {
      for (let offset = 0; offset < totalSamples; offset += CHUNK_FRAMES) {
        if (cancelled()) throw new ExportCancelledError()
        if (failure) throw failure

        const n = Math.min(CHUNK_FRAMES, totalSamples - offset)
        // Duplicate the mixdown onto both stereo planes.
        planar.set(samples.subarray(offset, offset + n), 0)
        planar.set(samples.subarray(offset, offset + n), n)

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: n,
          numberOfChannels: 2,
          timestamp: Math.round((offset / sampleRate) * 1e6),
          data: planar.subarray(0, n * 2),
        })
        try {
          audioEncoder.encode(audioData)
        } finally {
          audioData.close()
        }

        while (audioEncoder.encodeQueueSize > 8) {
          if (failure) throw failure
          await sleep(2)
        }

        const done = Math.min(offset + CHUNK_FRAMES, totalSamples)
        report({
          phase: 'encoding',
          progress: 0.9 + (done / totalSamples) * 0.07,
          time: done / sampleRate,
        })
      }
      if (failure) throw failure
      await audioEncoder.flush()
    } finally {
      if (audioEncoder.state !== 'closed') audioEncoder.close()
    }
    if (failure) throw failure
  }

  /* ------------------------------- finalize ------------------------------- */

  report({ phase: 'muxing', progress: 0.97, time: durationSeconds })
  muxer.finalize()

  const blob = new Blob([target.buffer], { type: 'video/mp4' })
  report({ phase: 'done', progress: 1, time: durationSeconds })
  return blob
}
