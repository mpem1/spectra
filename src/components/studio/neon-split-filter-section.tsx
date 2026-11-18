'use client'

import { Sparkles } from 'lucide-react'
import type { NeonSplitFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

/** The five ramps, mirrored from the renderer's RAMPS table for the chip
 *  swatches — a tiny CSS gradient strip per chip so the palette choice is
 *  visible at a glance. Keep in sync with src/lib/visualizer/neon-split.ts. */
const RAMPS: {
  id: NeonSplitFilterConfig['ramp']
  label: string
  sub: string
  css: string
}[] = [
  {
    id: 'violet',
    label: 'Violet neon',
    sub: 'the classic preset',
    css: 'linear-gradient(90deg,#000000 0%,#16124e 18%,#232e83 38%,#6143b6 58%,#a855dd 74%,#d55fec 87%,#ffd6fa 100%)',
  },
  {
    id: 'uv',
    label: 'UV',
    sub: 'electric violet',
    css: 'linear-gradient(90deg,#01000a 0%,#0b1030 20%,#232b7c 42%,#4f2bb8 62%,#8a45ff 80%,#c9a1ff 92%,#f4ecff 100%)',
  },
  {
    id: 'acid',
    label: 'Acid',
    sub: 'radioactive green',
    css: 'linear-gradient(90deg,#000000 0%,#052012 18%,#0d5c2a 40%,#2fae4e 60%,#7ee06a 78%,#c9ff7a 90%,#f2ffc9 100%)',
  },
  {
    id: 'ember',
    label: 'Ember',
    sub: 'furnace orange',
    css: 'linear-gradient(90deg,#000000 0%,#200509 18%,#7c1a12 40%,#c43e18 60%,#f57b21 76%,#ffb45e 90%,#ffedc9 100%)',
  },
  {
    id: 'ice',
    label: 'Ice',
    sub: 'glacial cyan',
    css: 'linear-gradient(90deg,#000000 0%,#041224 18%,#0a3a5c 40%,#1a7ab0 60%,#4fc3e8 78%,#a5ecf7 90%,#eafcff 100%)',
  },
]

/**
 * Neon Split filter card — the social-grade neon look: the whole picture is
 * re-read as brightness and recolored through a glowing neon ramp, the dark
 * end glitters with sparkle grain, a soft bloom milks the highlights, and an
 * optional split line lets the bottom of the frame keep its own colors.
 * Baked into every export; skipped on transparent backgrounds.
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
        The neon poster grade — every pixel&apos;s brightness is re-read as a
        position on a glowing neon ramp: shadows sink to near-black, mids climb
        through blue and violet, highlights flare to magenta. The dark end
        glitters with sparkle grain and a soft bloom milks the bright areas.
        Turn on Split to let the bottom of the frame keep its own colors — the
        line can ride the beat. Baked into every export.
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
            format={(v) => (v < 0.475 ? 'Washed' : v <= 0.525 ? 'Neutral' : `${Math.round(v * 100)}%`)}
          />
          <SliderRow
            label="Sparkle grain"
            value={filter.grain}
            min={0}
            max={1}
            step={0.05}
            onChange={set('grain')}
            format={(v) => (v <= 0.025 ? 'Clean' : `${Math.round(v * 100)}%`)}
          />
          <SliderRow
            label="Neon bloom"
            value={filter.glow}
            min={0}
            max={1}
            step={0.05}
            onChange={set('glow')}
            format={(v) => (v <= 0.025 ? 'Flat' : `${Math.round(v * 100)}%`)}
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
          {filter.beatReactive && filter.split > 0.025 ? (
            <p className="text-[10px] leading-snug text-zinc-600">
              On every kick the split line slides down — the neon pushes further
              over the picture — then settles back home between beats.
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
            Contrast shapes the tones before the ramp (50% is neutral — higher
            pushes the shadows down and the highlights up so the neon reads
            punchier). Sparkle grain screens glitter into the dark end — the
            ramp recolors it, so it always shines in your chosen palette. Neon
            bloom glows the bright areas outward. Split fades the untouched
            picture back in from the bottom (0% keeps the whole frame neon);
            with React to beat the line slides down on every kick and the bloom
            flares, resting exactly as dialed in between hits. Mix blends the
            whole look back toward the original. Skipped on transparent
            backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
