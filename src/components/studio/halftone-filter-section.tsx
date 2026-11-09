'use client'

import { Newspaper } from 'lucide-react'
import type { HalftoneFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'

/** Label + control on one row, the standard dense studio toggle row. */
function ToggleRow({
  label,
  checked,
  onCheckedChange,
  children,
}: {
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <div className="flex h-5 items-center justify-between">
      <MicroLabel>{label}</MicroLabel>
      <div className="flex items-center gap-2">
        {children}
        <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
      </div>
    </div>
  )
}

/**
 * Halftone filter card — newspaper print: darker tones turn into halftone
 * dots on a 45° grid while lighter areas stay untouched. The Shadow range
 * slider is the "only the darker colors" control. The picture can be
 * printed from black & white / contrast-punched / negative source, and the
 * ink can be any color or a two-color gradient that moves with the song.
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
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchHalftoneFilter({ beatReactive })}
            onStrength={(beatStrength) => patchHalftoneFilter({ beatStrength })}
            strengthLabel="Beat pop"
          />
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

          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
            <MicroLabel className="text-zinc-400">Picture</MicroLabel>
            <ToggleRow
              label="Black & white"
              checked={filter.grayscale}
              onCheckedChange={(grayscale) => patchHalftoneFilter({ grayscale })}
            />
            <SliderRow
              label="Contrast"
              value={filter.contrast}
              min={0}
              max={1}
              step={0.05}
              onChange={set('contrast')}
              format={(v) =>
                Math.abs(v - 0.5) < 0.025 ? 'Neutral' : `${Math.round(v * 100)}%`
              }
            />
            <ToggleRow
              label="Invert"
              checked={filter.invert}
              onCheckedChange={(invert) => patchHalftoneFilter({ invert })}
            />
            <p className="text-[10px] leading-snug text-zinc-600">
              Shapes the picture before printing. Contrast 50% is the untouched
              picture; Invert flips it to a negative.
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
            <MicroLabel className="text-zinc-400">Ink</MicroLabel>
            <div className="flex h-5 items-center justify-between">
              <MicroLabel>Ink color</MicroLabel>
              <ColorPickerButton
                ariaLabel="Ink color"
                value={filter.inkColor}
                onChange={(inkColor) => patchHalftoneFilter({ inkColor })}
              />
            </div>
            <ToggleRow
              label="Gradient"
              checked={filter.gradient}
              onCheckedChange={(gradient) => patchHalftoneFilter({ gradient })}
            />
            {filter.gradient ? (
              <>
                <div className="flex h-5 items-center justify-between">
                  <MicroLabel>Second color</MicroLabel>
                  <ColorPickerButton
                    ariaLabel="Second gradient color"
                    value={filter.inkColor2}
                    onChange={(inkColor2) => patchHalftoneFilter({ inkColor2 })}
                  />
                </div>
                <SliderRow
                  label="Gradient motion"
                  value={filter.gradientMotion}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={set('gradientMotion')}
                  format={(v) =>
                    v < 0.025 ? 'Static' : `${Math.round(v * 100)}%`
                  }
                />
                <p className="text-[10px] leading-snug text-zinc-600">
                  Blends the two colors across the dots and moves the blend
                  with the song — a slow drift plus a swing on every kick. 0%
                  keeps it still.
                </p>
              </>
            ) : (
              <p className="text-[10px] leading-snug text-zinc-600">
                Turn on Gradient to blend two colors across the dots and move
                the blend with the sound.
              </p>
            )}
          </div>

          <p className="text-[10px] leading-snug text-zinc-600">
            Skipped on transparent backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
