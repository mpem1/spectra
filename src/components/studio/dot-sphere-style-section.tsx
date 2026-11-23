'use client'

import { Globe as SphereIcon } from 'lucide-react'
import { useStudioStore } from '@/store/studio'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

/**
 * Dot Sphere style card — shown under the style grid when the Dot Sphere
 * style is selected. The look: your background picture bends away and
 * fades toward the screen edges behind a 3D LED ball with a grid of
 * glowing dots streaming horizontally around it, squeezed at the edges
 * like a real dot ball, and wavy neon bands weaving over the surface.
 * Neon gives the classic pink/blue LED palette; Picture rebuilds the
 * background as dot colors. Deterministic, so every export bakes the
 * identical look; on transparent backgrounds only the ball's dots render
 * so alpha recordings stay clean.
 */
export function DotSphereStyleSection() {
  const viz = useStudioStore((s) => s.config.visualizer)
  const patchVisualizer = useStudioStore((s) => s.patchVisualizer)

  const set = (key: keyof typeof viz) => (value: number) =>
    patchVisualizer({ [key]: value } as never)

  return (
    <section className={sectionShell('violet')}>
      <div className="flex h-7 items-center gap-2">
        <SphereIcon className="size-3.5 text-violet-500" aria-hidden />
        <MicroLabel className="text-violet-300/80">Dot Sphere</MicroLabel>
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Your style owns the frame: the background picture bends away and
        fades toward the screen edges while an LED ball floats in the
        center — a grid of glowing dots streaming horizontally around it,
        squeezed at the edges like a real dot ball, with wavy neon bands
        weaving over the surface. Neon gives the classic pink/blue LED
        palette; Picture rebuilds the background as dot colors.
      </p>

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
              aria-pressed={viz.dotSphereColors === m.id}
              onClick={() => patchVisualizer({ dotSphereColors: m.id })}
              className={cn(
                'h-7 rounded-md text-xs transition-colors',
                viz.dotSphereColors === m.id
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
        value={viz.dotSphereSize}
        min={0.6}
        max={2.6}
        step={0.01}
        onChange={set('dotSphereSize')}
        format={(v) => `${v.toFixed(2)}×`}
      />
      <SliderRow
        label="Dot rows"
        value={viz.dotSphereRows}
        min={12}
        max={80}
        step={1}
        onChange={set('dotSphereRows')}
        format={(v) => `${Math.round(v)}`}
      />
      <SliderRow
        label="Dot size"
        value={viz.dotSphereDotSize}
        min={0.4}
        max={2.2}
        step={0.01}
        onChange={set('dotSphereDotSize')}
        format={(v) => `${v.toFixed(2)}×`}
      />
      <SliderRow
        label="Flow speed"
        value={viz.dotSphereFlow}
        min={-3}
        max={3}
        step={0.01}
        onChange={set('dotSphereFlow')}
        format={(v) => `${v.toFixed(2)}`}
      />
      <SliderRow
        label="Wave amount"
        value={viz.dotSphereWave}
        min={0}
        max={1}
        step={0.01}
        onChange={set('dotSphereWave')}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <SliderRow
        label="Wave scale"
        value={viz.dotSphereWaveScale}
        min={1}
        max={10}
        step={1}
        onChange={(v) => set('dotSphereWaveScale')(Math.round(v))}
        format={(v) => `${Math.round(v)}`}
      />
      <SliderRow
        label="Wave speed"
        value={viz.dotSphereWaveSpeed}
        min={0}
        max={3}
        step={0.01}
        onChange={set('dotSphereWaveSpeed')}
        format={(v) => `${v.toFixed(2)}`}
      />
      <SliderRow
        label="Band twist"
        value={viz.dotSphereTwist}
        min={0}
        max={3}
        step={0.01}
        onChange={set('dotSphereTwist')}
        format={(v) => v.toFixed(2)}
      />
      <SliderRow
        label="Music ripple"
        value={viz.dotSphereRipple}
        min={0}
        max={1}
        step={0.05}
        onChange={set('dotSphereRipple')}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <SliderRow
        label="Glow"
        value={viz.dotSphereGlow}
        min={0}
        max={1}
        step={0.05}
        onChange={set('dotSphereGlow')}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <SliderRow
        label="Backdrop"
        value={viz.dotSphereBackdrop}
        min={0}
        max={1}
        step={0.05}
        onChange={set('dotSphereBackdrop')}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <BeatPunchRow
        on={viz.dotSphereBeat}
        strength={viz.dotSphereBeatStrength}
        onToggle={(dotSphereBeat) => patchVisualizer({ dotSphereBeat })}
        onStrength={(dotSphereBeatStrength) => patchVisualizer({ dotSphereBeatStrength })}
        strengthLabel="Beat swell"
      />
      <p className="text-[10px] leading-snug text-zinc-600">
        The dots stream around the ball with the song (flow speed above,
        negative reverses). Music ripple lets every row ride its own
        frequency band. Your background picture bends away toward the
        screen edges and sinks into the dark behind the ball (Backdrop
        sets how far it sinks); the wave closes on itself in whole cycles,
        so the rotation never shows a seam. The ball answers the Layout
        dials below like any style; on transparent backgrounds only the
        ball&apos;s dots render so alpha recordings stay clean.
      </p>
    </section>
  )
}
