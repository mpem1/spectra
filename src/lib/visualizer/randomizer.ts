'use client'

/**
 * The look randomizer — one click, a fresh variation of the current setup.
 *
 * Every click picks:
 *  - 1–2 style dials (visualizer sliders, drawn only from the ones the
 *    current style actually shows),
 *  - 0–2 color tools (the Color tab effects),
 *  - 0–2 filters (the Filters tab effects),
 *
 * and moves each picked dial to a random position within 25% of its factory
 * default — positive or negative along the horizontal slider track (always
 * at least one step, so a pick is a real, visible change; zero-default dials
 * therefore move too). Picked effects that are switched off are turned on;
 * anything not picked is left exactly where the user set it. Switches,
 * colors, gradients, text and uploaded images are never touched — dials
 * only.
 *
 * Slider geometry (min/max/step) mirrors the studio UI exactly; the factory
 * defaults are read live from DEFAULT_STUDIO_CONFIG so the two can never
 * drift apart.
 */

import {
  DEFAULT_STUDIO_CONFIG,
  type AnaglyphFilterConfig,
  type CamcorderFilterConfig,
  type ColorGradeFilterConfig,
  type ContourFilterConfig,
  type CubifyFilterConfig,
  type DitherFilterConfig,
  type ExposureFilterConfig,
  type FilmFilterConfig,
  type GlitchFilterConfig,
  type GradientMapFilterConfig,
  type HalationFilterConfig,
  type HalftoneFilterConfig,
  type NeonSplitFilterConfig,
  type PhosphorFilterConfig,
  type ScreenFilterConfig,
  type StudioConfig,
  type TextureFilterConfig,
  type VisualizerConfig,
  type VhsFilterConfig,
} from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'

/* -------------------------------- jitter math -------------------------------- */

/**
 * A random value within ±25% of `defaultValue` measured on the slider track
 * (25% of the track span, random sign — so zero-default dials move too),
 * snapped to the step grid and always at least one step away from the
 * default so every pick is perceptible.
 */
function jitter(defaultValue: number, min: number, max: number, step: number): number {
  const span = max - min
  const magnitude = span * (0.05 + Math.random() * 0.2) // 5–25% of the track
  const sign = Math.random() < 0.5 ? -1 : 1
  let v = Math.min(max, Math.max(min, defaultValue + sign * magnitude))
  // Snap onto the step grid, then kill float noise.
  v = min + Math.round((v - min) / step) * step
  v = Number(Math.min(max, Math.max(min, v)).toFixed(4))
  // A pick must always be a real change: bump one step when snapping
  // collapsed the jitter (coarse-step sliders on short tracks).
  if (Math.abs(v - defaultValue) < step) {
    const up = defaultValue + step <= max
    const down = defaultValue - step >= min
    if (up && down) v = defaultValue + (Math.random() < 0.5 ? step : -step)
    else if (up) v = defaultValue + step
    else if (down) v = defaultValue - step
  }
  return v
}

/** "+18%" / "-7%" — how far the dial moved, as a share of the track. */
function deltaLabel(def: number, v: number, min: number, max: number): string {
  const span = max - min
  const pct = span > 0 ? Math.round((Math.abs(v - def) / span) * 100) : 0
  return `${v >= def ? '+' : '-'}${pct}%`
}

/* --------------------------------- registry ---------------------------------- */

type NumericKeys<C> = { [K in keyof C]: NonNullable<C[K]> extends number ? K : never }[keyof C]

/** One visualizer slider the randomizer may nudge. */
interface StyleDial {
  label: string
  key: NumericKeys<VisualizerConfig>
  min: number
  max: number
  step: number
  /** Eligible only while this passes (the slider must be visible for the current style). */
  when?: (viz: VisualizerConfig) => boolean
}

/** One dial inside an effect (color tool / filter). */
interface EffectParam<C> {
  key: NumericKeys<C>
  label: string
  min: number
  max: number
  step: number
  /** Factory default override for optional legacy keys missing from DEFAULT_STUDIO_CONFIG. */
  def?: number
  /** Only randomized while this passes (sub-mode conditions, mirrored from the UI). */
  when?: (cfg: C) => boolean
}

