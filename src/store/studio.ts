'use client'

import { create } from 'zustand'
import {
  DEFAULT_STUDIO_CONFIG,
  GRADIENT_PRESETS,
  type BackgroundConfig,
  type ExportSettings,
  type GradientConfig,
  type GradientPresetId,
  type LyricsConfig,
  type StudioConfig,
  type VisualizerConfig,
} from '@/lib/visualizer/types'

export type StudioTab = 'visual' | 'background' | 'lyrics' | 'export'

export interface AudioMeta {
  name: string
  duration: number
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'mp4',
  fps: 30,
  resolution: '1280x720',
  length: 'full',
}

interface StudioState {
  config: StudioConfig
  activeTab: StudioTab
  audioMeta: AudioMeta | null
  projectId: string | null
  exportSettings: ExportSettings

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
}

export const useStudioStore = create<StudioState>()((set) => ({
  config: structuredClone(DEFAULT_STUDIO_CONFIG),
  activeTab: 'visual',
  audioMeta: null,
  projectId: null,
  exportSettings: { ...DEFAULT_EXPORT_SETTINGS },

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
  setConfig: (config) => set({ config: structuredClone(config) }),
}))
