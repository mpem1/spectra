'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { getAudioEngine } from '@/lib/audio/engine'
import {
  DEFAULT_CONFIG,
  DEFAULT_LYRICS_STATE,
  type AspectRatio,
  type FftSize,
  type GradientStop,
  type LastRecording,
  type LyricLine,
  type LyricsPosition,
  type TrackInfo,
  type VisualizerConfig,
  type VisualizerType,
} from '@/lib/types'

interface EditorStore {
  // audio
  track: TrackInfo | null
  audioFile: File | Blob | null
  lastRecording: LastRecording | null

  // visualizer style
  config: VisualizerConfig

  // lyrics overlay
  showLyrics: boolean
  lyrics: LyricLine[]
  lyricsSize: number
  lyricsPosition: LyricsPosition
  lyricsColor: string
  lyricsGlowColor: string
  lyricsGlow: number

  // actions
  loadTrack: (file: File) => Promise<void>
  setConfig: (patch: Partial<VisualizerConfig>) => void
  setGradientStops: (stops: GradientStop[]) => void
  replaceConfig: (config: VisualizerConfig) => void
  resetConfig: () => void
  setLastRecording: (rec: LastRecording | null) => void
  setShowLyrics: (v: boolean) => void
  setLyrics: (lines: LyricLine[]) => void
  setLyricsSize: (v: number) => void
  setLyricsPosition: (p: LyricsPosition) => void
  setLyricsColor: (c: string) => void
  setLyricsGlowColor: (c: string) => void
  setLyricsGlow: (v: number) => void
}

const TYPES: VisualizerType[] = ['bars', 'wave', 'radial', 'particles', 'blob', 'grid']
const ASPECTS: AspectRatio[] = ['16:9', '1:1', '9:16']
const FFTS: FftSize[] = [512, 1024, 2048, 4096]
const POSITIONS: LyricsPosition[] = ['top', 'center', 'bottom']

function hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

const MAX_STOPS = 6

/** Average two #rrggbb colors (legacy midpoint migration helper). */
function mixHex(a: string, b: string): string {
  const pa = a.replace('#', '')
  const pb = b.replace('#', '')
  const ch = (s: string, i: number) => parseInt(s.slice(i * 2, i * 2 + 2), 16)
  const mix = (i: number) => Math.round((ch(pa, i) + ch(pb, i)) / 2)
  return (
    '#' +
    [0, 1, 2]
      .map((i) => mix(i).toString(16).padStart(2, '0'))
      .join('')
  )
}

/** Clamp/repair a gradient stop list; falls back to the legacy A/B/mid look. */
function sanitizeStops(
  raw: unknown,
  colorA: string,
  colorB: string,
  mid: number
): GradientStop[] {
  let stops: GradientStop[] = []
  if (Array.isArray(raw) && raw.length > 0) {
    stops = raw
      .filter(
        (s): s is Partial<GradientStop> =>
          !!s && typeof s === 'object' && typeof (s as Partial<GradientStop>).color === 'string'
      )
      .slice(0, MAX_STOPS)
      .map((s, i) => ({
        color: hex(s.color, i === 0 ? colorA : colorB),
        position: num(s.position, i / Math.max(1, raw.length - 1), 0, 1),
      }))
  }
  if (stops.length === 0) {
    // Legacy 2-color + midpoint config → an equivalent stop list
    const m = Math.min(0.9, Math.max(0.1, mid))
    stops = [{ color: colorA, position: 0 }]
    if (Math.abs(m - 0.5) > 0.004) {
      stops.push({ color: mixHex(colorA, colorB), position: m })
    }
    stops.push({ color: colorB, position: 1 })
  }
  return stops.sort((a, b) => a.position - b.position)
}

/**
 * Project a stop list onto the legacy scalar fields so saved presets, the DB
 * roundtrip and old UI paths keep working: first stop → colorA, last → colorB,
 * middle-most stop → gradientMid.
 */
