'use client'

import { MonitorDot } from 'lucide-react'
import type { PhosphorFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

/**
 * Phosphor monitor card — the lo-fi sci-fi video-tube look: the whole
 * picture becomes glowing vertical lines or columns of dashes on a dark
 * tube (the analogue retro-futuristic monitor aesthetic). The shade ladder
 * follows the picked phosphor color, so the tube can be classic green,
 * amber, blue — whatever. Deterministic, so every export bakes the
 * identical look; skipped on transparent backgrounds.
 */
export function PhosphorFilterSection() {
  const filter = useStudioStore((s) => s.config.phosphorFilter)
  const patchPhosphorFilter = useStudioStore((s) => s.patchPhosphorFilter)

  const set = (key: keyof PhosphorFilterConfig) => (value: number) =>
    patchPhosphorFilter({ [key]: value } as Partial<PhosphorFilterConfig>)

  return (
    <section className={sectionShell('green')}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <MonitorDot className="size-3.5 text-green-500" aria-hidden />
          <MicroLabel className="text-green-300/80">Phosphor</MicroLabel>
        </div>
        <Switch
          aria-label="Enable phosphor monitor filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchPhosphorFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Retro monitor — the whole picture becomes glowing vertical lines (or
        stacked dashes) on a dark tube, like an old sci-fi CRT terminal. Pick
        the phosphor color, dial the size, spacing and glow, and it bakes
        into every export.
      </p>

      {filter.enabled ? (
        <>
          <div className="space-y-1.5">
            <MicroLabel>Style</MicroLabel>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
              {(
                [
                  { id: 'lines', label: 'Lines' },
                  { id: 'dashes', label: 'Dashes' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={filter.mode === m.id}
                  onClick={() => patchPhosphorFilter({ mode: m.id })}
                  className={cn(
                    'h-7 rounded-md text-xs transition-colors',
                    filter.mode === m.id
                      ? 'bg-green-500 font-medium text-zinc-950'
                      : 'text-zinc-300 hover:text-zinc-100',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex h-5 items-center justify-between">
                <MicroLabel>Glow color</MicroLabel>
                <ColorPickerButton
                  value={filter.inkColor}
                  onChange={(inkColor) => patchPhosphorFilter({ inkColor })}
                  ariaLabel="Phosphor glow color"
                />
              </div>
              <p className="text-[10px] leading-snug text-zinc-600">
                The glow shade ladder follows this hue.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex h-5 items-center justify-between">
                <MicroLabel>Tube color</MicroLabel>
                <ColorPickerButton
                  value={filter.paperColor}
                  onChange={(paperColor) => patchPhosphorFilter({ paperColor })}
                  ariaLabel="Phosphor tube color"
                />
              </div>
              <p className="text-[10px] leading-snug text-zinc-600">
                The dark tube behind the print.
              </p>
            </div>
          </div>

          <SliderRow
            label={filter.mode === 'lines' ? 'Line size' : 'Dash size'}
            value={filter.cellSize}
            min={3}
            max={12}
            step={1}
            onChange={set('cellSize')}
            format={(v) => `${Math.round(v)} px`}
          />
          <SliderRow
            label="Spacing"
            value={filter.gap}
            min={0}
            max={0.6}
            step={0.05}
            onChange={set('gap')}
            format={(v) => `${Math.round(v * 100)}%`}
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
            onToggle={(beatReactive) => patchPhosphorFilter({ beatReactive })}
            onStrength={(beatStrength) => patchPhosphorFilter({ beatStrength })}
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
