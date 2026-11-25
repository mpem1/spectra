'use client'

/**
 * The look randomizer — one click, one fresh look. Never cumulative.
 *
 * Every click starts by sweeping the slate clean: every style dial the
 * randomizer owns returns to its factory value, and every color tool /
 * filter it owns is switched off with its dials back at factory defaults —
 * so nothing from a previous roll (or an earlier tweak to a dial it owns)
 * stacks on top of the next one.
 *
 * Onto that clean slate it picks:
 *  - a different visualizer style card (the shape itself — Bars → Wave → …;
 *    Image only joins the pool when artwork is actually uploaded, since
 *    without it the style is an empty placeholder frame),
 *  - 1–2 style dials (visualizer sliders, drawn only from the ones the
 *    freshly picked style actually shows),
 *  - 0–2 color tools (the Color tab effects),
 *  - 0–2 filters (the Filters tab effects),
 *
 * and moves each picked dial to a random position within 25% of its factory
 * default — positive or negative along the horizontal slider track (always
 * at least one step, so a pick is a real, visible change; zero-default dials
 * therefore move too) — switching each picked effect on. Every picked effect
 * also re-rolls its COLOR options: preset selectors (Neon Split's ramp, the
 * color grade's look, the gradient map's ramp library, the instant-film
 * stock, the dither palette) land a random preset, and color fields (halo
 * tint, inks, papers, lens tints, custom-texture tints) get fresh random
 * colors in their own role — glows stay bright, backings stay dark, tints
 * stay tasteful. Choices the randomizer doesn't own are never touched: the
 * current style itself, gradients outside these effects, text, uploaded
 * images, blend modes, sub-modes.
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
  type VisualizerStyle,
  type VhsFilterConfig,
} from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { RAMPS } from '@/lib/visualizer/neon-split-data'
import { EXPOSURE_STOCKS } from '@/lib/visualizer/exposure-filter'

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

/* ------------------------------ random colors ------------------------------- */

/** hsl(h° 0–360, s 0–1, l 0–1) → '#rrggbb' — the roll's color vocabulary. */
function hslHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hue < 60) {
    r = c
    g = x
  } else if (hue < 120) {
    r = x
    g = c
  } else if (hue < 180) {
    g = c
    b = x
  } else if (hue < 240) {
    g = x
    b = c
  } else if (hue < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const hex = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v + m)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

const randHue = () => Math.random() * 360

/** Vivid glow — the ink/glow/tint role: bright, saturated, any hue. */
function vividColor(): string {
  return hslHex(randHue(), 0.72 + Math.random() * 0.23, 0.52 + Math.random() * 0.14)
}

/** Deep backing — the tube/paper-behind-the-glow role: dark, hue-tinted. */
function deepColor(): string {
  return hslHex(randHue(), 0.55 + Math.random() * 0.35, 0.06 + Math.random() * 0.1)
}

/** Print ink — the dark print role (halftone ink, MacPaint ink). */
function printInkColor(): string {
  return hslHex(randHue(), 0.45 + Math.random() * 0.4, 0.09 + Math.random() * 0.14)
}

/** Print paper — the bright paper role (MacPaint paper, halftone backdrop). */
function printPaperColor(): string {
  return hslHex(randHue(), 0.25 + Math.random() * 0.45, 0.88 + Math.random() * 0.09)
}

/** A bright lighting tint (the custom texture's highlight color). */
function highlightTint(): string {
  return hslHex(randHue(), 0.4 + Math.random() * 0.4, 0.66 + Math.random() * 0.16)
}

