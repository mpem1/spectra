'use client'

import { Flashlight } from 'lucide-react'
import type { StrobeFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { ColorPickerButton } from '@/components/studio/color-picker'
import {
  MicroLabel,
  BeatPunchRow,
  SliderRow,
  ToggleRow,
  sectionShell,
} from '@/components/studio/controls'

/**
 * Strobe card — the screen flashes to its negative at random intervals:
 * every flash inverts the colors on screen for a split second, like a
 * strobe light firing in front of the camera. Frequency dials how often it
 * fires (the gaps stay random), Mix fades the inverted print back over the
 * frame, an optional color overlay tints the negative (its hue can roll
 * fresh on every flash), and React to beat fires the strobe on the song's
 * low end. Deterministic, so every export bakes the identical flashes;
 * skipped on transparent backgrounds.
 */
export function StrobeFilterSection() {
  const filter = useStudioStore((s) => s.config.strobeFilter)
  const patchStrobeFilter = useStudioStore((s) => s.patchStrobeFilter)

  const set = (key: keyof StrobeFilterConfig) => (value: number) =>
    patchStrobeFilter({ [key]: value } as Partial<StrobeFilterConfig>)

  return (
    <section className={sectionShell('rose', undefined, filter.enabled)}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Flashlight className="size-3.5 text-rose-500" aria-hidden />
          <MicroLabel className="text-rose-300/80">Strobe</MicroLabel>
        </div>
        <Switch
          aria-label="Enable strobe filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchStrobeFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Strobe — the screen flashes to its negative at random intervals, like
        a strobe light firing in front of the camera: every flash inverts the
        colors on screen for a split second.
      </p>

      {filter.enabled ? (
        <>
          <SliderRow
            label="Frequency"
            value={filter.frequency}
            min={0}
            max={8}
            step={0.1}
            onChange={set('frequency')}
            format={(v) => (v <= 0.01 ? 'Off — beat only' : `${v.toFixed(1)}/s`)}
          />
          <SliderRow
            label="Mix"
            value={filter.mix}
            min={0}
            max={1}
            step={0.05}
            onChange={set('mix')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <ToggleRow
            label="Color overlay"
            checked={filter.colorOverlay}
            onCheckedChange={(colorOverlay) => patchStrobeFilter({ colorOverlay })}
          />
          {filter.colorOverlay ? (
            <>
              <div className="space-y-1.5">
                <div className="flex h-5 items-center justify-between">
                  <MicroLabel>Overlay color</MicroLabel>
                  <ColorPickerButton
                    value={filter.overlayColor}
                    onChange={(overlayColor) => patchStrobeFilter({ overlayColor })}
                    ariaLabel="Strobe overlay color"
                  />
                </div>
                <p className="text-[10px] leading-snug text-zinc-600">
                  The negative keeps its flipped brightness and takes this
                  hue — a red overlay reads as a red-negative strobe.
                </p>
              </div>
              <ToggleRow
                label="Randomize color on beat"
                checked={filter.randomColorOnBeat}
                onCheckedChange={(randomColorOnBeat) =>
                  patchStrobeFilter({ randomColorOnBeat })
                }
              />
            </>
          ) : null}
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchStrobeFilter({ beatReactive })}
            onStrength={(beatStrength) => patchStrobeFilter({ beatStrength })}
            strengthLabel="Beat flash"
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            The flashes land at random intervals around the Frequency dial
            (hashed from the song time, so exports flash the exact same way).
            With React to beat on, every kick fires the strobe too. Skipped
            on transparent backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
