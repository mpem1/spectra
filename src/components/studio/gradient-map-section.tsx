'use client'

import { Blend, Plus, X } from 'lucide-react'
import type { GradientMapFilterConfig, GradientMapPresetId } from '@/lib/visualizer/types'
import {
  GRADIENT_MAP_BLENDS,
  GRADIENT_MAP_PRESETS,
  gradientPresetCss,
  gradientStopsCss,
} from '@/lib/visualizer/gradient-map-filter'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SliderRow, sectionShell, MicroLabel } from '@/components/studio/controls'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Custom ramps cap at 8 stops (2 minimum) — beyond that the ramp stops
 *  resolving into anything a human can steer. */
const MAX_STOPS = 8

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

/** One gradient preset chip — a live ramp swatch bar over the name, the
 *  active chip picks up the section's cyan. */
function PresetChip({
  label,
  sub,
  css,
  active,
  onClick,
}: {
  label: string
  sub: string
  css: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex min-h-[44px] flex-col justify-center gap-1 rounded-lg border px-2 py-1.5 transition-colors',
        active
          ? 'border-cyan-400/70 bg-cyan-500/15'
          : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700',
      )}
    >
      <span
        aria-hidden
        className="h-2.5 w-full rounded-full border border-zinc-700"
        style={{ background: css }}
      />
      <span className={cn('text-[11px] font-medium leading-none', active ? 'text-cyan-200' : 'text-zinc-300')}>
        {label}
      </span>
      <span className="text-[9px] leading-none text-zinc-500">{sub}</span>
    </button>
  )
}

/** One option in the shift-motion chip chooser (Manual / Continuous / Beat). */
function ModeChip({
  label,
  sub,
  active,
  onClick,
}: {
  label: string
  sub: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 transition-colors',
        active
          ? 'border-cyan-400/70 bg-cyan-500/15 text-cyan-200'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
      )}
    >
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[9px] leading-none text-zinc-500">{sub}</span>
    </button>
  )
}

/**
 * Gradient map card — effect.app's Gradient Map effect as its own Color-tab
 * stage. Every pixel's brightness re-reads as a position on a gradient ramp
 * and the mapped color lands on the picture through a blend mode at an
 * opacity: pick one of ten preset ramps, slide and tile the window, or let
 * the window cycle on its own — steady (Continuous) or rolling forward one
 * step on every detected kick (React to beat). Like the other filter cards,
 * the card collapses to one line while the switch is off.
 */
