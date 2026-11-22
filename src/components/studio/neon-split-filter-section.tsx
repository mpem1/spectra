'use client'

import { Plus, Sparkles, X } from 'lucide-react'
import type { NeonMapStop, NeonSplitFilterConfig } from '@/lib/visualizer/types'
import { RAMPS, rampCss } from '@/lib/visualizer/neon-split-data'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { MicroLabel, SliderRow, sectionShell } from '@/components/studio/controls'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { cn } from '@/lib/utils'

/** The five ramps as quick-start presets — each loads its stops into the
 *  editable gradient map below. 'violet' is the real preset's gradient. */
const RAMP_PRESETS: {
  id: NeonSplitFilterConfig['ramp']
  label: string
  sub: string
}[] = [
  { id: 'violet', label: 'Violet neon', sub: 'the real preset' },
  { id: 'uv', label: 'UV', sub: 'electric violet' },
  { id: 'acid', label: 'Acid', sub: 'radioactive green' },
  { id: 'ember', label: 'Ember', sub: 'furnace orange' },
  { id: 'ice', label: 'Ice', sub: 'glacial cyan' },
]

/** The gradient map's Blend dropdown — effect.app's own modes, each with the
 *  exact per-channel math the shader (and the CPU fallback) runs. */
const BLEND_MODES: { id: NonNullable<NeonSplitFilterConfig['mapBlend']>; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'add', label: 'Add' },
]

const MAX_MAP_STOPS = 8

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function rgbHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v * 255))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function sortedStops(stops: NeonMapStop[]): NeonMapStop[] {
  return [...stops].sort((a, b) => a.t - b.t)
}

/** The gradient's color at position t — linear between the neighbor stops. */
function sampleStops(stops: NeonMapStop[], t: number): string {
  const s = sortedStops(stops)
  if (s.length === 0) return '#000000'
  if (t <= s[0].t) return s[0].c
  if (t >= s[s.length - 1].t) return s[s.length - 1].c
  for (let i = 0; i < s.length - 1; i++) {
    if (t <= s[i + 1].t) {
      const f = (t - s[i].t) / Math.max(1e-6, s[i + 1].t - s[i].t)
      const a = hexRgb(s[i].c)
      const b = hexRgb(s[i + 1].c)
      return rgbHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f)
    }
  }
  return s[s.length - 1].c
}

function sameStops(a: NeonMapStop[], b: NeonMapStop[]): boolean {
  if (a.length !== b.length) return false
  const sa = sortedStops(a)
  const sb = sortedStops(b)
  return sa.every((s, i) => Math.abs(s.t - sb[i].t) < 0.005 && s.c === sb[i].c)
}

/** Group divider inside the card — a small uppercase header with a rule. */
function Group({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {children}
      </span>
      <span className="h-px flex-1 bg-zinc-800/80" aria-hidden />
    </div>
  )
}

/**
 * Neon Split filter card — the effect.app "neon split" preset, rebuilt from
 * the preset's own published definition and effect shaders (fetched off the
 * site — the same numbers the real thing runs). The upper part of the frame
 * inverts behind a soft vertical band (the actual "split", fading out just
 * past mid-height), the highlights bloom through a mip pyramid, colored film
 * grain sits in the light and can churn at a set speed, and every pixel's
 * brightness re-reads through the preset's own gradient map. Every effect
 * node's real parameters are on dials here: the gradient map's amount, the
 * bloom's threshold / softness / intensity / mix, and the grain's strength /
 * speed / size / color / shadow / highlight weighting. An optional split line
 * lets the frame below the line keep its own colors. Baked into every export;
 * skipped on transparent backgrounds. With the switch off the card collapses
 * to a single line — the same way the other filter cards keep the Color tab
 * clean.
 */
