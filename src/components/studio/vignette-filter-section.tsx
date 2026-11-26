'use client'

import type { LucideIcon } from 'lucide-react'
import { Circle, Droplets, Palette } from 'lucide-react'
import type { VignetteFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

/**
 * One option in the lens-mode chooser (Color / Edge blur) — the same chip
 * pattern the gradient map's shift-motion chooser uses, tinted to this
 * card's purple accent.
 */
function LensChip({
  icon: Icon,
  label,
  sub,
  active,
  onClick,
}: {
  icon: LucideIcon
  label: string
  sub: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 transition-colors',
        active
          ? 'border-purple-400/70 bg-purple-500/15 text-purple-200'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[9px] leading-none text-zinc-500">{sub}</span>
    </button>
  )
}

/**
 * Vignette card — the lens works the frame's edges one of two ways,
 * picked with the mode chips: COLOR, the classic elliptical falloff with
 * a tintable edge color (near-black keeps the neutral lens), or EDGE
 * BLUR, the same falloff reading a frosted copy of the picture instead
 * of a shadow. Reach / softness shape the falloff either way.
 * Deterministic, so every export bakes the identical look; skipped on
 * transparent backgrounds.
 */
export function VignetteFilterSection() {
  const filter = useStudioStore((s) => s.config.vignetteFilter)
  const patchVignetteFilter = useStudioStore((s) => s.patchVignetteFilter)

  const set = (key: keyof VignetteFilterConfig) => (value: number) =>
    patchVignetteFilter({ [key]: value } as Partial<VignetteFilterConfig>)

  return (
    <section className={sectionShell('purple', undefined, filter.enabled)}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Circle className="size-3.5 text-purple-500" aria-hidden />
          <MicroLabel className="text-purple-300/80">Vignette</MicroLabel>
        </div>
        <Switch
          aria-label="Enable vignette filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchVignetteFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Vignette — the lens closes in on the frame's edges one of two ways:
        a shadow fading in toward the corners, or a frosted blur around the
        rim. Either function, one at a time.
      </p>

      {filter.enabled ? (
        <>
          <div className="space-y-1.5">
            <MicroLabel>Lens edge</MicroLabel>
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Vignette lens mode">
              <LensChip
                icon={Palette}
                label="Color"
                sub="tinted shadow"
                active={!filter.edgeBlur}
                onClick={() => patchVignetteFilter({ edgeBlur: false })}
              />
              <LensChip
                icon={Droplets}
                label="Edge blur"
                sub="frosted rim"
                active={filter.edgeBlur}
                onClick={() => patchVignetteFilter({ edgeBlur: true })}
              />
            </div>
          </div>
          {!filter.edgeBlur ? (
            <div className="space-y-1.5">
              <div className="flex h-5 items-center justify-between">
                <MicroLabel>Edge tint</MicroLabel>
                <ColorPickerButton
                  value={filter.tintColor}
                  onChange={(tintColor) => patchVignetteFilter({ tintColor })}
                  ariaLabel="Vignette edge tint"
                />
              </div>
              <p className="text-[10px] leading-snug text-zinc-600">
                The shadow color fading in toward the corners.
              </p>
            </div>
          ) : (
            <p className="text-[10px] leading-snug text-zinc-600">
              The picture blurs toward the edges — a frosted lens rim with
              the center pixel-sharp. The edge tint hides while the blur
              owns the lens.
            </p>
          )}
          <SliderRow
            label="Amount"
            value={filter.amount}
            min={0}
            max={1}
            step={0.05}
            onChange={set('amount')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Reach"
            value={filter.reach}
            min={0}
            max={1}
            step={0.05}
            onChange={set('reach')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Softness"
            value={filter.softness}
            min={0}
            max={1}
            step={0.05}
            onChange={set('softness')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchVignetteFilter({ beatReactive })}
            onStrength={(beatStrength) => patchVignetteFilter({ beatStrength })}
            strengthLabel="Beat pulse"
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            Reach sets how far in the effect starts, softness how smoothly
            it fades — amount is the rim's strength either way. Skipped on
            transparent backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
