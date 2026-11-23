'use client'

import { create } from 'zustand'
import {
  DEFAULT_STUDIO_CONFIG,
  GRADIENT_PRESETS,
  resolveLayersConfig,
  type BackgroundConfig,
  type DiscConfig,
  type ExportProgress,
  type ExportQuality,
  type ExportSettings,
  type GradientConfig,
  type GradientPresetId,
  type LayersConfig,
  type LyricsConfig,
  type StudioConfig,
  type TitleConfig,
  type VisualizerConfig,
  type WatermarkConfig,
  type PulseImageConfig,
  type CustomFontConfig,
  type ScreenFilterConfig,
  type VhsFilterConfig,
  type CamcorderFilterConfig,
  type FilmFilterConfig,
  type HalftoneFilterConfig,
  type GlitchFilterConfig,
  type AnaglyphFilterConfig,
  type NeonSplitFilterConfig,
  type ColorGradeFilterConfig,
  type GradientMapFilterConfig,
  type HalationFilterConfig,
  type ExposureFilterConfig,
  type PolaroidFilterConfig,
  type DitherFilterConfig,
  type PhosphorFilterConfig,
  type ContourFilterConfig,
  type CubifyFilterConfig,
} from '@/lib/visualizer/types'
import {
  exportMP4,
  exportWEBM,
  audioBufferToWav,
  sanitizeFilename,
  type ExportMediaResult,
} from '@/lib/export/exporter'
import { transcodeMp4AudioToAac, muxWavIntoMp4 } from '@/lib/ffmpeg-wasm'
import { getEngine, getPreviewControls } from '@/components/studio/engine-registry'
import { getPreviewCanvas } from '@/components/studio/canvas-registry'
import { toast } from 'sonner'

