/**
 * Gradient map — effect.app's Gradient Map effect as its own Color-tab
 * stage. Every pixel's Rec.709 luminance re-reads as a position on a
 * gradient ramp, and the mapped color lands on the pixel through a blend
 * mode at an opacity — the same engine node the Neon Split preset runs,
 * rebuilt here as a standalone, fully dialable pass (the per-channel
 * blend math is the site's own gradient-map shader, already ported and
 * verified byte-level for the Neon Split CPU path — this file shares it).
 *
 * What's on dials, mirroring the site's feature one-for-one:
 *   - Gradient map   — the ramp itself: ten built-in presets, 'neon'
 *     being the Neon Split preset's own gradient (verbatim stops) —
 *     plus a CUSTOM ramp whose stops the user edits in place (2..8
 *     color stops with positions, seeded from the house look).
 *   - Blend          — the map node's five modes (normal / multiply /
 *     screen / overlay / add), exact per-channel shader math.
 *   - Opacity        — the mapped color mixed back toward the original
 *     (1 = the full map, 0 = the untouched picture).
 *   - Gradient shift — the ramp window slides along the luminance axis,
 *     wrapped (colors that slide off one end re-enter from the other).
 *   - Gradient repeat— the ramp tiles across the luminance range.
 *
 * Spectra's own extension on top — the window can CYCLE:
 *   - Continuous: the shift auto-advances on the style clock (wall clock
 *     live so the look stays alive while paused, song time in exports —
 *     the same determinism contract as every decorative motion here).
 *   - React to beat: every detected kick — the shared flipGate sub-band
 *     onset detector the halftone print, the 3D glasses and the polaroid
 *     kicks already ride — advances the window one step (a Beat step
 *     dial), and the mode carries its own full control set: a Kick
 *     sensitivity dial (the flipGate sens input — only slams vs every
 *     hit), a Direction chooser (forward climbs the ramp per kick,
 *     backward walks down it, ping-pong sweeps up then back), and a
 *     Glide dial for how long each step takes to ease in.
 *
 * Performance: the ramp is a cached 256-entry LUT (rebuilt only when the
 * preset's stops change), so the per-frame work is ONE luma + one window
 * wrap + one LUT lookup + the blend math per pixel — the same cost class
 * as the Exposure trilinear pass, far below the Neon Split chain.
 * Deterministic (same frame in, same pixels out); skipped on transparent
 * backgrounds like every full-frame filter.
 */
import type { AudioFrame, GradientMapFilterConfig, GradientMapPresetId, RenderContext } from './types'
import { clamp01, getWork, resetWork } from './filter-utils'
import { flipGate } from './halftone-filter'
import { gradientLutPixelsFromStops, RAMPS, type RampStop } from './neon-split-data'

/* -------------------------------- presets --------------------------------- */

/** The ten built-in ramps. The first five are the Neon Split ramp family
 *  (imported verbatim so both features stay glued); the rest cover the
 *  classic map families — sunset duotone, thermal camera, gold, rose and
 *  the pure mono ramp. */