function projectStops(config: VisualizerConfig, stops: GradientStop[]): void {
  if (stops.length === 0) return
  config.gradientStops = stops
  config.colorA = stops[0].color
  config.colorB = stops[stops.length - 1].color
  if (stops.length > 2) {
    let best = stops[1].position
    for (let i = 1; i < stops.length - 1; i++) {
      if (Math.abs(stops[i].position - 0.5) < Math.abs(best - 0.5)) best = stops[i].position
    }
    config.gradientMid = num(best, 0.5, 0.1, 0.9)
  } else {
    config.gradientMid = 0.5
  }
}

/** Clamp/repair any hydrated value so corrupt storage can never break the canvas. */
function sanitizeConfig(raw: unknown): VisualizerConfig {
  const v = (raw ?? {}) as Partial<VisualizerConfig>
  const d = DEFAULT_CONFIG
  return {
    type: TYPES.includes(v.type as VisualizerType) ? (v.type as VisualizerType) : d.type,
    colorA: hex(v.colorA, d.colorA),
    colorB: hex(v.colorB, d.colorB),
    gradientMid: num(v.gradientMid, d.gradientMid, 0.1, 0.9),
    gradientStops: sanitizeStops(v.gradientStops, hex(v.colorA, d.colorA), hex(v.colorB, d.colorB), num(v.gradientMid, d.gradientMid, 0.1, 0.9)),
    gradientAngle: num(v.gradientAngle, d.gradientAngle, 0, 360),
    gradientCycle: bool(v.gradientCycle, d.gradientCycle),
    gradientCycleSpeed: num(v.gradientCycleSpeed, d.gradientCycleSpeed, 1, 180),
    barCount: Math.round(num(v.barCount, d.barCount, 8, 160)),
    lineWidth: num(v.lineWidth, d.lineWidth, 0.2, 3),
    particleCount: Math.round(num(v.particleCount, d.particleCount, 20, 400)),
    glow: Math.round(num(v.glow, d.glow, 0, 48)),
    afterglow: num(v.afterglow, d.afterglow, 0, 0.95),
    mirror: bool(v.mirror, d.mirror),
    rotation: bool(v.rotation, d.rotation),
    smoothing: num(v.smoothing, d.smoothing, 0, 0.95),
    sensitivity: num(v.sensitivity, d.sensitivity, 0.4, 3),
    fftSize: FFTS.includes(v.fftSize as FftSize) ? (v.fftSize as FftSize) : d.fftSize,
    aspect: ASPECTS.includes(v.aspect as AspectRatio) ? (v.aspect as AspectRatio) : d.aspect,
    transparentBg: bool(v.transparentBg, d.transparentBg),
    bgColor: hex(v.bgColor, d.bgColor),
    bgImage: typeof v.bgImage === 'string' && v.bgImage.length < 2_000_000 ? v.bgImage : null,
    bgImageDim: num(v.bgImageDim, d.bgImageDim, 0, 0.95),
    bgScale: num(v.bgScale, d.bgScale, 1, 3),
    bgOffsetX: num(v.bgOffsetX, d.bgOffsetX, -1, 1),
    bgOffsetY: num(v.bgOffsetY, d.bgOffsetY, -1, 1),
    bgMirror: bool(v.bgMirror, d.bgMirror),
    showTitle: bool(v.showTitle, d.showTitle),
    title: typeof v.title === 'string' ? v.title.slice(0, 80) : d.title,
    subtitle: typeof v.subtitle === 'string' ? v.subtitle.slice(0, 80) : d.subtitle,
  }
}

function sanitizeLyrics(raw: unknown): LyricLine[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((l) => l && typeof l === 'object' && typeof (l as LyricLine).text === 'string')
    .map((l, i) => {
      const line = l as Partial<LyricLine>
      return {
        id: typeof line.id === 'string' ? line.id : `ly_${i}`,
        time: num(line.time, 0, 0, 36000),
        text: String(line.text).slice(0, 300),
      }
    })
    .sort((a, b) => a.time - b.time)
}