export function NeonSplitFilterSection() {
  const filter = useStudioStore((s) => s.config.neonSplitFilter)
  const patchNeonSplitFilter = useStudioStore((s) => s.patchNeonSplitFilter)

  const set = (key: keyof NeonSplitFilterConfig) => (value: number) =>
    patchNeonSplitFilter({ [key]: value } as Partial<NeonSplitFilterConfig>)

  // The gradient map's live stops: the edited set when present, else the
  // legacy ramp (old saves carry `ramp` without `mapStops`).
  const stops: NeonMapStop[] =
    filter.mapStops && filter.mapStops.length > 0 ? filter.mapStops : RAMPS[filter.ramp] ?? RAMPS.violet
  const patchStops = (mapStops: NeonMapStop[]) => patchNeonSplitFilter({ mapStops })

  return (
    <section className={sectionShell('fuchsia', undefined, filter.enabled)}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-fuchsia-500" aria-hidden />
          <MicroLabel className="text-fuchsia-300/80">Neon Split</MicroLabel>
        </div>
        <Switch
          aria-label="Enable neon split filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchNeonSplitFilter({ enabled })}
        />
      </div>
      {/* Like most of the other filter cards, the card is minimized while
          the switch is off — one line keeps it discoverable, flipping the
          switch opens the full dial set. */}
      {filter.enabled ? (
        <p className="text-[11px] leading-snug text-zinc-600">
          The effect.app neon-split preset, rebuilt from its own published
          shader code — with the full Gradient map node on dials below: an
          editable gradient (every stop is a row — pick its color, slide its
          position), its Opacity, Blend mode, Gradient shift and Gradient
          repeat — plus Noise (the colored film grain) and Bloom (the
          highlight glow). The upper part of the frame inverts behind a soft
          band — the real &ldquo;split&rdquo;. Everything here bakes into
          the preview and every export.
        </p>
      ) : (
        <p className="text-[11px] leading-snug text-zinc-600">
          The effect.app neon-split preset on full dials — flip the switch
          on to open the gradient map, bloom, grain and frame controls.
        </p>
      )}

      {filter.enabled && (
      <div className="space-y-3">
          {/* effect.app's GRADIENT MAP node — the real feature set: Blend,
              Opacity, the editable gradient (one slider row per color stop),
              shift and repeat, with the five ramp presets as one-click
              starting points. */}
          <Group>Gradient map</Group>
          <div className="space-y-1.5">
            <MicroLabel>Blend</MicroLabel>
            <Select
              value={filter.mapBlend ?? 'normal'}
              onValueChange={(v) =>
                patchNeonSplitFilter({ mapBlend: v as NonNullable<NeonSplitFilterConfig['mapBlend']> })
              }
              disabled={!filter.enabled}
            >
              <SelectTrigger aria-label="Gradient map blend mode" className="h-9 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BLEND_MODES.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SliderRow
            label="Opacity"
            value={filter.mapAmount ?? 1}
            min={0}
            max={1}
            step={0.05}
            onChange={set('mapAmount')}
            disabled={!filter.enabled}
            format={(v) => `${Math.round(v * 100)}`}
          />
          <div className="space-y-1.5">
            <MicroLabel>Color stops</MicroLabel>
            <p className="text-[10px] leading-snug text-zinc-600">
              Each stop is one row: pick its color, slide its position from
              shadows (0) to highlights (100), delete it with the X — add more
              with the button below.
            </p>
            <div className="space-y-1.5" role="group" aria-label="Gradient map color stops">
              {stops.map((stop, index) => (
                <div key={index} className="flex items-center gap-2">
                  <ColorPickerButton
                    value={stop.c}
                    onChange={(c) => patchStops(stops.map((s, i) => (i === index ? { ...s, c } : s)))}
                    ariaLabel={`Gradient map stop ${index + 1} color`}
                  />
                  <Slider
                    aria-label={`Gradient map stop ${index + 1} position`}
                    min={0}
                    max={100}
                    step={1}
                    value={[Math.round(Math.min(1, Math.max(0, stop.t)) * 100)]}
                    onValueChange={(vals: number[]) =>
                      patchStops(stops.map((s, i) => (i === index ? { ...s, t: (vals[0] ?? 0) / 100 } : s)))
                    }
                    className="flex-1 py-1"
                  />
                  <span className="w-7 text-right text-xs tabular-nums text-zinc-300">
                    {Math.round(Math.min(1, Math.max(0, stop.t)) * 100)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-zinc-500 hover:text-red-400"
                    aria-label={`Delete gradient map stop ${index + 1}`}
                    disabled={stops.length <= 2 || !filter.enabled}
                    onClick={() => patchStops(stops.filter((_, i) => i !== index))}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              className="h-8 w-full border-dashed border-zinc-700 text-xs text-zinc-400 hover:border-fuchsia-500/60 hover:text-fuchsia-400"
              disabled={!filter.enabled || stops.length >= MAX_MAP_STOPS}
              onClick={() => patchStops([...stops, { t: 0.5, c: sampleStops(stops, 0.5) }])}
            >
              <Plus className="size-3.5" aria-hidden />
              Add color stop
            </Button>
          </div>
          <SliderRow
            label="Gradient shift"
            value={filter.mapShift ?? 0}
            min={-1}
            max={1}
            step={0.01}
            onChange={set('mapShift')}
            disabled={!filter.enabled}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Gradient repeat"
            value={filter.mapRepeat ?? 1}
            min={1}
            max={8}
            step={1}
            onChange={set('mapRepeat')}
            disabled={!filter.enabled}
            format={(v) => `${Math.round(v)}×`}
          />
          <div className="space-y-1.5">
            <MicroLabel>Ramp presets</MicroLabel>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" role="group" aria-label="Ramp presets">
              {RAMP_PRESETS.map((r) => {
                const presetStops = RAMPS[r.id]
                const active = sameStops(stops, presetStops)
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={!filter.enabled}
                    aria-pressed={active}
                    aria-label={`Load ${r.label} ramp preset into the gradient map`}
                    onClick={() =>
                      patchNeonSplitFilter({ ramp: r.id, mapStops: presetStops.map((s) => ({ ...s })) })
                    }
                    className={cn(
                      'flex min-h-[44px] flex-col justify-center gap-1.5 rounded-lg border px-2.5 py-2 transition-colors',
                      active
                        ? 'border-fuchsia-400/70 bg-fuchsia-500/15'
                        : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700',
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          'text-xs font-medium',
                          active ? 'text-fuchsia-200' : 'text-zinc-300',
                        )}
                      >
                        {r.label}
                      </span>
                      <span className="text-[9px] leading-none text-zinc-500">{r.sub}</span>
                    </span>
                    <span
                      aria-hidden
                      className="h-1.5 w-full rounded-full"
                      style={{ background: rampCss(r.id) }}
                    />
                  </button>
                )
              })}
            </div>
          </div>

          <Group>Bloom</Group>
          <SliderRow
            label="Intensity"
            value={filter.glow}
            min={0}
            max={1}
            step={0.05}
            onChange={set('glow')}
            disabled={!filter.enabled}
            format={(v) => (v <= 0.025 ? 'Flat' : v <= 0.525 ? 'Preset' : `+${Math.round((v - 0.5) * 100)}%`)}
          />
          <SliderRow
            label="Threshold"
            value={filter.bloomThreshold ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            onChange={set('bloomThreshold')}
            disabled={!filter.enabled}
            format={(v) => {
              const t = Math.round(Math.min(1, Math.max(0, 0.1 + (v - 0.5) * 1.4)) * 100)
              return t <= 1 ? 'Everything' : `${t}%`
            }}
          />
          <SliderRow
            label="Softness"
            value={filter.bloomSoftness ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            onChange={set('bloomSoftness')}
            disabled={!filter.enabled}
            format={(v) => (v <= 0.025 ? 'Hard edge' : v <= 0.525 ? 'Preset' : 'Softest')}
          />
          <SliderRow
            label="Mix"
            value={filter.bloomMix ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            onChange={set('bloomMix')}
            disabled={!filter.enabled}
            format={(v) => (v <= 0.025 ? 'None' : `${Math.round(v * 130)}%`)}
          />

          {/* effect.app calls this section Noise — same colored speckle. */}
          <Group>Noise · film grain</Group>
          <SliderRow
            label="Film grain"
            value={filter.grain}
            min={0}
            max={1}
            step={0.05}
            onChange={set('grain')}
            disabled={!filter.enabled}
            format={(v) => (v <= 0.025 ? 'Clean' : v <= 0.525 ? 'Preset' : `+${Math.round((v - 0.5) * 100)}%`)}
          />
          <SliderRow
            label="Grain speed"
            value={filter.grainSpeed ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            onChange={set('grainSpeed')}
            disabled={!filter.enabled}
            format={(v) => (v <= 0.025 ? 'Still' : `${Math.round(v * 24)} steps/s`)}
          />
          <SliderRow
            label="Grain size"
            value={filter.grainSize ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            onChange={set('grainSize')}
            disabled={!filter.enabled}
            format={(v) => {
              const cell = Math.max(0.5, 0.5 + (v - 0.5) * 7)
              return cell <= 0.51 ? 'Preset (fine)' : `${cell.toFixed(1)}px`
            }}
          />
          <SliderRow
            label="Grain color"
            value={filter.grainChroma ?? 0.69}
            min={0}
            max={1}
            step={0.05}
            onChange={set('grainChroma')}
            disabled={!filter.enabled}
            format={(v) => (v <= 0.025 ? 'Monochrome' : Math.abs(v - 0.69) <= 0.03 ? 'Preset' : `${Math.round(v * 100)}% colored`)}
          />
          <SliderRow
            label="Shadow grain"
            value={filter.grainShadow ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            onChange={set('grainShadow')}
            disabled={!filter.enabled}
            format={(v) => {
              const w = Math.round(Math.min(1, Math.max(0, 0.25 + (v - 0.5))) * 100)
              return w <= 1 ? 'None' : Math.abs(v - 0.5) <= 0.03 ? 'Preset' : `${w}%`
            }}
          />
          <SliderRow
            label="Highlight grain"
            value={filter.grainHighlight ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            onChange={set('grainHighlight')}
            disabled={!filter.enabled}
            format={(v) => {
              const w = Math.round(Math.min(1, Math.max(0.06, 0.53 + (v - 0.5) * 0.94)) * 100)
              return Math.abs(v - 0.5) <= 0.03 ? 'Preset' : `${w}%`
            }}
          />

          <Group>Frame</Group>
          <SliderRow
            label="Contrast"
            value={filter.contrast}
            min={0}
            max={1}
            step={0.05}
            onChange={set('contrast')}
            disabled={!filter.enabled}
            format={(v) => (v < 0.475 ? 'Washed' : v <= 0.525 ? 'Preset' : `+${Math.round((v - 0.5) * 100)}%`)}
          />
          <SliderRow
            label="Split"
            value={filter.split}
            min={0}
            max={1}
            step={0.05}
            onChange={set('split')}
            disabled={!filter.enabled}
            format={(v) => (v <= 0.025 ? 'All neon' : `${Math.round(v * 100)}% original`)}
          />
          <SliderRow
            label="Mix"
            value={filter.strength}
            min={0}
            max={1}
            step={0.05}
            onChange={set('strength')}
            disabled={!filter.enabled}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            Every dial sits at the real preset&apos;s value in the middle.
            Gradient map: your own editable gradient (one row per stop — a
            color and a position slider) carries ALL the color; Opacity blends the
            original colors back through it (100 = the published full map),
            Shift slides the ramp window with wrap-around (shadows can pick up
            the bright end — the look in the reference&apos;s -0.55), Repeat
            tiles the ramp, and Blend sets how the mapped color lands on each
            pixel (Normal replaces it; Multiply / Screen / Overlay / Add mix
            it with what&apos;s there). Bloom: Intensity drives the
            mip-pyramid glow (50% = its intensity 3), Threshold sets how
            bright a pixel must be before it glows, Softness is the knee of
            that cutoff, Mix scales how much of the glow screens back over
            the frame. Noise (film grain): the preset&apos;s colored speckle
            in linear light — heavier in highlights than shadows; Speed rolls
            it like film (0 = the published still grain, 24 steps/s at full),
            Size goes from the published fine speckle to chunky 4px grain,
            Color goes mono ↔ colored, Shadow / Highlight grain re-weight
            which tones catch the speckle. Frame: Contrast shapes the master
            tone curve (50% = the preset&apos;s own curve), Split fades the
            untouched picture back in from the bottom, Mix blends the whole
            look back toward the original. Skipped on transparent
            backgrounds so alpha recordings stay clean.
          </p>
      </div>
      )}
    </section>
  )
}