/** A color tool / filter the randomizer may switch on and re-dial. */
interface RandomEffect {
  label: string
  /** Returns the toast label, or null when nothing could be randomized. */
  apply: () => string | null
}

function pickRandom<T>(items: readonly T[], count: number): T[] {
  const pool = [...items]
  const out: T[] = []
  const n = Math.min(count, pool.length)
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length)
    const picked = pool.splice(idx, 1)[0]
    if (picked !== undefined) out.push(picked)
  }
  return out
}

/* ------------------------------- style elements ------------------------------ */

const notStyle = (...styles: string[]) => (viz: VisualizerConfig) => !styles.includes(viz.style)
const isStyle = (...styles: string[]) => (viz: VisualizerConfig) => styles.includes(viz.style)

/**
 * Style-tab dials, one entry per slider the UI can show. `when` mirrors the
 * Style tab's own visibility conditions so a dial is only ever picked when
 * it actually dresses the current style.
 */
const STYLE_DIALS: StyleDial[] = [
  // Layout — every style
  { label: 'Position X', key: 'positionX', min: 0, max: 100, step: 1 },
  { label: 'Position Y', key: 'positionY', min: 0, max: 100, step: 1 },
  { label: 'Size', key: 'scale', min: 0.1, max: 2.5, step: 0.05 },
  { label: 'Transparency', key: 'transparency', min: 0, max: 1, step: 0.05 },
  { label: 'Sensitivity', key: 'sensitivity', min: 0.1, max: 3, step: 0.1 },
  // Shape & motion — every style except Serato / Dot Sphere
  { label: 'Bar count', key: 'barCount', min: 16, max: 256, step: 8, when: notStyle('serato', 'dotsphere') },
  { label: 'Smoothing', key: 'smoothing', min: 0, max: 0.95, step: 0.05, when: notStyle('serato', 'dotsphere') },
  { label: 'Roundness', key: 'roundness', min: 0, max: 1, step: 0.05, when: notStyle('ribbon', 'terrain', 'sphere', 'dotsphere') },
  { label: 'Gap', key: 'gap', min: 0, max: 0.8, step: 0.05, when: notStyle('ribbon', 'terrain', 'sphere', 'dotsphere', 'serato') },
  // Perspective & Terrain road dressing
  { label: 'Horizon', key: 'mirrorOffset', min: 0.1, max: 0.9, step: 0.01, when: isStyle('perspective', 'terrain') },
  { label: 'Flow speed', key: 'flowSpeed', min: 0, max: 1, step: 0.05, when: isStyle('perspective', 'terrain') },
  { label: 'LED texture', key: 'perspTexture', min: 0, max: 1, step: 0.05, when: isStyle('perspective') },
  { label: 'Echo trails', key: 'perspEcho', min: 0, max: 1, step: 0.05, when: isStyle('perspective') },
  { label: 'Fill', key: 'terrainFill', min: 0, max: 1, step: 0.05, when: isStyle('terrain') },
  // Sphere dressing
  { label: 'Spin', key: 'sphereSpin', min: 0, max: 1, step: 0.05, when: isStyle('sphere') },
  { label: 'Quills', key: 'sphereQuills', min: 0, max: 1, step: 0.05, when: isStyle('sphere') },
  // Serato strip dressing
  { label: 'Zoom', key: 'seratoWindow', min: 4, max: 30, step: 1, when: isStyle('serato') },
  { label: 'Strip height', key: 'seratoHeight', min: 0.3, max: 1, step: 0.02, when: isStyle('serato') },
  // Mirror axis (bars / wave / grid with a mirror mode on)
  {
    label: 'Mirror offset',
    key: 'mirrorOffset',
    min: 0,
    max: 1,
    step: 0.01,
    when: (viz) =>
      viz.mirror !== 'none' && (viz.style === 'bars' || viz.style === 'wave' || viz.style === 'grid'),
  },
  // Dot sphere dressing
  { label: 'Sphere size', key: 'dotSphereSize', min: 0.6, max: 2.6, step: 0.01, when: isStyle('dotsphere') },
  { label: 'Dot rows', key: 'dotSphereRows', min: 12, max: 80, step: 1, when: isStyle('dotsphere') },
  { label: 'Dot size', key: 'dotSphereDotSize', min: 0.4, max: 2.2, step: 0.01, when: isStyle('dotsphere') },
  { label: 'Flow speed', key: 'dotSphereFlow', min: -3, max: 3, step: 0.01, when: isStyle('dotsphere') },
  { label: 'Wave amount', key: 'dotSphereWave', min: 0, max: 1, step: 0.01, when: isStyle('dotsphere') },
  { label: 'Wave scale', key: 'dotSphereWaveScale', min: 1, max: 10, step: 1, when: isStyle('dotsphere') },
  { label: 'Wave speed', key: 'dotSphereWaveSpeed', min: 0, max: 3, step: 0.01, when: isStyle('dotsphere') },
  { label: 'Band twist', key: 'dotSphereTwist', min: 0, max: 3, step: 0.01, when: isStyle('dotsphere') },
  { label: 'Music ripple', key: 'dotSphereRipple', min: 0, max: 1, step: 0.05, when: isStyle('dotsphere') },
  { label: 'Glow', key: 'dotSphereGlow', min: 0, max: 1, step: 0.05, when: isStyle('dotsphere') },
  // Image style dressing
  { label: 'Artwork size', key: 'imgvizSize', min: 15, max: 100, step: 1, when: isStyle('imgviz') },
  { label: 'Artwork dim', key: 'imgvizDim', min: 0, max: 1, step: 0.05, when: isStyle('imgviz') },
  { label: 'Inner gain', key: 'imgvizInnerGain', min: 0.2, max: 2, step: 0.05, when: isStyle('imgviz') },
  { label: 'Inner X', key: 'imgvizInnerX', min: 0, max: 100, step: 1, when: isStyle('imgviz') },
  { label: 'Inner Y', key: 'imgvizInnerY', min: 0, max: 100, step: 1, when: isStyle('imgviz') },
  { label: 'Motion amount', key: 'imgvizMotionAmount', min: 0, max: 1, step: 0.05, when: (viz) => viz.style === 'imgviz' && viz.imgvizMotion },
  { label: 'Glow strength', key: 'imgvizGlowStrength', min: 0, max: 1, step: 0.05, when: (viz) => viz.style === 'imgviz' && viz.imgvizGlow },
  { label: 'Bolt density', key: 'imgvizBoltDensity', min: 0, max: 1, step: 0.05, when: (viz) => viz.style === 'imgviz' && viz.imgvizBolt },
  { label: 'Bolt reach', key: 'imgvizBoltLength', min: 0.3, max: 2, step: 0.05, when: (viz) => viz.style === 'imgviz' && viz.imgvizBolt },
]

