'use client'

import { Vibrate } from 'lucide-react'
import type { ShakeFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'

/**
 * Camera shake card — the finished picture reframed like handheld footage:
 * a smooth two-sine wander drifts the frame around, roll wobble tilts it a
 * fraction of a degree, and the beat jolts it when "React to beat" is on.
 * Deterministic, so every export bakes the identical look; skipped on
 * transparent backgrounds.
 */
export function ShakeFilterSection() {
  const filter = useStudioStore((s) => s.config.shakeFilter)
  const patchShakeFilter = useStudioStore((s) => s.patchShakeFilter)

  const set = (key: keyof ShakeFilterConfig) => (value: number) =>
    patchShakeFilter({ [key]: value } as Partial<ShakeFilterConfig>)

  return (
    <section className={sectionShell('yellow', undefined, filter.enabled)}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Vibrate className="size-3.5 text-yellow-500" aria-hidden />
          <MicroLabel className="text-yellow-300/80">Camera shake</MicroLabel>
        </div>
        <Switch
          aria-label="Enable camera shake filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchShakeFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Camera shake — the whole finished picture drifts around like
        handheld footage: a smooth wander moves the frame, roll wobble tilts
        it a little, and the overscan keeps the edges hidden.
      </p>

      {filter.enabled ? (
        <>
          <SliderRow
            label="Drift"
            value={filter.amount}
            min={0}
            max={60}
            step={1}
            onChange={set('amount')}
            format={(v) => `${Math.round(v)} px`}
          />
          <SliderRow
            label="Drift speed"
            value={filter.speed}
            min={0}
            max={3}
            step={0.05}
            onChange={set('speed')}
            format={(v) => `${v.toFixed(2)}×`}
          />
          <SliderRow
            label="Roll wobble"
            value={filter.wobble}
            min={0}
            max={2}
            step={0.05}
            onChange={set('wobble')}
            format={(v) => `${v.toFixed(2)}°`}
          />
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchShakeFilter({ beatReactive })}
            onStrength={(beatStrength) => patchShakeFilter({ beatStrength })}
            strengthLabel="Beat jolt"
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            With React to beat on, every kick jolts the frame in a fresh
            direction (hashed from the song time, so exports kick the exact
            same way). Skipped on transparent backgrounds so alpha recordings
            stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
