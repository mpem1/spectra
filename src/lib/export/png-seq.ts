/**
 * Spectra — PNG sequence export.
 *
 * Renders frames through the SAME deterministic pipeline as the MP4 export
 * (OfflineAnalyzer + pure renderFrame), grabs each frame as a PNG and bundles
 * everything into a ZIP via fflate. Transparent backgrounds keep their alpha
 * channel in every frame.
 */
import { zipSync } from 'fflate'
import { OfflineAnalyzer } from '../audio/offline'
import { renderFrame } from '../visualizer/renderer'
import { loadBackgroundImage } from '../visualizer/image-cache'
import type {
  ExportProgress,
  ExportSettings,
  StudioConfig,
} from '../visualizer/types'
import { RESOLUTION_DIMS as RESOLUTIONS } from '../visualizer/types'
import { ExportCancelledError } from './exporter'

/** Safety cap — 15s @ 30fps. Keeps the zip (and the browser tab) alive. */
export const PNG_SEQ_MAX_FRAMES = 450

export interface PngSeqOptions {
  config: StudioConfig
  settings: ExportSettings
  audioBuffer: AudioBuffer
  onProgress?: (progress: ExportProgress) => void
  signal?: { cancelled: boolean }
}

export interface PngSeqResult {
  frames: number
  capped: boolean
  blob: Blob
}

function lengthSeconds(length: ExportSettings['length'], fallback: number): number {
  if (length === '15s') return Math.min(15, fallback)
  if (length === '30s') return Math.min(30, fallback)
  return fallback
}

/** Yield to the event loop so the progress UI can repaint. */
const tick = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0))

export async function exportPngSequence(opts: PngSeqOptions): Promise<PngSeqResult> {
  const { config, settings, audioBuffer, onProgress, signal } = opts
  const { width, height } = RESOLUTIONS[settings.resolution]

  // Decode a configured background image before frame 0 (deterministic frames).
  if (config.background.mode === 'image' && config.background.imageSrc) {
    try {
      await loadBackgroundImage(config.background.imageSrc)
    } catch {
      // Fall through — the renderer paints a dark fallback.
    }
  }

  const analyzer = new OfflineAnalyzer(audioBuffer, settings.fps)
  const total = Math.min(
    Math.ceil(lengthSeconds(settings.length, analyzer.duration) * settings.fps),
    analyzer.totalFrames,
    PNG_SEQ_MAX_FRAMES,
  )
  const capped = Math.ceil(analyzer.duration * settings.fps) > total

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context is not available in this browser')

  const files: Record<string, [Uint8Array, { level: 0 }]> = {}

  for (let i = 0; i < total; i++) {
    if (signal?.cancelled) throw new ExportCancelledError()
    const frame = analyzer.frame(i, config.visualizer.barCount, config.visualizer.smoothing)
    renderFrame({ ctx, width, height, frame: i }, frame, config)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    )
    if (!blob) throw new Error(`Frame ${i}: PNG encoding failed`)
    const data = new Uint8Array(await blob.arrayBuffer())
    files[`spectra_frame_${String(i).padStart(6, '0')}.png`] = [data, { level: 0 }]
    onProgress?.({
      phase: i === total - 1 ? 'muxing' : 'rendering',
      progress: (i + 1) / total,
      time: frame.time,
    })
    if (i % 4 === 0) await tick()
  }

  onProgress?.({ phase: 'encoding', progress: 0.99, time: analyzer.duration })
  const zipped = zipSync(files, { level: 0 })
  const blob = new Blob([zipped], { type: 'application/zip' })
  onProgress?.({ phase: 'done', progress: 1, time: analyzer.duration })
  return { frames: total, capped, blob }
}