/** Nudge one style dial and report the move for the toast. */
function applyStyleDial(dial: StyleDial): string | null {
  const { config, patchVisualizer } = useStudioStore.getState()
  const viz = config.visualizer
  if (dial.when && !dial.when(viz)) return null
  const def = (DEFAULT_STUDIO_CONFIG.visualizer as unknown as Record<string, unknown>)[
    dial.key as string
  ]
  if (typeof def !== 'number' || !Number.isFinite(def)) return null
  const value = jitter(def, dial.min, dial.max, dial.step)
  const partial: Partial<VisualizerConfig> = {}
  partial[dial.key] = value
  patchVisualizer(partial)
  return `${dial.label} ${deltaLabel(def, value, dial.min, dial.max)}`
}

/* --------------------------- color tools & filters --------------------------- */

/**
 * Wraps one effect (color tool / filter) into a pickable: the first click on
 * it switches it on (if it was off) and re-dials its numeric parameters to
 * random positions within 25% of the factory defaults. Conditions mirror the
 * UI — a dial that the effect's current sub-mode hides is left alone.
 */
function makeEffect<C extends { enabled: boolean }>(spec: {
  label: string
  get: (config: StudioConfig) => C
  defaults: C
  patch: (partial: Partial<C>) => void
  params: EffectParam<C>[]
}): RandomEffect {
  return {
    label: spec.label,
    apply: () => {
      const cfg = spec.get(useStudioStore.getState().config)
      // Built as a plain string-keyed record — the keys are config keys
      // validated by NumericKeys<C> at each definition site, so the single
      // double-cast at the patch call below is the only untyped spot.
      const partial: Record<string, number | boolean> = {}
      if (!cfg.enabled) partial.enabled = true
      let touched = false
      for (const param of spec.params) {
        if (param.when && !param.when(cfg)) continue
        const def =
          param.def ?? (spec.defaults as unknown as Record<string, unknown>)[param.key as string]
        if (typeof def !== 'number' || !Number.isFinite(def)) continue
        partial[param.key as string] = jitter(def, param.min, param.max, param.step)
        touched = true
      }
      if (!touched && cfg.enabled) return null
      spec.patch(partial as unknown as Partial<C>)
      return cfg.enabled ? spec.label : `${spec.label} on`
    },
  }
}

