'use client'

import { Videotape } from 'lucide-react'
import type { VhsFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'

/**
 * VHS filter card — plays the picture off a worn-out tape: wavy line
 * wobble, a rolling tracking-noise band and white dropout specks. Motion
 * follows the song and is baked into every export; skipped on transparent
 * backgrounds so alpha recordings stay clean.
 */
export function VhsFilterSection() {
  const filter = useStudioStore((s) => s.config.vhsFilter)
  const patchVhsFilter = useStudioStore((s) => s.patchVhsFilter)

  const set = (key: keyof VhsFilterConfig) => (value: number) =>
    patchVhsFilter({ [key]: value } as Partial<VhsFilterConfig>)

  return (
    <section className={sectionShell('violet')}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Videotape className="size-3.5 text-violet-500" aria-hidden />
          <MicroLabel className="text-violet-300/80">VHS tape</MicroLabel>
        </div>
        <Switch
          aria-label="Enable VHS filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchVhsFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Plays the whole picture off a worn-out VHS tape — wavy lines, a
        rolling tracking-noise band and white dropout specks, over everything
        including the watermark. Baked into every export.
      </p>

      {filter.enabled ? (
        <>
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchVhsFilter({ beatReactive })}
            onStrength={(beatStrength) => patchVhsFilter({ beatStrength })}
            strengthLabel="Beat pop"
          />
          <SliderRow
            label="Wobble"
            value={filter.wobble}
            min={0}
            max={1}
            step={0.05}
            onChange={set('wobble')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Tracking"
            value={filter.tracking}
            min={0}
            max={1}
            step={0.05}
            onChange={set('tracking')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Tracking speed"
            value={filter.trackingSpeed}
            min={0}
            max={1}
            step={0.05}
            onChange={set('trackingSpeed')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Dust"
            value={filter.dust}
            min={0}
            max={1}
            step={0.05}
            onChange={set('dust')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            Skipped on transparent backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