/** A deep lighting tint (the custom texture's shadow color). */
function shadowTint(): string {
  return hslHex(randHue(), 0.4 + Math.random() * 0.3, 0.1 + Math.random() * 0.12)
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

/** One color option inside an effect — a set of '#rrggbb' config fields the
 *  roll recolors together (an ink+paper pair, a lens stack) so related
 *  colors always coordinate. */
interface EffectColor<C> {
  label: string
  /** The config fields this entry owns (also what reset restores). */
  keys: (keyof C & string)[]
  /** Rolls the new colors — one entry may write several fields at once;
   *  values are hex strings or arrays of them (the 3D glasses' tint stacks). */
  roll: (view: C) => Record<string, unknown>
  /** Only randomized while this passes (mirrors the UI's visibility). */
  when?: (view: C) => boolean
}

/** One preset selector inside an effect — the roll lands a random option in
 *  the field (a ramp, a film stock, a palette). */
interface EffectPreset<C> {
  label: string
  key: keyof C & string
  options: readonly string[]
  /** Toast names per option id (falls back to the id). */
  names: Record<string, string>
  /** Only randomized while this passes. */
  when?: (view: C) => boolean
  /** Extra patch a chosen option carries — a ramp preset also loads its
   *  stops into the editable gradient map, exactly like the UI chip. */
  extra?: (id: string) => Record<string, unknown> | null
  /** Extra fields reset must restore for this preset (factory state the
   *  defaults object doesn't carry — e.g. Neon Split's optional mapStops). */
  reset?: Record<string, unknown>
}

/** A color tool / filter the randomizer may switch on and re-dial. */
interface RandomEffect {
  label: string
  /** Returns the toast label, or null when nothing could be randomized. */
  apply: () => string | null
  /** Switch the effect off and return every dial it owns to factory default. */
  reset: () => void
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
 * The Style tab's visualizer cards, mirrored for the roll — same ids as the
 * tab's STYLES list (keep in sync) plus toast labels.
 */
const VISUALIZER_STYLES: { id: VisualizerStyle; label: string }[] = [
  { id: 'bars', label: 'Bars' },
  { id: 'wave', label: 'Wave' },
  { id: 'radial', label: 'Radial' },
  { id: 'particles', label: 'Particles' },
  { id: 'blob', label: 'Blob' },
  { id: 'grid', label: 'Grid' },
  { id: 'ribbon', label: 'Ribbon' },
  { id: 'perspective', label: 'Perspective' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'sphere', label: 'Sphere' },
  { id: 'dotsphere', label: 'Dot Sphere' },
  { id: 'serato', label: 'Serato' },
  { id: 'imgviz', label: 'Image' },
]

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
 * Wraps one effect (color tool / filter) into a pickable. `apply` switches it
 * on (if it was off), lands random picks in its preset selectors, re-dials
 * its numeric parameters to random positions within 25% of the factory
 * defaults and re-rolls its color options in their own roles; conditions
 * mirror the UI — a dial, color or preset that the effect's current sub-mode
 * hides is left alone, and presets are rolled FIRST so a palette switch can
 * gate which colors and dials the rest of the roll touches (the dither's
 * palette decides which inks exist). `reset` sweeps the effect off and back
 * to factory defaults — every dial, color and preset it owns, regardless of
 * sub-mode conditions, so a mode switch never hides a stale value. Fields
 * outside the registry (blend modes, sub-modes, uploaded images) survive
 * both operations.
 */
function makeEffect<C extends { enabled: boolean }>(spec: {
  label: string
  get: (config: StudioConfig) => C
  defaults: C
  patch: (partial: Partial<C>) => void
  params: EffectParam<C>[]
  colors?: EffectColor<C>[]
  presets?: EffectPreset<C>[]
}): RandomEffect {
  // Stops arrays and tint stacks are plain JSON — a deep clone keeps every
  // editor (gradient editor, lens stack) from ever mutating the factory
  // defaults through a shared reference.
  const cloneDefault = (v: unknown): unknown =>
    Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : v

  return {
    label: spec.label,
    reset: () => {
      // Off + factory dials, colors and presets, unconditionally — writing a
      // default into a field the current sub-mode hides is a no-op visually
      // and guarantees the slate is clean for the next roll.
      const partial: Record<string, unknown> = { enabled: false }
      for (const param of spec.params) {
        const def =
          param.def ?? (spec.defaults as unknown as Record<string, unknown>)[param.key as string]
        if (typeof def !== 'number' || !Number.isFinite(def)) continue
        partial[param.key as string] = def
      }
      for (const preset of spec.presets ?? []) {
        const def = (spec.defaults as unknown as Record<string, unknown>)[preset.key as string]
        if (def !== undefined) partial[preset.key as string] = cloneDefault(def)
        if (preset.reset) Object.assign(partial, preset.reset)
      }
      for (const color of spec.colors ?? []) {
        for (const key of color.keys) {
          const def = (spec.defaults as unknown as Record<string, unknown>)[key]
          if (def !== undefined) partial[key] = cloneDefault(def)
        }
      }
      spec.patch(partial as unknown as Partial<C>)
    },
    apply: () => {
      const cfg = spec.get(useStudioStore.getState().config)
      // Built as a plain string-keyed record — the keys are config keys
      // validated by NumericKeys<C>/keyof C at each definition site, so the
      // single double-cast at the patch call below is the only untyped spot.
      const partial: Record<string, unknown> = {}
      // The view tracks every value this roll has landed — presets may gate
      // dials and colors (the dither's palette decides which inks exist),
      // so every `when` tests the roll's own state, not the stale config.
      let view: C = { ...cfg }
      const picks: string[] = []
      if (!cfg.enabled) {
        partial.enabled = true
        view = { ...view, enabled: true }
      }
      // Preset selectors first — a palette switch gates what the rest of
      // the roll may touch.
      for (const preset of spec.presets ?? []) {
        if (preset.when && !preset.when(view)) continue
        const id = preset.options[Math.floor(Math.random() * preset.options.length)]
        if (id === undefined) continue
        partial[preset.key as string] = id
        view = { ...view, [preset.key]: id } as unknown as C
        const extra = preset.extra?.(id)
        if (extra) {
          Object.assign(partial, extra)
          view = { ...view, ...(extra as Partial<C>) } as unknown as C
        }
        picks.push(preset.names[id] ?? id)
      }
      let touched = picks.length > 0
      for (const param of spec.params) {
        if (param.when && !param.when(view)) continue
        const def =
          param.def ?? (spec.defaults as unknown as Record<string, unknown>)[param.key as string]
        if (typeof def !== 'number' || !Number.isFinite(def)) continue
        const value = jitter(def, param.min, param.max, param.step)
        partial[param.key as string] = value
        view = { ...view, [param.key]: value } as unknown as C
        touched = true
      }
      for (const color of spec.colors ?? []) {
        if (color.when && !color.when(view)) continue
        Object.assign(partial, color.roll(view))
        touched = true
      }
      if (!touched && cfg.enabled) return null
      spec.patch(partial as unknown as Partial<C>)
      const on = cfg.enabled ? '' : ' on'
      const note = picks.length ? ` (${picks.join(', ')})` : ''
      return `${spec.label}${on}${note}`
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
    colors: [
      {
        label: 'Highlight tint',
        keys: ['customHighlightColor'],
        when: (v) => v.type === 'custom',
        roll: () => ({ customHighlightColor: highlightTint() }),
      },
      {
        label: 'Shadow tint',
        keys: ['customShadowColor'],
        when: (v) => v.type === 'custom',
        roll: () => ({ customShadowColor: shadowTint() }),
      },
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
    colors: [
      {
        label: 'Ink',
        keys: ['inkColor'],
        roll: () => ({ inkColor: printInkColor() }),
      },
      {
        label: 'Gradient ink',
        keys: ['inkColor2'],
        when: (v) => v.gradient,
        roll: () => ({ inkColor2: vividColor() }),
      },
      {
        label: 'Backdrop',
        keys: ['backdropColor'],
        // The backdrop only shows while a poster mode is up.
        when: (v) => v.printOnly || v.gradient || v.imageFill,
        roll: () => ({ backdropColor: printPaperColor() }),
      },
      {
        label: 'Backdrop gradient',
        keys: ['backdropColor2'],
        when: (v) => (v.printOnly || v.gradient || v.imageFill) && v.backdropGradient,
        roll: () => ({ backdropColor2: vividColor() }),
      },
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
    colors: [
      {
        label: 'Lens tints',
        keys: ['leftColors', 'rightColors'],
        // Complementary hues — any pair keeps the classic channel
        // separation (red↔cyan by construction); extra slots trail as
        // tracer echoes one hue-step apart, matching the stack order.
        roll: (v) => {
          const n = Math.min(4, Math.max(1, v.leftColors?.length ?? 1))
          const h = randHue()
          const side = (base: number) =>
            Array.from(
              { length: n },
              (_, i) => hslHex(base + i * 26, 0.9, 0.5 + Math.random() * 0.06),
            )
          return { leftColors: side(h), rightColors: side(h + 180) }
        },
      },
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
    colors: [
      {
        label: 'Phosphor & tube',
        keys: ['inkColor', 'paperColor'],
        roll: () => ({ inkColor: vividColor(), paperColor: deepColor() }),
      },
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
    colors: [
      {
        label: 'Thread & tube',
        keys: ['inkColor', 'paperColor'],
        roll: () => ({ inkColor: vividColor(), paperColor: deepColor() }),
      },
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
    presets: [
      {
        label: 'Palette',
        key: 'mode',
        options: ['blue', 'mono', 'color', 'custom', 'macpaint'],
        names: { blue: 'Blue glow', mono: 'B&W', color: 'Color', custom: 'Custom', macpaint: 'MacPaint' },
      },
    ],
    colors: [
      {
        label: 'Blue glow',
        keys: ['blueInkColor', 'bluePaperColor'],
        when: (v) => v.mode === 'blue',
        roll: () => ({ blueInkColor: vividColor(), bluePaperColor: deepColor() }),
      },
      {
        label: 'Custom palette',
        keys: ['inkColor', 'paperColor'],
        when: (v) => v.mode === 'custom',
        roll: () => ({ inkColor: vividColor(), paperColor: deepColor() }),
      },
      {
        label: 'MacPaint inks',
        keys: ['macInkColor', 'macPaperColor'],
        when: (v) => v.mode === 'macpaint',
        roll: () => ({ macInkColor: printInkColor(), macPaperColor: printPaperColor() }),
      },
    ],
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
    presets: [
      {
        label: 'Ramp',
        key: 'ramp',
        options: ['violet', 'uv', 'acid', 'ember', 'ice'],
        names: { violet: 'Violet neon', uv: 'UV', acid: 'Acid', ember: 'Ember', ice: 'Ice' },
        // The UI's ramp chips load their stops into the editable gradient
        // map — the roll does exactly that, so the editor and the look agree.
        extra: (id) => {
          const stops = RAMPS[id]
          return stops ? { mapStops: stops.map((s) => ({ ...s })) } : null
        },
        // The factory state derives the map from the ramp (no mapStops).
        reset: { mapStops: undefined },
      },
    ],
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
    presets: [
      {
        label: 'Grade',
        key: 'look',
        options: ['bw', 'sepia'],
        names: { bw: 'Black & white', sepia: 'Sepia' },
      },
    ],
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
    presets: [
      {
        label: 'Ramp',
        key: 'preset',
        // The built-in ramp library only — 'custom' is the user's own
        // editable stops and never a random pick.
        options: ['neon', 'uv', 'acid', 'ember', 'ice', 'sunset', 'magma', 'gold', 'rose', 'mono'],
        names: {
          neon: 'Neon',
          uv: 'UV',
          acid: 'Acid',
          ember: 'Ember',
          ice: 'Ice',
          sunset: 'Sunset',
          magma: 'Magma',
          gold: 'Gold',
          rose: 'Rose',
          mono: 'Mono',
        },
      },
    ],
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
    presets: [
      {
        label: 'Stock',
        key: 'stock',
        options: EXPOSURE_STOCKS.map((s) => s.id),
        names: Object.fromEntries(EXPOSURE_STOCKS.map((s) => [s.id, s.label])),
      },
    ],
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
    colors: [
      { label: 'Halo tint', keys: ['tint'], roll: () => ({ tint: vividColor() }) },
    ],
  }),
]

/* --------------------------------- the entry --------------------------------- */

export interface RandomizeSummary {
  /** Human-readable list of what moved, for the toast — e.g. "Bar count +18% · VHS tape on". */
  changed: string[]
}

/**
 * Roll one fresh look: first default everything the randomizer owns (so
 * previous picks never stack), then switch to a different visualizer style
 * and pick 1–2 of its dials, 0–2 color tools and 0–2 filters, every picked
 * dial within ±25% of its factory default on the slider track. Applies the
 * patches to the studio store and returns what moved.
 */
export function randomizeLook(): RandomizeSummary {
  const changed: string[] = []

  /* ------------------------- clean slate ------------------------- */

  // Style dials: every dial the randomizer owns goes back to its factory
  // value — including dials the current style hides, so no stale jitter
  // resurfaces after a style switch. One patch for the whole sweep.
  const styleReset: Record<string, number> = {}
  for (const dial of STYLE_DIALS) {
    const def = (DEFAULT_STUDIO_CONFIG.visualizer as unknown as Record<string, unknown>)[
      dial.key as string
    ]
    if (typeof def === 'number' && Number.isFinite(def)) styleReset[dial.key as string] = def
  }
  useStudioStore.getState().patchVisualizer(styleReset as Partial<VisualizerConfig>)

  // Color tools & filters: off, dials back to factory. Their non-dial
  // fields (sub-modes, gradients, colors, uploaded images) survive.
  for (const effect of COLOR_EFFECTS) effect.reset()
  for (const effect of FILTER_EFFECTS) effect.reset()

  /* -------------------------- fresh roll -------------------------- */

  // The style card itself: always switch to a different visualizer, so the
  // shape of the scene changes on every click. Image style joins the pool
  // only when artwork is uploaded — without it the style is an empty
  // placeholder frame, never a look worth rolling.
  const vizBefore = useStudioStore.getState().config.visualizer
  const stylePool = VISUALIZER_STYLES.filter(
    (s) => s.id !== vizBefore.style && (s.id !== 'imgviz' || !!vizBefore.imgvizSrc),
  )
  const nextStyle = pickRandom(stylePool, 1)[0]
  if (nextStyle) {
    useStudioStore.getState().patchVisualizer({ style: nextStyle.id })
    changed.push(`Style → ${nextStyle.label}`)
  }

  // Style: always 1–2 dials (the eligible pool is never empty — five dials
  // apply to every style). Eligibility is checked against the freshly
  // switched style, mirroring the sliders its tab now shows.
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
