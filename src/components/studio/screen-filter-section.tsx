'use client'

import { Tv } from 'lucide-react'
import type { ScreenFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'

/**
 * Screen filter — draws an old-display look over the ENTIRE frame
 * (visualizer, disc, lyrics, watermark included): CRT scanlines, an RGB
 * phosphor mask, chromatic aberration and a soft glow. Baked into every
 * export; skipped on transparent backgrounds so alpha recordings stay clean.
 */
export function ScreenFilterSection() {
  const filter = useStudioStore((s) => s.config.screenFilter)
  const patchScreenFilter = useStudioStore((s) => s.patchScreenFilter)

  const set = (key: keyof ScreenFilterConfig) => (value: number) =>
    patchScreenFilter({ [key]: value } as Partial<ScreenFilterConfig>)

  return (
    <section className={sectionShell('pink')}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Tv className="size-3.5 text-pink-500" aria-hidden />
          <MicroLabel className="text-pink-300/80">Screen filter</MicroLabel>
        </div>
        <Switch
          aria-label="Enable screen filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchScreenFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Plays the whole picture on a virtual CRT — scanlines, RGB phosphor
        mask, color split and a soft glow, over everything including the
        watermark. Baked into every export.
      </p>

      {filter.enabled ? (
        <>
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchScreenFilter({ beatReactive })}
            onStrength={(beatStrength) => patchScreenFilter({ beatStrength })}
          />
          <SliderRow
            label="Mask size"
            value={filter.size}
            min={2}
            max={8}
            step={1}
            onChange={set('size')}
            format={(v) => `${Math.round(v)}px`}
            disabled={!filter.enabled}
          />
          <SliderRow
            label="Scanlines"
            value={filter.scanlines}
            min={0}
            max={1}
            step={0.05}
            onChange={set('scanlines')}
            format={(v) => `${Math.round(v * 100)}%`}
            disabled={!filter.enabled}
          />
          <SliderRow
            label="Phosphor mask"
            value={filter.grille}
            min={0}
            max={1}
            step={0.05}
            onChange={set('grille')}
            format={(v) => `${Math.round(v * 100)}%`}
            disabled={!filter.enabled}
          />
          <SliderRow
            label="Color split"
            value={filter.aberration}
            min={0}
            max={1}
            step={0.05}
            onChange={set('aberration')}
            format={(v) => `${Math.round(v * 100)}%`}
            disabled={!filter.enabled}
          />
          <SliderRow
            label="Glow"
            value={filter.glow}
            min={0}
            max={1}
            step={0.05}
            onChange={set('glow')}
            format={(v) => `${Math.round(v * 100)}%`}
            disabled={!filter.enabled}
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            Skipped on transparent backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
