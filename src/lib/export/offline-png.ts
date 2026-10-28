/**
 * OFFLINE PNG-sequence export — the deterministic TRANSPARENT footage path.
 *
 * Same contract as offline-export.ts (decode → analyze → render every frame at
 * its exact song position) but each frame is encoded as a PNG — which always
 * keeps its alpha channel — and appended to a ZIP. "Transparent background"
 * therefore carries straight through: no black matte, no live capture, no
 * dropped frames; frame N always lands at song position startSec + N/fps so
 * the sequence syncs with the original song in any NLE.
 *
 * The archive is assembled in memory (STORE entries — PNGs are already
 * deflate-compressed), so very long exports should use a test trim or the
 * streaming PNG Seq dialog instead.
 */

import { Zip, ZipDeflate } from 'fflate'
import type { LyricsState, VisualizerConfig } from '@/lib/types'
import { createVisualizer } from '@/lib/audio/visualizers'
import {
  AfterglowLayer,
  SceneImages,
  drawSceneBackground,
  drawSceneOverlays,
} from '@/lib/render/scene'
import { OfflineAnalyzer, mixToMono } from './offline-analyzer'
import { ExportCancelledError } from './offline-export'

export interface OfflinePngOptions {
  audioFile: Blob
  config: VisualizerConfig
  lyrics: LyricsState
  width: number
  height: number
  fps: number
  startSec: number
  endSec: number
  onProgress: (pct: number, label: string) => void
  cancelToken: { cancelled: boolean }
}

export interface OfflinePngResult {
  blob: Blob
  frames: number
  durationSec: number
  width: number
  height: number
  fps: number
}

/** Soft safety valve for the in-memory archive (~700 MB of PNG bytes). */
const MAX_ARCHIVE_BYTES = 700 * 1024 * 1024

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        resolve(null)
        return
      }
      resolve(new Uint8Array(await blob.arrayBuffer()))
    }, 'image/png')
  })
}

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

/**
 * Render the visualizer offline to a ZIP of alpha-capable PNG frames.
 * Throws `ExportCancelledError` when cancelled.
 */
export async function exportOfflinePngZip(opts: OfflinePngOptions): Promise<OfflinePngResult> {
  const fps = Math.max(1, Math.min(60, Math.round(opts.fps)))
  const width = Math.max(2, Math.round(opts.width / 2) * 2)
  const height = Math.max(2, Math.round(opts.height / 2) * 2)

  // ---------------------------------------------------------------- decode
  opts.onProgress(0.01, 'Decoding audio…')
  const arrayBuffer = await opts.audioFile.arrayBuffer()
  // Same 48 kHz decode as the MP4 exporter so both paths agree frame-for-frame.
  const offlineCtx = new OfflineAudioContext(2, 4800, 48000)
  const buffer = await offlineCtx.decodeAudioData(arrayBuffer)
  if (buffer.length === 0) throw new Error('The audio file decoded to silence.')

  const duration = buffer.duration
  const startSec = Math.max(0, Math.min(opts.startSec, duration - 0.05))
  const endSec = Math.max(startSec + 1 / fps, Math.min(opts.endSec, duration))
  const frames = Math.max(1, Math.ceil((endSec - startSec) * fps))

  if (opts.cancelToken.cancelled) throw new ExportCancelledError()

  // ---------------------------------------------------------------- render
  // Unlike MP4, PNG keeps alpha — honor transparentBg exactly as configured.
  const cfg: VisualizerConfig = opts.config
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create the rendering canvas.')

  const images = new SceneImages()
  const afterglow = new AfterglowLayer()
  const renderer = createVisualizer(cfg.type)
  const analyzer = new OfflineAnalyzer(mixToMono(buffer), buffer.sampleRate, cfg.fftSize, cfg.smoothing)
  const dt = 1 / fps

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  const zip = new Zip((err, data, final) => {
    if (err) throw err
    chunks.push(data)
    totalBytes += data.byteLength
    if (totalBytes > MAX_ARCHIVE_BYTES) {
      throw new Error(
        'The PNG sequence grew too large for an in-memory export — choose a shorter length.'
      )
    }
    if (final) zipDone()
  })
  let zipDoneResolve: (() => void) | null = null
  const zipDone = () => zipDoneResolve?.()
  const zipDonePromise = new Promise<void>((resolve) => {
    zipDoneResolve = resolve
  })

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

      const bytes = await canvasToPngBytes(canvas)
      if (!bytes) throw new Error(`PNG encoding failed on frame ${i + 1}.`)
      const entry = new ZipDeflate(`frame_${String(i + 1).padStart(6, '0')}.png`, {
        level: 0, // PNGs are already deflate-compressed — store them
      })
      zip.add(entry)
      entry.push(bytes, true)

      // Let the encoder's async queue drain between frames
      await nextTick()

      if (i % 3 === 0 || i === frames - 1) {
        opts.onProgress(
          0.05 + 0.92 * ((i + 1) / frames),
          `Rendering frame ${i + 1} / ${frames}`
        )
      }
    }
    opts.onProgress(0.99, 'Packing ZIP…')
    zip.end()
    await Promise.race([zipDonePromise, new Promise<void>((r) => setTimeout(r, 10_000))])
  } catch (err) {
    throw err
  }

  const blob = new Blob(chunks as BlobPart[], { type: 'application/zip' })
  if (blob.size === 0) throw new Error('The export produced no data.')

  opts.onProgress(1, 'Done')
  return {
    blob,
    frames,
    durationSec: endSec - startSec,
    width,
    height,
    fps,
  }
}