export const useEditorStore = create<EditorStore>()(
  persist(
    (set) => ({
      track: null,
      audioFile: null,
      lastRecording: null,
      config: { ...DEFAULT_CONFIG },
      ...DEFAULT_LYRICS_STATE,

      loadTrack: async (file) => {
        const duration = await getAudioEngine().load(file, file.name)
        set({ track: { name: file.name, duration }, audioFile: file })
      },
      setConfig: (patch) =>
        set((s) => {
          const config = { ...s.config, ...patch }
          // Legacy color paths (color pickers, saved color presets) recolor the
          // endpoints of the stop list instead of fighting the multi-stop truth.
          if (
            !('gradientStops' in patch) &&
            ('colorA' in patch || 'colorB' in patch || 'gradientMid' in patch)
          ) {
            const stops = (s.config.gradientStops ?? []).map((st) => ({ ...st }))
            if (stops.length === 0) {
              config.gradientStops = [
                { color: config.colorA, position: 0 },
                { color: config.colorB, position: 1 },
              ]
            } else {
              stops[0].color = config.colorA
              stops[stops.length - 1].color = config.colorB
              config.gradientStops = stops
            }
          }
          return { config }
        }),
      setGradientStops: (stops) =>
        set((s) => {
          const config = { ...s.config }
          projectStops(
            config,
            sanitizeStops(stops, s.config.colorA, s.config.colorB, s.config.gradientMid)
          )
          return { config }
        }),
      replaceConfig: (config) => set({ config: sanitizeConfig(config) }),
      resetConfig: () =>
        set({
          config: {
            ...DEFAULT_CONFIG,
            gradientStops: DEFAULT_CONFIG.gradientStops.map((s) => ({ ...s })),
          },
        }),
      setLastRecording: (lastRecording) => set({ lastRecording }),

      setShowLyrics: (showLyrics) => set({ showLyrics }),
      setLyrics: (lyrics) => set({ lyrics: sanitizeLyrics(lyrics) }),
      setLyricsSize: (v) => set({ lyricsSize: num(v, 1, 0.5, 2.5) }),
      setLyricsPosition: (p) => set({ lyricsPosition: POSITIONS.includes(p) ? p : 'bottom' }),
      setLyricsColor: (c) => set({ lyricsColor: hex(c, DEFAULT_LYRICS_STATE.lyricsColor) }),
      setLyricsGlowColor: (c) =>
        set({ lyricsGlowColor: hex(c, DEFAULT_LYRICS_STATE.lyricsGlowColor) }),
      setLyricsGlow: (v) => set({ lyricsGlow: Math.round(num(v, 8, 0, 48)) }),
    }),
    {
      name: 'spectra-editor-v1',
      storage: createJSONStorage(() => localStorage),
      // Rehydrate AFTER mount (see EditorApp) — sync hydration during store
      // creation would make the first client render differ from SSR whenever
      // the persisted config differs from the defaults (hydration mismatch).
      skipHydration: true,
      partialize: (s) => ({
        config: s.config,
        showLyrics: s.showLyrics,
        lyrics: s.lyrics,
        lyricsSize: s.lyricsSize,
        lyricsPosition: s.lyricsPosition,
        lyricsColor: s.lyricsColor,
        lyricsGlowColor: s.lyricsGlowColor,
        lyricsGlow: s.lyricsGlow,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>
        return {
          ...current,
          config: sanitizeConfig(p.config),
          showLyrics: bool(p.showLyrics, DEFAULT_LYRICS_STATE.showLyrics),
          lyrics: sanitizeLyrics(p.lyrics),
          lyricsSize: num(p.lyricsSize, 1, 0.5, 2.5),
          lyricsPosition: POSITIONS.includes(p.lyricsPosition as LyricsPosition)
            ? (p.lyricsPosition as LyricsPosition)
            : 'bottom',
          lyricsColor: hex(p.lyricsColor, DEFAULT_LYRICS_STATE.lyricsColor),
          lyricsGlowColor: hex(p.lyricsGlowColor, DEFAULT_LYRICS_STATE.lyricsGlowColor),
          lyricsGlow: Math.round(num(p.lyricsGlow, 8, 0, 48)),
        }
      },
    }
  )
)
