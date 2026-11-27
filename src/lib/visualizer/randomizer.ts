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
 *  - the LAYOUT: Position X / Position Y land anywhere on their tracks
 *    (the factory 50/50 sits dead center, so "50% either way" IS the whole
 *    track) and Size lands between 20% and 160% — all three on every roll,
 *  - EVERY SHAPE & MOTION dial the freshly picked style shows — all of its
 *    sliders land a uniform random spot on their tracks (Serato's
 *    Sensitivity is the one bounded window: 0.2–0.7, the strip's usable
 *    punch), and the
 *    section's picks and switches roll too: Orientation (and the vertical
 *    Side), the Mirror family (and the offset dials it uncovers), the Glow
 *    switch, the perspective Up/Down colors, the Serato colors pick, the
 *    Dot Sphere card's dot colors / orb face / beat swell, and the Image
 *    card's inner visualizer, switches, glow & bolt color modes,
 *  - 0–2 color tools (the Color tab effects),
 *  - 0–2 filters (the Filters tab effects),
 *  - the LAYERS switches (the Filters tab's Layers card): "Layers stay
 *    colored" flips 50/50 and, when it lands off, "Text stays legible"
 *    flips too — both switches are written every roll, so a previous
 *    roll's lifted layers never stack onto the next one,
 *
 * switching each picked effect on. Every picked effect also re-rolls its
 * COLOR options: preset selectors (Neon Split's ramp, the color grade's
 * look, the gradient map's ramp library and its shift motion, the
 * instant-film stock, the dither palette, the kaleidoscope's segment
 * style, the cubify tile-shape mix) land a random preset, and color fields
 * (halo tint, inks, papers, lens tints, custom-texture tints) get fresh
 * random colors in their own role — glows stay bright, backings stay dark,
 * tints stay tasteful (the vignette's edge tint rolls deep, and only while
 * the lens carries its color function — the tint picker hides when the edge
 * blur owns the vignette). The gradient map's ramp roll can also land
 * CUSTOM colors: fresh editable stops sampled from the loaded background
 * image or video (dominant colors, luminance-sorted, spread across the
 * track) — vivid rolls when no media is up — exactly like the editor's
 * Custom tab. The Style tab's own GRADIENT section rolls as
 * well, wherever the tab still shows it (every style except perspective, which
 * gets its own two-color roll instead): colors land fresh every roll — half
 * the rolls one of the editor's five preset ramps, half a coordinated
 * vivid recolor of the current stops (the visualizer draws from this
 * palette) — shape flips linear/radial and Cycle colors flips on/off,
 * each 50/50. The BACKDROP rolls too: every roll sets it to a Solid or a
 * Gradient (50/50 — the mode itself joins the roll) and lands fresh colors
 * in one of three brightness moods — deep, mid or bright — so it stops
 * reading as always-dark. An uploaded image or video playing AS the backdrop
 * is the one exception — the dice never yank the scene off the user's media,
 * so the mode stays on its tab and the toast says "Background image/video
 * kept". Choices the randomizer doesn't own are never
 * touched: the background gradient's geometry (stop layout, angle, shape,
 * cycling), the visualizer gradient's angle, cycle speed and stop layout
 * (outside the preset branch), the layer Transparency dial and the Layers
 * card's alpha dials, text, uploaded images, blend modes, sub-modes.
 *
 * A few dials carry hard TASTE CEILINGS: the roll never lands them above the
 * ceiling (the color grade's Strength ≤ 45%, the contour threads ≤ 46 lines
 * and ≤ 46% strength, the phosphor tube ≤ 30% strength). Their factory
 * defaults sit above the ceiling, so instead of jittering around the default
 * (which would pin every roll to the cap) a capped dial rolls in the quarter
 * of its slider track just under the ceiling — always present, never
 * overcooked. The gradient map's Speed carries a softer ceiling (≤ 50%):
 * its factory default already respects it, so the usual ±25% jitter applies
 * with the ceiling enforced on picks that drift past. More dials carry
 * dedicated WINDOWS (uniform across the whole declared window, wherever the
 * default sits): Neon Split's gradient shift only drifts within ±0.11 and
 * its repeat lands x1 or x2, its film grain rolls Preset → +15% and its
 * grain size fine (0.5px) → 1.2px, and the gradient map's shift rolls
 * anywhere from -100% to 90%.
 *
 * The React-to-beat toggles roll too: every picked effect that owns one
 * flips it 50/50, and when it lands on, that effect's punch dial (beat pop,
 * tape jolt, beat flare — whatever its own card calls it) rolls like every
 * other dial. The strobe's overlay switches roll the same 50/50 way (the
 * color overlay on the invert, and the per-flash hue roll gated on it), so
 * a picked strobe can land a tinted negative whose color churns on every
 * flash. A swept roll switches every toggle back off.
 *
 * Slider geometry (min/max/step) mirrors the studio UI exactly; the factory
 * defaults are read live from DEFAULT_STUDIO_CONFIG so the two can never
 * drift apart.
 */

import {
  DEFAULT_STUDIO_CONFIG,
  GRADIENT_PRESETS,
  type AnaglyphFilterConfig,
  type CamcorderFilterConfig,
  type ColorGradeFilterConfig,
  type ColorStop,
  type ContourFilterConfig,
  type CubifyFilterConfig,
  type CubifyShape,
  type DitherFilterConfig,
  type ExposureFilterConfig,
  type FilmFilterConfig,
  type GlitchFilterConfig,
  type GradientMapFilterConfig,
  type GradientPresetId,
  type HalationFilterConfig,
  type HalftoneFilterConfig,
  type KaleidoscopeFilterConfig,
  type NeonSplitFilterConfig,
  type PhosphorFilterConfig,
  type ScreenFilterConfig,
  type ShakeFilterConfig,
  type StudioConfig,
  type StrobeFilterConfig,
  type TextureFilterConfig,
  type VignetteFilterConfig,
  type VisualizerConfig,
  type VisualizerStyle,
  type VhsFilterConfig,
  type WaveWarpFilterConfig,
} from '@/lib/visualizer/types'
import { CUBIFY_SHAPE_ORDER } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { RAMPS } from '@/lib/visualizer/neon-split-data'
import { EXPOSURE_STOCKS } from '@/lib/visualizer/exposure-filter'
import { getBackgroundImage } from '@/lib/visualizer/image-cache'
import { getBackgroundMedia, getGifAnimation, isGifSrc } from '@/lib/visualizer/animated-bg'

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

/**
 * A capped dial's roll. When the factory default sits ABOVE the ceiling,
 * the roll lands in the quarter of the slider track just under the ceiling
 * (a 45% ceiling on a 0–100% dial rolls 20–45%) — jittering around the
 * default would clamp every pick onto the cap itself, which is no roll at
 * all. When the default already respects the ceiling, the usual ±25% of
 * the full track applies and only the picks that drift past the ceiling
 * are pulled back onto its snapped spot — the ceiling shapes the top of
 * the band without ever pinning the whole roll onto itself.
 */
