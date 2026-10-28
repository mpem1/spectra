/**
 * OFFLINE video export — the definitive fix for clicks and audio drift.
 *
 * Real-time recording (MediaRecorder or the live-tapped MP4 recorder) derives
 * video timestamps from the wall clock and audio from the audio hardware
 * clock; main-thread stalls during encoding also starve the live audio tap.
 * The result: clicks, and audio that slowly drifts against the original song
 * when dropped into an NLE next to it.
 *
 * This exporter removes real time from the equation entirely:
 *
 * 1. The ORIGINAL audio file is decoded once (`decodeAudioData`) — its exact
 *    PCM is the single timeline everything else is derived from.
 * 2. Every visual frame i is rendered deterministically at song position
 *    startSec + i/fps (analysis computed from PCM slices, not a live node).
 * 3. Video timestamps are frameIndex × 1e6/fps — perfect constant frame rate.
 * 4. The audio track is encoded straight from the original PCM slices with
 *    sample-accurate timestamps (AAC, falling back to Opus).
 * 5. Both tracks are muxed into one MP4 (mp4-muxer).
 *
 * Sync is therefore exact BY CONSTRUCTION: video frame N and audio sample
 * N/fps×sr share the same timestamp origin, and nothing depends on how busy
 * the main thread is. It also renders faster than real time and works in
 * background tabs (MessageChannel yielding is never timer-throttled).
 */

import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import type { LyricsState, VisualizerConfig } from '@/lib/types'
import { createVisualizer } from '@/lib/audio/visualizers'
import {
  AfterglowLayer,
  SceneImages,
  drawSceneBackground,
  drawSceneOverlays,
} from '@/lib/render/scene'
import { OfflineAnalyzer, mixToMono } from './offline-analyzer'

/** Thrown when the user cancels — callers catch and treat as a normal exit. */
export class ExportCancelledError extends Error {
  constructor() {
    super('Export cancelled')
    this.name = 'ExportCancelledError'
  }
}

/** AVC profile/level candidates, probed in order with `isConfigSupported`.
 *  (Mirrors the ladder in mp4-recorder.ts — kept local so the live recorder
 *  pipeline stays untouched.) */
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
const AUDIO_CODEC_AAC = 'mp4a.40.2'
const AUDIO_CODEC_OPUS = 'opus'

export interface OfflineExportOptions {
  /** The ORIGINAL audio file (the same one loaded into the editor) */
  audioFile: Blob
  config: VisualizerConfig
  lyrics: LyricsState
  width: number
  height: number
  fps: number
  bitrate: number
  /** Song range to render, in seconds (clamped to the decoded audio) */
  startSec: number
  endSec: number
  includeAudio: boolean
  onProgress: (pct: number, label: string) => void
  /** Mutable cancel flag — checked before every frame */
  cancelToken: { cancelled: boolean }
}

export interface OfflineExportResult {
  blob: Blob
  frames: number
  durationSec: number
  width: number
  height: number
  fps: number
  /** Whether an audio track was muxed in */
  audio: boolean
  audioCodec: 'aac' | 'opus' | null
  videoCodec: string
}

function getVideoEncoderCtor(): typeof VideoEncoder | null {
  if (typeof window === 'undefined') return null
  const ctor = (window as unknown as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder
  return typeof ctor === 'function' ? ctor : null
}

function getAudioEncoderCtor(): typeof AudioEncoder | null {
  if (typeof window === 'undefined') return null
  const ctor = (window as unknown as { AudioEncoder?: typeof AudioEncoder }).AudioEncoder
  return typeof ctor === 'function' ? ctor : null
}

async function probeVideoEncoder(
  width: number,
  height: number,
  fps: number,
  bitrate: number
): Promise<string | null> {
  const ctor = getVideoEncoderCtor()
  if (!ctor) return null
  for (const codec of AVC_CANDIDATES) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
        avc: { format: 'avc' },
        latencyMode: 'quality',
      })
      if (support.supported) return codec
    } catch {
      /* probe next candidate */
    }
  }
  return null
}

