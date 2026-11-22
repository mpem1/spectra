'use client'

import { Aperture } from 'lucide-react'
import type { HalationFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { SliderRow, BeatPunchRow, ToggleRow, sectionShell, MicroLabel } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

/** Group divider inside the card — a small uppercase header with a rule. */
function Group({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {children}
      </span>
      <span className="h-px flex-1 bg-zinc-800/80" aria-hidden />
    </div>
  )
}

/** One option in the flip-direction chip chooser — active chip picks up
 *  the section's rose (the same chooser the 3D glasses card runs). */
function OptionChip({
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
          ? 'border-rose-400/70 bg-rose-500/15 text-rose-200'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
      )}
    >
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[9px] leading-none text-zinc-500">{sub}</span>
    </button>
  )
}

/** Percent readout, 0-100. */
const pct = (v: number) => `${Math.round(v * 100)}%`

/** One-click halo colors — the Kodak default plus a spread of looks. */
const HALO_PRESETS: { name: string; hex: string }[] = [
  { name: 'Kodak', hex: '#ff4d21' },
  { name: 'Cherry', hex: '#ff2436' },
  { name: 'Gold', hex: '#ffb020' },
  { name: 'Magenta', hex: '#ff2fa0' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Ice', hex: '#35d0ff' },
  { name: 'White', hex: '#ffffff' },
]

/**
 * Halation filter card — effect.app's Halation effect, rebuilt from its own
 * decrypted shaders. The classic film artifact: bright highlights bleed a
 * glow into the frame around them, in whatever halo color you pick (the
 * Kodak look, with the stock color of your choice — presets or the full
 * picker). React to beat pushes both the glow energy and the finished halo
 * with every kick, scaled by the Beat flare dial, and Flip on kick swaps
 * the whole look per detected kick — the 3D glasses' flip, translated to
 * the halo: the color inverts, the halo lifts off, or the halation stamps
 * in from a clean frame. Like the other filter cards, the card collapses
 * to one line while the switch is off; flipping it on opens the full dial
 * set.
 */
export function HalationSection() {
  const filter = useStudioStore((s) => s.config.halationFilter)
  const patch = useStudioStore((s) => s.patchHalationFilter)

  const set = (key: keyof HalationFilterConfig) => (value: number) =>
    patch({ [key]: value } as Partial<HalationFilterConfig>)

  const currentTint = (filter.tint ?? '#ff4d21').toLowerCase()
  // Flip direction with the factory default ('print') applied — chips and
  // helper text below all read this so a save without the field agrees
  // with the renderer's own fallback.
  const flipTo = filter.beatFlipTo ?? 'print'

  return (
    <section className={sectionShell('rose', undefined, filter.enabled)}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Aperture className="size-3.5 text-rose-500" aria-hidden />
          <MicroLabel className="text-rose-300/80">Halation</MicroLabel>
        </div>
        <Switch
          aria-label="Enable halation filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patch({ enabled })}
        />
      </div>

      {/* Like most of the other filter cards, the card is minimized while
          the switch is off — one line keeps it discoverable, flipping the
          switch opens the full dial set. */}
      {filter.enabled ? (
        <>
          <p className="text-[11px] leading-snug text-zinc-600">
            The film highlight-bleed glow — bright parts of the picture bloom
            a halo in whatever color you pick below, the way light bleeds
            through film into the base and reflects back (the Kodak look, in
            any stock color you like). Rebuilt from effect.app&apos;s own
            Halation shaders — every dial below is the real effect&apos;s own
            parameter at its published default, plus the free halo color, the
            beat flare and the kick flip. Everything here bakes into the
            preview and every export.
          </p>

          <div className="space-y-3">
            <Group>Bright pass</Group>
            <SliderRow
              label="Threshold"
              value={filter.threshold ?? 0.6}
              min={0}
              max={1}
              step={0.01}
              onChange={set('threshold')}
              format={(v) => (v <= 0.005 ? 'Everything' : pct(v))}
            />
            <SliderRow
              label="Knee"
              value={filter.knee ?? 0.25}
              min={0.01}
              max={0.8}
              step={0.01}
              onChange={set('knee')}
              format={(v) => (v <= 0.03 ? 'Hard edge' : pct(v))}
            />
            <SliderRow
              label="Boost"
              value={filter.boost ?? 0.5}
              min={0}
              max={1}
              step={0.01}
              onChange={set('boost')}
              format={pct}
            />

            <Group>Diffusion</Group>
            <SliderRow
              label="Local glow"
              value={filter.localDiffusion ?? 0.04}
              min={0.005}
              max={0.2}
              step={0.005}
              onChange={set('localDiffusion')}
              format={(v) => `${(v * 100).toFixed(1)}% of width`}
            />
            <SliderRow
              label="Global halo"
              value={filter.globalDiffusion ?? 0.12}
              min={0}
              max={0.4}
              step={0.005}
              onChange={set('globalDiffusion')}
              format={(v) => (v <= 0.001 ? 'None' : `${(v * 100).toFixed(1)}% of width`)}
            />

            <Group>Glow</Group>
            <SliderRow
              label="Intensity"
              value={filter.intensity ?? 0.7}
              min={0}
              max={1}
              step={0.01}
              onChange={set('intensity')}
              format={(v) => (v <= 0.005 ? 'Off' : pct(v))}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MicroLabel>Halo color</MicroLabel>
              <div className="flex flex-wrap items-center gap-1.5">
                {HALO_PRESETS.map((p) => (
                  <button
                    key={p.hex}
                    type="button"
                    aria-label={`Use the ${p.name} halo color`}
                    aria-pressed={currentTint === p.hex.toLowerCase()}
                    onClick={() => patch({ tint: p.hex })}
                    className={cn(
                      'size-5 rounded-full border transition-transform hover:scale-110',
                      currentTint === p.hex.toLowerCase() ? 'border-zinc-300' : 'border-zinc-700'
                    )}
                    style={{ backgroundColor: p.hex }}
                  />
                ))}
                <ColorPickerButton
                  value={filter.tint ?? '#ff4d21'}
                  onChange={(tint) => patch({ tint })}
                  ariaLabel="Halo color"
                  className="ml-1"
                />
              </div>
            </div>
            <SliderRow
              label="Background gain"
              value={filter.backgroundGain ?? 0.85}
              min={0}
              max={1}
              step={0.01}
              onChange={set('backgroundGain')}
              format={(v) => (v <= 0.005 ? 'Dark tones only' : v >= 0.995 ? 'Everywhere' : pct(v))}
            />
            <SliderRow
              label="Compensation"
              value={filter.blueComp ?? 0.5}
              min={0}
              max={1}
              step={0.01}
              onChange={set('blueComp')}
              format={(v) => (v <= 0.005 ? 'No blue damping' : v >= 0.995 ? 'None' : pct(v))}
            />

            <BeatPunchRow
              on={filter.beatReactive ?? false}
              strength={filter.beatStrength ?? 0.5}
              onToggle={(beatReactive) => patch({ beatReactive })}
              onStrength={(beatStrength) => patch({ beatStrength })}
              strengthLabel="Beat flare"
            />

            <ToggleRow
              label="Flip on kick"
              checked={filter.beatFlip ?? false}
              onCheckedChange={(beatFlip) => patch({ beatFlip })}
            />
            {filter.beatFlip ? (
              <>
                <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="What the kick shows">
                  <OptionChip
                    label="Around"
                    sub="color inverts"
                    active={flipTo === 'around'}
                    onClick={() => patch({ beatFlipTo: 'around' })}
                  />
                  <OptionChip
                    label="The picture"
                    sub="halo between kicks"
                    active={flipTo === 'picture'}
                    onClick={() => patch({ beatFlipTo: 'picture' })}
                  />
                  <OptionChip
                    label="The print"
                    sub="picture between kicks"
                    active={flipTo === 'print'}
                    onClick={() => patch({ beatFlipTo: 'print' })}
                  />
                </div>
                <p className="text-[10px] leading-snug text-zinc-600">
                  {flipTo === 'picture'
                    ? 'The halo rests on the frame between kicks; on a kick it lifts clean off so the untouched picture flashes through, then the glow settles back.'
                    : flipTo === 'print'
                      ? 'The untouched picture rests on the frame between kicks; on a kick the halation stamps in, holds, then fades back out.'
                      : 'The halo rests on the frame between kicks; on a kick the whole glow flips to the opposite color — the tint\'s complement — holds, then swings back to the color you picked.'}
                </p>
                <SliderRow
                  label="Kick sensitivity"
                  value={filter.flipSensitivity ?? 0.1}
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
                  value={filter.flipHold ?? 0.2}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={set('flipHold')}
                  format={(v) => (v < 0.025 ? 'Quick flash' : `${(v * 2).toFixed(1)}s`)}
                />
                <p className="text-[10px] leading-snug text-zinc-600">
                  The same kick detector the halftone print and the 3D glasses
                  flip on (each card keeps its own dials, so dialed the same
                  they fire together): sensitivity listens for the HIT on a
                  clean sub-bass channel — lower = only the hardest slams,
                  higher = every tap. Hold keeps the swapped look fully
                  swapped that long before the quick 0.25s fade-back.
                </p>
              </>
            ) : null}

            <p className="text-[10px] leading-snug text-zinc-600">
              Bright pass: Threshold sets how bright a pixel must be before it
              halos, Knee eases mid-tones into the glow (higher = softer
              cutoff), Boost pushes extra energy through. Diffusion: Local
              glow is the tight bloom hugging the highlight, Global halo is
              the wide wash — both sized as a fraction of the frame width.
              Glow: Intensity scales the whole effect, Halo color picks the
              glow color (tap a preset dot or open the swatch for the full
              picker — the hottest core drifts toward white), Background gain
              decides what tones can catch the halo (dark only ↔ everywhere),
              Compensation tames the halo over blue-leaning pixels so skies
              stay cool. React to beat pushes BOTH the glow energy and the
              finished halo with every kick — Beat flare sets how hard, so
              the whole bloom visibly breathes with the low end. Flip on kick
              swaps the whole look per detected kick: Around inverts the halo
              color, The picture flashes the untouched frame through, The
              print stamps the halation in from a clean frame. Skipped on
              transparent backgrounds so alpha recordings stay clean.
            </p>
          </div>
        </>
      ) : (
        <p className="text-[11px] leading-snug text-zinc-600">
          The film highlight-bleed glow — bright spots bloom halos in the
          color you pick. Flip the switch on to open the threshold,
          diffusion, glow, beat flare and kick flip controls.
        </p>
      )}
    </section>
  )
}
