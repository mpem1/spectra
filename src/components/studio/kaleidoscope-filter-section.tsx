'use client'

import { Aperture } from 'lucide-react'
import type { KaleidoscopeFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'

/**
 * Kaleidoscope card — the whole picture mirrored through a radial array of
 * wedge slices around a center point: pick the wedge count, spin, zoom and
 * center, and the print turns with the song. Deterministic, so every export
 * bakes the identical look; skipped on transparent backgrounds.
 */
export function KaleidoscopeFilterSection() {
  const filter = useStudioStore((s) => s.config.kaleidoscopeFilter)
  const patchKaleidoscopeFilter = useStudioStore((s) => s.patchKaleidoscopeFilter)

  const set = (key: keyof KaleidoscopeFilterConfig) => (value: number) =>
    patchKaleidoscopeFilter({ [key]: value } as Partial<KaleidoscopeFilterConfig>)

  return (
    <section className={sectionShell('fuchsia', undefined, filter.enabled)}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Aperture className="size-3.5 text-fuchsia-500" aria-hidden />
          <MicroLabel className="text-fuchsia-300/80">Kaleidoscope</MicroLabel>
        </div>
        <Switch
          aria-label="Enable kaleidoscope filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchKaleidoscopeFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Kaleidoscope — the whole picture mirrored through a radial array of
        wedge slices around a center point. Every seam reads as a clean
        reflection, the array spins slowly, and the zoom magnifies the slice.
      </p>

      {filter.enabled ? (
        <>
          <SliderRow
            label="Segments"
            value={filter.segments}
            min={2}
            max={16}
            step={1}
            onChange={set('segments')}
            format={(v) => `${Math.round(v)} wedges`}
          />
          <SliderRow
            label="Spin"
            value={filter.spin}
            min={-0.5}
            max={0.5}
            step={0.01}
            onChange={set('spin')}
            format={(v) => `${v.toFixed(2)} rev/s`}
          />
          <SliderRow
            label="Zoom"
            value={filter.zoom}
            min={1}
            max={4}
            step={0.05}
            onChange={set('zoom')}
            format={(v) => `${v.toFixed(2)}×`}
          />
          <div className="grid grid-cols-2 gap-3">
            <SliderRow
              label="Center X"
              value={filter.centerX}
              min={0}
              max={100}
              step={1}
              onChange={set('centerX')}
              format={(v) => `${Math.round(v)}%`}
            />
            <SliderRow
              label="Center Y"
              value={filter.centerY}
              min={0}
              max={100}
              step={1}
              onChange={set('centerY')}
              format={(v) => `${Math.round(v)}%`}
            />
          </div>
          <SliderRow
            label="Mix"
            value={filter.blend}
            min={0}
            max={1}
            step={0.05}
            onChange={set('blend')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchKaleidoscopeFilter({ beatReactive })}
            onStrength={(beatStrength) => patchKaleidoscopeFilter({ beatStrength })}
            strengthLabel="Beat spin"
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            The array auto-covers the frame, so no wedge ever shows a gap
            whatever the center or zoom. Skipped on transparent backgrounds
            so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