function jitterCapped(
  defaultValue: number,
  cap: number,
  min: number,
  max: number,
  step: number,
): number {
  const ceiling = Math.min(max, Math.max(min, cap))
  if (defaultValue <= ceiling) {
    const v = jitter(defaultValue, min, max, step)
    if (v <= ceiling) return v
    // Drifted past the ceiling: land on the ceiling's snapped spot.
    const pulled = min + Math.round((ceiling - min) / step) * step
    return Number(Math.min(ceiling, Math.max(min, pulled)).toFixed(4))
  }
  const span = max - min
  const floor = Math.max(min, ceiling - span * 0.25)
  let v = floor + Math.random() * (ceiling - floor)
  // Snap onto the step grid, then kill float noise.
  v = min + Math.round((v - min) / step) * step
  v = Number(Math.min(ceiling, Math.max(min, v)).toFixed(4))
  // A pick must always be a real change off the factory default.
  if (Math.abs(v - defaultValue) < step) {
    const up = v + step <= ceiling
    const down = v - step >= min
    if (up && down) v = v + (defaultValue <= v ? step : -step)
    else if (up) v = v + step
    else if (down) v = v - step
  }
  return v
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

/* ------------------------- visualizer gradient roll -------------------------- */

/**
 * The Style tab's GRADIENT section rolls wherever the tab shows it — every
 * style except perspective, whose own card keeps a strict two-color split
 * instead (the gate mirrors the tab's rendering condition exactly).
 *
 * Colors: half the rolls land one of the editor's five preset ramps (the
 * pills swap the stops and keep every other field — the roll does the
 * same, so pill highlighting agrees), the other half recolor the EXISTING
 * stops as one coordinated VIVID palette — one base hue drifting 40–110°
 * along the ramp at glow brightness. The visualizer draws its colors from
 * this palette, so it rolls bright where the backdrop rolls deep. Shape
 * flips linear/radial and the Cycle colors toggle flips on/off, each
 * 50/50; angle, cycle speed and the stop layout (outside the preset
 * branch) stay exactly as the user set them.
 */
function rollVividStops(stops: ColorStop[]): ColorStop[] {
  const baseHue = randHue()
  const drift = (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 70) // ±40–110° along the ramp
  const sat = 0.72 + Math.random() * 0.23 // glow brightness — the vivid role
  const lowL = 0.46 + Math.random() * 0.08
  const highL = lowL + 0.08 + Math.random() * 0.1
  return stops.map((stop) => {
    const t = Math.min(1, Math.max(0, stop.position / 100))
    return { ...stop, color: hslHex(baseHue + drift * t, sat, lowL + (highL - lowL) * t) }
  })
}

/* ----------------------------- background colors ----------------------------- */

/**
 * The backdrop's roll — every roll SETS the mode (solid or gradient, 50/50)
 * and lands fresh colors in one of three brightness moods, so the backdrop
 * stops reading as always-dark:
 *  - deep — the classic near-black, hue-tinted backing (30% of rolls),
 *  - mid — a confident colored wall, still behind the vivid visualizer (40%),
 *  - bright — a loud, saturated backdrop (30%).
 *
 * Solid paints one color in the mood's band. Gradient recolors the EXISTING
 * stops as one coordinated palette: one base hue drifting along the ramp
 * between the mood's bright end and deep end — the stop count, positions,
 * opacities, angle, shape and cycling stay exactly as the user set them.
 * The visualizer gradient rolls vivid and independent, so the scene stays
 * readable on every mood.
 *
 * When the backdrop IS an uploaded image or video, none of this runs — the
 * dice never pull the scene off the user's media; the roll reports
 * "Background image kept" / "Background video kept" and moves on.
 */
type BackgroundMood = 'deep' | 'mid' | 'bright'

function rollBackgroundMood(): BackgroundMood {
  const r = Math.random()
  return r < 0.3 ? 'deep' : r < 0.7 ? 'mid' : 'bright'
}

function rollSolidBackground(mood: BackgroundMood): string {
  const sat = mood === 'deep' ? 0.55 + Math.random() * 0.35 : 0.45 + Math.random() * 0.4
  const light =
    mood === 'deep'
      ? 0.06 + Math.random() * 0.1
      : mood === 'mid'
        ? 0.2 + Math.random() * 0.25
        : 0.5 + Math.random() * 0.22
  return hslHex(randHue(), sat, light)
}

function rollBackgroundStops(stops: ColorStop[], mood: BackgroundMood): ColorStop[] {
  const baseHue = randHue()
  const drift = (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 70) // ±40–110° along the ramp
  const sat = 0.5 + Math.random() * 0.35
  const topL =
    mood === 'deep'
      ? 0.16 + Math.random() * 0.14 // brightest stop — still deep enough to dress the scene
      : mood === 'mid'
        ? 0.32 + Math.random() * 0.18
        : 0.55 + Math.random() * 0.17
  const deepL =
    mood === 'deep'
      ? 0.05 + Math.random() * 0.05 // near-black at the far end
      : mood === 'mid'
        ? 0.12 + Math.random() * 0.13
        : 0.28 + Math.random() * 0.22
  return stops.map((stop) => {
    const t = Math.min(1, Math.max(0, stop.position / 100))
    return { ...stop, color: hslHex(baseHue + drift * t, sat, topL + (deepL - topL) * t) }
  })
}

/* ----------------------- gradient map custom ramp roll ----------------------- */

/**
 * Where the last rolled Gradient Map custom ramp came from — the Ramp
 * preset's toast name reads it (the extra callback runs right before the
 * pick is pushed, so the name always describes the roll that set it).
 */
let customRampFrom = 'vivid'

/**
 * The Gradient Map's CUSTOM ramp roll (the user's ask: the map's colors can
 * also use custom colors, set according to other colors in the image).
 * When a background image or video/GIF is loaded AND already decoded — it
 * always is by roll time, the live preview paints it every frame — the
 * ramp is SAMPLED from that media: dominant colors picked off a downscaled
 * frame, luminance-sorted so shadows read dark and highlights bright, then
 * spread evenly across the ramp track (3–6 stops). Near-monochrome media
 * keeps its own hue as a shades-of-one-color ramp. Without media (solid /
 * gradient / transparent backdrop, or the media still decoding) the ramp
 * rolls vivid instead — one base hue drifting along the track from deep to
 * bright, the same coordinated-palette philosophy as the visualizer
 * gradient's roll. Either way the stops land in customStops with preset
 * 'custom' — exactly like the editor's Custom tab.
 */
function rollCustomRampStops(): { t: number; c: string }[] {
  const source = rampSampleSource()
  if (source) {
    const colors = sampleDominantColors(source.src)
    if (colors && colors.length >= 2) {
      customRampFrom = source.label
      return colorsToRampStops(colors)
    }
    if (colors && colors.length === 1) {
      // Near-monochrome media — keep its hue as a shades-of-one-color ramp.
      customRampFrom = source.label
      return shadesRampStops(colors[0] ?? '#000000')
    }
  }
  // No media (or still decoding / nothing drawable): vivid rolls.
  customRampFrom = 'vivid'
  return rollVividRampStops(3 + Math.floor(Math.random() * 4)) // 3–6 stops
}

/**
 * The media frame the custom ramp should sample from — the background
 * image's decoded element, the current video frame (or a GIF's first
 * decoded frame), or null when no media is up / it is not drawable yet.
 */
function rampSampleSource(): { src: CanvasImageSource; label: string } | null {
  const bg = useStudioStore.getState().config.background
  if (bg.mode === 'image' && bg.imageSrc) {
    const img = getBackgroundImage(bg.imageSrc)
    return img ? { src: img, label: 'from image' } : null
  }
  if (bg.mode === 'video' && bg.videoSrc) {
    if (isGifSrc(bg.videoSrc)) {
      const anim = getGifAnimation(bg.videoSrc)
      const frame = anim?.frames[0]
      if (anim && frame) return { src: frame, label: 'from video' }
      return null
    }
    const media = getBackgroundMedia(bg.videoSrc)
    if (media) return { src: media.media, label: 'from video' }
  }
  return null
}

/**
 * Downscale the frame onto a small grid and pick the dominant colors:
 * pixels quantized into coarse 16-level RGB buckets, buckets ranked by
 * pixel count, then greedily accepted while each new color sits far enough
 * from the already-picked ones (so a big flat sky and its near-identical
 * clouds don't both land). The target count (3–6) is rolled per pick for
 * variety; when distinct colors run out the distance floor is dropped so a
 * quiet image still fills at least two slots with its real colors. Returns
 * null when nothing drawable came off the frame (all transparent).
 */
function sampleDominantColors(src: CanvasImageSource): string[] | null {
  try {
    const W = 48
    const H = 32
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(src, 0, 0, W, H)
    const data = ctx.getImageData(0, 0, W, H).data
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) < 128) continue // transparent pixels carry no color
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
      e.n += 1
      e.r += r
      e.g += g
      e.b += b
      buckets.set(key, e)
    }
    if (buckets.size === 0) return null
    const ranked = [...buckets.values()].sort((a, b) => b.n - a.n)
    const avg = (e: { n: number; r: number; g: number; b: number }) =>
      [e.r / e.n, e.g / e.n, e.b / e.n] as const
    const dist = (a: readonly number[], b: readonly number[]) =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    const want = 3 + Math.floor(Math.random() * 4) // 3–6 stops
    const picked: (readonly number[])[] = []
    for (const e of ranked) {
      const c = avg(e)
      if (picked.every((p) => dist(p, c) > 60)) picked.push(c)
      if (picked.length >= want) break
    }
    // Quiet image — fill up to two slots ignoring the separation floor.
    if (picked.length < 2) {
      for (const e of ranked) {
        if (picked.length >= 2) break
        const c = avg(e)
        if (!picked.some((p) => p[0] === c[0] && p[1] === c[1] && p[2] === c[2])) picked.push(c)
      }
    }
    if (picked.length === 0) return null
    return picked.map(rgbToHex)
  } catch {
    return null
  }
}

/** Hex-encode a sampled rgb triple. */
function rgbToHex(c: readonly number[]): string {
  const hex = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0')
  return `#${hex(c[0] ?? 0)}${hex(c[1] ?? 0)}${hex(c[2] ?? 0)}`
}

function hexLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) || 0
  const g = parseInt(hex.slice(3, 5), 16) || 0
  const b = parseInt(hex.slice(5, 7), 16) || 0
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Sampled colors → ramp stops: luminance-sorted (the natural duotone
 * direction — dark pixels map to the dark end) and spread evenly across
 * the track. The LUT sorts internally, but the emitted order matches it.
 */