const param = <C,>(key: NumericKeys<C>, min: number, max: number, step: number) => ({ key, min, max, step })

/** The Filters tab cards (the Layers options are not a look — excluded). */
const FILTER_EFFECTS: RandomEffect[] = [
  makeEffect<ScreenFilterConfig>({
    label: 'CRT screen',
    get: (c) => c.screenFilter,
    defaults: DEFAULT_STUDIO_CONFIG.screenFilter,
    patch: (p) => useStudioStore.getState().patchScreenFilter(p),
    params: [
      { ...param<ScreenFilterConfig>('size', 2, 8, 1), label: 'Mask size' },
      { ...param<ScreenFilterConfig>('scanlines', 0, 1, 0.05), label: 'Scanlines' },
      { ...param<ScreenFilterConfig>('grille', 0, 1, 0.05), label: 'Phosphor mask' },
      { ...param<ScreenFilterConfig>('aberration', 0, 1, 0.05), label: 'Color split' },
      { ...param<ScreenFilterConfig>('glow', 0, 1, 0.05), label: 'Glow' },
    ],
  }),
  makeEffect<VhsFilterConfig>({
    label: 'VHS tape',
    get: (c) => c.vhsFilter,
    defaults: DEFAULT_STUDIO_CONFIG.vhsFilter,
    patch: (p) => useStudioStore.getState().patchVhsFilter(p),
    params: [
      { ...param<VhsFilterConfig>('wobble', 0, 1, 0.05), label: 'Wobble' },
      { ...param<VhsFilterConfig>('tracking', 0, 1, 0.05), label: 'Tracking' },
      { ...param<VhsFilterConfig>('trackingSpeed', 0, 1, 0.05), label: 'Tracking speed' },
      { ...param<VhsFilterConfig>('dust', 0, 1, 0.05), label: 'Dust' },
    ],
  }),
  makeEffect<CamcorderFilterConfig>({
    label: 'Camcorder',
    get: (c) => c.camcorderFilter,
    defaults: DEFAULT_STUDIO_CONFIG.camcorderFilter,
    patch: (p) => useStudioStore.getState().patchCamcorderFilter(p),
    params: [
      { ...param<CamcorderFilterConfig>('resolution', 128, 1024, 1), label: 'Resolution' },
      { ...param<CamcorderFilterConfig>('distortion', 0, 2.5, 0.01), label: 'Distortion' },
      { ...param<CamcorderFilterConfig>('colorFringing', 0, 2, 0.01), label: 'Color fringing' },
      { ...param<CamcorderFilterConfig>('wobble', 0, 2, 0.01), label: 'Wobble' },
      { ...param<CamcorderFilterConfig>('tapeCrease', 0, 2, 0.01), label: 'Tape crease' },
      { ...param<CamcorderFilterConfig>('trackingNoise', 0, 2, 0.01), label: 'Tracking noise' },
      { ...param<CamcorderFilterConfig>('verticalJump', 0, 2, 0.01), label: 'Vertical jump' },
      { ...param<CamcorderFilterConfig>('sparkle', 0, 2, 0.01), label: 'Sparkle' },
      { ...param<CamcorderFilterConfig>('flicker', 0, 2, 0.01), label: 'Flicker' },
      { ...param<CamcorderFilterConfig>('grain', 0, 2, 0.01), label: 'Grain' },
      { ...param<CamcorderFilterConfig>('saturation', 0, 2.5, 0.01), label: 'Saturation' },
      { ...param<CamcorderFilterConfig>('colorShift', 0, 2, 0.01), label: 'Color shift' },
      { ...param<CamcorderFilterConfig>('colorBlend', 0, 1, 0.01), label: 'Color blend' },
      { ...param<CamcorderFilterConfig>('softness', 0.4, 2, 0.01), label: 'Softness' },
      { ...param<CamcorderFilterConfig>('colorDelay', 0, 8, 0.1), label: 'Color delay' },
      { ...param<CamcorderFilterConfig>('sharpening', 0, 2, 0.01), label: 'Sharpening' },
      { ...param<CamcorderFilterConfig>('blur', 0.3, 50, 0.01), label: 'Blur' },
      { ...param<CamcorderFilterConfig>('blurMix', 0, 1, 0.01), label: 'Blur mix' },
      { ...param<CamcorderFilterConfig>('gradeStrength', 0, 1, 0.01), label: 'Grade strength' },
    ],
  }),
  makeEffect<FilmFilterConfig>({
    label: 'Film reel',
    get: (c) => c.filmFilter,
    defaults: DEFAULT_STUDIO_CONFIG.filmFilter,
    patch: (p) => useStudioStore.getState().patchFilmFilter(p),
    params: [
      { ...param<FilmFilterConfig>('scratches', 0, 1, 0.05), label: 'Scratches' },
      { ...param<FilmFilterConfig>('dust', 0, 1, 0.05), label: 'Dust & hair' },
      { ...param<FilmFilterConfig>('speed', 0, 1, 0.05), label: 'Reel speed' },
      { ...param<FilmFilterConfig>('flicker', 0, 1, 0.05), label: 'Flicker' },
    ],
  }),
  makeEffect<TextureFilterConfig>({
    label: 'Texture',
    get: (c) => c.textureFilter,
    defaults: DEFAULT_STUDIO_CONFIG.textureFilter,
    patch: (p) => useStudioStore.getState().patchTextureFilter(p),
    params: [
      { ...param<TextureFilterConfig>('amount', 0, 1, 0.05), label: 'Amount' },
      // The tile-size dial belongs to the built-in materials only — the
      // custom texture has its own Size dial tied to the uploaded map.
      { ...param<TextureFilterConfig>('scale', 0.4, 3, 0.1), label: 'Scale', when: (f) => f.type !== 'custom' },
    ],
  }),
  makeEffect<HalftoneFilterConfig>({
    label: 'Halftone print',
    get: (c) => c.halftoneFilter,
    defaults: DEFAULT_STUDIO_CONFIG.halftoneFilter,
    patch: (p) => useStudioStore.getState().patchHalftoneFilter(p),
    params: [
      { ...param<HalftoneFilterConfig>('dotSize', 3, 14, 1), label: 'Dot size' },
      { ...param<HalftoneFilterConfig>('dotRange', 0, 1, 0.05), label: 'Shadow range' },
      { ...param<HalftoneFilterConfig>('strength', 0, 1, 0.05), label: 'Ink strength' },
      { ...param<HalftoneFilterConfig>('contrast', 0, 1, 0.05), label: 'Contrast' },
    ],
  }),
  makeEffect<GlitchFilterConfig>({
    label: 'Glitch',
    get: (c) => c.glitchFilter,
    defaults: DEFAULT_STUDIO_CONFIG.glitchFilter,
    patch: (p) => useStudioStore.getState().patchGlitchFilter(p),
    params: [
      { ...param<GlitchFilterConfig>('blocks', 0, 1, 0.05), label: 'Blocks' },
      { ...param<GlitchFilterConfig>('slices', 0, 1, 0.05), label: 'Slices' },
      { ...param<GlitchFilterConfig>('rate', 0, 1, 0.05), label: 'Burst rate' },
    ],
  }),
  makeEffect<AnaglyphFilterConfig>({
    label: '3D glasses',
    get: (c) => c.anaglyphFilter,
    defaults: DEFAULT_STUDIO_CONFIG.anaglyphFilter,
    patch: (p) => useStudioStore.getState().patchAnaglyphFilter(p),
    params: [
      { ...param<AnaglyphFilterConfig>('depth', 0, 2.5, 0.05), label: 'Depth' },
      { ...param<AnaglyphFilterConfig>('strength', 0, 1, 0.05), label: 'Mix' },
    ],
  }),
  makeEffect<PhosphorFilterConfig>({
    label: 'Phosphor tube',
    get: (c) => c.phosphorFilter,
    defaults: DEFAULT_STUDIO_CONFIG.phosphorFilter,
    patch: (p) => useStudioStore.getState().patchPhosphorFilter(p),
    params: [
      { ...param<PhosphorFilterConfig>('cellSize', 3, 12, 1), label: 'Cell size' },
      { ...param<PhosphorFilterConfig>('gap', 0, 0.6, 0.05), label: 'Spacing' },
      { ...param<PhosphorFilterConfig>('contrast', 0, 1, 0.05), label: 'Contrast' },
      { ...param<PhosphorFilterConfig>('strength', 0, 1, 0.05), label: 'Strength' },
      { ...param<PhosphorFilterConfig>('glow', 0, 1, 0.05), label: 'Glow' },
    ],
  }),
  makeEffect<ContourFilterConfig>({
    label: 'Contour threads',
    get: (c) => c.contourFilter,
    defaults: DEFAULT_STUDIO_CONFIG.contourFilter,
    patch: (p) => useStudioStore.getState().patchContourFilter(p),
    params: [
      { ...param<ContourFilterConfig>('lines', 24, 160, 2), label: 'Lines' },
      { ...param<ContourFilterConfig>('warp', 0, 1, 0.05), label: 'Warp' },
      { ...param<ContourFilterConfig>('motion', 0, 1, 0.05), label: 'Drift' },
      { ...param<ContourFilterConfig>('reactivity', 0, 1, 0.05), label: 'Reactivity' },
      { ...param<ContourFilterConfig>('glow', 0, 1, 0.05), label: 'Glow' },
      { ...param<ContourFilterConfig>('stillness', 0, 1, 0.05), label: 'Stillness' },
      { ...param<ContourFilterConfig>('waveSpread', 0, 1, 0.05), label: 'Wave spread' },
      { ...param<ContourFilterConfig>('strength', 0, 1, 0.05), label: 'Strength' },
    ],
  }),
  makeEffect<CubifyFilterConfig>({
    label: 'Cubify',
    get: (c) => c.cubifyFilter,
    defaults: DEFAULT_STUDIO_CONFIG.cubifyFilter,
    patch: (p) => useStudioStore.getState().patchCubifyFilter(p),
    params: [
      { ...param<CubifyFilterConfig>('scale', 0, 8, 0.01), label: 'Cube size' },
      { ...param<CubifyFilterConfig>('stretch', -1, 1, 0.01), label: 'Cube stretch' },
      { ...param<CubifyFilterConfig>('depth', 0, 5, 0.01), label: 'Depth distortion' },
      { ...param<CubifyFilterConfig>('angle', 0, 90, 1), label: 'Rotation angle' },
      { ...param<CubifyFilterConfig>('dispersion', 0, 1, 0.001), label: 'Dispersion' },
      { ...param<CubifyFilterConfig>('blend', 0, 1, 0.05), label: 'Mix' },
    ],
  }),
  makeEffect<DitherFilterConfig>({
    label: 'Retro dither',
    get: (c) => c.ditherFilter,
    defaults: DEFAULT_STUDIO_CONFIG.ditherFilter,
    patch: (p) => useStudioStore.getState().patchDitherFilter(p),
    params: [
      // MacPaint mode swaps the dials for its own set (mirrors the UI).
      { ...param<DitherFilterConfig>('macThreshold', 0, 1, 0.01), label: 'Threshold', when: (f) => f.mode === 'macpaint' },
      { ...param<DitherFilterConfig>('macContrast', 0.1, 4, 0.05), label: 'Contrast', when: (f) => f.mode === 'macpaint' },
      { ...param<DitherFilterConfig>('macGrain', 0, 1, 0.05), label: 'Grain', when: (f) => f.mode === 'macpaint' },
      { ...param<DitherFilterConfig>('macSmoothing', 0, 3, 1), label: 'Smooth', when: (f) => f.mode === 'macpaint' },
      { ...param<DitherFilterConfig>('macSharpen', -1, 2, 0.05), label: 'Sharpen', when: (f) => f.mode === 'macpaint' },
      { ...param<DitherFilterConfig>('macRadius', 0.5, 5, 0.1), label: 'Radius', when: (f) => f.mode === 'macpaint' },
      { ...param<DitherFilterConfig>('cellSize', 2, 14, 1), label: 'Dot size', when: (f) => f.mode !== 'macpaint' },
      { ...param<DitherFilterConfig>('contrast', 0, 1, 0.05), label: 'Contrast', when: (f) => f.mode !== 'macpaint' },
      { ...param<DitherFilterConfig>('glow', 0, 1, 0.05), label: 'Glow', when: (f) => f.mode !== 'macpaint' },
      { ...param<DitherFilterConfig>('strength', 0, 1, 0.05), label: 'Strength' },
    ],
  }),
]