export type StudioTab = 'style' | 'color' | 'filters' | 'lyrics' | 'export' | 'presets'

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
  startSec: 0,
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
  patchTitle: (partial: Partial<TitleConfig>) => void
  patchDisc: (partial: Partial<DiscConfig>) => void
  patchWatermark: (partial: Partial<WatermarkConfig>) => void
  patchPulseImage: (partial: Partial<PulseImageConfig>) => void
  patchScreenFilter: (partial: Partial<ScreenFilterConfig>) => void
  patchVhsFilter: (partial: Partial<VhsFilterConfig>) => void
  /** Patches config.camcorderFilter (the Backrooms camcorder print) */
  patchCamcorderFilter: (partial: Partial<CamcorderFilterConfig>) => void
  patchFilmFilter: (partial: Partial<FilmFilterConfig>) => void
  patchHalftoneFilter: (partial: Partial<HalftoneFilterConfig>) => void
  patchGlitchFilter: (partial: Partial<GlitchFilterConfig>) => void
  patchAnaglyphFilter: (partial: Partial<AnaglyphFilterConfig>) => void
  /** Patches config.neonSplitFilter */
  patchNeonSplitFilter: (partial: Partial<NeonSplitFilterConfig>) => void
  /** Patches config.colorGradeFilter */
  patchColorGradeFilter: (partial: Partial<ColorGradeFilterConfig>) => void
  /** Patches config.gradientMapFilter (the standalone gradient-map stage) */
  patchGradientMapFilter: (partial: Partial<GradientMapFilterConfig>) => void
  /** Patches config.halationFilter */
  patchHalationFilter: (partial: Partial<HalationFilterConfig>) => void
  /** Patches config.exposureFilter (the instant-film stock grade) */
  patchExposureFilter: (partial: Partial<ExposureFilterConfig>) => void
  /** Patches config.polaroidFilter (the polaroid-print wall) */
  patchPolaroidFilter: (partial: Partial<PolaroidFilterConfig>) => void
  patchDitherFilter: (partial: Partial<DitherFilterConfig>) => void
  /** Patches config.phosphorFilter */
  patchPhosphorFilter: (partial: Partial<PhosphorFilterConfig>) => void
  /** Patches config.contourFilter */
  patchContourFilter: (partial: Partial<ContourFilterConfig>) => void
  /** Patches config.cubifyFilter (the glossy cube-tile print) */
  patchCubifyFilter: (partial: Partial<CubifyFilterConfig>) => void
  /** Patches config.layers (the layers-vs-filters options) */
  patchLayers: (partial: Partial<LayersConfig>) => void
  /** Adds an imported font file to the shared lyrics/title library */
  addCustomFont: (font: CustomFontConfig) => void
  /** Removes a font; any text layer using it falls back to Sans */
  removeCustomFont: (id: string) => void
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

  patchTitle: (partial) =>
    set((s) => ({
      config: { ...s.config, title: { ...s.config.title, ...partial } },
    })),

  patchDisc: (partial) =>
    set((s) => ({
      config: { ...s.config, disc: { ...s.config.disc, ...partial } },
    })),

  patchWatermark: (partial) =>
    set((s) => ({
      config: { ...s.config, watermark: { ...s.config.watermark, ...partial } },
    })),

  patchPulseImage: (partial) =>
    set((s) => ({
      config: { ...s.config, pulseImage: { ...s.config.pulseImage, ...partial } },
    })),

  patchScreenFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, screenFilter: { ...s.config.screenFilter, ...partial } },
    })),

  patchVhsFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, vhsFilter: { ...s.config.vhsFilter, ...partial } },
    })),

  patchCamcorderFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, camcorderFilter: { ...s.config.camcorderFilter, ...partial } },
    })),

  patchFilmFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, filmFilter: { ...s.config.filmFilter, ...partial } },
    })),

  patchHalftoneFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, halftoneFilter: { ...s.config.halftoneFilter, ...partial } },
    })),

  patchGlitchFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, glitchFilter: { ...s.config.glitchFilter, ...partial } },
    })),

  patchAnaglyphFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, anaglyphFilter: { ...s.config.anaglyphFilter, ...partial } },
    })),

  patchNeonSplitFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, neonSplitFilter: { ...s.config.neonSplitFilter, ...partial } },
    })),

  patchColorGradeFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, colorGradeFilter: { ...s.config.colorGradeFilter, ...partial } },
    })),

  patchGradientMapFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, gradientMapFilter: { ...s.config.gradientMapFilter, ...partial } },
    })),

  patchHalationFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, halationFilter: { ...s.config.halationFilter, ...partial } },
    })),

  patchExposureFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, exposureFilter: { ...s.config.exposureFilter, ...partial } },
    })),

  patchPolaroidFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, polaroidFilter: { ...s.config.polaroidFilter, ...partial } },
    })),

  patchDitherFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, ditherFilter: { ...s.config.ditherFilter, ...partial } },
    })),

  patchPhosphorFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, phosphorFilter: { ...s.config.phosphorFilter, ...partial } },
    })),

  patchContourFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, contourFilter: { ...s.config.contourFilter, ...partial } },
    })),

  patchCubifyFilter: (partial) =>
    set((s) => ({
      config: { ...s.config, cubifyFilter: { ...s.config.cubifyFilter, ...partial } },
    })),

  patchLayers: (partial) =>
    set((s) => ({
      config: { ...s.config, layers: { ...s.config.layers, ...partial } },
    })),

  addCustomFont: (font) =>
    set((s) => ({ config: { ...s.config, fonts: [...s.config.fonts, font] } })),

  removeCustomFont: (id) =>
    set((s) => ({
      config: {
        ...s.config,
        fonts: s.config.fonts.filter((f) => f.id !== id),
        // Layers pointing at the removed font fall back to Sans.
        lyrics:
          s.config.lyrics.font === id ? { ...s.config.lyrics, font: 'sans' } : s.config.lyrics,
        title: s.config.title.font === id ? { ...s.config.title, font: 'sans' } : s.config.title,
      },
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
  setConfig: (config) => {
    // The retired Dot Sphere FILTER graduates into the Dot Sphere STYLE:
    // old saves that tuned the filter's dials carry them over (the same
    // look re-renders when the user picks the style in the grid). The
    // style itself is NOT auto-switched — the user picks it like any
    // other style. The cast is deliberate: the field only exists in saves
    // made before the filter moved to the Style tab.
    const legacyDotSphere = (
      config as StudioConfig & {
        dotSphereFilter?: {
          size: number
          rows: number
          dotSize: number
          flowSpeed: number
          waveAmount: number
          waveScale: number
          waveSpeed: number
          bandTwist: number
          ripple: number
          glow: number
          backdrop: number
          colorMode: 'neon' | 'picture'
          beatReactive: boolean
          beatStrength: number
        }
      }
    ).dotSphereFilter
    return set({
      // Merge over the factory defaults so configs saved by older versions
      // (missing newer fields like background.imageSrc / shade) still load.
      config: {
        visualizer: {
          ...DEFAULT_STUDIO_CONFIG.visualizer,
          ...config.visualizer,
          // The retired 'horizon' road style lives on as 'perspective' (same
          // geometry family) — remap old saves so nothing renders blank. The
          // string cast is deliberate: old saves may carry any style string.
          style:
            (config.visualizer as VisualizerConfig | undefined)?.style ===
            ('horizon' as VisualizerConfig['style'])
              ? 'perspective'
              : ((config.visualizer as VisualizerConfig | undefined)?.style ??
                DEFAULT_STUDIO_CONFIG.visualizer.style),
          // The retired Dot Sphere FILTER graduates into the Dot Sphere
          // STYLE: old saves that tuned the filter's dials carry them over
          // (the same look re-renders when the user picks the style). The
          // style itself is NOT auto-switched — the user picks it in the
          // grid like any other style.
          ...(legacyDotSphere
            ? {
                dotSphereSize: legacyDotSphere.size,
                dotSphereRows: legacyDotSphere.rows,
                dotSphereDotSize: legacyDotSphere.dotSize,
                dotSphereFlow: legacyDotSphere.flowSpeed,
                dotSphereWave: legacyDotSphere.waveAmount,
                dotSphereWaveScale: legacyDotSphere.waveScale,
                dotSphereWaveSpeed: legacyDotSphere.waveSpeed,
                dotSphereTwist: legacyDotSphere.bandTwist,
                dotSphereRipple: legacyDotSphere.ripple,
                dotSphereGlow: legacyDotSphere.glow,
                dotSphereBackdrop: legacyDotSphere.backdrop,
                dotSphereColors: legacyDotSphere.colorMode,
                dotSphereBeat: legacyDotSphere.beatReactive,
                dotSphereBeatStrength: legacyDotSphere.beatStrength,
              }
            : {}),
        },
        background: { ...DEFAULT_STUDIO_CONFIG.background, ...config.background },
        lyrics: { ...DEFAULT_STUDIO_CONFIG.lyrics, ...config.lyrics },
        title: { ...DEFAULT_STUDIO_CONFIG.title, ...config.title },
        disc: { ...DEFAULT_STUDIO_CONFIG.disc, ...config.disc },
        watermark: { ...DEFAULT_STUDIO_CONFIG.watermark, ...config.watermark },
        pulseImage: { ...DEFAULT_STUDIO_CONFIG.pulseImage, ...config.pulseImage },
        screenFilter: { ...DEFAULT_STUDIO_CONFIG.screenFilter, ...config.screenFilter },
        vhsFilter: { ...DEFAULT_STUDIO_CONFIG.vhsFilter, ...config.vhsFilter },
        camcorderFilter: { ...DEFAULT_STUDIO_CONFIG.camcorderFilter, ...config.camcorderFilter },
        filmFilter: { ...DEFAULT_STUDIO_CONFIG.filmFilter, ...config.filmFilter },
        halftoneFilter: { ...DEFAULT_STUDIO_CONFIG.halftoneFilter, ...config.halftoneFilter },
        glitchFilter: { ...DEFAULT_STUDIO_CONFIG.glitchFilter, ...config.glitchFilter },
        anaglyphFilter: { ...DEFAULT_STUDIO_CONFIG.anaglyphFilter, ...config.anaglyphFilter },
        neonSplitFilter: { ...DEFAULT_STUDIO_CONFIG.neonSplitFilter, ...config.neonSplitFilter },
        colorGradeFilter: { ...DEFAULT_STUDIO_CONFIG.colorGradeFilter, ...config.colorGradeFilter },
        gradientMapFilter: { ...DEFAULT_STUDIO_CONFIG.gradientMapFilter, ...config.gradientMapFilter },
        halationFilter: { ...DEFAULT_STUDIO_CONFIG.halationFilter, ...config.halationFilter },
        exposureFilter: { ...DEFAULT_STUDIO_CONFIG.exposureFilter, ...config.exposureFilter },
        polaroidFilter: { ...DEFAULT_STUDIO_CONFIG.polaroidFilter, ...config.polaroidFilter },
        ditherFilter: { ...DEFAULT_STUDIO_CONFIG.ditherFilter, ...config.ditherFilter },
        phosphorFilter: { ...DEFAULT_STUDIO_CONFIG.phosphorFilter, ...config.phosphorFilter },
        contourFilter: { ...DEFAULT_STUDIO_CONFIG.contourFilter, ...config.contourFilter },
        cubifyFilter: { ...DEFAULT_STUDIO_CONFIG.cubifyFilter, ...config.cubifyFilter },
        // Layers-vs-filters options: new saves carry their own section; old
        // saves graduate the halftone's flip-gated "Layers stay colored".
        layers: resolveLayersConfig(config),
        // Imported font library — keep only well-formed entries.
        fonts: Array.isArray(config.fonts)
          ? config.fonts.filter(
              (f): f is CustomFontConfig =>
                !!f && typeof f.id === 'string' && typeof f.data === 'string' && f.data.length > 0,
            )
          : [],
      },
    })
  },

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
    const fmt = state.exportSettings.format
    exportCancelFlag = { cancelled: false }
    set({ exportJob: { active: true, progress: null }, activeTab: 'export' })
    try {
      const runExport = () =>
        fmt === 'webm'
          ? exportWEBM({
              config: state.config,
              settings: state.exportSettings,
              audioBuffer,
              onProgress: (progress) => set({ exportJob: { active: true, progress } }),
              signal: exportCancelFlag,
              onNotice: (message) => toast.warning('Export notice', { description: message }),
            })
          : exportMP4({
              config: state.config,
              settings: state.exportSettings,
              audioBuffer,
              onProgress: (progress) => set({ exportJob: { active: true, progress } }),
              signal: exportCancelFlag,
              onNotice: (message) => toast.warning('Export notice', { description: message }),
            })

      const result: ExportMediaResult = await runExport()
      let blob = result.blob

      // Social-media guarantee for the MP4 target: the file must carry AAC
      // audio — Facebook/Instagram reject Opus-in-MP4, and some browsers have
      // no AAC encoder (the exporter then muxes Opus or nothing). Fix the
      // soundtrack in-browser with ffmpeg.wasm; the video stream is copied,
      // so this costs seconds, not a re-render. Failures degrade to the
      // un-converted file with a warning rather than losing the export.
      if (fmt === 'mp4' && result.audioKind !== 'aac') {
        const dur = result.durationSec
        const converting = (pct: number) =>
          set({
            exportJob: {
              active: true,
              progress: {
                phase: 'converting',
                progress: Math.min(0.97, pct / 100),
                time: dur * Math.min(1, pct / 100),
              },
            },
          })
        try {
          if (result.audioKind === 'opus') {
            blob = await transcodeMp4AudioToAac(result.blob, {
              durationSec: dur,
              onProgress: converting,
            })
          } else {
            // Silent MP4 (no audio encoder at all): attach the original song
            // — re-encoded lossless-ish to WAV — as a fresh AAC track.
            blob = await muxWavIntoMp4(
              result.blob,
              audioBufferToWav(audioBuffer, dur, state.exportSettings.startSec ?? 0),
              { durationSec: dur, onProgress: converting },
            )
          }
        } catch {
          toast.warning('Audio could not be converted to AAC', {
            description:
              result.audioKind === 'opus'
                ? 'The file keeps Opus audio, which Facebook may reject. Check your connection and export again.'
                : 'The video stays silent (Facebook accepts it, just without sound).',
          })
        }
      }

      const ext = fmt === 'webm' ? 'webm' : 'mp4'
      const base = sanitizeFilename(state.audioMeta?.name ?? 'spectra')
      const filename = `${base}-${state.exportSettings.fps}fps.${ext}`
      downloadBlob(blob, filename)
      toast.success(`${ext.toUpperCase()} exported`, {
        description: `${filename} · ${(blob.size / (1024 * 1024)).toFixed(1)} MB`,
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
