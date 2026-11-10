'use client'

import { Newspaper } from 'lucide-react'
import type { HalftoneFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

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

/** One side of the Flip on kick chooser — which side of the swap the kick
 * reveals. Compact two-up chip, active side picks up the section's yellow. */
function FlipDirButton({
  label,
  sub,
  active,
  onClick,
}: {
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
          ? 'border-yellow-400/70 bg-yellow-500/15 text-yellow-200'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
      )}
    >
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[9px] leading-none text-zinc-500">{sub}</span>
    </button>
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
        most of the picture. Beat pop spans a wide range: low = a gentle
        breath on the kick, max = the print lifts clean off the page and
        snaps back between kicks. Flip on kick swaps the whole look on every
        kick — you choose which side shows, how hard a kick fires it, how
        long it stays, and whether the picture stays black & white or the
        moving layers stay colored.
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
          <ToggleRow
            label="Flip on kick"
            checked={filter.beatFlip}
            onCheckedChange={(beatFlip) => patchHalftoneFilter({ beatFlip })}
          />
          {filter.beatFlip ? (
            <>
              <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="What the kick shows">
                <FlipDirButton
                  label="The picture"
                  sub="print between kicks"
                  active={filter.beatFlipTo !== 'print'}
                  onClick={() => patchHalftoneFilter({ beatFlipTo: 'picture' })}
                />
                <FlipDirButton
                  label="The print"
                  sub="picture between kicks"
                  active={filter.beatFlipTo === 'print'}
                  onClick={() => patchHalftoneFilter({ beatFlipTo: 'print' })}
                />
              </div>
              <p className="text-[10px] leading-snug text-zinc-600">
                {filter.beatFlipTo === 'print'
                  ? 'The regular picture rests on the frame between kicks; on a kick the halftone print stamps in, then fades back out as the kick decays. Runs all the way whatever the Beat pop dial says.'
                  : 'The print rests on the frame between kicks; on a kick it lifts clean off so the untouched regular picture flashes through, then settles back. Runs all the way whatever the Beat pop dial says.'}
              </p>
              <SliderRow
                label="Kick sensitivity"
                value={filter.flipSensitivity}
                min={0}
                max={1}
                step={0.05}
                onChange={set('flipSensitivity')}
                format={(v) =>
                  v <= 0.025 ? 'Slams only' : v >= 0.975 ? 'Every hit' : `${Math.round(v * 100)}%`
                }
              />
              <SliderRow
                label="Flip hold"
                value={filter.flipHold}
                min={0}
                max={1}
                step={0.05}
                onChange={set('flipHold')}
                format={(v) => (v < 0.025 ? 'With the kick' : `${(v * 2).toFixed(1)}s`)}
              />
              <p className="text-[10px] leading-snug text-zinc-600">
                Sensitivity sets how hard a kick must land before the flip
                fires. Hold keeps the swapped side fully swapped for that long
                before it fades back — “With the kick” fades out with the
                kick, as before.
              </p>
              <ToggleRow
                label="Stay black & white"
                checked={filter.flipMono}
                onCheckedChange={(flipMono) => patchHalftoneFilter({ flipMono })}
              />
              <p className="text-[10px] leading-snug text-zinc-600">
                The picture keeps its Black &amp; white / Contrast look on the
                kick side too — the color never flashes back, only the dots
                come and go. Needs a picture conditioning turned on (e.g.
                Black &amp; white) to change anything.
              </p>
              <ToggleRow
                label="Layers stay colored"
                checked={filter.flipColorLayers}
                onCheckedChange={(flipColorLayers) => patchHalftoneFilter({ flipColorLayers })}
              />
              <p className="text-[10px] leading-snug text-zinc-600">
                The visualizer, pulse image, vinyl cover and text overlays
                stay in full color on top of the print — the halftone only
                textures the background picture. While on, those layers skip
                the screen, VHS and film passes.
              </p>
            </>
          ) : null}
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
              picture; Invert turns the whole print — picture and ink — into a
              photo negative, so the print stays visible with any ink color.
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