/** AAC when the platform provides it, otherwise Opus (Chrome always has one of the two). */
async function probeAudioEncoder(sampleRate: number): Promise<'aac' | 'opus' | null> {
  const ctor = getAudioEncoderCtor()
  if (!ctor) return null
  for (const codec of [AUDIO_CODEC_AAC, AUDIO_CODEC_OPUS] as const) {
    try {
      const support = await AudioEncoder.isConfigSupported({
        codec,
        sampleRate,
        numberOfChannels: 2,
        bitrate: AAC_BITRATE,
      })
      if (support.supported) return codec === AUDIO_CODEC_AAC ? 'aac' : 'opus'
    } catch {
      /* probe next candidate */
    }
  }
  return null
}

/** Yield to the event loop via MessageChannel — NOT throttled in background
 *  tabs (unlike setTimeout), so exports keep running while the tab is hidden. */
function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === 'function') {
      const chan = new MessageChannel()
      chan.port1.onmessage = () => {
        chan.port1.close()
        chan.port2.close()
        resolve()
      }
      chan.port2.postMessage(null)
    } else {
      setTimeout(resolve, 0)
    }
  })
}

async function closeEncoder(enc: VideoEncoder | AudioEncoder | null): Promise<void> {
  if (!enc) return
  try {
    if (enc.state === 'configured') await enc.flush()
  } catch {
    /* finalize whatever was encoded */
  }
  try {
    enc.close()
  } catch {
    /* already closed */
  }
}

/**
 * Render the visualizer offline and mux a frame-accurate MP4 with the
 * original audio. Throws `ExportCancelledError` when cancelled.
 */
