'use client'

import { Aperture } from 'lucide-react'
import type { HalationFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { SliderRow, sectionShell, MicroLabel } from '@/components/studio/controls'

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

/** Percent readout, 0-100. */
const pct = (v: number) => `${Math.round(v * 100)}%`

/**
 * Halation filter card — effect.app's Halation effect, rebuilt from its own
 * decrypted shaders. The classic film artifact: bright highlights bleed a
 * red/orange glow into the frame around them (light blooming through film
 * into the base and reflecting back — the look Kodak stocks are famous
 * for). Like the other filter cards, the card collapses to one line while
 * the switch is off; flipping it on opens the full dial set.
 */
export function HalationSection() {
  const filter = useStudioStore((s) => s.config.halationFilter)
  const patch = useStudioStore((s) => s.patchHalationFilter)

  const set = (key: keyof HalationFilterConfig) => (value: number) =>
    patch({ [key]: value } as Partial<HalationFilterConfig>)

  return (
    <section className={sectionShell('rose')}>
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
            a red/orange halo the way light bleeds through film into the base
            and reflects back (the look Kodak stocks are famous for).
            Rebuilt from effect.app&apos;s own Halation shaders — every dial
            below is the real effect&apos;s own parameter at its published
            default. Everything here bakes into the preview and every export.
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
            <SliderRow
              label="Hue"
              value={filter.hue ?? 0.5}
              min={0}
              max={1}
              step={0.01}
              onChange={set('hue')}
              format={(v) =>
                v <= 0.03 ? 'Red only' : v >= 0.97 ? 'Full orange shift' : `${Math.round(v * 100)}% toward orange`
              }
            />
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

            <p className="text-[10px] leading-snug text-zinc-600">
              Bright pass: Threshold sets how bright a pixel must be before it
              halos, Knee eases mid-tones into the glow (higher = softer
              cutoff), Boost pushes extra energy through. Diffusion: Local
              glow is the tight bloom hugging the highlight, Global halo is
              the wide red wash — both sized as a fraction of the frame
              width. Glow: Intensity scales the whole effect, Hue shifts the
              hot core from red toward orange, Background gain decides what
              tones can catch the halo (dark only ↔ everywhere), Compensation
              tames the halo over blue-leaning pixels so skies stay cool.
              Skipped on transparent backgrounds so alpha recordings stay
              clean.
            </p>
          </div>
        </>
      ) : (
        <p className="text-[11px] leading-snug text-zinc-600">
          The film highlight-bleed glow — bright spots bloom red/orange
          halos. Flip the switch on to open the threshold, diffusion and glow
          controls.
        </p>
      )}
    </section>
  )
}
