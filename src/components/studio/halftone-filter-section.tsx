'use client'

import { Newspaper } from 'lucide-react'
import type { HalftoneFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { MicroLabel, BeatPunchRow, SliderRow, ToggleRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

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
 * printed from black & white / contrast-punched / negative source, the
 * ink can be any color or a two-color gradient that moves with the song,
 * and Print only wipes the picture away entirely — just the dots dancing
 * on a backdrop you choose. The Gradient / Picture fills print that same
 * poster on their own (the fill lives inside the dots, so the picture
 * steps off the frame while either is set).
 */
export function HalftoneFilterSection() {
  const filter = useStudioStore((s) => s.config.halftoneFilter)
  const patchHalftoneFilter = useStudioStore((s) => s.patchHalftoneFilter)

  const set = (key: keyof HalftoneFilterConfig) => (value: number) =>
    patchHalftoneFilter({ [key]: value } as Partial<HalftoneFilterConfig>)

  // The poster is up whenever Print only is on — or whenever a Gradient /
  // Picture fill is set, because those fills live INSIDE the dots and print
  // poster-style on their own (the picture steps off the frame; never dots
  // layered over the image). Mirrors the renderer's poster gate.
  const posterActive =
    filter.printOnly || !!filter.gradient || !!filter.imageFill

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
        long it stays, and whether the picture stays black &amp; white.
        Inside the dots: the ink, a gradient, or the picture&apos;s own
        colors — the gradient and picture fills print on their own paper
        (only the halftone shows), and Print only pins that poster look on
        for the plain ink too.
      </p>

      {filter.enabled ? (
        <>
          <ToggleRow
            label="Print only"
            checked={filter.printOnly}
            onCheckedChange={(printOnly) => patchHalftoneFilter({ printOnly })}
          />
          {posterActive ? (
            <>
              <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
                <MicroLabel className="text-zinc-400">Backdrop</MicroLabel>
                <div className="flex h-5 items-center justify-between">
                  <MicroLabel>Color</MicroLabel>
                  <ColorPickerButton
                    ariaLabel="Backdrop color"
                    value={filter.backdropColor}
                    onChange={(backdropColor) => patchHalftoneFilter({ backdropColor })}
                  />
                </div>
                <ToggleRow
                  label="Gradient"
                  checked={filter.backdropGradient}
                  onCheckedChange={(backdropGradient) => patchHalftoneFilter({ backdropGradient })}
                />
                {filter.backdropGradient ? (
                  <>
                    <div className="flex h-5 items-center justify-between">
                      <MicroLabel>Second color</MicroLabel>
                      <ColorPickerButton
                        ariaLabel="Second backdrop color"
                        value={filter.backdropColor2}
                        onChange={(backdropColor2) => patchHalftoneFilter({ backdropColor2 })}
                      />
                    </div>
                    <SliderRow
                      label="Gradient motion"
                      value={filter.backdropMotion}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={set('backdropMotion')}
                      format={(v) => (v < 0.025 ? 'Static' : `${Math.round(v * 100)}%`)}
                    />
                  </>
                ) : null}
              </div>
              <p className="text-[10px] leading-snug text-zinc-600">
                The picture disappears — only the print remains, still sampled
                from the hidden picture so the dots keep dancing with the music.
                The backdrop is the paper: a solid color for the classic poster
                look, or two blended colors with the same drift-and-kick motion
                as the ink gradient. Flip on kick now lifts the print clean off,
                flashing the bare backdrop.
                {posterActive && !filter.printOnly
                  ? ' Right now the Gradient / Picture fill raised this poster on its own — switch the fill back to Ink to print over the picture again.'
                  : ''}
              </p>
            </>
          ) : (
            <p className="text-[10px] leading-snug text-zinc-600">
              Turn on Print only to wipe the picture away: just the halftone
              dots on a solid backdrop you choose — white paper for the classic
              look, or any color / gradient for posters.
            </p>
          )}
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
            <MicroLabel className="text-zinc-400">Inside the dots</MicroLabel>
            <div
              className="grid grid-cols-3 gap-1.5"
              role="group"
              aria-label="What fills the halftone dots"
            >
              <FlipDirButton
                label="Ink"
                sub="solid color"
                active={!filter.imageFill && !filter.gradient}
                onClick={() => patchHalftoneFilter({ imageFill: false, gradient: false })}
              />
              <FlipDirButton
                label="Gradient"
                sub="two colors"
                active={!filter.imageFill && !!filter.gradient}
                onClick={() => patchHalftoneFilter({ imageFill: false, gradient: true })}
              />
              <FlipDirButton
                label="Picture"
                sub="image colors"
                active={!!filter.imageFill}
                onClick={() => patchHalftoneFilter({ imageFill: true })}
              />
            </div>
            <p className="text-[10px] leading-snug text-zinc-600">
              What the dots are made of. Ink is the solid color from the Ink
              panel below; Gradient is that panel&apos;s two-color blend
              drifting with the song; Picture prints the picture&apos;s own
              colors inside every dot — a color halftone, with Black &amp;
              white / Contrast shaping what the dots carry. Gradient and
              Picture fill the dots on their own paper: the picture steps off
              the frame and only the halftone shows — never dots layered over
              the image. Ink keeps the picture underneath (unless Print only
              is on).
            </p>
          </div>
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
                  ? 'The regular picture rests on the frame between kicks; on a kick the halftone print stamps in, then fades back out. Runs all the way whatever the Beat pop dial says.'
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
                format={(v) => (v < 0.025 ? 'Quick flash' : `${(v * 2).toFixed(1)}s`)}
              />
              <p className="text-[10px] leading-snug text-zinc-600">
                Sensitivity listens for the HIT on a clean sub-bass channel
                (not the loudness meters, which max out in loud sections) —
                long bass notes and drones hold their fire, steady kick
                patterns stay locked, kicks over a held 808 all land. Lower =
                only the hardest slams, higher = every tap. Hold keeps
                the swapped side fully swapped for that long before a quick
                0.25s fade-back — “Quick flash” gives one flash per kick.
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
              onCheckedChange={(gradient) =>
                patchHalftoneFilter({
                  gradient,
                  // Turning the Ink panel's gradient on IS an explicit ink
                  // choice — it steps on the Picture fill so the toggle does
                  // exactly what it says. Turning it off leaves the fill as-is.
                  imageFill: gradient ? false : filter.imageFill,
                })
              }
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
                the blend with the sound. The gradient prints on its own
                paper — the picture steps off the frame while it&apos;s set.
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
