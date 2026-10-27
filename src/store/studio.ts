'use client'

import { create } from 'zustand'
import {
  DEFAULT_STUDIO_CONFIG,
  GRADIENT_PRESETS,
  type BackgroundConfig,
  type ExportProgress,
  type ExportQuality,
  type ExportSettings,
  type GradientConfig,
  type GradientPresetId,
  type LyricsConfig,
  type StudioConfig,
  type VisualizerConfig,
} from '@/lib/visualizer/types'
import { exportMP4 } from '@/lib/export/exporter'
import { getEngine, getPreviewControls } from '@/components/studio/engine-registry'
import { getPreviewCanvas } from '@/components/studio/canvas-registry'
import { toast } from 'sonner'

export type StudioTab = 'style' | 'lyrics' | 'export' | 'presets'

export interface AudioMeta {
  name: string
  duration: number
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'mp4',
  fps: 30,
  resolution: '1920x1080',
  length: 'full',
  quality: 'high',
}

/**
 * Live-recording video bitrate (MediaRecorder defaults to ~1 Mbps, which looks
 * terrible). Sized like the MP4 export: 0.2 bits/pixel/frame at 30 fps,
 * clamped to a sane range for the preview canvas backing store.
 */
export function recordingVideoBitrate(width: number, height: number): number {
  return Math.min(20_000_000, Math.max(4_000_000, Math.round(width * height * 30 * 0.2)))
}

/** Human labels for the export quality tiers (shared by the Export tab). */
export const EXPORT_QUALITY_LABELS: Record<ExportQuality, string> = {
  standard: 'Standard · smaller file',
  high: 'High · recommended',
  max: 'Max · largest file',
}

/** Live-recording state shared by the top-bar Record button and the Export tab. */
interface RecordingSlice {
  recording: boolean
  recordElapsed: number
  /** Last finished WebM recording — offered to the Convert dialog. */
  lastRecording: Blob | null
  startRecording: () => void
  stopRecording: () => void
}

/** Deterministic MP4 export state shared by top-bar + Export tab. */
interface ExportSlice {
  exportJob: { active: boolean; progress: ExportProgress | null }
  startExport: () => Promise<void>
  cancelExport: () => void
}

type StudioState = {
  config: StudioConfig
  activeTab: StudioTab
  audioMeta: AudioMeta | null
  projectId: string | null
  exportSettings: ExportSettings
  /** Player bar: repeat toggle + output volume 0..1. */
  loop: boolean
  volume: number

  patchVisualizer: (partial: Partial<VisualizerConfig>) => void
  patchBackground: (partial: Partial<BackgroundConfig>) => void
  patchLyrics: (partial: Partial<LyricsConfig>) => void
  /** Patches config.visualizer.gradient */
  patchGradient: (partial: Partial<GradientConfig>) => void
  /** Patches config.background.gradient */
  patchBgGradient: (partial: Partial<GradientConfig>) => void
  applyPreset: (id: GradientPresetId) => void
  setExportSettings: (partial: Partial<ExportSettings>) => void
  setActiveTab: (tab: StudioTab) => void
  setAudioMeta: (meta: AudioMeta | null) => void
  setProjectId: (id: string | null) => void
  setConfig: (config: StudioConfig) => void
  setLoop: (loop: boolean) => void
  setVolume: (volume: number) => void
} & RecordingSlice &
  ExportSlice

/* ------------------------- recorder internals (module) ------------------------ */

let recorderRef: MediaRecorder | null = null
let recordChunks: Blob[] = []
let recordTimer: number | null = null
let recordStart = 0

function pickRecorderMime(alpha: boolean): string {
  const candidates = alpha
    ? ['video/webm;codecs=vp9', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) {
      return candidate
    }
  }
  return ''
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Shared download helper (export tab + PNG seq + recorder). */
export { downloadBlob }

/* --------------------------------- the store --------------------------------- */

let exportCancelFlag = { cancelled: false }

