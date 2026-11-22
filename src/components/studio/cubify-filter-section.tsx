'use client'

import { Blocks as CubeIcon } from 'lucide-react'
import type { CubifyFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'

/**
 * Cubify card — effect.app's Cubify effect: the whole picture becomes a
 * mosaic of glossy 3D cubes (averaged colors with a beveled face, one global
 * light direction, soft specular sheen and optional seams). Deterministic,
 * so every export bakes the identical look; skipped on transparent
 * backgrounds.
 */
export function CubifyFilterSection() {
  const filter = useStudioStore((s) => s.config.cubifyFilter)
  const patchCubifyFilter = useStudioStore((s) => s.patchCubifyFilter)

  const set = (key: keyof CubifyFilterConfig) => (value: number) =>
    patchCubifyFilter({ [key]: value } as Partial<CubifyFilterConfig>)

  return (
    <section className={sectionShell('orange', undefined, filter.enabled)}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <CubeIcon className="size-3.5 text-orange-500" aria-hidden />
          <MicroLabel className="text-orange-300/80">Cubify</MicroLabel>
        </div>
        <Switch
          aria-label="Enable cubify filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchCubifyFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Cubify — the whole picture is rebuilt as big glossy cubes: every tile
        takes the average color of what it covers, beveled like a 3D block
        under one light. Small sizes read as glass mosaic, large ones as bold
        blocky art. Baked into every export.
      </p>

      {filter.enabled ? (
        <>
          <SliderRow
            label="Cube size"
            value={filter.size}
            min={4}
            max={80}
            step={1}
            onChange={set('size')}
            format={(v) => `${Math.round(v)} px`}
          />
          <SliderRow
            label="Bevel"
            value={filter.bevel}
            min={0}
            max={1}
            step={0.05}
            onChange={set('bevel')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Gloss"
            value={filter.gloss}
            min={0}
            max={1}
            step={0.05}
            onChange={set('gloss')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Seams"
            value={filter.gap}
            min={0}
            max={0.5}
            step={0.02}
            onChange={set('gap')}
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
            onToggle={(beatReactive) => patchCubifyFilter({ beatReactive })}
            onStrength={(beatStrength) => patchCubifyFilter({ beatStrength })}
            strengthLabel="Beat lift"
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            Skipped on transparent backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
