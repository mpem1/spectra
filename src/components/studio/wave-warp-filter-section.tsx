'use client'

import { Waves } from 'lucide-react'
import type { WaveWarpFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'

/**
 * Water wave card — the whole picture ripples like a reflection on water:
 * thin strips of the frame shift sideways on a sine that rolls down the
 * picture and drifts with the clock. Deterministic, so every export bakes
 * the identical look; skipped on transparent backgrounds.
 */
export function WaveWarpFilterSection() {
  const filter = useStudioStore((s) => s.config.waveWarpFilter)
  const patchWaveWarpFilter = useStudioStore((s) => s.patchWaveWarpFilter)

  const set = (key: keyof WaveWarpFilterConfig) => (value: number) =>
    patchWaveWarpFilter({ [key]: value } as Partial<WaveWarpFilterConfig>)

  return (
    <section className={sectionShell('cyan', undefined, filter.enabled)}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Waves className="size-3.5 text-cyan-500" aria-hidden />
          <MicroLabel className="text-cyan-300/80">Water wave</MicroLabel>
        </div>
        <Switch
          aria-label="Enable water wave filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchWaveWarpFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Water wave — the whole picture ripples like a reflection on water:
        thin strips of the frame sway sideways on a wave that rolls down the
        picture and drifts with the clock. The edges stay seamless.
      </p>

      {filter.enabled ? (
        <>
          <SliderRow
            label="Amplitude"
            value={filter.amplitude}
            min={0}
            max={120}
            step={1}
            onChange={set('amplitude')}
            format={(v) => `${Math.round(v)} px`}
          />
          <SliderRow
            label="Ripples"
            value={filter.density}
            min={0.5}
            max={8}
            step={0.1}
            onChange={set('density')}
            format={(v) => v.toFixed(1)}
          />
          <SliderRow
            label="Flow speed"
            value={filter.speed}
            min={0}
            max={3}
            step={0.05}
            onChange={set('speed')}
            format={(v) => `${v.toFixed(2)} cyc/s`}
          />
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
            onToggle={(beatReactive) => patchWaveWarpFilter({ beatReactive })}
            onStrength={(beatStrength) => patchWaveWarpFilter({ beatStrength })}
            strengthLabel="Beat wobble"
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            Amplitude sets how far the water sways, ripples how many waves
            stack top to bottom, flow speed how fast the pattern drifts.
            Skipped on transparent backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