/** The Color tab tools. */
const COLOR_EFFECTS: RandomEffect[] = [
  makeEffect<NeonSplitFilterConfig>({
    label: 'Neon Split',
    get: (c) => c.neonSplitFilter,
    defaults: DEFAULT_STUDIO_CONFIG.neonSplitFilter,
    patch: (p) => useStudioStore.getState().patchNeonSplitFilter(p),
    params: [
      { ...param<NeonSplitFilterConfig>('mapAmount', 0, 1, 0.05), label: 'Opacity' },
      { ...param<NeonSplitFilterConfig>('mapShift', -1, 1, 0.01), label: 'Gradient shift', def: 0 },
      { ...param<NeonSplitFilterConfig>('mapRepeat', 1, 8, 1), label: 'Gradient repeat', def: 1 },
      { ...param<NeonSplitFilterConfig>('glow', 0, 1, 0.05), label: 'Bloom intensity' },
      { ...param<NeonSplitFilterConfig>('bloomThreshold', 0, 1, 0.05), label: 'Bloom threshold' },
      { ...param<NeonSplitFilterConfig>('bloomSoftness', 0, 1, 0.05), label: 'Bloom softness' },
      { ...param<NeonSplitFilterConfig>('bloomMix', 0, 1, 0.05), label: 'Bloom mix' },
      { ...param<NeonSplitFilterConfig>('grain', 0, 1, 0.05), label: 'Film grain' },
      { ...param<NeonSplitFilterConfig>('grainSpeed', 0, 1, 0.05), label: 'Grain speed' },
      { ...param<NeonSplitFilterConfig>('grainSize', 0, 1, 0.05), label: 'Grain size' },
      { ...param<NeonSplitFilterConfig>('grainChroma', 0, 1, 0.05), label: 'Grain color' },
      { ...param<NeonSplitFilterConfig>('grainShadow', 0, 1, 0.05), label: 'Shadow grain' },
      { ...param<NeonSplitFilterConfig>('grainHighlight', 0, 1, 0.05), label: 'Highlight grain' },
      { ...param<NeonSplitFilterConfig>('contrast', 0, 1, 0.05), label: 'Contrast' },
      { ...param<NeonSplitFilterConfig>('split', 0, 1, 0.05), label: 'Split' },
      { ...param<NeonSplitFilterConfig>('strength', 0, 1, 0.05), label: 'Mix' },
    ],
  }),
  makeEffect<ColorGradeFilterConfig>({
    label: 'Color grade',
    get: (c) => c.colorGradeFilter,
    defaults: DEFAULT_STUDIO_CONFIG.colorGradeFilter,
    patch: (p) => useStudioStore.getState().patchColorGradeFilter(p),
    params: [
      { ...param<ColorGradeFilterConfig>('strength', 0, 1, 0.05), label: 'Strength' },
      { ...param<ColorGradeFilterConfig>('contrast', 0, 1, 0.05), label: 'Contrast' },
      // Warmth dresses the sepia look only, exactly like the UI.
      { ...param<ColorGradeFilterConfig>('warmth', 0, 1, 0.05), label: 'Warmth', when: (f) => f.look === 'sepia' },
    ],
  }),
  makeEffect<GradientMapFilterConfig>({
    label: 'Gradient map',
    get: (c) => c.gradientMapFilter,
    defaults: DEFAULT_STUDIO_CONFIG.gradientMapFilter,
    patch: (p) => useStudioStore.getState().patchGradientMapFilter(p),
    params: [
      { ...param<GradientMapFilterConfig>('opacity', 0, 1, 0.01), label: 'Opacity' },
      { ...param<GradientMapFilterConfig>('shift', -1, 1, 0.01), label: 'Gradient shift' },
      { ...param<GradientMapFilterConfig>('repeat', 1, 8, 1), label: 'Gradient repeat' },
      { ...param<GradientMapFilterConfig>('shiftSpeed', 0, 1, 0.05), label: 'Speed', when: (f) => f.shiftMode === 'continuous' },
      { ...param<GradientMapFilterConfig>('beatStep', 0.05, 1, 0.05), label: 'Beat step', when: (f) => f.shiftMode === 'beat' },
      { ...param<GradientMapFilterConfig>('beatSens', 0, 1, 0.05), label: 'Kick sensitivity', when: (f) => f.shiftMode === 'beat' },
      { ...param<GradientMapFilterConfig>('beatEase', 0.02, 0.6, 0.02), label: 'Glide', when: (f) => f.shiftMode === 'beat' },
    ],
  }),
  makeEffect<ExposureFilterConfig>({
    label: 'Exposure',
    get: (c) => c.exposureFilter,
    defaults: DEFAULT_STUDIO_CONFIG.exposureFilter,
    patch: (p) => useStudioStore.getState().patchExposureFilter(p),
    params: [
      { ...param<ExposureFilterConfig>('color', 0, 2, 0.01), label: 'Color' },
      { ...param<ExposureFilterConfig>('light', 0, 2, 0.01), label: 'Light' },
    ],
  }),
  makeEffect<HalationFilterConfig>({
    label: 'Halation',
    get: (c) => c.halationFilter,
    defaults: DEFAULT_STUDIO_CONFIG.halationFilter,
    patch: (p) => useStudioStore.getState().patchHalationFilter(p),
    params: [
      { ...param<HalationFilterConfig>('threshold', 0, 1, 0.01), label: 'Threshold' },
      { ...param<HalationFilterConfig>('knee', 0.01, 0.8, 0.01), label: 'Knee' },
      { ...param<HalationFilterConfig>('boost', 0, 1, 0.01), label: 'Boost' },
      { ...param<HalationFilterConfig>('localDiffusion', 0.005, 0.2, 0.005), label: 'Local glow' },
      { ...param<HalationFilterConfig>('globalDiffusion', 0, 0.4, 0.005), label: 'Global halo' },
      { ...param<HalationFilterConfig>('intensity', 0, 1, 0.01), label: 'Intensity' },
      { ...param<HalationFilterConfig>('backgroundGain', 0, 1, 0.01), label: 'Background gain' },
      { ...param<HalationFilterConfig>('blueComp', 0, 1, 0.01), label: 'Compensation' },
    ],
  }),
]

