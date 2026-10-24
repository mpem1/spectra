/**
 * Pulse Studio — shared type contracts.
 * Single source of truth for the render engine (2-a), UI panels (2-b),
 * and export pipeline (3). DO NOT break these interfaces.
 */

/* ---------------------------------- Gradient --------------------------------- */

export interface ColorStop {
  /** CSS color string, e.g. "#22c55e" or "#22c55ecc" */
  color: string
  /** Position along the gradient, 0..100 */
  position: number
  /** Opacity 0..100 (UI shows numeric value next to slider) */
  opacity: number
}

export interface GradientConfig {
  stops: ColorStop[]
  /** Gradient angle in degrees (0-360) */
  angle: number
  /** When true, the palette sweeps smoothly back and forth (colors stay in the palette) */
  cycleColors: boolean
  /** Sweep speed — one full back-and-forth pass per 1/speed seconds */
  cycleSpeed: number
}

export type GradientPresetId = 'sunset' | 'aurora' | 'ember' | 'neon' | 'mono'

/* --------------------------------- Visualizer -------------------------------- */

export type VisualizerStyle = 'bars' | 'wave' | 'radial' | 'particles' | 'blob' | 'grid'
export type MirrorMode = 'none' | 'mirror' | 'center'

export interface VisualizerConfig {
  style: VisualizerStyle
  /** Number of frequency bars / points (16..256) */
  barCount: number
  /** Analysis smoothing 0..1 (higher = calmer motion) */
  smoothing: number
  /** Overall reactivity multiplier 0.1..3 */
  sensitivity: number
  /** Bar corner radius / roundness 0..1 */
  roundness: number
  /** Gap between bars, 0..1 (fraction of slot width) */
  gap: number
  mirror: MirrorMode
  /** Draw gradient behind bars as filled background glow */
  glow: boolean
  gradient: GradientConfig
}

/* --------------------------------- Background -------------------------------- */

export type BackgroundMode = 'solid' | 'gradient' | 'transparent' | 'image'

export interface BackgroundConfig {
  mode: BackgroundMode
  /** Solid color (used when mode = solid) */
  color: string
  /** Optional second gradient used when mode = gradient */
  gradient: GradientConfig
  /** Image data URL (used when mode = image), drawn cover-fit */
  imageSrc: string
  /** Darkening overlay over the image, 0..1 ("shade fader") */
  shade: number
  /** Vignette strength 0..1 (darkens edges) */
  vignette: number
  /** Subtle noise grain 0..1 */
  grain: number
}

/* ----------------------------------- Lyrics ---------------------------------- */

export interface LyricLine {
  /** Start time in seconds */
  time: number
  /** Line text */
  text: string
}

export interface LyricsConfig {
  enabled: boolean
  lines: LyricLine[]
  font: 'sans' | 'serif' | 'mono'
  size: number // px relative to 720p canvas
  weight: number // 300..800
  /** Vertical position 0..100 (50 = center) */
  positionY: number
  color: string
  /** Fade duration in seconds */
  fade: number
  /** Uppercase transform */
  uppercase: boolean
  /** Seconds a line stays before fading out when no newer line replaces it */
  holdTime: number
  /** Text fill: flat color or a sweep of the visualizer palette */
  fill: 'solid' | 'gradient'
  /** Outline stroke behind the text */
  outline: boolean
  /** Outline stroke width, px relative to 720p canvas */
  outlineWidth: number
  outlineColor: string
  /** Soft glow halo behind the text */
  glow: boolean
  /** Glow blur strength 0..1 */
  glowStrength: number
  glowColor: string
}

/* ----------------------------------- Project --------------------------------- */

export interface StudioConfig {
  visualizer: VisualizerConfig
  background: BackgroundConfig
  lyrics: LyricsConfig
}

/* --------------------------------- Audio frame -------------------------------- */

/**
 * Deterministic per-frame audio analysis fed to the renderer.
 * Both the live preview (AnalyserNode) and the offline exporter (own FFT)
 * produce this exact shape, so the same renderer is used everywhere.
 */