export const GRADIENT_MAP_PRESETS: {
  id: GradientMapPresetId
  label: string
  sub: string
  stops: RampStop[]
}[] = [
  { id: 'neon', label: 'Neon', sub: 'the house look', stops: RAMPS.violet },
  { id: 'uv', label: 'UV', sub: 'electric violet', stops: RAMPS.uv },
  { id: 'acid', label: 'Acid', sub: 'radioactive green', stops: RAMPS.acid },
  { id: 'ember', label: 'Ember', sub: 'furnace orange', stops: RAMPS.ember },
  { id: 'ice', label: 'Ice', sub: 'glacial cyan', stops: RAMPS.ice },
  {
    id: 'sunset',
    label: 'Sunset',
    sub: 'wine to gold',
    stops: [
      { t: 0, c: '#14001f' },
      { t: 0.42, c: '#7a1e46' },
      { t: 0.72, c: '#ff5e3a' },
      { t: 1, c: '#ffd166' },
    ],
  },
  {
    id: 'magma',
    label: 'Magma',
    sub: 'thermal camera',
    stops: [
      { t: 0, c: '#02020a' },
      { t: 0.3, c: '#3b0f70' },
      { t: 0.55, c: '#8c2981' },
      { t: 0.75, c: '#de4968' },
      { t: 0.9, c: '#fe9f6d' },
      { t: 1, c: '#fcfdbf' },
    ],
  },
  {
    id: 'gold',
    label: 'Gold',
    sub: 'bullion shine',
    stops: [
      { t: 0, c: '#0d0700' },
      { t: 0.4, c: '#4d2c06' },
      { t: 0.75, c: '#c98f1b' },
      { t: 1, c: '#ffe9b3' },
    ],
  },
  {
    id: 'rose',
    label: 'Rose',
    sub: 'hot pink bloom',
    stops: [
      { t: 0, c: '#180209' },
      { t: 0.45, c: '#6e0f2e' },
      { t: 0.8, c: '#ff4d6d' },
      { t: 1, c: '#ffd6de' },
    ],
  },
  {
    id: 'mono',
    label: 'Mono',
    sub: 'pure black & white',
    stops: [
      { t: 0, c: '#000000' },
      { t: 1, c: '#ffffff' },
    ],
  },
]

const presetFor = (id: string): RampStop[] =>
  GRADIENT_MAP_PRESETS.find((p) => p.id === id)?.stops ?? GRADIENT_MAP_PRESETS[0].stops

/** Ramp CSS for UI swatches, from explicit stops (the Custom editor's
 *  live preview reads this). */
export function gradientStopsCss(stops: { t: number; c: string }[]): string {
  const sorted = [...stops].sort((a, b) => a.t - b.t)
  return `linear-gradient(90deg,${sorted.map((s) => `${s.c} ${Math.round(s.t * 100)}%`).join(',')})`
}

/** Ramp CSS for the UI preset swatches. */
export function gradientPresetCss(id: string): string {
  return gradientStopsCss(presetFor(id))
}

/* ------------------------------ custom ramp -------------------------------- */

const HEX6 = /^#[0-9a-fA-F]{6}$/

/** The Custom ramp's stops, garbage-proofed: 2..8 entries, each a finite
 *  position clamped into 0..1 and a #rrggbb color; anything else (or too
 *  few valid stops) falls back to the house ramp so the pass can never
 *  crash or render black from a corrupted save. */
export function sanitizeCustomStops(raw: unknown): RampStop[] {
  const fallback = GRADIENT_MAP_PRESETS[0].stops
  if (!Array.isArray(raw)) return fallback
  const clean: RampStop[] = []
  for (const s of raw) {
    if (typeof s !== 'object' || s === null) continue
    const t = (s as { t?: unknown }).t
    const c = (s as { c?: unknown }).c
    if (typeof t !== 'number' || !Number.isFinite(t)) continue
    if (typeof c !== 'string' || !HEX6.test(c)) continue
    clean.push({ t: Math.min(1, Math.max(0, t)), c: c.toLowerCase() })
  }
  if (clean.length < 2) return fallback
  return clean.slice(0, 8)
}

/* ------------------------------- blend modes ------------------------------- */

/** effect.app's map-node Blend dropdown — the same ids and order the
 *  Neon Split pass runs. */
export const GRADIENT_MAP_BLENDS: { id: GradientMapFilterConfig['blend']; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'add', label: 'Add' },
]

const BLEND_IDS = ['normal', 'multiply', 'screen', 'overlay', 'add'] as const

/* -------------------------------- ramp cache ------------------------------- */

/** 256-entry sRGB ramp LUTs, cached per stop set (preset switches are
 *  free; the per-pixel loop reads three bytes per sample). */
const rampLuts = new Map<string, Uint8ClampedArray>()

function rampKey(stops: RampStop[]): string {
  return stops.map((s) => `${Math.round(s.t * 1000)}:${s.c}`).join('|')
}

