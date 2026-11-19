'use client'

import { Sparkles } from 'lucide-react'
import type { NeonSplitFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

/** The five ramps, mirrored from neon-split-data's RAMPS table — the preset's
 *  own 4-stop gradient geometry (0 / 0.406 / 0.857 / 1), recolored per chip.
 *  Keep in sync with src/lib/visualizer/neon-split-data.ts. */
const RAMPS: {
  id: NeonSplitFilterConfig['ramp']
  label: string
  sub: string
  css: string
}[] = [
  {
    id: 'violet',
    label: 'Violet neon',
    sub: 'the real preset',
    css: 'linear-gradient(90deg,#000000 0%,#002266 40.6%,#d55fec 85.7%,#ffd6fa 100%)',
  },
  {
    id: 'uv',
    label: 'UV',
    sub: 'electric violet',
    css: 'linear-gradient(90deg,#01000a 0%,#0b1030 40.6%,#8a45ff 85.7%,#f4ecff 100%)',
  },
  {
    id: 'acid',
    label: 'Acid',
    sub: 'radioactive green',
    css: 'linear-gradient(90deg,#000000 0%,#06240f 40.6%,#3fce54 85.7%,#e8ffc4 100%)',
  },
  {
    id: 'ember',
    label: 'Ember',
    sub: 'furnace orange',
    css: 'linear-gradient(90deg,#000000 0%,#260607 40.6%,#f57b21 85.7%,#ffedc9 100%)',
  },
  {
    id: 'ice',
    label: 'Ice',
    sub: 'glacial cyan',
    css: 'linear-gradient(90deg,#000000 0%,#041a2c 40.6%,#4fc3e8 85.7%,#eafcff 100%)',
  },
]

/**
 * Neon Split filter card — the effect.app "neon split" preset, rebuilt from
 * the preset's own published definition and effect shaders (fetched off the
 * site — the same numbers the real thing runs). The lower part of the frame
 * inverts behind a soft vertical band (the actual "split"), the highlights
 * bloom through a mip pyramid, colored film grain sits in the light and can
 * churn at a set speed, every pixel's brightness re-reads through the
 * preset's own gradient map, and two paper texture layers leave the crease
 * marks. An optional split line lets the bottom of the frame keep its own
 * colors. Baked into every export; skipped on transparent backgrounds.
 */
export function NeonSplitFilterSection() {
  const filter = useStudioStore((s) => s.config.neonSplitFilter)
  const patchNeonSplitFilter = useStudioStore((s) => s.patchNeonSplitFilter)

  const set = (key: keyof NeonSplitFilterConfig) => (value: number) =>
    patchNeonSplitFilter({ [key]: value } as Partial<NeonSplitFilterConfig>)

  return (
    <section className={sectionShell('fuchsia')}>
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
      <p className="text-[11px] leading-snug text-zinc-600">
        The effect.app neon-split preset, rebuilt from its own published
        shader code — the lower part of the frame inverts behind a soft band
        (the real &ldquo;split&rdquo;), the highlights bloom, colored film
        grain sits in the light, and every pixel&apos;s brightness re-reads
        through the preset&apos;s own gradient map (deep blue → orchid → pale
        pink). No overlay — the color IS the map. Turn on Split to let the
        bottom of the frame keep its own colors. Baked into every export.
      </p>

      {filter.enabled ? (
        <>
          <div className="space-y-1.5">
            <MicroLabel>Neon ramp</MicroLabel>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" role="group" aria-label="Neon ramp">
              {RAMPS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={filter.ramp === r.id}
                  onClick={() => patchNeonSplitFilter({ ramp: r.id })}
                  className={cn(
                    'flex min-h-[44px] flex-col justify-center gap-1.5 rounded-lg border px-2.5 py-2 transition-colors',
                    filter.ramp === r.id
                      ? 'border-fuchsia-400/70 bg-fuchsia-500/15'
                      : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700',
                  )}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        'text-xs font-medium',
                        filter.ramp === r.id ? 'text-fuchsia-200' : 'text-zinc-300',
                      )}
                    >
                      {r.label}
                    </span>
                    <span className="text-[9px] leading-none text-zinc-500">{r.sub}</span>
                  </span>
                  <span
                    aria-hidden
                    className="h-1.5 w-full rounded-full"
                    style={{ background: r.css }}
                  />
                </button>
              ))}
            </div>
          </div>
          <SliderRow
            label="Contrast"
            value={filter.contrast}
            min={0}
            max={1}
            step={0.05}
            onChange={set('contrast')}
            format={(v) => (v < 0.475 ? 'Washed' : v <= 0.525 ? 'Preset' : `+${Math.round((v - 0.5) * 100)}%`)}
          />
          <SliderRow
            label="Paper texture"
            value={filter.wash ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            onChange={set('wash')}
            format={(v) => (v <= 0.025 ? 'Off' : v <= 0.525 ? 'Preset' : 'Preset')}
          />
          <SliderRow
            label="Film grain"
            value={filter.grain}
            min={0}
            max={1}
            step={0.05}
            onChange={set('grain')}
            format={(v) => (v <= 0.025 ? 'Clean' : v <= 0.525 ? 'Preset' : `+${Math.round((v - 0.5) * 100)}%`)}
          />
          <SliderRow
            label="Grain speed"
            value={filter.grainSpeed ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            onChange={set('grainSpeed')}
            format={(v) => (v <= 0.025 ? 'Still' : `${Math.round(v * 24)} steps/s`)}
          />
          <SliderRow
            label="Neon bloom"
            value={filter.glow}
            min={0}
            max={1}
            step={0.05}
            onChange={set('glow')}
            format={(v) => (v <= 0.025 ? 'Flat' : v <= 0.525 ? 'Preset' : `+${Math.round((v - 0.5) * 100)}%`)}
          />
          <SliderRow
            label="Split"
            value={filter.split}
            min={0}
            max={1}
            step={0.05}
            onChange={set('split')}
            format={(v) => (v <= 0.025 ? 'All neon' : `${Math.round(v * 100)}% original`)}
          />
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchNeonSplitFilter({ beatReactive })}
            onStrength={(beatStrength) => patchNeonSplitFilter({ beatStrength })}
            strengthLabel="Beat punch"
          />
          {filter.beatReactive ? (
            <p className="text-[10px] leading-snug text-zinc-600">
              On every kick the bloom flares with the bass, then settles back
              exactly as dialed in between beats.
            </p>
          ) : null}
          <SliderRow
            label="Mix"
            value={filter.strength}
            min={0}
            max={1}
            step={0.05}
            onChange={set('strength')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            Every dial sits at the real preset&apos;s value in the middle:
            Contrast shapes the master tone curve (50% = the preset&apos;s own
            curve, lower relaxes it). Paper texture fades the two paper layers
            (a charcoal sheet screened over the frame and a folded-paper sheet
            whose creases mark the highlights — 50% = the preset&apos;s own
            opacities). Film grain is the preset&apos;s colored speckle in
            linear light — heavier in highlights than shadows; Grain speed
            rolls it like film (0 = the published still grain, 24 steps/s at
            full — exports stay frame-exact). Neon bloom drives the
            preset&apos;s mip-pyramid glow (50% = its intensity 3). Split
            fades the untouched picture back in from the bottom (0% keeps the
            whole frame neon). Mix blends the whole look back toward the
            original. Skipped on transparent backgrounds so alpha recordings
            stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
