// Spectra — shared types for the visualizer editor

export type VisualizerType = 'bars' | 'wave' | 'radial' | 'particles' | 'blob' | 'grid'
export type AspectRatio = '16:9' | '1:1' | '9:16'
export type FftSize = 512 | 1024 | 2048 | 4096
export type LyricsPosition = 'top' | 'center' | 'bottom'

export interface LyricLine {
  id: string
  time: number // seconds
  text: string
}

/** One color stop of the multi-stop gradient (position 0..1 along the angle). */
export interface GradientStop {
  color: string // #rrggbb
  position: number // 0..1
}

export interface VisualizerConfig {
  // visualizer
  type: VisualizerType
  colorA: string // hex — projection of gradientStops[0] (kept in sync for presets/DB)
  colorB: string // hex — projection of the last gradient stop
  gradientMid: number // 0.1..0.9 — legacy midpoint projection (see gradientStops)
  gradientStops: GradientStop[] // 1..6 stops — the authoritative gradient palette
  gradientAngle: number // 0..360 — direction of the gradient across the canvas
  gradientCycle: boolean // rotate the stop hues continuously
  gradientCycleSpeed: number // 1..180 °/s hue rotation while cycling
  barCount: number // bars / radial spokes / grid columns
  lineWidth: number // 0.2..3 — stroke weight
  particleCount: number // particles mode only
  glow: number // 0..48 shadow blur on the visualizer
  afterglow: number // 0..0.95 trail persistence
  mirror: boolean // bars/wave/grid mirror around their baseline
  rotation: boolean // radial/blob slow rotation
  // audio analysis
  smoothing: number // 0..0.95 analyser smoothing
  sensitivity: number // 0.4..3 amplitude multiplier
  fftSize: FftSize
  aspect: AspectRatio
  // background
  transparentBg: boolean
  bgColor: string
  bgImage: string | null // data URL
  bgImageDim: number // 0..0.95
  bgScale: number // 1..3 zoom
  bgOffsetX: number // -1..1 pan
  bgOffsetY: number
  bgMirror: boolean // flip image horizontally
  // text overlay
  showTitle: boolean
  title: string
  subtitle: string
}

export interface LyricsState {
  showLyrics: boolean
  lyrics: LyricLine[]
  lyricsSize: number // 0.5..2.5 multiplier on the base font size
  lyricsPosition: LyricsPosition
  lyricsColor: string // text color — independent from the visualizer gradient
  lyricsGlowColor: string // glow color — independent from the visualizer gradient
  lyricsGlow: number // 0..48 shadow blur
}

export interface TrackInfo {
  name: string
  duration: number
}

export interface LastRecording {
  blob: Blob
  alpha: boolean
  durationSec: number
}

export interface PresetSummary {
  id: string
  name: string
  config: string
  createdAt: string
}

export interface ColorPresetSummary {
  id: string
  name: string
  colorA: string
  colorB: string
  createdAt: string
}

export const VISUALIZER_META: {
  type: VisualizerType
  label: string
  description: string
}[] = [
  { type: 'bars', label: 'Bars', description: 'Classic spectrum columns rising from the baseline' },
  { type: 'wave', label: 'Wave', description: 'Smooth oscilloscope line driven by the waveform' },
  { type: 'radial', label: 'Radial', description: 'Spokes radiating around the center' },
  { type: 'particles', label: 'Particles', description: 'Dots that drift and pulse with the beat' },
  { type: 'blob', label: 'Blob', description: 'Liquid shape that breathes with the music' },
  { type: 'grid', label: 'Grid', description: 'Columns of glowing cells stacked from the floor' },
]

export const COLOR_PRESETS: { name: string; colorA: string; colorB: string }[] = [
  { name: 'Emerald', colorA: '#34d399', colorB: '#8b5cf6' },
  { name: 'Sunset', colorA: '#f43f5e', colorB: '#fb923c' },
  { name: 'Aurora', colorA: '#22d3ee', colorB: '#a855f7' },
  { name: 'Ember', colorA: '#ef4444', colorB: '#f59e0b' },
  { name: 'Neon', colorA: '#ec4899', colorB: '#22d3ee' },
  { name: 'Ocean', colorA: '#2dd4bf', colorB: '#3b82f6' },
  { name: 'Candy', colorA: '#f472b6', colorB: '#c084fc' },
  { name: 'Gold', colorA: '#fbbf24', colorB: '#f97316' },
  { name: 'Mono', colorA: '#e4e4e7', colorB: '#52525b' },
]

/** One-click gradient palettes (matches the rebuild's presets). */
export const GRADIENT_PRESETS: { name: string; stops: GradientStop[] }[] = [
  {
    name: 'Sunset',
    stops: [
      { color: '#f43f5e', position: 0 },
      { color: '#f59e0b', position: 0.55 },
      { color: '#7c3aed', position: 1 },
    ],
  },
  {
    name: 'Aurora',
    stops: [
      { color: '#10b981', position: 0 },
      { color: '#22d3ee', position: 0.5 },
      { color: '#a855f7', position: 1 },
    ],
  },
  {
    name: 'Ember',
    stops: [
      { color: '#dc2626', position: 0 },
      { color: '#f97316', position: 0.6 },
      { color: '#facc15', position: 1 },
    ],
  },
  {
    name: 'Neon',
    stops: [
      { color: '#ec4899', position: 0 },
      { color: '#84cc16', position: 0.5 },
      { color: '#06b6d4', position: 1 },
    ],
  },
  {
    name: 'Mono',
    stops: [
      { color: '#ffffff', position: 0 },
      { color: '#a3a3a3', position: 1 },
    ],
  },
]

export const DEFAULT_CONFIG: VisualizerConfig = {
  type: 'bars',
  colorA: '#34d399',
  colorB: '#8b5cf6',
  gradientMid: 0.5,
  gradientStops: [
    { color: '#34d399', position: 0 },
    { color: '#8b5cf6', position: 1 },
  ],
  gradientAngle: 270, // bottom → top: preserves the classic bars look
  gradientCycle: false,
  gradientCycleSpeed: 30,
  barCount: 64,
  lineWidth: 1,
  particleCount: 120,
  glow: 12,
  afterglow: 0.55,
  mirror: true,
  rotation: false,
  smoothing: 0.8,
  sensitivity: 1.2,
  fftSize: 2048,
  aspect: '16:9',
  transparentBg: false,
  bgColor: '#09090b',
  bgImage: null,
  bgImageDim: 0.35,
  bgScale: 1,
  bgOffsetX: 0,
  bgOffsetY: 0,
  bgMirror: false,
  showTitle: false,
  title: '',
  subtitle: '',
}

export const DEFAULT_LYRICS_STATE = {
  showLyrics: false,
  lyrics: [] as LyricLine[],
  lyricsSize: 1,
  lyricsPosition: 'bottom' as LyricsPosition,
  lyricsColor: '#ffffff',
  lyricsGlowColor: '#ffffff',
  lyricsGlow: 8,
}
