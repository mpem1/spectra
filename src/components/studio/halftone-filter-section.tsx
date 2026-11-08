'use client'

import { Newspaper } from 'lucide-react'
import type { HalftoneFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, SliderRow, sectionShell } from '@/components/studio/controls'

/**
 * Halftone filter card — newspaper print: darker tones turn into black
 * halftone dots on a 45° grid while lighter areas stay untouched. The
 * Shadow range slider is the "only the darker colors" control.
 */
export function HalftoneFilterSection() {
  const filter = useStudioStore((s) => s.config.halftoneFilter)
  const patchHalftoneFilter = useStudioStore((s) => s.patchHalftoneFilter)

  const set = (key: keyof HalftoneFilterConfig) => (value: number) =>
    patchHalftoneFilter({ [key]: value } as Partial<HalftoneFilterConfig>)

  return (
    <section className={sectionShell('yellow')}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Newspaper className="size-3.5 text-yellow-500" aria-hidden />
          <MicroLabel className="text-yellow-300/80">Halftone print</MicroLabel>
        </div>
        <Switch
          aria-label="Enable halftone filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchHalftoneFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Newspaper print — darker tones turn into halftone dots while lighter
        areas stay intact. The Shadow range slider decides how dark a color
        must be before it gets dotted: low = only the deepest shadows, high =
        most of the picture.
      </p>

      {filter.enabled ? (
        <>
          <SliderRow
            label="Dot size"
            value={filter.dotSize}
            min={3}
            max={14}
            step={1}
            onChange={set('dotSize')}
            format={(v) => `${Math.round(v)}px`}
          />
          <SliderRow
            label="Shadow range"
            value={filter.dotRange}
            min={0}
            max={1}
            step={0.05}
            onChange={set('dotRange')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Ink strength"
            value={filter.strength}
            min={0}
            max={1}
            step={0.05}
            onChange={set('strength')}
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
