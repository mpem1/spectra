'use client'

import { useRef } from 'react'
import { Globe as SphereIcon, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useStudioStore } from '@/store/studio'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { parseColor, toHex6 } from '@/components/studio/color-utils'
import { cn } from '@/lib/utils'

/**
 * Dot Sphere style card — shown under the style grid when the Dot Sphere
 * style is selected. The look: a 3D LED ball with a grid of glowing dots
 * streaming horizontally around it floats in the center of the frame,
 * over your background EXACTLY as you picked it — the picture or gradient
 * is never bent, dimmed or repainted. The dots paint in neon pink/blue,
 * your own gradient palette, or the picture's own colors; the ball's face
 * is a dark LED space, any solid color (painted as a lit 3D ball), or a
 * picture rounded like the orb. The ball reacts to the music like the other visualizers: every
 * row of dots rides its own frequency band and pushes outward with it,
 * so the surface ripples like a waveform. Deterministic, so every export
 * bakes the identical look; on transparent backgrounds only the ball's
 * dots render (unless you picked a color or picture face) so alpha
 * recordings stay clean.
 */
export function DotSphereStyleSection() {
  const viz = useStudioStore((s) => s.config.visualizer)
  const patchVisualizer = useStudioStore((s) => s.patchVisualizer)
  const faceInputRef = useRef<HTMLInputElement>(null)

  const set = (key: keyof typeof viz) => (value: number) =>
    patchVisualizer({ [key]: value } as never)

  const handleFaceFile = (file: File | undefined): void => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('That file is not an image')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      patchVisualizer({ dotSphereFaceSrc: String(reader.result), dotSphereFace: 'image' })
      toast.success('Face picture set — it rounds with the orb')
    }
    reader.onerror = () => toast.error('Could not read that image')
    reader.readAsDataURL(file)
  }

  return (
    <section className={sectionShell('violet')}>
      <div className="flex h-7 items-center gap-2">
        <SphereIcon className="size-3.5 text-violet-500" aria-hidden />
        <MicroLabel className="text-violet-300/80">Dot Sphere</MicroLabel>
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        A 3D LED ball floats in the center of the frame — a grid of glowing
        dots streaming horizontally around it, squeezed at the edges like a
        real dot ball, with wavy bands weaving over the surface. Your
        background stays exactly as you picked it: the picture or gradient
        is never bent, dimmed or repainted — the ball simply floats over it.
      </p>

      <div className="space-y-1.5">
        <MicroLabel>Dot colors</MicroLabel>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
          {(
            [
              { id: 'neon', label: 'Neon' },
              { id: 'palette', label: 'Palette' },
              { id: 'picture', label: 'Picture' },
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
        <p className="text-[10px] leading-snug text-zinc-600">
          {viz.dotSphereColors === 'neon'
            ? 'The classic LED look — hot pink and electric blue.'
            : viz.dotSphereColors === 'palette'
              ? 'The dots sweep your GRADIENT palette below — edit it there.'
              : 'The dots pick up the colors of the picture behind the ball.'}
        </p>
      </div>

      <div className="space-y-1.5">
        <MicroLabel>Orb face</MicroLabel>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
          {(
            [
              { id: 'dark', label: 'Dark' },
              { id: 'color', label: 'Color' },
              { id: 'image', label: 'Picture' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={viz.dotSphereFace === m.id}
              onClick={() => patchVisualizer({ dotSphereFace: m.id })}
              className={cn(
                'h-7 rounded-md text-xs transition-colors',
                viz.dotSphereFace === m.id
                  ? 'bg-violet-500 font-medium text-zinc-950'
                  : 'text-zinc-300 hover:text-zinc-100',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        {viz.dotSphereFace === 'color' ? (
          <div className="flex items-center gap-2">
            <ColorPickerButton
              value={viz.dotSphereFaceColor}
              onChange={(dotSphereFaceColor) => patchVisualizer({ dotSphereFaceColor })}
              ariaLabel="Orb face color"
              className="h-8 w-10"
            />
            <input
              type="color"
              value={toHex6(parseColor(viz.dotSphereFaceColor) ?? { r: 5, g: 1, b: 9, a: 1 })}
              onChange={(e) => patchVisualizer({ dotSphereFaceColor: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded-md border border-zinc-800 bg-zinc-950 p-0.5"
              aria-label="Native orb face color picker"
            />
            <input
              value={viz.dotSphereFaceColor}
              onChange={(e) => {
                const parsed = parseColor(e.target.value)
                if (parsed)
                  patchVisualizer({ dotSphereFaceColor: toHex6(parsed) })
              }}
              spellCheck={false}
              className="h-8 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 font-mono text-xs"
              aria-label="Orb face hex color"
              placeholder="#050109"
            />
          </div>
        ) : null}
        {viz.dotSphereFace === 'color' ? (
          <p className="text-[10px] leading-snug text-zinc-600">
            The face is painted as a lit 3D ball — light from the upper
            left, a soft gloss and a shadow sinking around the edge — not
            a flat disk.
          </p>
        ) : null}
        {viz.dotSphereFace === 'image' ? (
          <div className="space-y-2">
            <input
              ref={faceInputRef}
              type="file"
              accept="image/png,image/webp,image/jpeg,image/svg+xml"
              className="hidden"
              aria-label="Dot Sphere face image file"
              onChange={(e) => {
                handleFaceFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            {viz.dotSphereFaceSrc ? (
              <img
                src={viz.dotSphereFaceSrc}
                alt="Dot Sphere face preview"
                className="h-16 w-full rounded-lg border border-zinc-800 bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:16px_16px] object-contain p-1"
              />
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => faceInputRef.current?.click()}
                className="h-8 flex-1 rounded-md border border-zinc-800 bg-zinc-950/60 text-xs text-zinc-300 transition-colors hover:text-zinc-100"
              >
                {viz.dotSphereFaceSrc ? 'Replace picture' : 'Choose a picture'}
              </button>
              {viz.dotSphereFaceSrc ? (
                <button
                  type="button"
                  aria-label="Remove orb face picture"
                  onClick={() => patchVisualizer({ dotSphereFaceSrc: '' })}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950/60 text-zinc-400 transition-colors hover:text-zinc-100"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
            <p className="text-[10px] leading-snug text-zinc-600">
              The picture is clipped inside the ball&apos;s circle — rounded
              exactly like the orb, cropped to fit, never stretched.
            </p>
          </div>
        ) : null}
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
      <BeatPunchRow
        on={viz.dotSphereBeat}
        strength={viz.dotSphereBeatStrength}
        onToggle={(dotSphereBeat) => patchVisualizer({ dotSphereBeat })}
        onStrength={(dotSphereBeatStrength) => patchVisualizer({ dotSphereBeatStrength })}
        strengthLabel="Beat swell"
      />
      <p className="text-[10px] leading-snug text-zinc-600">
        The dots stream around the ball with the song (flow speed above,
        negative reverses). Music ripple makes the ball react like the
        other visualizers: every row rides its own frequency band and
        pushes outward with it — the surface ripples like a waveform, the
        bass rows surging on the kick drum — scaled by the Sensitivity
        dial below. The wave closes on itself in whole cycles, so the
        rotation never shows a seam. The ball answers the Layout dials
        below like any style; on transparent backgrounds only the
        ball&apos;s dots render (unless you picked a color or picture
        face) so alpha recordings stay clean.
      </p>
    </section>
  )
}