function colorsToRampStops(colors: string[]): { t: number; c: string }[] {
  const sorted = [...colors].sort((a, b) => hexLuminance(a) - hexLuminance(b))
  const n = sorted.length
  return sorted.map((c, i) => ({ t: n === 1 ? 0 : i / (n - 1), c }))
}

const RAMP_BLACK = [0, 0, 0] as const
const RAMP_WHITE = [255, 255, 255] as const

/** One color → a three-stop shades ramp (its own hue, dark → light). */
function shadesRampStops(hex: string): { t: number; c: string }[] {
  const r = parseInt(hex.slice(1, 3), 16) || 0
  const g = parseInt(hex.slice(3, 5), 16) || 0
  const b = parseInt(hex.slice(5, 7), 16) || 0
  const mix = (other: readonly number[], k: number) =>
    rgbToHex([r + (other[0] - r) * k, g + (other[1] - g) * k, b + (other[2] - b) * k])
  return [
    { t: 0, c: mix(RAMP_BLACK, 0.55) },
    { t: 0.5, c: hex },
    { t: 1, c: mix(RAMP_WHITE, 0.45) },
  ]
}

/**
 * The no-media fallback: a coordinated vivid ramp — one base hue drifting
 * ±50–140° along the track from a deep end to a bright end (the same
 * philosophy as the visualizer gradient's vivid recolor, stretched across
 * the full luminance axis so the map keeps the picture's tonal structure).
 */
function rollVividRampStops(count: number): { t: number; c: string }[] {
  const n = Math.max(2, count)
  const baseHue = randHue()
  const drift = (Math.random() < 0.5 ? -1 : 1) * (50 + Math.random() * 90)
  const sat = 0.62 + Math.random() * 0.3
  const deepL = 0.1 + Math.random() * 0.08
  const brightL = 0.52 + Math.random() * 0.14
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    return { t, c: hslHex(baseHue + drift * t, sat, deepL + (brightL - deepL) * t) }
  })
}

/* ------------------------------ layers vs filters ---------------------------- */

/**
 * The Filters tab's LAYERS switches join every roll: "Layers stay colored"
 * (every moving layer and the text lifted in full color above the whole
 * filter chain) flips 50/50, and when it lands off, its lighter sibling
 * "Text stays legible" (only the words skip the chain) flips 50/50 too —
 * mirroring the card's gated visibility. Both fields are written EVERY
 * roll (a landed stayColored clears textClear, exactly like the card's
 * gate), so nothing from a previous roll can stack onto the next one and
 * the clean slate needs no sweep here. The alpha dials are not look dice
 * (a rolled fade reads as a broken look), so they stay as the user set
 * them. Returns a toast line when a switch lands ON — landing both off is
 * the factory state and stays silent, like the style flags.
 */
function rollLayers(): string | null {
  const stayColored = Math.random() < 0.5
  const textClear = stayColored ? false : Math.random() < 0.5
  useStudioStore.getState().patchLayers({ stayColored, textClear })
  if (stayColored) return 'Layers stay colored'
  if (textClear) return 'Text stays legible'
  return null
}

/* --------------------------------- registry ---------------------------------- */

type NumericKeys<C> = { [K in keyof C]: NonNullable<C[K]> extends number ? K : never }[keyof C]

type BooleanKeys<C> = { [K in keyof C]: NonNullable<C[K]> extends boolean ? K : never }[keyof C]

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
  /** Hard ceiling for the roll — the dial never lands above it. The factory
   *  default may sit above the ceiling; the roll then stays in the quarter
   *  of the track just under it (see jitterCapped). */
  cap?: number
  /** Roll uniformly across the WHOLE window (min..max) instead of jittering
   *  around the factory default — for dials with a dedicated random window
   *  (Neon Split's gradient shift only drifts within ±0.11 of center, its
   *  gradient repeat only lands x1 or x2, its film grain rolls
   *  Preset→+15% and its grain size fine→1.2px, and the gradient map's
   *  shift rolls anywhere from -100% to 90%), wherever the default sits. */
  uniform?: boolean
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
  /** Value transform — what an option id writes into the field. Absent:
   *  the id itself (enum presets). Present: the id's decoded payload (the
   *  cubify tile mix writes its parsed CubifyShape[]). */
  value?: (id: string) => unknown
}

/** One boolean switch inside an effect — the React-to-beat toggle the roll
 *  may flip; when it lands on, dials gated on it (its punch strength) roll
 *  with the rest, exactly like the UI showing the slider while it's on. */