function rampLut(stops: RampStop[]): Uint8ClampedArray {
  const key = rampKey(stops)
  const hit = rampLuts.get(key)
  if (hit) return hit
  const px = gradientLutPixelsFromStops(stops)
  const lut = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    lut[i * 3] = px[i * 4]
    lut[i * 3 + 1] = px[i * 4 + 1]
    lut[i * 3 + 2] = px[i * 4 + 2]
  }
  // Every Custom-stop drag builds a fresh 768-byte LUT entry; cap the
  // cache so a long editing session can't grow it without bound.
  if (rampLuts.size > 96) rampLuts.clear()
  rampLuts.set(key, lut)
  return lut
}

/* ------------------------------ beat cycling ------------------------------- */

/**
 * Kick-driven window position for the 'beat' motion mode: the shared
 * flipGate detector (sub-band onsets — fires once on the hit, never on
 * sustained bass or swells) marks each kick, and every kick advances the
 * window one Beat step along the chosen Direction — forward climbs the
 * ramp per kick, backward walks down it, bounce ping-pongs (forward a
 * full sweep, then back down, over and over). The advance eases in over
 * the Glide dial's time (from wherever the window actually is, so dial
 * and direction changes never jump) so the colors roll instead of
 * strobing. State lives per canvas (preview and export each get their
 * own), so live preview and offline export evolve the exact same window
 * sequence; a seek / loop restart (song time moving backward) drops the
 * count like every flipGate consumer.
 */
interface BeatShiftState {
  kicks: number
  prevEnv: number
  lastT: number
  /** Window position the glide eases FROM (where the window actually is). */
  from: number
  /** The last returned position — the next kick's glide origin. */
  lastPos: number
  kickT: number
}

const beatStates = new Map<CanvasRenderingContext2D, BeatShiftState>()

function beatShiftFor(
  ctx: CanvasRenderingContext2D,
  sub: number,
  time: number,
  step: number,
  sens: number,
  ease: number,
  dir: 'forward' | 'backward' | 'bounce',
): number {
  let st = beatStates.get(ctx)
  if (!st) {
    st = { kicks: 0, prevEnv: 0, lastT: time, from: 0, lastPos: 0, kickT: -Infinity }
    beatStates.set(ctx, st)
  }
  if (time < st.lastT) {
    // Seek / loop restart — the count and the glide are stale.
    st.kicks = 0
    st.prevEnv = 0
    st.from = 0
    st.lastPos = 0
    st.kickT = -Infinity
  }
  const env = flipGate(ctx, sub, time, sens, 0.18, 'gradient-map')
  if (env > 0.6 && st.prevEnv <= 0.6) {
    st.from = st.lastPos
    st.kicks += 1
    st.kickT = time
  }
  st.prevEnv = env
  st.lastT = time
  // The kick count's target under the chosen direction. Bounce folds the
  // walk into a triangle: it climbs to a full ramp sweep, then walks back
  // down, over and over (0, .25, .5, .75, 1, .75, .5, .25, 0, … at a .25
  // step).
  let target: number
  if (dir === 'backward') {
    target = -st.kicks * step
  } else if (dir === 'bounce') {
    const x = (st.kicks * step) % 2
    target = x <= 1 ? x : 2 - x
  } else {
    target = st.kicks * step
  }
  const k =
    st.kickT === -Infinity ? 1 : Math.min(1, Math.max(0, (time - st.kickT) / Math.max(0.02, ease)))
  const g = k * k * (3 - 2 * k)
  const pos = st.from + (target - st.from) * g
  st.lastPos = pos
  return pos
}

/* --------------------------------- the pass --------------------------------- */