/* --------------------------------- the entry --------------------------------- */

export interface RandomizeSummary {
  /** Human-readable list of what moved, for the toast — e.g. "Bar count +18% · VHS tape on". */
  changed: string[]
}

/**
 * Roll one randomized variation of the current look: 1–2 style dials,
 * 0–2 color tools and 0–2 filters, every picked dial within ±25% of its
 * factory default on the slider track. Applies the patches to the studio
 * store and returns what moved.
 */
export function randomizeLook(): RandomizeSummary {
  const changed: string[] = []

  // Style: always 1–2 dials (the eligible pool is never empty — five dials
  // apply to every style).
  const viz = useStudioStore.getState().config.visualizer
  const eligible = STYLE_DIALS.filter((dial) => !dial.when || dial.when(viz))
  const styleCount = 1 + Math.floor(Math.random() * 2)
  for (const dial of pickRandom(eligible, styleCount)) {
    const label = applyStyleDial(dial)
    if (label) changed.push(label)
  }

  // Color tools: 0–2.
  const colorCount = Math.floor(Math.random() * 3)
  for (const effect of pickRandom(COLOR_EFFECTS, colorCount)) {
    const label = effect.apply()
    if (label) changed.push(label)
  }

  // Filters: 0–2.
  const filterCount = Math.floor(Math.random() * 3)
  for (const effect of pickRandom(FILTER_EFFECTS, filterCount)) {
    const label = effect.apply()
    if (label) changed.push(label)
  }

  return { changed }
}
