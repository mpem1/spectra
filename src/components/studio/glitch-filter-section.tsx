'use client'

import { Zap } from 'lucide-react'
import type { GlitchFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'

/**
 * Glitch filter card — digital corruption bursts: chunky pixel blocks,
 * picture slices shoved sideways and raw color bars that flash in for a
 * few frames at a time, over everything including the watermark. Burst
 * rate is its own dial so intensity never trades against frequency.
 * Baked into every export; skipped on transparent backgrounds.
 */
export function GlitchFilterSection() {
  const filter = useStudioStore((s) => s.config.glitchFilter)
  const patchGlitchFilter = useStudioStore((s) => s.patchGlitchFilter)

  const set = (key: keyof GlitchFilterConfig) => (value: number) =>
    patchGlitchFilter({ [key]: value } as Partial<GlitchFilterConfig>)

  return (
    <section className={sectionShell('fuchsia')}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="size-3.5 text-fuchsia-500" aria-hidden />
          <MicroLabel className="text-fuchsia-300/80">Glitch</MicroLabel>
        </div>
        <Switch
          aria-label="Enable glitch filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchGlitchFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Digital corruption — the picture plays clean, then bursts of broken
        signal flash in: blocky pixel squares, slices shoved sideways and raw
        color bars, over everything including the watermark. Baked into every
        export.
      </p>

      {filter.enabled ? (
        <>
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchGlitchFilter({ beatReactive })}
            onStrength={(beatStrength) => patchGlitchFilter({ beatStrength })}
            strengthLabel="Beat pop"
          />
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
            <div className="flex h-5 items-center justify-between">
              <MicroLabel className="text-zinc-400">Randomize</MicroLabel>
              <Switch
                aria-label="Randomize slices and burst rate"
                checked={filter.randomize}
                onCheckedChange={(randomize) => patchGlitchFilter({ randomize })}
              />
            </div>
            {filter.randomize ? (
              <>
                <SliderRow
                  label="Min step"
                  value={filter.randomStepMin}
                  min={0.01}
                  max={0.5}
                  step={0.01}
                  onChange={set('randomStepMin')}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                <SliderRow
                  label="Max step"
                  value={filter.randomStepMax}
                  min={0.01}
                  max={0.5}
                  step={0.01}
                  onChange={set('randomStepMax')}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                <SliderRow
                  label="Step time"
                  value={filter.randomStepTime}
                  min={0.1}
                  max={3}
                  step={0.1}
                  onChange={set('randomStepTime')}
                  format={(v) => `${v.toFixed(1)}s`}
                />
                <p className="text-[10px] leading-snug text-zinc-600">
                  Slices and Burst rate wander in a random walk: every Step
                  time each jumps a random distance between Min and Max in
                  either direction, landing where the next jump starts.
                  Hitting 0% or 100% sends the next two jumps back toward
                  your dial, so the walk never gets stuck at an edge. Blocks
                  stays dialed; moving Slices or Burst rate re-anchors its
                  walk. The same song second walks the same chaos in every
                  export.
                </p>
              </>
            ) : null}
          </div>
          <SliderRow
            label="Blocks"
            value={filter.blocks}
            min={0}
            max={1}
            step={0.05}
            onChange={set('blocks')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Slices"
            value={filter.slices}
            min={0}
            max={1}
            step={0.05}
            onChange={set('slices')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Burst rate"
            value={filter.rate}
            min={0}
            max={1}
            step={0.05}
            onChange={set('rate')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            Burst rate sets how often corruption fires — Blocks and Slices keep
            each burst just as strong. Skipped on transparent backgrounds so
            alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