export async function exportOfflineMp4(opts: OfflineExportOptions): Promise<OfflineExportResult> {
  const fps = Math.max(1, Math.min(60, Math.round(opts.fps)))
  const width = Math.max(2, Math.round(opts.width / 2) * 2)
  const height = Math.max(2, Math.round(opts.height / 2) * 2)
  // H.264 yuv420p — scale bitrate with pixel rate, clamped to sane bounds
  const bitrate = Math.min(50_000_000, Math.max(1_000_000, Math.round(opts.bitrate)))

  // ---------------------------------------------------------------- decode
  opts.onProgress(0.01, 'Decoding audio…')
  const arrayBuffer = await opts.audioFile.arrayBuffer()
  // An OfflineAudioContext needs no user gesture and never touches speakers.
  // Decoding at 48 kHz also resamples 44.1 kHz sources to the AAC-native rate
  // (a clean, correctly-ratioed resample — unlike real-time capture paths).
  const offlineCtx = new OfflineAudioContext(2, 4800, 48000)
  const buffer = await offlineCtx.decodeAudioData(arrayBuffer)
  const sampleRate = buffer.sampleRate
  if (buffer.length === 0) throw new Error('The audio file decoded to silence.')

  const duration = buffer.duration
  const startSec = Math.max(0, Math.min(opts.startSec, duration - 0.05))
  const endSec = Math.max(startSec + 1 / fps, Math.min(opts.endSec, duration))
  const frames = Math.max(1, Math.ceil((endSec - startSec) * fps))

  if (opts.cancelToken.cancelled) throw new ExportCancelledError()

  // ---------------------------------------------------------------- probes
  const videoCodec = await probeVideoEncoder(width, height, fps, bitrate)
  if (!videoCodec) {
    throw new Error(
      'No H.264 video encoder is available in this browser. Offline export needs Chrome, Edge, Firefox 130+ or Safari 16.4+.'
    )
  }
  const audioCodec = opts.includeAudio ? await probeAudioEncoder(sampleRate) : null
  if (opts.cancelToken.cancelled) throw new ExportCancelledError()

  // ---------------------------------------------------------------- muxer
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    ...(audioCodec
      ? {
          audio: {
            codec: audioCodec === 'aac' ? ('aac' as const) : ('opus' as const),
            sampleRate,
            numberOfChannels: 2,
          },
        }
      : {}),
    fastStart: 'in-memory',
  })

  // ---------------------------------------------------------------- audio
  // Encode the ENTIRE audio range up front, straight from the decoded PCM —
  // sample-accurate offsets, zero dependence on real time. Muxers interleave
  // by timestamp, so encoding order does not matter.
  if (audioCodec) {
    opts.onProgress(0.05, 'Encoding audio…')
    const enc = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: () => {},
    })
    enc.configure({
      codec: audioCodec === 'aac' ? AUDIO_CODEC_AAC : AUDIO_CODEC_OPUS,
      sampleRate,
      numberOfChannels: 2,
      bitrate: AAC_BITRATE,
    })
    const chL = buffer.getChannelData(0)
    const chR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chL
    const startSample = Math.round(startSec * sampleRate)
    const endSample = Math.min(buffer.length, Math.round(endSec * sampleRate))
    const CHUNK = 4800 // 100 ms blocks
    for (let pos = startSample; pos < endSample; pos += CHUNK) {
      if (opts.cancelToken.cancelled) {
        await closeEncoder(enc)
        throw new ExportCancelledError()
      }
      const n = Math.min(CHUNK, endSample - pos)
      const planar = new Float32Array(n * 2)
      planar.set(chL.subarray(pos, pos + n), 0)
      planar.set(chR.subarray(pos, pos + n), n)
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round(((pos - startSample) * 1e6) / sampleRate),
        data: planar,
      })
      enc.encode(data)
      data.close()
      while (enc.encodeQueueSize > 24) await nextTick()
    }
    await closeEncoder(enc)
  }

  // ---------------------------------------------------------------- video
  opts.onProgress(audioCodec ? 0.1 : 0.03, 'Rendering frames…')

  // H.264 cannot carry alpha — export always renders the solid background
  const cfg: VisualizerConfig = { ...opts.config, transparentBg: false }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Could not create the rendering canvas.')

  const images = new SceneImages()
  const afterglow = new AfterglowLayer()
  const renderer = createVisualizer(opts.config.type)
  const analyzer = new OfflineAnalyzer(mixToMono(buffer), sampleRate, cfg.fftSize, cfg.smoothing)
  const dt = 1 / fps

  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: () => {},
  })
  enc.configure({
    codec: videoCodec,
    width,
    height,
    bitrate,
    framerate: fps,
    avc: { format: 'avc' },
    latencyMode: 'quality',
  })

  const frameDurUs = 1e6 / fps
  try {
    for (let i = 0; i < frames; i++) {
      if (opts.cancelToken.cancelled) throw new ExportCancelledError()
      const t = startSec + i * dt

      analyzer.step(t)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      drawSceneBackground(ctx, width, height, cfg, images)
      const renderCtx = afterglow.begin(width, height, cfg.afterglow) ?? ctx
      renderer({
        ctx: renderCtx,
        width: renderCtx.canvas.width,
        height: renderCtx.canvas.height,
        time: t,
        dt,
        freq: analyzer.freq,
        wave: analyzer.wave,
        bass: analyzer.bass,
        mid: analyzer.mid,
        treble: analyzer.treble,
        level: analyzer.level,
        config: cfg,
      })
      if (renderCtx !== ctx) afterglow.composite(ctx)
      drawSceneOverlays(ctx, width, height, cfg, opts.lyrics, t, true)

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(i * frameDurUs),
        duration: Math.round(frameDurUs),
      })
      enc.encode(frame, { keyFrame: i % (fps * 2) === 0 })
      frame.close()

      // Backpressure — never drop frames offline, just wait for the encoder
      while (enc.encodeQueueSize > 8) await nextTick()

      if (i % 3 === 0 || i === frames - 1) {
        opts.onProgress(
          0.1 + 0.86 * ((i + 1) / frames),
          `Rendering frame ${i + 1} / ${frames}`
        )
      }
    }
    opts.onProgress(0.98, 'Finalizing…')
    await closeEncoder(enc)
  } catch (err) {
    try {
      enc.close()
    } catch {
      /* already closed */
    }
    throw err
  }

  muxer.finalize()
  const { buffer: out } = muxer.target
  const blob = new Blob([out], { type: 'video/mp4' })
  if (blob.size === 0) throw new Error('The export produced no data.')

  opts.onProgress(1, 'Done')
  return {
    blob,
    frames,
    durationSec: endSec - startSec,
    width,
    height,
    fps,
    audio: audioCodec !== null,
    audioCodec,
    videoCodec,
  }
}
