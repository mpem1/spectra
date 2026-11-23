'use client'

import { Globe as SphereIcon } from 'lucide-react'
import type { DotSphereFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

/**
 * Dot Sphere card — the picture bends away and fades toward the screen
 * edges behind a fully visible centered ball (your image-visualizer PNG,
 * album art or Background picture), while a 3D LED ball floats in the
 * center: a grid of glowing dots streaming horizontally around it (they
 * swell toward the viewer and squeeze into vertical ellipses rounding the
 * limb), wavy neon bands weaving over the surface. Neon gives the classic
 * pink/blue LED palette; Picture rebuilds the actual image as dot colors.
 * Deterministic, so every export bakes the identical look; skipped on
 * transparent backgrounds.
 */
export function DotSphereFilterSection() {
  const filter = useStudioStore((s) => s.config.dotSphereFilter)
  const patchDotSphereFilter = useStudioStore((s) => s.patchDotSphereFilter)

  const set = (key: keyof DotSphereFilterConfig) => (value: number) =>
    patchDotSphereFilter({ [key]: value } as Partial<DotSphereFilterConfig>)

  return (
    <section className={sectionShell('violet', undefined, filter.enabled)}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <SphereIcon className="size-3.5 text-violet-500" aria-hidden />
          <MicroLabel className="text-violet-300/80">Dot Sphere</MicroLabel>
        </div>
        <Switch
          aria-label="Enable dot sphere filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchDotSphereFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        LED ball floating in the center while the picture around it bends
        away and fades toward the screen edges — and on the ball a grid of
        glowing dots streams horizontally around it, squeezed at the edges
        like a real dot ball, while wavy neon bands weave over the surface.
        Neon gives the classic pink/blue LED palette; Picture rebuilds the
        actual image as dot colors.
      </p>

      {filter.enabled ? (
        <>
          <div className="space-y-1.5">
            <MicroLabel>Dot colors</MicroLabel>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
              {(
                [
                  { id: 'neon', label: 'Neon pink & blue' },
                  { id: 'picture', label: 'From the picture' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={filter.colorMode === m.id}
                  onClick={() => patchDotSphereFilter({ colorMode: m.id })}
                  className={cn(
                    'h-7 rounded-md text-xs transition-colors',
                    filter.colorMode === m.id
                      ? 'bg-violet-500 font-medium text-zinc-950'
                      : 'text-zinc-300 hover:text-zinc-100',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <SliderRow
            label="Sphere size"
            value={filter.size}
            min={0.6}
            max={2.6}
            step={0.01}
            onChange={set('size')}
            format={(v) => `${v.toFixed(2)}×`}
          />
          <SliderRow
            label="Dot rows"
            value={filter.rows}
            min={12}
            max={80}
            step={1}
            onChange={set('rows')}
            format={(v) => `${Math.round(v)}`}
          />
          <SliderRow
            label="Dot size"
            value={filter.dotSize}
            min={0.4}
            max={2.2}
            step={0.01}
            onChange={set('dotSize')}
            format={(v) => `${v.toFixed(2)}×`}
          />
          <SliderRow
            label="Flow speed"
            value={filter.flowSpeed}
            min={-3}
            max={3}
            step={0.01}
            onChange={set('flowSpeed')}
            format={(v) => `${v.toFixed(2)}`}
          />
          <SliderRow
            label="Wave amount"
            value={filter.waveAmount}
            min={0}
            max={1}
            step={0.01}
            onChange={set('waveAmount')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Wave scale"
            value={filter.waveScale}
            min={1}
            max={10}
            step={1}
            onChange={(v) => set('waveScale')(Math.round(v))}
            format={(v) => `${Math.round(v)}`}
          />
          <SliderRow
            label="Wave speed"
            value={filter.waveSpeed}
            min={0}
            max={3}
            step={0.01}
            onChange={set('waveSpeed')}
            format={(v) => `${v.toFixed(2)}`}
          />
          <SliderRow
            label="Band twist"
            value={filter.bandTwist}
            min={0}
            max={3}
            step={0.01}
            onChange={set('bandTwist')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Music ripple"
            value={filter.ripple}
            min={0}
            max={1}
            step={0.05}
            onChange={set('ripple')}
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
            label="Backdrop"
            value={filter.backdrop}
            min={0}
            max={1}
            step={0.05}
            onChange={set('backdrop')}
            format={(v) => `${Math.round(v * 100)}%`}
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
            onToggle={(beatReactive) => patchDotSphereFilter({ beatReactive })}
            onStrength={(beatStrength) => patchDotSphereFilter({ beatStrength })}
            strengthLabel="Beat swell"
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            The dots stream around the ball with the song (flow speed above,
            negative reverses). Music ripple lets every row ride its own
            frequency band. Your picture (the image-visualizer PNG, the
            album art or the Background tab's picture) always bends away
            toward the screen edges and sinks into the dark behind the ball;
            the wave closes on itself in whole cycles, so the rotation never
            shows a seam. Skipped on transparent backgrounds so alpha
            recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
