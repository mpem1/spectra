'use client'

import { Grip } from 'lucide-react'
import type { DitherFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

/**
 * Dither filter card — retro ordered dithering: the whole picture is
 * repainted as chunky dot patterns in a palette of your choosing (the
 * glowing "all shades of blue" poster, classic 1-bit black & white, retro
 * color, or your own two colors) with a bloom over the bright dots.
 * Deterministic, so every export bakes the identical look; skipped on
 * transparent backgrounds.
 */
export function DitherFilterSection() {
  const filter = useStudioStore((s) => s.config.ditherFilter)
  const patchDitherFilter = useStudioStore((s) => s.patchDitherFilter)

  const set = (key: keyof DitherFilterConfig) => (value: number) =>
    patchDitherFilter({ [key]: value } as Partial<DitherFilterConfig>)

  return (
    <section className={sectionShell('cyan')}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Grip className="size-3.5 text-cyan-500" aria-hidden />
          <MicroLabel className="text-cyan-300/80">Dither</MicroLabel>
        </div>
        <Switch
          aria-label="Enable dither filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchDitherFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Retro dither print — the whole picture becomes chunky glowing dots,
        like old 1-bit screens and dither-poster art. Pick a palette, dial
        the dot size and glow, and it bakes into every export.
      </p>

      {filter.enabled ? (
        <>
          <div className="space-y-1.5">
            <MicroLabel>Palette</MicroLabel>
            <div className="grid grid-cols-4 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
              {(
                [
                  { id: 'blue', label: 'Blue glow' },
                  { id: 'mono', label: 'B&W' },
                  { id: 'color', label: 'Color' },
                  { id: 'custom', label: 'Custom' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={filter.mode === m.id}
                  onClick={() => patchDitherFilter({ mode: m.id })}
                  className={cn(
                    'h-7 rounded-md text-xs transition-colors',
                    filter.mode === m.id
                      ? 'bg-cyan-500 font-medium text-zinc-950'
                      : 'text-zinc-300 hover:text-zinc-100',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {filter.mode === 'custom' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex h-5 items-center justify-between">
                  <MicroLabel>Bright dots</MicroLabel>
                  <ColorPickerButton
                    value={filter.inkColor}
                    onChange={(inkColor) => patchDitherFilter({ inkColor })}
                    ariaLabel="Bright dots color"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex h-5 items-center justify-between">
                  <MicroLabel>Dark dots</MicroLabel>
                  <ColorPickerButton
                    value={filter.paperColor}
                    onChange={(paperColor) => patchDitherFilter({ paperColor })}
                    ariaLabel="Dark dots color"
                  />
                </div>
              </div>
            </div>
          ) : null}

          <SliderRow
            label="Dot size"
            value={filter.cellSize}
            min={2}
            max={14}
            step={1}
            onChange={set('cellSize')}
            format={(v) => `${Math.round(v)} px`}
          />
          <SliderRow
            label="Contrast"
            value={filter.contrast}
            min={0}
            max={1}
            step={0.05}
            onChange={set('contrast')}
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
          <SliderRow
            label="Glow"
            value={filter.glow}
            min={0}
            max={1}
            step={0.05}
            onChange={set('glow')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchDitherFilter({ beatReactive })}
            onStrength={(beatStrength) => patchDitherFilter({ beatStrength })}
            strengthLabel="Beat flare"
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            Skipped on transparent backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
