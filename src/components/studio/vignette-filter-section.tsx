'use client'

import { Circle } from 'lucide-react'
import type { VignetteFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'

/**
 * Vignette card — the lens darkens toward the frame's edges: an
 * elliptical falloff with reach / softness dials and a tintable edge
 * color (near-black keeps the classic neutral lens). Deterministic, so
 * every export bakes the identical look; skipped on transparent
 * backgrounds.
 */
export function VignetteFilterSection() {
  const filter = useStudioStore((s) => s.config.vignetteFilter)
  const patchVignetteFilter = useStudioStore((s) => s.patchVignetteFilter)

  const set = (key: keyof VignetteFilterConfig) => (value: number) =>
    patchVignetteFilter({ [key]: value } as Partial<VignetteFilterConfig>)

  return (
    <section className={sectionShell('purple', undefined, filter.enabled)}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Circle className="size-3.5 text-purple-500" aria-hidden />
          <MicroLabel className="text-purple-300/80">Vignette</MicroLabel>
        </div>
        <Switch
          aria-label="Enable vignette filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchVignetteFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Vignette — the lens darkens toward the frame's edges: an elliptical
        falloff centered on the picture, like looking through a camera lens.
        Tint the shadow near-black for the classic look or cast a color into
        the corners.
      </p>

      {filter.enabled ? (
        <>
          <div className="space-y-1.5">
            <div className="flex h-5 items-center justify-between">
              <MicroLabel>Edge tint</MicroLabel>
              <ColorPickerButton
                value={filter.tintColor}
                onChange={(tintColor) => patchVignetteFilter({ tintColor })}
                ariaLabel="Vignette edge tint"
              />
            </div>
            <p className="text-[10px] leading-snug text-zinc-600">
              The shadow color fading in toward the corners.
            </p>
          </div>
          <SliderRow
            label="Amount"
            value={filter.amount}
            min={0}
            max={1}
            step={0.05}
            onChange={set('amount')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Reach"
            value={filter.reach}
            min={0}
            max={1}
            step={0.05}
            onChange={set('reach')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Softness"
            value={filter.softness}
            min={0}
            max={1}
            step={0.05}
            onChange={set('softness')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchVignetteFilter({ beatReactive })}
            onStrength={(beatStrength) => patchVignetteFilter({ beatStrength })}
            strengthLabel="Beat pulse"
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            Reach sets how far in the darkness starts, softness how smoothly
            it fades. Skipped on transparent backgrounds so alpha recordings
            stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