export interface AudioFrame {
  /** Song time in seconds */
  time: number
  /**
   * Decorative-motion clock: gradient color cycling, ambient wobble, slow
   * rotation. Free-runs on a wall clock in the live preview (so styling stays
   * alive while paused) and equals `time` in offline/export frames, keeping
   * exported video deterministic.
   */
  styleTime: number
  /** Frequency magnitudes, normalized 0..1, length = barCount */
  freq: Float32Array
  /** Waveform samples, normalized -1..1, length 2048 */
  wave: Float32Array
  /** Overall RMS energy 0..1 */
  energy: number
  /** Bass energy 0..1 (first ~10% of spectrum) */
  bass: number
  /** Treble energy 0..1 (last ~30% of spectrum) */
  treble: number
}

/* ------------------------------- Renderer API -------------------------------- */

export interface RenderContext {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  /** Frame index (deterministic export uses integer frames) */
  frame: number
}

/** Stateless, pure render call: same inputs → same pixels. */
export type RenderFrameFn = (rc: RenderContext, frame: AudioFrame, config: StudioConfig) => void

/* --------------------------------- Export API --------------------------------- */

export type ExportFormat = 'mp4'
export type ExportLength = 'full' | '30s' | '15s'
export type ExportResolution = '1280x720' | '1920x1080' | '1080x1080' | '720x1280'

export interface ExportSettings {
  format: ExportFormat
  fps: 24 | 30 | 60
  resolution: ExportResolution
  length: ExportLength
}

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'encoding' | 'muxing' | 'done'
  /** 0..1 overall progress */
  progress: number
  /** Current render time within the song (seconds) */
  time: number
}

/* --------------------------------- Presets ----------------------------------- */

export const GRADIENT_PRESETS: Record<GradientPresetId, { name: string; stops: ColorStop[] }> = {
  sunset: {
    name: 'Sunset',
    stops: [
      { color: '#f97316', position: 0, opacity: 100 },
      { color: '#ec4899', position: 50, opacity: 100 },
      { color: '#8b5cf6', position: 100, opacity: 100 },
    ],
  },
  aurora: {
    name: 'Aurora',
    stops: [
      { color: '#06b6d4', position: 0, opacity: 100 },
      { color: '#10b981', position: 50, opacity: 100 },
      { color: '#a3e635', position: 100, opacity: 100 },
    ],
  },
  ember: {
    name: 'Ember',
    stops: [
      { color: '#dc2626', position: 0, opacity: 100 },
      { color: '#f97316', position: 55, opacity: 100 },
      { color: '#fbbf24', position: 100, opacity: 100 },
    ],
  },
  neon: {
    name: 'Neon',
    stops: [
      { color: '#22c55e', position: 0, opacity: 100 },
      { color: '#e2e8f0', position: 50, opacity: 100 },
      { color: '#22d3ee', position: 100, opacity: 100 },
    ],
  },
  mono: {
    name: 'Mono',
    stops: [
      { color: '#e5e5e5', position: 0, opacity: 100 },
      { color: '#a3a3a3', position: 50, opacity: 100 },
      { color: '#525252', position: 100, opacity: 100 },
    ],
  },
}

export const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  visualizer: {
    style: 'bars',
    barCount: 64,
    smoothing: 0.7,
    sensitivity: 1.2,
    roundness: 0.6,
    gap: 0.35,
    mirror: 'none',
    glow: true,
    gradient: {
      stops: [...GRADIENT_PRESETS.sunset.stops.map((s) => ({ ...s }))],
      angle: 48,
      cycleColors: false,
      cycleSpeed: 0.25,
    },
  },
  background: {
    mode: 'solid',
    color: '#0a0a0a',
    gradient: {
      stops: [
        { color: '#1e1b4b', position: 0, opacity: 100 },
        { color: '#0a0a0a', position: 100, opacity: 100 },
      ],
      angle: 160,
      cycleColors: false,
      cycleSpeed: 0.15,
    },
    imageSrc: '',
    shade: 0.5,
    vignette: 0.35,
    grain: 0.08,
  },
  lyrics: {
    enabled: false,
    lines: [],
    font: 'sans',
    size: 42,
    weight: 600,
    positionY: 78,
    color: '#ffffff',
    fade: 0.35,
    uppercase: false,
    holdTime: 4,
    fill: 'solid',
    outline: false,
    outlineWidth: 3,
    outlineColor: '#000000',
    glow: false,
    glowStrength: 0.5,
    glowColor: '#ffffff',
  },
}
