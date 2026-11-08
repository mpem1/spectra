'use client'

import { Film } from 'lucide-react'
import type { FilmFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'

/**
 * Film filter card — old school film reel: vertical emulsion scratches,
 * dust and hairs, and per-frame exposure flicker. Deterministic, so every
 * export bakes the identical reel; skipped on transparent backgrounds.
 */
export function FilmFilterSection() {
  const filter = useStudioStore((s) => s.config.filmFilter)
  const patchFilmFilter = useStudioStore((s) => s.patchFilmFilter)

  const set = (key: keyof FilmFilterConfig) => (value: number) =>
    patchFilmFilter({ [key]: value } as Partial<FilmFilterConfig>)

  return (
    <section className={sectionShell('amber')}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Film className="size-3.5 text-amber-500" aria-hidden />
          <MicroLabel className="text-amber-300/80">Film reel</MicroLabel>
        </div>
        <Switch
          aria-label="Enable film filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchFilmFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Old school film reel — vertical scratches that wander, dust and
        hairs that pop at a dialable reel speed, and a gentle exposure
        flicker, over everything including the watermark. Baked into every
        export.
      </p>

      {filter.enabled ? (
        <>
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchFilmFilter({ beatReactive })}
            onStrength={(beatStrength) => patchFilmFilter({ beatStrength })}
            strengthLabel="Beat pop"
          />
          <SliderRow
            label="Scratches"
            value={filter.scratches}
            min={0}
            max={1}
            step={0.05}
            onChange={set('scratches')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Dust & hair"
            value={filter.dust}
            min={0}
            max={1}
            step={0.05}
            onChange={set('dust')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Reel speed"
            value={filter.speed ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            onChange={set('speed')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Flicker"
            value={filter.flicker}
            min={0}
            max={1}
            step={0.05}
            onChange={set('flicker')}
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