export function GradientMapSection() {
  const filter = useStudioStore((s) => s.config.gradientMapFilter)
  const patch = useStudioStore((s) => s.patchGradientMapFilter)

  const set = (key: keyof GradientMapFilterConfig) => (value: number) =>
    patch({ [key]: value } as Partial<GradientMapFilterConfig>)

  return (
    <section className={sectionShell('cyan')}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Blend className="size-3.5 text-cyan-500" aria-hidden />
          <MicroLabel className="text-cyan-300/80">Gradient map</MicroLabel>
        </div>
        <Switch
          aria-label="Enable gradient map filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patch({ enabled })}
        />
      </div>

      {filter.enabled ? (
        <>
          <p className="text-[11px] leading-snug text-zinc-600">
            The effect.app Gradient Map as its own stage: every pixel&apos;s
            brightness re-reads as a position on a gradient ramp and the mapped
            color lands on the picture through a blend mode at an opacity —
            the same engine node Neon Split runs, standalone. Pick a preset
            ramp or build your own, then slide and tile the window, or let it
            cycle on its own.
          </p>

          <div className="space-y-3">
            <Group>Gradient map</Group>
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Gradient preset">
              {GRADIENT_MAP_PRESETS.map((p) => (
                <PresetChip
                  key={p.id}
                  label={p.label}
                  sub={p.sub}
                  css={gradientPresetCss(p.id)}
                  active={filter.preset === p.id}
                  onClick={() => patch({ preset: p.id as GradientMapPresetId })}
                />
              ))}
              {/* Custom — a full-width chip with a live swatch of the
                  user's own stops (seeded from the house look). */}
              <button
                type="button"
                aria-pressed={filter.preset === 'custom'}
                onClick={() => patch({ preset: 'custom' as GradientMapPresetId })}
                className={cn(
                  'col-span-2 flex min-h-[44px] items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors',
                  filter.preset === 'custom'
                    ? 'border-cyan-400/70 bg-cyan-500/15'
                    : 'border-dashed border-zinc-700 bg-zinc-900/60 hover:border-zinc-500',
                )}
              >
                <span
                  aria-hidden
                  className="h-2.5 min-w-0 flex-1 rounded-full border border-zinc-700"
                  style={{ background: gradientStopsCss(filter.customStops ?? []) }}
                />
                {filter.preset === 'custom' ? (
                  <span className="text-[11px] font-medium leading-none text-cyan-200">Custom</span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium leading-none text-zinc-300">
                    <Plus className="size-3" aria-hidden />
                    Custom ramp
                  </span>
                )}
              </button>
            </div>

            {filter.preset === 'custom' ? (
              <div className="space-y-1.5" role="group" aria-label="Custom ramp stops">
                {filter.customStops.map((stop, index) => (
                  // Stable index keys — a key derived from color/position
                  // would remount the row mid-drag and slam the color
                  // picker popover shut (same contract as the background
                  // gradient editor).
                  <div key={index} className="flex items-center gap-2">
                    <ColorPickerButton
                      value={stop.c}
                      onChange={(color) => {
                        const stops = filter.customStops.map((s, i) =>
                          i === index ? { ...s, c: color.toLowerCase() } : s,
                        )
                        patch({ customStops: stops })
                      }}
                      ariaLabel={`Ramp stop ${index + 1} color`}
                    />
                    <div className="min-w-0 flex-1">
                      <SliderRow
                        label={`Stop ${index + 1}`}
                        value={stop.t}
                        min={0}
                        max={1}
                        step={0.01}
                        onChange={(t) => {
                          const stops = filter.customStops.map((s, i) =>
                            i === index ? { ...s, t: Math.min(1, Math.max(0, t)) } : s,
                          )
                          patch({ customStops: stops })
                        }}
                        format={(v) => `${Math.round(v * 100)}%`}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-zinc-500 hover:text-red-400"
                      aria-label={`Delete ramp stop ${index + 1}`}
                      disabled={filter.customStops.length <= 2}
                      onClick={() =>
                        patch({ customStops: filter.customStops.filter((_, i) => i !== index) })
                      }
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
                {filter.customStops.length < MAX_STOPS ? (
                  <Button
                    variant="outline"
                    className="h-8 w-full border-dashed border-zinc-700 text-xs text-zinc-400 hover:border-cyan-500/60 hover:text-cyan-400"
                    onClick={() => {
                      // New stop lands at the midpoint of the widest gap
                      // (or dead center on a two-stop ramp), color picked
                      // from the ramp's midpoint so it never fights the look.
                      const sorted = [...filter.customStops].sort((a, b) => a.t - b.t)
                      let gap = 0
                      let t = 0.5
                      for (let i = 1; i < sorted.length; i++) {
                        const g = sorted[i].t - sorted[i - 1].t
                        if (g > gap) {
                          gap = g
                          t = sorted[i - 1].t + g / 2
                        }
                      }
                      patch({
                        customStops: [...filter.customStops, { t, c: '#c084fc' }].sort(
                          (a, b) => a.t - b.t,
                        ),
                      })
                    }}
                  >
                    + Add stop
                  </Button>
                ) : (
                  <p className="text-[10px] text-zinc-600">Eight stops is the ramp cap.</p>
                )}
                <p className="text-[10px] leading-snug text-zinc-600">
                  Your own ramp: each row is one color and where it sits
                  along the brightness axis — dark tones read the low
                  positions, bright tones the high ones. The ramp saves with
                  the project and ships in every export.
                </p>
              </div>
            ) : null}

            <Group>Look</Group>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MicroLabel>Blend</MicroLabel>
              <Select
                value={filter.blend}
                onValueChange={(value) => patch({ blend: value as GradientMapFilterConfig['blend'] })}
              >
                <SelectTrigger size="sm" className="w-[160px]" aria-label="Gradient map blend">
                  <SelectValue placeholder="Normal" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {GRADIENT_MAP_BLENDS.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <SliderRow
              label="Opacity"
              value={filter.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={set('opacity')}
              format={(v) => (v <= 0.005 ? 'Untouched' : `${Math.round(v * 100)}%`)}
            />

            <Group>Window</Group>
            <SliderRow
              label="Gradient shift"
              value={filter.shift}
              min={-1}
              max={1}
              step={0.01}
              onChange={set('shift')}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SliderRow
              label="Gradient repeat"
              value={filter.repeat}
              min={1}
              max={8}
              step={1}
              onChange={set('repeat')}
              format={(v) => (v <= 1 ? 'Once' : `${v}× tiled`)}
            />
            <p className="text-[10px] leading-snug text-zinc-600">
              Shift slides the ramp window along the brightness axis — colors
              that slide off one end re-enter from the other. Repeat tiles the
              whole ramp across the brightness range, so every band of tones
              sweeps the full gradient.
            </p>

            <Group>Shift motion</Group>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Shift motion">
              <ModeChip
                label="Manual"
                sub="the dial only"
                active={filter.shiftMode === 'manual'}
                onClick={() => patch({ shiftMode: 'manual' })}
              />
              <ModeChip
                label="Continuous"
                sub="auto-cycling"
                active={filter.shiftMode === 'continuous'}
                onClick={() => patch({ shiftMode: 'continuous' })}
              />
              <ModeChip
                label="React to beat"
                sub="advances on kicks"
                active={filter.shiftMode === 'beat'}
                onClick={() => patch({ shiftMode: 'beat' })}
              />
            </div>
            {filter.shiftMode === 'continuous' ? (
              <>
                <SliderRow
                  label="Speed"
                  value={filter.shiftSpeed}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={set('shiftSpeed')}
                  format={(v) => (v <= 0.025 ? 'Still' : `${Math.round(v * 100)}%`)}
                />
                <p className="text-[10px] leading-snug text-zinc-600">
                  The window sweeps along the ramp at a steady rate — 100%
                  covers the whole gradient every 2 seconds, so the colors roll
                  through the picture continuously. The manual shift dial still
                  offsets the starting point.
                </p>
              </>
            ) : null}
            {filter.shiftMode === 'beat' ? (
              <>
                <SliderRow
                  label="Beat step"
                  value={filter.beatStep}
                  min={0.05}
                  max={1}
                  step={0.05}
                  onChange={set('beatStep')}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Beat direction">
                  <ModeChip
                    label="Forward"
                    sub="climbs per kick"
                    active={(filter.beatDir ?? 'forward') === 'forward'}
                    onClick={() => patch({ beatDir: 'forward' })}
                  />
                  <ModeChip
                    label="Backward"
                    sub="walks down"
                    active={filter.beatDir === 'backward'}
                    onClick={() => patch({ beatDir: 'backward' })}
                  />
                  <ModeChip
                    label="Ping-pong"
                    sub="up then back"
                    active={filter.beatDir === 'bounce'}
                    onClick={() => patch({ beatDir: 'bounce' })}
                  />
                </div>
                <SliderRow
                  label="Kick sensitivity"
                  value={filter.beatSens ?? 0.12}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={set('beatSens')}
                  format={(v) =>
                    v <= 0.025 ? 'Slams only' : v >= 0.975 ? 'Every hit' : `${Math.round(v * 100)}%`
                  }
                />
                <SliderRow
                  label="Glide"
                  value={filter.beatEase ?? 0.14}
                  min={0.02}
                  max={0.6}
                  step={0.02}
                  onChange={set('beatEase')}
                  format={(v) => `${Math.round(v * 1000)}ms`}
                />
                <p className="text-[10px] leading-snug text-zinc-600">
                  Every detected kick slides the window one Beat step in the
                  chosen direction — Forward climbs the ramp per kick,
                  Backward walks down it, Ping-pong sweeps a full ramp then
                  sweeps back. Kick sensitivity listens for the HIT on a
                  clean sub-bass channel (lower = only the hardest slams,
                  higher = every tap), Beat step sets how far each kick
                  travels, and Glide sets how long each step takes to ease
                  in — short is snappy strobe cuts, long is smooth rolls.
                  The manual shift dial still offsets the starting point.
                </p>
              </>
            ) : null}
            {filter.shiftMode === 'manual' ? (
              <p className="text-[10px] leading-snug text-zinc-600">
                The window stays exactly where the shift dial puts it. Pick
                Continuous for a steady cycle or React to beat to advance the
                window on every kick.
              </p>
            ) : null}
          </div>

          <p className="text-[10px] leading-snug text-zinc-600">
            Brightness becomes color: dark tones read the ramp&apos;s left end,
            bright tones its right. Blend decides how the mapped color lands
            (Normal repaints, Multiply/Screen/Overlay/Add interact with what&apos;s
            there), and Opacity blends the look back toward the original.
            Baked into every export; skipped on transparent backgrounds.
          </p>
        </>
      ) : null}
    </section>
  )
}