export const useStudioStore = create<StudioState>()((set, get) => ({
  config: structuredClone(DEFAULT_STUDIO_CONFIG),
  activeTab: 'style',
  audioMeta: null,
  projectId: null,
  exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
  loop: false,
  volume: 1,

  recording: false,
  recordElapsed: 0,
  lastRecording: null,

  exportJob: { active: false, progress: null },

  patchVisualizer: (partial) =>
    set((s) => ({
      config: { ...s.config, visualizer: { ...s.config.visualizer, ...partial } },
    })),

  patchBackground: (partial) =>
    set((s) => ({
      config: { ...s.config, background: { ...s.config.background, ...partial } },
    })),

  patchLyrics: (partial) =>
    set((s) => ({
      config: { ...s.config, lyrics: { ...s.config.lyrics, ...partial } },
    })),

  patchGradient: (partial) =>
    set((s) => ({
      config: {
        ...s.config,
        visualizer: {
          ...s.config.visualizer,
          gradient: { ...s.config.visualizer.gradient, ...partial },
        },
      },
    })),

  patchBgGradient: (partial) =>
    set((s) => ({
      config: {
        ...s.config,
        background: {
          ...s.config.background,
          gradient: { ...s.config.background.gradient, ...partial },
        },
      },
    })),

  applyPreset: (id) =>
    set((s) => ({
      config: {
        ...s.config,
        visualizer: {
          ...s.config.visualizer,
          gradient: {
            ...s.config.visualizer.gradient,
            stops: GRADIENT_PRESETS[id].stops.map((stop) => ({ ...stop })),
          },
        },
      },
    })),

  setExportSettings: (partial) =>
    set((s) => ({ exportSettings: { ...s.exportSettings, ...partial } })),

  setActiveTab: (activeTab) => set({ activeTab }),
  setAudioMeta: (audioMeta) => set({ audioMeta }),
  setProjectId: (projectId) => set({ projectId }),
  setConfig: (config) =>
    set({
      // Merge over the factory defaults so configs saved by older versions
      // (missing newer fields like background.imageSrc / shade) still load.
      config: {
        visualizer: { ...DEFAULT_STUDIO_CONFIG.visualizer, ...config.visualizer },
        background: { ...DEFAULT_STUDIO_CONFIG.background, ...config.background },
        lyrics: { ...DEFAULT_STUDIO_CONFIG.lyrics, ...config.lyrics },
      },
    }),

  setLoop: (loop) => {
    set({ loop })
    getEngine()?.setLoop(loop)
  },

  setVolume: (volume) => {
    set({ volume })
    getEngine()?.setVolume(volume)
  },

  /* ------------------------------ recording ------------------------------ */

  startRecording: () => {
    if (get().recording) return
    const canvas = getPreviewCanvas()
    if (!canvas) {
      toast.error('Preview canvas not ready')
      return
    }
    const alpha = get().config.background.mode === 'transparent'
    let stream: MediaStream
    try {
      stream = canvas.captureStream(30)
    } catch {
      toast.error('Canvas capture is not supported in this browser')
      return
    }
    const mimeType = pickRecorderMime(alpha)
    let recorder: MediaRecorder
    try {
      const options: MediaRecorderOptions = {
        videoBitsPerSecond: recordingVideoBitrate(canvas.width, canvas.height),
      }
      if (mimeType) options.mimeType = mimeType
      recorder = new MediaRecorder(stream, options)
    } catch {
      toast.error('MediaRecorder could not start in this browser')
      return
    }
    recordChunks = []
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) recordChunks.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(recordChunks, { type: recorder.mimeType || 'video/webm' })
      stream.getTracks().forEach((t) => t.stop())
      set({ lastRecording: blob.size > 0 ? blob : null })
      if (blob.size > 0) {
        downloadBlob(blob, 'spectra-recording.webm')
        toast.success('Recording saved', {
          description: `spectra-recording.webm · ${(blob.size / (1024 * 1024)).toFixed(1)} MB`,
        })
      } else {
        toast.error('Recording was empty')
      }
    }
    recorder.start()
    recorderRef = recorder

    // Force playback from the top so the capture is a full run-through.
    getPreviewControls()?.seek(0)
    getPreviewControls()?.play()

    set({ recording: true, recordElapsed: 0 })
    recordStart = Date.now()
    recordTimer = window.setInterval(() => {
      const secs = (Date.now() - recordStart) / 1000
      set({ recordElapsed: secs })
      // Auto-stop once playback has finished (audio ended or demo loop wrapped).
      const controls = getPreviewControls()
      if (secs > 1.5 && controls && !controls.isPlaying()) get().stopRecording()
    }, 250)
  },

  stopRecording: () => {
    if (recordTimer !== null) {
      window.clearInterval(recordTimer)
      recordTimer = null
    }
    const rec = recorderRef
    if (rec && rec.state !== 'inactive') rec.stop()
    recorderRef = null
    set({ recording: false })
    getPreviewControls()?.pause()
  },

  /* -------------------------------- export -------------------------------- */

  startExport: async () => {
    const state = get()
    if (state.exportJob.active) return
    const engine = getEngine()
    const audioBuffer = engine?.audioBuffer
    if (!audioBuffer) {
      toast.error('Load audio first', {
        description: 'Deterministic export muxes your original audio file.',
      })
      return
    }
    exportCancelFlag = { cancelled: false }
    set({ exportJob: { active: true, progress: null }, activeTab: 'export' })
    try {
      const blob = await exportMP4({
        config: state.config,
        settings: state.exportSettings,
        audioBuffer,
        onProgress: (progress) => set({ exportJob: { active: true, progress } }),
        signal: exportCancelFlag,
        onNotice: (message) => toast.warning('Export notice', { description: message }),
      })
      downloadBlob(blob, 'spectra.mp4')
      toast.success('MP4 exported', {
        description: `spectra.mp4 · ${(blob.size / (1024 * 1024)).toFixed(1)} MB`,
      })
    } catch (err) {
      if (exportCancelFlag.cancelled) {
        toast.info('Export cancelled')
      } else {
        toast.error('Export failed', {
          description: err instanceof Error ? err.message : 'Unknown error while exporting.',
        })
      }
    } finally {
      set({ exportJob: { active: false, progress: null } })
    }
  },

  cancelExport: () => {
    exportCancelFlag.cancelled = true
  },
}))

/** Cooperative cancel handle for the running export (read by the Export tab). */
export function isExportCancelled(): boolean {
  return exportCancelFlag.cancelled
}