export function drawGradientMapFilter(
  rc: RenderContext,
  cfg: GradientMapFilterConfig | undefined,
  frame: Pick<AudioFrame, 'time' | 'styleTime' | 'bass' | 'sub'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 8 || H < 8) return

  const mix = clamp01(cfg.opacity ?? 1)
  if (mix <= 0.001) return // opacity 0 = the untouched picture, any blend

  const stops = cfg.preset === 'custom' ? sanitizeCustomStops(cfg.customStops) : presetFor(cfg.preset)
  const lut = rampLut(stops)
  const blendId = Math.max(0, BLEND_IDS.indexOf(cfg.blend ?? 'normal'))
  const repeat = Math.min(8, Math.max(1, cfg.repeat ?? 1))
  const baseShift = Math.min(1, Math.max(-1, cfg.shift ?? 0))

  // The window position: the manual dial, plus the motion mode's advance.
  let shift = baseShift
  if (cfg.shiftMode === 'continuous') {
    // styleTime: wall clock live (the look stays alive while paused), song
    // time in exports — the same decorative-clock contract as grain speed.
    shift = baseShift + frame.styleTime * clamp01(cfg.shiftSpeed ?? 0.3) * 0.5
  } else if (cfg.shiftMode === 'beat') {
    shift =
      baseShift +
      beatShiftFor(
        ctx,
        clamp01(frame.sub ?? frame.bass),
        frame.time,
        Math.max(0, cfg.beatStep ?? 0.25),
        clamp01(cfg.beatSens ?? 0.12),
        Math.max(0.02, cfg.beatEase ?? 0.14),
        cfg.beatDir ?? 'forward',
      )
  }

  // snapshot → map every pixel through the ramp window → draw back
  const work = getWork('gradient-map:base', W, H)
  const wctx = resetWork(work.getContext('2d', { willReadFrequently: true })!)
  wctx.drawImage(ctx.canvas, 0, 0)
  const img = wctx.getImageData(0, 0, W, H)
  const d = img.data

  // Per-pixel: Rec.709 luminance → the wrapped ramp window → LUT → blend
  // → opacity mix — the exact chain the Neon Split CPU path (and the
  // site's gradient-map shader) runs.
  for (let i = 0; i < d.length; i += 4) {
    const pxR = d[i] / 255
    const pxG = d[i + 1] / 255
    const pxB = d[i + 2] / 255
    const t = 0.2126 * pxR + 0.7152 * pxG + 0.0722 * pxB
    const w = t * repeat + shift
    const tw = w - Math.floor(w)
    const gi = ((tw * 255) + 0.5) | 0
    const mappedR = lut[gi * 3] / 255
    const mappedG = lut[gi * 3 + 1] / 255
    const mappedB = lut[gi * 3 + 2] / 255
    // the blend mode — the map node's per-channel math
    let colR = mappedR
    let colG = mappedG
    let colB = mappedB
    if (blendId === 1) {
      colR = pxR * mappedR
      colG = pxG * mappedG
      colB = pxB * mappedB
    } else if (blendId === 2) {
      colR = 1 - (1 - pxR) * (1 - mappedR)
      colG = 1 - (1 - pxG) * (1 - mappedG)
      colB = 1 - (1 - pxB) * (1 - mappedB)
    } else if (blendId === 3) {
      colR = pxR <= 0.5 ? 2 * pxR * mappedR : 1 - 2 * (1 - pxR) * (1 - mappedR)
      colG = pxG <= 0.5 ? 2 * pxG * mappedG : 1 - 2 * (1 - pxG) * (1 - mappedG)
      colB = pxB <= 0.5 ? 2 * pxB * mappedB : 1 - 2 * (1 - pxB) * (1 - mappedB)
    } else if (blendId === 4) {
      colR = Math.min(1, pxR + mappedR)
      colG = Math.min(1, pxG + mappedG)
      colB = Math.min(1, pxB + mappedB)
    }
    if (mix < 0.999) {
      colR = pxR * (1 - mix) + colR * mix
      colG = pxG * (1 - mix) + colG * mix
      colB = pxB * (1 - mix) + colB * mix
    }
    d[i] = (colR * 255 + 0.5) | 0
    d[i + 1] = (colG * 255 + 0.5) | 0
    d[i + 2] = (colB * 255 + 0.5) | 0
    // alpha preserved — the pass is skipped on transparent backgrounds
    // anyway, so this only ever sees opaque frames
  }
  wctx.putImageData(img, 0, 0)
  ctx.drawImage(work, 0, 0)
}
