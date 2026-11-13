'use client'

import { Waves } from 'lucide-react'
import type { ContourFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'

/**
 * Contour filter card — the woven-thread waveform look: the whole picture
 * re-materializes as glowing smooth lines that bend around its bright
 * shapes and ripple with the music (each line rides its own frequency
 * bin) — holding still around the focal features while the waves swing
 * wider through the space beyond. Deterministic, so every export bakes
 * the identical look; skipped on transparent backgrounds.
 */
export function ContourFilterSection() {
  const filter = useStudioStore((s) => s.config.contourFilter)
  const patchContourFilter = useStudioStore((s) => s.patchContourFilter)

  const set = (key: keyof ContourFilterConfig) => (value: number) =>
    patchContourFilter({ [key]: value } as Partial<ContourFilterConfig>)

  return (
    <section className={sectionShell('cyan')}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Waves className="size-3.5 text-cyan-500" aria-hidden />
          <MicroLabel className="text-cyan-300/80">Contour</MicroLabel>
        </div>
        <Switch
          aria-label="Enable contour filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchContourFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Woven waveform — the picture becomes glowing smooth lines that bend
        around its bright shapes and ripple with the music. They hold still
        around the focal features while the waves swing wider through the
        empty space beyond. Put a picture behind it (Background tab) for
        the full contour look.
      </p>

      {filter.enabled ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex h-5 items-center justify-between">
                <MicroLabel>Line color</MicroLabel>
                <ColorPickerButton
                  value={filter.inkColor}
                  onChange={(inkColor) => patchContourFilter({ inkColor })}
                  ariaLabel="Contour line color"
                />
              </div>
              <p className="text-[10px] leading-snug text-zinc-600">
                The thread glow follows this hue.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex h-5 items-center justify-between">
                <MicroLabel>Tube color</MicroLabel>
                <ColorPickerButton
                  value={filter.paperColor}
                  onChange={(paperColor) => patchContourFilter({ paperColor })}
                  ariaLabel="Contour tube color"
                />
              </div>
              <p className="text-[10px] leading-snug text-zinc-600">
                The dark tube behind the lines.
              </p>
            </div>
          </div>

          <SliderRow
            label="Lines"
            value={filter.lines}
            min={24}
            max={160}
            step={2}
            onChange={set('lines')}
            format={(v) => `${Math.round(v)}`}
          />
          <SliderRow
            label="Warp"
            value={filter.warp}
            min={0}
            max={1}
            step={0.05}
            onChange={set('warp')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Drift"
            value={filter.motion}
            min={0}
            max={1}
            step={0.05}
            onChange={set('motion')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Reactivity"
            value={filter.reactivity}
            min={0}
            max={1}
            step={0.05}
            onChange={set('reactivity')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Glow"
            value={filter.glow}
            min={0}
            max={1}
            step={0.05}
            onChange={set('glow')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Stillness"
            value={filter.stillness}
            min={0}
            max={1}
            step={0.05}
            onChange={set('stillness')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Wave spread"
            value={filter.waveSpread}
            min={0}
            max={1}
            step={0.05}
            onChange={set('waveSpread')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Strength"
            value={filter.strength}
            min={0}
            max={1}
            step={0.05}
            onChange={set('strength')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchContourFilter({ beatReactive })}
            onStrength={(beatStrength) => patchContourFilter({ beatStrength })}
            strengthLabel="Beat swell"
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            Skipped on transparent backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
