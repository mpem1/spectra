'use client'

import { Blocks as CubeIcon } from 'lucide-react'
import type { CubifyFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, BeatPunchRow, SliderRow, ToggleRow, sectionShell } from '@/components/studio/controls'

/**
 * Cubify card — effect.app's Cubify effect, ported 1:1 from its shader: the
 * frame resamples through an array of glass cubes (rotated exponential grid,
 * per-cell edge-pull warp = the 3D depth, optional hard pixel snap, RGB
 * dispersion on the edges). Dials match the original effect's controls.
 * Deterministic, so every export bakes the identical look; skipped on
 * transparent backgrounds.
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
        Cubify — the whole picture refracts through an array of glass cubes:
        the frame snaps onto a rotated grid and every cell bends its content
        toward the cube edges, reading as 3D blocks. The real effect.app
        algorithm, dial for dial.
      </p>

      {filter.enabled ? (
        <>
          <SliderRow
            label="Cube size"
            value={filter.scale}
            min={0}
            max={8}
            step={0.01}
            onChange={set('scale')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Cube stretch"
            value={filter.stretch}
            min={-1}
            max={1}
            step={0.01}
            onChange={set('stretch')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Depth distortion"
            value={filter.depth}
            min={0}
            max={5}
            step={0.01}
            onChange={set('depth')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Rotation angle"
            value={filter.angle}
            min={0}
            max={90}
            step={1}
            onChange={set('angle')}
            format={(v) => `${Math.round(v)}°`}
          />
          <ToggleRow
            label="Hard edges"
            checked={filter.hard}
            onCheckedChange={(hard) => patchCubifyFilter({ hard })}
          />
          <SliderRow
            label="Position offset X"
            value={filter.offsetX}
            min={-1}
            max={1}
            step={0.01}
            onChange={set('offsetX')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Position offset Y"
            value={filter.offsetY}
            min={-1}
            max={1}
            step={0.01}
            onChange={set('offsetY')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Animation speed X"
            value={filter.speedX}
            min={-5}
            max={5}
            step={0.01}
            onChange={set('speedX')}
            format={(v) => `${v.toFixed(2)} cells/s`}
          />
          <SliderRow
            label="Animation speed Y"
            value={filter.speedY}
            min={-5}
            max={5}
            step={0.01}
            onChange={set('speedY')}
            format={(v) => `${v.toFixed(2)} cells/s`}
          />
          <SliderRow
            label="Dispersion"
            value={filter.dispersion}
            min={0}
            max={1}
            step={0.001}
            onChange={set('dispersion')}
            format={(v) => `${(v * 100).toFixed(1)}%`}
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
            onToggle={(beatReactive) => patchCubifyFilter({ beatReactive })}
            onStrength={(beatStrength) => patchCubifyFilter({ beatStrength })}
            strengthLabel="Beat lift"
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            The grid drifts with the song (speed dials above). Hard edges
            snaps every cube to hard pixels; dispersion fringes the cube
            edges like chromatic glass. Skipped on transparent backgrounds so
            alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