interface EffectSwitch<C> {
  /** Toast name when the switch lands on — the punch name its own card
   *  uses, e.g. 'beat pop'. */
  label: string
  key: BooleanKeys<C>
  /** Only randomized while this passes (mirrors the UI's visibility). */
  when?: (view: C) => boolean
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
 * Every numeric style dial the randomizer owns. The LAYOUT trio
 * (Position X / Y, Size) rolls through `rollLayout` with its own dedicated
 * ranges; Transparency is swept on the clean slate but never rolled (a
 * rolled layer fade would read as a broken look); every other entry is a
 * SHAPE & MOTION dial (or one of the Dot Sphere / Image cards' own dials)
 * and lands a uniform random spot on its track on every roll — with
 * per-style WINDOWS where a style needs one (Serato's Sensitivity rolls
 * 0.2–0.7, the strip's usable punch).
 * `when` mirrors the Style tab's own visibility conditions so a dial is
 * only ever rolled while the freshly picked style actually shows it —
 * EVERY entry is still reset to its factory value on the clean slate,
 * including dials the current style hides, so no stale roll resurfaces
 * after a style switch.
 */
const STYLE_DIALS: StyleDial[] = [
  // Layout — every style (rolled by rollLayout, never jittered)
  { label: 'Position X', key: 'positionX', min: 0, max: 100, step: 1 },
  { label: 'Position Y', key: 'positionY', min: 0, max: 100, step: 1 },
  { label: 'Size', key: 'scale', min: 0.2, max: 1.6, step: 0.05 },
  { label: 'Transparency', key: 'transparency', min: 0, max: 1, step: 0.05 },
  // Shape & motion — every style except Serato / Dot Sphere
  { label: 'Bar count', key: 'barCount', min: 16, max: 256, step: 8, when: notStyle('serato', 'dotsphere') },
  { label: 'Smoothing', key: 'smoothing', min: 0, max: 0.95, step: 0.05, when: notStyle('serato', 'dotsphere') },
  { label: 'Roundness', key: 'roundness', min: 0, max: 1, step: 0.05, when: notStyle('ribbon', 'terrain', 'sphere', 'dotsphere') },
  { label: 'Gap', key: 'gap', min: 0, max: 0.8, step: 0.05, when: notStyle('ribbon', 'terrain', 'sphere', 'dotsphere', 'serato') },
  { label: 'Sensitivity', key: 'sensitivity', min: 0.1, max: 3, step: 0.1, when: notStyle('serato') },
  // Serato's Sensitivity window: the DJ strip only ever rolls a punch
  // between 0.2 and 0.7 — the shared full track (0.1..3) overshoots this
  // style into mush above ~0.7 and near-freeze below 0.2. The UI slider
  // keeps its 0.1..3 track; this is a randomizer window, like the taste
  // ceilings. Same key as the entry above — the `when`s are mutually
  // exclusive, and the clean-slate sweep writes the factory default by key
  // (duplicates are harmless).
  { label: 'Sensitivity', key: 'sensitivity', min: 0.2, max: 0.7, step: 0.1, when: isStyle('serato') },
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
  // Terrain's signed water-line dial (both mirror modes)
  {
    label: 'Mirror offset',
    key: 'terrainMirrorDrop',
    min: -1,
    max: 1,
    step: 0.01,
    when: (viz) => viz.style === 'terrain' && viz.mirror !== 'none',
  },
  // Perspective's water-line dial (the road reflection, mirror mode only)
  {
    label: 'Mirror offset',
    key: 'perspMirrorDrop',
    min: 0,
    max: 1,
    step: 0.01,
    when: (viz) => viz.style === 'perspective' && viz.mirror === 'mirror',
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
  { label: 'Beat swell', key: 'dotSphereBeatStrength', min: 0, max: 1, step: 0.05, when: (viz) => viz.style === 'dotsphere' && viz.dotSphereBeat },
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

/** One enum-valued style field the roll flips (orientation, mirror, …). */
interface StyleChoice {
  /** Toast wording for the field. */
  label: string
  key: keyof VisualizerConfig
  options: readonly string[]
  /** Eligible only while this passes (the picker must be visible for the current style). */
  when?: (viz: VisualizerConfig) => boolean
  /** Toast wording per option — options missing from the map (the factory
   *  defaults, usually) stay silent. */
  say?: Record<string, string>
}

/**
 * The enum-valued SHAPE & MOTION fields, in the order they gate each other
 * (the orientation pick uncovers Side; the image card's switches uncover
 * its placement and color-mode picks). Every condition is evaluated against
 * the state MERGED with the roll so far — see rollShapeMotion.
 */
const STYLE_CHOICES: StyleChoice[] = [
  {
    label: 'Orientation',
    key: 'orientation',
    options: ['horizontal', 'vertical'],
    when: isStyle('bars', 'wave', 'grid', 'ribbon', 'perspective', 'terrain', 'sphere', 'serato'),
    say: { vertical: 'vertical' },
  },
  {
    label: 'Side',
    key: 'anchor',
    options: ['left', 'right'],
    when: (viz) => viz.orientation === 'vertical' && viz.style !== 'sphere',
    say: { left: 'left edge' },
  },
  {
    label: 'Mirror',
    key: 'mirror',
    options: ['none', 'mirror', 'center'],
    when: notStyle('sphere', 'dotsphere', 'serato', 'imgviz'),
    say: { mirror: 'mirror', center: 'center' },
  },
  {
    label: 'Serato colors',
    key: 'seratoColors',
    options: ['rainbow', 'palette', 'solid'],
    when: isStyle('serato'),
    say: { palette: 'palette colors', solid: 'solid colors' },
  },
  {
    label: 'Dot colors',
    key: 'dotSphereColors',
    options: ['neon', 'palette', 'picture'],
    when: isStyle('dotsphere'),
    say: { palette: 'palette dots', picture: 'picture dots' },
  },
  {
    label: 'Orb face',
    key: 'dotSphereFace',
    options: ['dark', 'color'],
    when: isStyle('dotsphere'),
    say: { color: 'color face' },
  },
  {
    label: 'Inner visualizer',
    key: 'imgvizInner',
    options: ['bars', 'wave', 'radial', 'particles', 'blob', 'grid', 'ribbon'],
    when: isStyle('imgviz'),
    say: { wave: 'inner wave', radial: 'inner radial', particles: 'inner dots', blob: 'inner blob', grid: 'inner grid', ribbon: 'inner ribbon' },
  },
  {
    label: 'Inner orientation',
    key: 'imgvizInnerOrient',
    options: ['horizontal', 'vertical'],
    when: (viz) =>
      viz.style === 'imgviz' &&
      (viz.imgvizInner === 'bars' || viz.imgvizInner === 'wave' || viz.imgvizInner === 'grid' || viz.imgvizInner === 'ribbon'),
    say: { vertical: 'inner vertical' },
  },
  {
    label: 'Glow placement',
    key: 'imgvizGlowPlacement',
    options: ['over', 'outside'],
    when: (viz) => viz.style === 'imgviz' && viz.imgvizGlow,
    say: { outside: 'glow outside only' },
  },
  {
    label: 'Glow color',
    key: 'imgvizGlowMode',
    options: ['palette', 'custom'],
    when: (viz) => viz.style === 'imgviz' && viz.imgvizGlow,
    say: { custom: 'custom glow color' },
  },
  {
    label: 'Bolt color',
    key: 'imgvizBoltMode',
    options: ['palette', 'custom'],
    when: (viz) => viz.style === 'imgviz' && viz.imgvizBolt,
    say: { custom: 'custom bolt color' },
  },
]

/** One boolean style field the roll coin-flips (50/50). */
interface StyleFlag {
  key: keyof VisualizerConfig
  /** The factory value the clean slate guarantees — a flip away from it
   *  lands a toast note, a flip back to it stays silent. */
  factory: boolean
  /** Toast wording — `${word} on` / `${word} off`. */
  word: string
  when?: (viz: VisualizerConfig) => boolean
}

const STYLE_FLAGS: StyleFlag[] = [
  { key: 'glow', factory: true, word: 'glow' },
  { key: 'dotSphereBeat', factory: false, word: 'beat swell', when: isStyle('dotsphere') },
  { key: 'imgvizMotion', factory: true, word: 'motion', when: isStyle('imgviz') },
  { key: 'imgvizGlow', factory: true, word: 'edges', when: isStyle('imgviz') },
  { key: 'imgvizBolt', factory: true, word: 'electricity', when: isStyle('imgviz') },
]

/**
 * The non-numeric style fields the roll owns — swept back to factory on the
 * clean slate (the numeric dials sweep through STYLE_DIALS) so a previous
 * roll's vertical orientation, mirror pick or custom card colors never
 * stacks onto the next one. Uploaded artwork (imgvizSrc, dotSphereFaceSrc)
 * is NOT owned — it survives the sweep.
 */
const STYLE_FIELD_RESET: Record<string, unknown> = {
  orientation: 'horizontal',
  anchor: 'right',
  mirror: 'none',
  glow: true,
  seratoColors: 'rainbow',
  perspUp: '#ff1f1f',
  perspDown: '#1e6bff',
  dotSphereColors: 'neon',
  dotSphereFace: 'dark',
  dotSphereFaceColor: '#050109',
  dotSphereBeat: false,
  imgvizInner: 'bars',
  imgvizInnerOrient: 'horizontal',
  imgvizMotion: true,
  imgvizGlow: true,
  imgvizGlowMode: 'palette',
  imgvizGlowPlacement: 'over',
  imgvizGlowColor: '#ffffff',
  imgvizBolt: true,
  imgvizBoltMode: 'palette',
  imgvizBoltColor: '#7df9ff',
}

/** The layout keys STYLE_DIALS holds for the sweep — rolled elsewhere, never jittered. */
const LAYOUT_KEYS = new Set(['positionX', 'positionY', 'scale', 'transparency'])

/** Uniform anywhere on the slider track, snapped to the step grid. */
function rollTrack(min: number, max: number, step: number): number {
  const steps = Math.max(1, Math.round((max - min) / step))
  const v = min + Math.round(Math.random() * steps) * step
  return Number(Math.min(max, Math.max(min, v)).toFixed(4))
}

/**
 * The LAYOUT roll — Position X / Y anywhere on their tracks (the factory
 * 50/50 sits dead center, so the user's "50% either way" IS the whole
 * track) and Size between 20% and 160%. One line for the toast.
 */
function rollLayout(): string {
  const positionX = rollTrack(0, 100, 1)
  const positionY = rollTrack(0, 100, 1)
  const scale = rollTrack(0.2, 1.6, 0.05)
  useStudioStore.getState().patchVisualizer({ positionX, positionY, scale })
  return `Position ${Math.round(positionX)}%/${Math.round(positionY)}% · Size ${Math.round(scale * 100)}%`
}

/**
 * The SHAPE & MOTION roll — every field the section shows for the freshly
 * picked style, all of it, on every roll: the switches flip first (50/50),
 * then the picks roll with every condition read from the state MERGED with
 * the roll so far (the orientation pick uncovers Side; the image card's
 * glow switch uncovers its placement and color-mode picks), then every
 * eligible slider lands a uniform random spot on its track (Serato's
 * Sensitivity rolls its bounded 0.2–0.7 window) — the
 * mirror pick decides which offset dial exists, the beat-swell switch
 * decides whether its strength rolls. The Dot Sphere and Image cards' own
 * dressing rolls with them (dot colors, orb face, inner visualizer, glow &
 * bolt modes — the perspective style gets its Up/Down colors here instead
 * of the shared gradient). Returns one summary line for the toast.
 */
function rollShapeMotion(): string {
  const viz0 = useStudioStore.getState().config.visualizer
  const patch: Record<string, unknown> = {}
  const notes: string[] = []
  const note = (n: string) => {
    if (notes.length < 5) notes.push(n)
    else if (notes.length === 5) notes.push('…')
  }
  // The roll-so-far view every `when` reads — picks gate later picks.
  const vizR = () => ({ ...viz0, ...patch }) as VisualizerConfig

  // 1 — the switches, 50/50 each (a flip off the factory value speaks up).
  for (const flag of STYLE_FLAGS) {
    if (flag.when && !flag.when(viz0)) continue
    const v = Math.random() < 0.5
    patch[flag.key as string] = v
    if (v !== flag.factory) note(`${flag.word} ${v ? 'on' : 'off'}`)
  }

  // 2 — the picks, each condition read against the merged state so the
  // chains fire (vertical orientation uncovers Side; glowing edges uncover
  // the glow placement and color-mode picks). A pick that lands off the
  // factory value speaks up.
  for (const choice of STYLE_CHOICES) {
    if (choice.when && !choice.when(vizR())) continue
    const v = choice.options[Math.floor(Math.random() * choice.options.length)]
    if (v === undefined) continue
    patch[choice.key as string] = v
    const said = choice.say?.[v]
    if (said) note(said)
  }

  // 3 — the color fields the picks uncover: perspective's own two-color
  // split (its card replaces the shared gradient — two vivid colors a
  // half-wheel apart), the image card's custom glow / bolt colors, the orb
  // face's paint when it lands 'color'.
  if (viz0.style === 'perspective') {
    const hue = randHue()
    patch.perspUp = hslHex(hue, 0.7 + Math.random() * 0.25, 0.5 + Math.random() * 0.15)
    patch.perspDown = hslHex(hue + 120 + Math.random() * 120, 0.7 + Math.random() * 0.25, 0.5 + Math.random() * 0.15)
    note('up/down colors')
  }
  if (patch.imgvizGlowMode === 'custom') patch.imgvizGlowColor = vividColor()
  if (patch.imgvizBoltMode === 'custom') patch.imgvizBoltColor = vividColor()
  if (patch.dotSphereFace === 'color') patch.dotSphereFaceColor = deepColor()

  if (Object.keys(patch).length) {
    useStudioStore.getState().patchVisualizer(patch as Partial<VisualizerConfig>)
  }

  // 4 — the sliders, evaluated against the UPDATED config so the picks
  // above (mirror mode, the image card's switches, the beat swell) decide
  // which dials exist. All of them roll — that is the point of the section.
  const viz = useStudioStore.getState().config.visualizer
  const sliderPatch: Record<string, number> = {}
  for (const dial of STYLE_DIALS) {
    if (LAYOUT_KEYS.has(dial.key as string)) continue
    if (dial.when && !dial.when(viz)) continue
    sliderPatch[dial.key as string] = rollTrack(dial.min, dial.max, dial.step)
  }
  if (Object.keys(sliderPatch).length) {
    useStudioStore.getState().patchVisualizer(sliderPatch as Partial<VisualizerConfig>)
  }

  const count = Object.keys(sliderPatch).length
  const head = `${count} dial${count === 1 ? '' : 's'} rolled`
  const said = notes.length ? `, ${notes.join(', ')}` : ''
  return `Shape & motion — ${head}${said}`
}

/* --------------------------- color tools & filters --------------------------- */

/**
 * Wraps one effect (color tool / filter) into a pickable. `apply` switches it
 * on (if it was off), lands random picks in its preset selectors, flips its
 * boolean switches (the React-to-beat toggles, 50/50), re-dials its numeric
 * parameters to random positions within 25% of the factory defaults (under
 * the dial's ceiling where one is set, uniformly across the whole window
 * where the dial declares its own) and re-rolls its color options in
 * their own roles; conditions
 * mirror the UI — a dial, color, preset or switch that the effect's current
 * sub-mode hides is left alone, and presets and switches are rolled FIRST so
 * their landing gates what the rest of the roll touches (the dither's
 * palette decides which inks exist; the beat switch decides whether its
 * punch dial rolls at all; the gradient map's shift motion decides which
 * motion dials roll — the Continuous Speed among them, capped at 50%).
 * `reset` sweeps the effect off and back
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
  switches?: EffectSwitch<C>[]
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
      for (const sw of spec.switches ?? []) {
        const def = (spec.defaults as unknown as Record<string, unknown>)[sw.key as string]
        if (typeof def === 'boolean') partial[sw.key as string] = def
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
        const value = preset.value ? preset.value(id) : id
        partial[preset.key as string] = value
        view = { ...view, [preset.key]: value } as unknown as C
        const extra = preset.extra?.(id)
        if (extra) {
          Object.assign(partial, extra)
          view = { ...view, ...(extra as Partial<C>) } as unknown as C
        }
        picks.push(preset.names[id] ?? id)
      }
      // Boolean switches next — the React-to-beat toggles. A switch that
      // lands on gates its own dials (the punch strength rolls below),
      // mirroring the UI: the slider only shows while the switch is on.
      for (const sw of spec.switches ?? []) {
        if (sw.when && !sw.when(view)) continue
        const on = Math.random() < 0.5
        partial[sw.key as string] = on
        view = { ...view, [sw.key]: on } as unknown as C
        if (on) picks.push(sw.label)
      }
      let touched = picks.length > 0
      for (const param of spec.params) {
        if (param.when && !param.when(view)) continue
        const def =
          param.def ?? (spec.defaults as unknown as Record<string, unknown>)[param.key as string]
        if (typeof def !== 'number' || !Number.isFinite(def)) continue
        const value = param.uniform
          ? rollTrack(param.min, param.max, param.step)
          : param.cap !== undefined
            ? jitterCapped(def, param.cap, param.min, param.max, param.step)
            : jitter(def, param.min, param.max, param.step)
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

/* ------------------------- cubify tile-shape roll pool ----------------------- */

/** Plural toast names for the cubify tile shapes. */
const CUBIFY_MIX_PLURALS: Record<string, string> = {
  cube: 'cubes',
  circle: 'circles',
  oval: 'ovals',
  diamond: 'diamonds',
  triangle: 'triangles',
}

/** Every subset of the five tile shapes with 1–3 members, in canonical
 *  order — the cubify roll pool. Uniform over the pool lands roughly a
 *  fifth single-shape tiles, two-fifths two-shape checkerboards and
 *  two-fifths three-shape shuffles (the "more than 2 shapes at once"
 *  mixes stay common without drowning out the classic reads). */
const CUBIFY_MIX_SUBSETS: CubifyShape[][] = []
for (let size = 1; size <= 3; size++) {
  const combos = (start: number, acc: CubifyShape[]): void => {
    if (acc.length === size) {
      CUBIFY_MIX_SUBSETS.push([...acc])
      return
    }
    for (let i = start; i < CUBIFY_SHAPE_ORDER.length; i++) {
      const shape = CUBIFY_SHAPE_ORDER[i]
      if (shape) combos(i + 1, [...acc, shape])
    }
  }
  combos(0, [])
}

/** Mix ids ('cube', 'circle+diamond', 'circle+oval+triangle', …). */
const CUBIFY_MIX_OPTIONS = CUBIFY_MIX_SUBSETS.map((mix) => mix.join('+'))

/** Toast names per mix id — 'circles + diamonds' style. */
const CUBIFY_MIX_NAMES: Record<string, string> = Object.fromEntries(
  CUBIFY_MIX_SUBSETS.map((mix) => [
    mix.join('+'),
    mix.map((s) => CUBIFY_MIX_PLURALS[s] ?? s).join(' + '),
  ]),
)

/** The Filters tab cards (the Layers options are not a look — excluded). */
const FILTER_EFFECTS: RandomEffect[] = [
  makeEffect<ScreenFilterConfig>({
    label: 'CRT screen',
    get: (c) => c.screenFilter,
    defaults: DEFAULT_STUDIO_CONFIG.screenFilter,
    patch: (p) => useStudioStore.getState().patchScreenFilter(p),
    switches: [{ label: 'beat pop', key: 'beatReactive' }],
    params: [
      { ...param<ScreenFilterConfig>('size', 2, 8, 1), label: 'Mask size' },
      { ...param<ScreenFilterConfig>('scanlines', 0, 1, 0.05), label: 'Scanlines' },
      { ...param<ScreenFilterConfig>('grille', 0, 1, 0.05), label: 'Phosphor mask' },
      { ...param<ScreenFilterConfig>('aberration', 0, 1, 0.05), label: 'Color split' },
      { ...param<ScreenFilterConfig>('glow', 0, 1, 0.05), label: 'Glow' },
      { ...param<ScreenFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Beat pop', when: (f) => f.beatReactive },
    ],
  }),
  makeEffect<VhsFilterConfig>({
    label: 'VHS tape',
    get: (c) => c.vhsFilter,
    defaults: DEFAULT_STUDIO_CONFIG.vhsFilter,
    patch: (p) => useStudioStore.getState().patchVhsFilter(p),
    switches: [{ label: 'beat pop', key: 'beatReactive' }],
    params: [
      { ...param<VhsFilterConfig>('wobble', 0, 1, 0.05), label: 'Wobble' },
      { ...param<VhsFilterConfig>('tracking', 0, 1, 0.05), label: 'Tracking' },
      { ...param<VhsFilterConfig>('trackingSpeed', 0, 1, 0.05), label: 'Tracking speed' },
      { ...param<VhsFilterConfig>('dust', 0, 1, 0.05), label: 'Dust' },
      { ...param<VhsFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Beat pop', when: (f) => f.beatReactive },
    ],
  }),
  makeEffect<CamcorderFilterConfig>({
    label: 'Camcorder',
    get: (c) => c.camcorderFilter,
    defaults: DEFAULT_STUDIO_CONFIG.camcorderFilter,
    patch: (p) => useStudioStore.getState().patchCamcorderFilter(p),
    switches: [{ label: 'tape jolt', key: 'beatReactive' }],
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
      { ...param<CamcorderFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Tape jolt', when: (f) => f.beatReactive },
    ],
  }),
  makeEffect<FilmFilterConfig>({
    label: 'Film reel',
    get: (c) => c.filmFilter,
    defaults: DEFAULT_STUDIO_CONFIG.filmFilter,
    patch: (p) => useStudioStore.getState().patchFilmFilter(p),
    switches: [{ label: 'beat pop', key: 'beatReactive' }],
    params: [
      { ...param<FilmFilterConfig>('scratches', 0, 1, 0.05), label: 'Scratches' },
      { ...param<FilmFilterConfig>('dust', 0, 1, 0.05), label: 'Dust & hair' },
      { ...param<FilmFilterConfig>('speed', 0, 1, 0.05), label: 'Reel speed' },
      { ...param<FilmFilterConfig>('flicker', 0, 1, 0.05), label: 'Flicker' },
      { ...param<FilmFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Beat pop', when: (f) => f.beatReactive },
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
    switches: [{ label: 'beat pop', key: 'beatReactive' }],
    params: [
      { ...param<HalftoneFilterConfig>('dotSize', 3, 14, 1), label: 'Dot size' },
      { ...param<HalftoneFilterConfig>('dotRange', 0, 1, 0.05), label: 'Shadow range' },
      { ...param<HalftoneFilterConfig>('strength', 0, 1, 0.05), label: 'Ink strength' },
      { ...param<HalftoneFilterConfig>('contrast', 0, 1, 0.05), label: 'Contrast' },
      { ...param<HalftoneFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Beat pop', when: (f) => f.beatReactive },
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
    switches: [{ label: 'beat pop', key: 'beatReactive' }],
    params: [
      { ...param<GlitchFilterConfig>('blocks', 0, 1, 0.05), label: 'Blocks' },
      { ...param<GlitchFilterConfig>('slices', 0, 1, 0.05), label: 'Slices' },
      { ...param<GlitchFilterConfig>('rate', 0, 1, 0.05), label: 'Burst rate' },
      { ...param<GlitchFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Beat pop', when: (f) => f.beatReactive },
    ],
  }),
  makeEffect<AnaglyphFilterConfig>({
    label: '3D glasses',
    get: (c) => c.anaglyphFilter,
    defaults: DEFAULT_STUDIO_CONFIG.anaglyphFilter,
    patch: (p) => useStudioStore.getState().patchAnaglyphFilter(p),
    switches: [{ label: 'beat pop', key: 'beatReactive' }],
    params: [
      { ...param<AnaglyphFilterConfig>('depth', 0, 2.5, 0.05), label: 'Depth' },
      { ...param<AnaglyphFilterConfig>('strength', 0, 1, 0.05), label: 'Mix' },
      // The 3D glasses' punch dial is the reactivity slider (its card binds
      // the beat row to it) — gated on the beat switch like the UI.
      { ...param<AnaglyphFilterConfig>('reactivity', 0, 1, 0.05), label: 'Beat pop', when: (f) => f.beatReactive },
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
    switches: [{ label: 'beat flare', key: 'beatReactive' }],
    params: [
      { ...param<PhosphorFilterConfig>('cellSize', 3, 12, 1), label: 'Cell size' },
      { ...param<PhosphorFilterConfig>('gap', 0, 0.6, 0.05), label: 'Spacing' },
      { ...param<PhosphorFilterConfig>('contrast', 0, 1, 0.05), label: 'Contrast' },
      // Taste ceiling: the roll never exceeds 30% strength.
      { ...param<PhosphorFilterConfig>('strength', 0, 1, 0.05), label: 'Strength', cap: 0.3 },
      { ...param<PhosphorFilterConfig>('glow', 0, 1, 0.05), label: 'Glow' },
      { ...param<PhosphorFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Beat flare', when: (f) => f.beatReactive },
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
    switches: [{ label: 'beat swell', key: 'beatReactive' }],
    params: [
      // Taste ceilings: the roll never exceeds 46 lines or 46% strength —
      // dense/strong contour webs bury the picture they trace.
      { ...param<ContourFilterConfig>('lines', 24, 160, 2), label: 'Lines', cap: 46 },
      { ...param<ContourFilterConfig>('warp', 0, 1, 0.05), label: 'Warp' },
      { ...param<ContourFilterConfig>('motion', 0, 1, 0.05), label: 'Drift' },
      { ...param<ContourFilterConfig>('reactivity', 0, 1, 0.05), label: 'Reactivity' },
      { ...param<ContourFilterConfig>('glow', 0, 1, 0.05), label: 'Glow' },
      { ...param<ContourFilterConfig>('stillness', 0, 1, 0.05), label: 'Stillness' },
      { ...param<ContourFilterConfig>('waveSpread', 0, 1, 0.05), label: 'Wave spread' },
      { ...param<ContourFilterConfig>('strength', 0, 1, 0.05), label: 'Strength', cap: 0.46 },
      { ...param<ContourFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Beat swell', when: (f) => f.beatReactive },
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
    switches: [{ label: 'beat lift', key: 'beatReactive' }],
    presets: [
      {
        label: 'Shape',
        key: 'shapes',
        options: CUBIFY_MIX_OPTIONS,
        names: CUBIFY_MIX_NAMES,
        // The id encodes the mix; the config field carries the parsed array.
        value: (id) => id.split('+') as CubifyShape[],
      },
    ],
    params: [
      { ...param<CubifyFilterConfig>('scale', 0, 8, 0.01), label: 'Cube size' },
      { ...param<CubifyFilterConfig>('stretch', -1, 1, 0.01), label: 'Cube stretch' },
      { ...param<CubifyFilterConfig>('depth', 0, 5, 0.01), label: 'Depth distortion' },
      { ...param<CubifyFilterConfig>('angle', 0, 90, 1), label: 'Rotation angle' },
      // The chromatic glass rides EVERY tile shape (each channel's pull
      // clamps inside its own cell, so it fringes the tile instead of
      // stacking ghost copies of it) — dispersion rolls for every mix; the
      // tile gaps only roll when the mix is actually mixed.
      { ...param<CubifyFilterConfig>('dispersion', 0, 1, 0.001), label: 'Dispersion' },
      {
        ...param<CubifyFilterConfig>('gaps', 0, 1, 0.05),
        label: 'Tile gaps',
        when: (f) => !(f.shapes.length === 1 && f.shapes[0] === 'cube'),
      },
      { ...param<CubifyFilterConfig>('blend', 0, 1, 0.05), label: 'Mix' },
      { ...param<CubifyFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Beat lift', when: (f) => f.beatReactive },
    ],
    colors: [
      {
        label: 'Dispersion fringes',
        keys: ['dispersionColorA', 'dispersionColorB'],
        roll: () => ({ dispersionColorA: vividColor(), dispersionColorB: vividColor() }),
        // The pickers only show while the glass is actually splitting.
        when: (f) => f.dispersion > 0.001,
      },
    ],
  }),
  makeEffect<DitherFilterConfig>({
    label: 'Retro dither',
    get: (c) => c.ditherFilter,
    defaults: DEFAULT_STUDIO_CONFIG.ditherFilter,
    patch: (p) => useStudioStore.getState().patchDitherFilter(p),
    // The card's punch row reads Beat shift / Beat flare per palette mode —
    // both bind the same switch, so the toast keeps the neutral name.
    switches: [{ label: 'beat punch', key: 'beatReactive' }],
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
      { ...param<DitherFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Beat punch', when: (f) => f.beatReactive },
    ],
  }),
  makeEffect<WaveWarpFilterConfig>({
    label: 'Water wave',
    get: (c) => c.waveWarpFilter,
    defaults: DEFAULT_STUDIO_CONFIG.waveWarpFilter,
    patch: (p) => useStudioStore.getState().patchWaveWarpFilter(p),
    switches: [{ label: 'beat wobble', key: 'beatReactive' }],
    params: [
      { ...param<WaveWarpFilterConfig>('amplitude', 0, 120, 1), label: 'Amplitude' },
      { ...param<WaveWarpFilterConfig>('density', 0.5, 8, 0.1), label: 'Ripples' },
      { ...param<WaveWarpFilterConfig>('speed', 0, 3, 0.05), label: 'Flow speed' },
      { ...param<WaveWarpFilterConfig>('blend', 0, 1, 0.05), label: 'Mix' },
      { ...param<WaveWarpFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Beat wobble', when: (f) => f.beatReactive },
    ],
  }),
  makeEffect<KaleidoscopeFilterConfig>({
    label: 'Kaleidoscope',
    get: (c) => c.kaleidoscopeFilter,
    defaults: DEFAULT_STUDIO_CONFIG.kaleidoscopeFilter,
    patch: (p) => useStudioStore.getState().patchKaleidoscopeFilter(p),
    presets: [
      {
        // The Segment style chip chooser (Classic / Mandala / Fan) — how
        // each wedge treats the slice, rolled like the gradient map's
        // shift motion so every pick lands one of the three treatments.
        label: 'Segment style',
        key: 'mirrorMode',
        options: ['alternate', 'mandala', 'direct'],
        names: {
          alternate: 'Classic tiling',
          mandala: 'Mandala',
          direct: 'Pinwheel fan',
        },
      },
    ],
    switches: [{ label: 'beat kick', key: 'beatReactive' }],
    params: [
      // The roll never lands 2 wedges (the plain two-way mirror reads as a
      // break, not a look) — 3..24 keeps every pick a real kaleidoscope.
      { ...param<KaleidoscopeFilterConfig>('segments', 3, 24, 1), label: 'Segments' },
      { ...param<KaleidoscopeFilterConfig>('spin', -0.5, 0.5, 0.01), label: 'Spin' },
      { ...param<KaleidoscopeFilterConfig>('zoom', 1, 4, 0.05), label: 'Zoom' },
      // Source motion — the drift is what makes a still background image
      // read as a working scope, so the roll always lands a living wander
      // (the zero-default moves too) and a breathe swell on top.
      { ...param<KaleidoscopeFilterConfig>('wander', 0, 1, 0.05), label: 'Wander' },
      { ...param<KaleidoscopeFilterConfig>('wanderSpeed', 0, 3, 0.05), label: 'Wander speed' },
      { ...param<KaleidoscopeFilterConfig>('breathe', 0, 1, 0.05), label: 'Breathe' },
      { ...param<KaleidoscopeFilterConfig>('centerX', 0, 100, 1), label: 'Center X' },
      { ...param<KaleidoscopeFilterConfig>('centerY', 0, 100, 1), label: 'Center Y' },
      { ...param<KaleidoscopeFilterConfig>('blend', 0, 1, 0.05), label: 'Mix' },
      { ...param<KaleidoscopeFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Beat kick', when: (f) => f.beatReactive },
    ],
  }),
  makeEffect<VignetteFilterConfig>({
    label: 'Vignette',
    get: (c) => c.vignetteFilter,
    defaults: DEFAULT_STUDIO_CONFIG.vignetteFilter,
    patch: (p) => useStudioStore.getState().patchVignetteFilter(p),
    // Two switches, rolled in order: which function the lens carries
    // (edge blur vs. the classic color shadow — either one, one at a time),
    // then the beat trigger.
    switches: [{ label: 'edge blur', key: 'edgeBlur' }, { label: 'beat pulse', key: 'beatReactive' }],
    params: [
      { ...param<VignetteFilterConfig>('amount', 0, 1, 0.05), label: 'Amount' },
      { ...param<VignetteFilterConfig>('reach', 0, 1, 0.05), label: 'Reach' },
      { ...param<VignetteFilterConfig>('softness', 0, 1, 0.05), label: 'Softness' },
      { ...param<VignetteFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Beat pulse', when: (f) => f.beatReactive },
    ],
    colors: [
      {
        label: 'Edge tint',
        keys: ['tintColor'],
        // The shadow always rolls deep — a bright edge tint would read as a
        // glow frame, not a lens. Only while the lens carries the color
        // function: the tint picker hides when edge blur owns the card, and
        // a rolled color no one can see is a dead pick.
        when: (f) => !f.edgeBlur,
        roll: () => ({ tintColor: deepColor() }),
      },
    ],
  }),
  makeEffect<ShakeFilterConfig>({
    label: 'Camera shake',
    get: (c) => c.shakeFilter,
    defaults: DEFAULT_STUDIO_CONFIG.shakeFilter,
    patch: (p) => useStudioStore.getState().patchShakeFilter(p),
    switches: [{ label: 'beat jolt', key: 'beatReactive' }],
    params: [
      { ...param<ShakeFilterConfig>('amount', 0, 60, 1), label: 'Drift' },
      { ...param<ShakeFilterConfig>('speed', 0, 3, 0.05), label: 'Drift speed' },
      { ...param<ShakeFilterConfig>('wobble', 0, 2, 0.05), label: 'Roll wobble' },
      { ...param<ShakeFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Beat jolt', when: (f) => f.beatReactive },
    ],
  }),
  makeEffect<StrobeFilterConfig>({
    label: 'Strobe',
    get: (c) => c.strobeFilter,
    defaults: DEFAULT_STUDIO_CONFIG.strobeFilter,
    patch: (p) => useStudioStore.getState().patchStrobeFilter(p),
    // Three switches, rolled in order: the beat trigger, the color overlay
    // on the invert, and the per-flash hue roll — the last gated on the
    // overlay (a rolled-on hue roll with no overlay would be a dead pick).
    switches: [
      { label: 'beat flash', key: 'beatReactive' },
      { label: 'color overlay', key: 'colorOverlay' },
      { label: 'color on every flash', key: 'randomColorOnBeat', when: (f) => f.colorOverlay },
    ],
    params: [
      { ...param<StrobeFilterConfig>('frequency', 0, 8, 0.1), label: 'Frequency' },
      { ...param<StrobeFilterConfig>('mix', 0, 1, 0.05), label: 'Mix' },
      { ...param<StrobeFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Beat flash', when: (f) => f.beatReactive },
    ],
    colors: [
      {
        label: 'Overlay color',
        keys: ['overlayColor'],
        // Only while the dialed hue actually dresses the look — with the
        // per-flash roll on, every flash lands its own hue and the picker
        // stays at factory.
        when: (v) => v.colorOverlay && !v.randomColorOnBeat,
        roll: () => ({ overlayColor: vividColor() }),
      },
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
      // The gradient-map dials carry dedicated windows (the user's tuning):
      // the shift only drifts within ±0.11 of center and the repeat only
      // lands x1 or x2 — a rolled ramp stays a subtle re-tint of the frame,
      // never a wild swing or a striped one. The noise dials have windows
      // too: film grain rolls from the published Preset level to +15% over
      // it, and grain size from the published fine speckle (0.5px) to 1.2px.
      {
        ...param<NeonSplitFilterConfig>('mapShift', -0.11, 0.11, 0.01),
        label: 'Gradient shift',
        def: 0,
        uniform: true,
      },
      {
        ...param<NeonSplitFilterConfig>('mapRepeat', 1, 2, 1),
        label: 'Gradient repeat',
        def: 1,
        uniform: true,
      },
      { ...param<NeonSplitFilterConfig>('glow', 0, 1, 0.05), label: 'Bloom intensity' },
      { ...param<NeonSplitFilterConfig>('bloomThreshold', 0, 1, 0.05), label: 'Bloom threshold' },
      { ...param<NeonSplitFilterConfig>('bloomSoftness', 0, 1, 0.05), label: 'Bloom softness' },
      { ...param<NeonSplitFilterConfig>('bloomMix', 0, 1, 0.05), label: 'Bloom mix' },
      // Film grain's dedicated window (the user's tuning): from the
      // published Preset level (dial 0.5, the UI's 'Preset' label) to +15%
      // over it (dial 0.65) — never cleaner than the preset, never noisier
      // than +15%.
      {
        ...param<NeonSplitFilterConfig>('grain', 0.5, 0.65, 0.05),
        label: 'Film grain',
        uniform: true,
      },
      { ...param<NeonSplitFilterConfig>('grainSpeed', 0, 1, 0.05), label: 'Grain speed' },
      // Grain size's dedicated window (the user's tuning): from the
      // published fine speckle (dial 0.5 = 0.5px, the UI's 'Preset (fine)'
      // label) to 1.2px (dial 0.6) — chunkier grain never lands.
      {
        ...param<NeonSplitFilterConfig>('grainSize', 0.5, 0.6, 0.05),
        label: 'Grain size',
        uniform: true,
      },
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
      // Taste ceiling: the roll never grades harder than 45% — full-bore
      // grades steamroll every other pick in the roll.
      { ...param<ColorGradeFilterConfig>('strength', 0, 1, 0.05), label: 'Strength', cap: 0.45 },
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
        // The built-in ramp library PLUS 'custom' (the user's ask: the map's
        // colors can also use custom colors, set according to other colors
        // in the image) — a custom pick writes fresh editable stops into
        // customStops: sampled from the loaded background image or video
        // when one is up (dominant colors, luminance-sorted), vivid rolls
        // when there isn't. Exactly like the editor's Custom tab.
        options: ['neon', 'uv', 'acid', 'ember', 'ice', 'sunset', 'magma', 'gold', 'rose', 'mono', 'custom'],
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
          // Getter — re-read on every roll so the toast names where the
          // custom colors came from (the extra callback runs before the
          // pick is pushed; see rollCustomRampStops).
          get custom() {
            return `Custom colors (${customRampFrom})`
          },
        },
        extra: (id) => (id === 'custom' ? { customStops: rollCustomRampStops() } : null),
        // Factory state carries the Neon seed stops in customStops — reset
        // restores them, so the editor's Custom tab goes back to factory too.
        reset: {
          customStops: DEFAULT_STUDIO_CONFIG.gradientMapFilter.customStops.map((s) => ({ ...s })),
        },
      },
      {
        // The Shift motion chip chooser (Manual / Continuous / React to
        // beat / Randomize) — rolled FIRST so its landing gates which
        // motion dials roll below, exactly like the tab's own chooser.
        label: 'Shift motion',
        key: 'shiftMode',
        options: ['manual', 'continuous', 'beat', 'random'],
        names: {
          manual: 'Manual motion',
          continuous: 'Continuous motion',
          beat: 'Beat motion',
          random: 'Random walk',
        },
      },
    ],
    params: [
      { ...param<GradientMapFilterConfig>('opacity', 0, 1, 0.01), label: 'Opacity' },
      // Dedicated window (the user's tuning): the shift rolls ANYWHERE
      // between -100% and 90% — uniform across the whole track except the
      // last 10% of the far end, not the old ±25% jitter around center.
      {
        ...param<GradientMapFilterConfig>('shift', -1, 0.9, 0.01),
        label: 'Gradient shift',
        uniform: true,
      },
      { ...param<GradientMapFilterConfig>('repeat', 1, 8, 1), label: 'Gradient repeat' },
      // Taste ceiling: the roll never cycles faster than 50% — runaway
      // speeds strobe the whole grade. The factory default (30%) already
      // respects it, so the usual ±25% jitter applies underneath.
      { ...param<GradientMapFilterConfig>('shiftSpeed', 0, 1, 0.05), label: 'Speed', when: (f) => f.shiftMode === 'continuous', cap: 0.5 },
      { ...param<GradientMapFilterConfig>('beatStep', 0.05, 1, 0.05), label: 'Beat step', when: (f) => f.shiftMode === 'beat' },
      { ...param<GradientMapFilterConfig>('beatSens', 0, 1, 0.05), label: 'Kick sensitivity', when: (f) => f.shiftMode === 'beat' },
      { ...param<GradientMapFilterConfig>('beatEase', 0.02, 0.6, 0.02), label: 'Glide', when: (f) => f.shiftMode === 'beat' },
      { ...param<GradientMapFilterConfig>('randomStepMin', 0.01, 0.5, 0.01), label: 'Min step', when: (f) => f.shiftMode === 'random' },
      { ...param<GradientMapFilterConfig>('randomStepMax', 0.01, 0.5, 0.01), label: 'Max step', when: (f) => f.shiftMode === 'random' },
      { ...param<GradientMapFilterConfig>('randomStepTime', 0.1, 3, 0.05), label: 'Step time', when: (f) => f.shiftMode === 'random' },
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
    switches: [{ label: 'beat flare', key: 'beatReactive' }],
    params: [
      { ...param<HalationFilterConfig>('threshold', 0, 1, 0.01), label: 'Threshold' },
      { ...param<HalationFilterConfig>('knee', 0.01, 0.8, 0.01), label: 'Knee' },
      { ...param<HalationFilterConfig>('boost', 0, 1, 0.01), label: 'Boost' },
      { ...param<HalationFilterConfig>('localDiffusion', 0.005, 0.2, 0.005), label: 'Local glow' },
      { ...param<HalationFilterConfig>('globalDiffusion', 0, 0.4, 0.005), label: 'Global halo' },
      { ...param<HalationFilterConfig>('intensity', 0, 1, 0.01), label: 'Intensity' },
      { ...param<HalationFilterConfig>('backgroundGain', 0, 1, 0.01), label: 'Background gain' },
      { ...param<HalationFilterConfig>('blueComp', 0, 1, 0.01), label: 'Compensation' },
      { ...param<HalationFilterConfig>('beatStrength', 0, 1, 0.05), label: 'Beat flare', when: (f) => f.beatReactive },
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
 * and roll its LAYOUT (position across the whole track, size 20–160%), ALL
 * of its SHAPE & MOTION dials and picks, 0–2 color tools and 0–2 filters —
 * every picked effect's colors and presets re-rolled in their own roles,
 * and the backdrop set to a fresh solid or gradient in a fresh brightness
 * mood. Applies the patches to the studio store and returns what moved.
 */
export function randomizeLook(): RandomizeSummary {
  const changed: string[] = []

  /* ------------------------- clean slate ------------------------- */

  // Style dials: every dial the randomizer owns goes back to its factory
  // value — including dials the current style hides, so no stale roll
  // resurfaces after a style switch. The non-numeric style fields it owns
  // (orientation, mirror, glow, the cards' picks and switches) sweep back
  // alongside them. One patch for the whole sweep.
  const styleReset: Record<string, unknown> = { ...STYLE_FIELD_RESET }
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

  // Layout: position across the whole track (the factory 50/50 sits dead
  // center, so 50%-either-way IS the full track) and size between 20% and
  // 160% — every roll.
  changed.push(rollLayout())

  // Shape & motion: every slider the section (plus the Dot Sphere / Image
  // cards' own dressing) shows for the freshly picked style lands a
  // uniform random spot on its track (Serato's Sensitivity stays in its
  // 0.2–0.7 window, and its colors pick lands rainbow, palette or solid);
  // the picks and switches (orientation,
  // mirror, glow, the cards' selectors, perspective's own colors) flip
  // alongside them — all of it, every roll.
  changed.push(rollShapeMotion())

  // Visualizer gradient: the Style tab's GRADIENT section joins every roll
  // when the freshly switched style still shows it (every style except
  // perspective — mirrored from the tab; perspective's own two-color split
  // rolled with the shape & motion above). Colors land fresh each roll:
  // half the rolls one of the editor's preset ramps, half a coordinated
  // vivid recolor of the existing stops. Shape flips linear/radial and
  // Cycle colors flips on/off, each 50/50 — angle, cycle speed and the
  // stop layout (outside the preset branch) stay as the user set them.
  const vizAfter = useStudioStore.getState().config.visualizer
  if (vizAfter.style !== 'perspective') {
    const notes: string[] = []
    const gradient = { ...vizAfter.gradient }
    if (Math.random() < 0.5) {
      const presetIds = Object.keys(GRADIENT_PRESETS) as GradientPresetId[]
      const id = pickRandom(presetIds, 1)[0]
      if (id) {
        // The editor's preset pills swap the stops and keep every other
        // field — the roll does exactly that, so pill highlighting agrees.
        gradient.stops = GRADIENT_PRESETS[id].stops.map((s) => ({ ...s }))
        changed.push(`Gradient → ${GRADIENT_PRESETS[id].name}`)
      }
    } else {
      gradient.stops = rollVividStops(gradient.stops)
      changed.push('Gradient colors')
    }
    gradient.shape = Math.random() < 0.5 ? 'linear' : 'radial'
    if (gradient.shape === 'radial') notes.push('radial')
    gradient.cycleColors = Math.random() < 0.5
    if (gradient.cycleColors) notes.push('cycle on')
    useStudioStore.getState().patchGradient(gradient)
    const last = changed.length - 1
    if (notes.length && last >= 0 && changed[last]) changed[last] += ` (${notes.join(', ')})`
  }

  // Background: the mode itself joins the roll — every press sets the
  // backdrop to a Solid or a Gradient (50/50) with fresh colors in one of
  // three brightness moods (deep / mid / bright), so it stops reading as
  // always-dark. The gradient's geometry (stop layout, angle, shape,
  // cycling) stays exactly as the user set them; only the colors roll.
  // The one exception: an uploaded image or video IS the backdrop — the
  // dice never yank the scene off the user's media, so this roll is skipped
  // entirely and the toast just reports the media was kept.
  const background = useStudioStore.getState().config.background
  if (background.mode === 'image' || background.mode === 'video') {
    changed.push(`Background ${background.mode} kept`)
  } else {
    const mood = rollBackgroundMood()
    if (Math.random() < 0.5) {
      useStudioStore.getState().patchBackground({ mode: 'solid', color: rollSolidBackground(mood) })
      changed.push(`Background solid (${mood})`)
    } else {
      useStudioStore.getState().patchBackground({
        mode: 'gradient',
        gradient: { ...background.gradient, stops: rollBackgroundStops(background.gradient.stops, mood) },
      })
      changed.push(`Background gradient (${mood})`)
    }
  }

  // Filters > Layers: the card's switches join every roll — "Layers stay
  // colored" flips 50/50 and, when it lands off, "Text stays legible"
  // flips too. Both fields are written every roll, so a previous roll's
  // lifted layers never stack onto the next one.
  const layersNote = rollLayers()
  if (layersNote) changed.push(layersNote)

  // Color tools: 0–2. (The gradient map's Ramp roll may land 'custom' —
  // fresh editable stops sampled from the loaded background image / video,
  // vivid rolls without one — see rollCustomRampStops.)
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
