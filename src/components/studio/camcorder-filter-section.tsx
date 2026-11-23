'use client'

import { Cctv } from 'lucide-react'
import type { CamcorderFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'

/**
 * Camcorder card — effect.app's "Backrooms" preset, captured and ported
 * 1:1: the picture plays through a lo-fi analog tape pipeline (PAL-style
 * YIQ chroma decode on a 420px internal grid, tape wobble, crease tears,
 * tracking noise, 29.97fps vertical jumps), the preset's yellow-green Oklab
 * zone grade, and a faint gaussian haze. The tape dials match the original
 * effect's controls; the grade zones are the preset's own, baked in.
 * Deterministic, so every export bakes the identical look; skipped on
 * transparent backgrounds.
 */
export function CamcorderFilterSection() {
  const filter = useStudioStore((s) => s.config.camcorderFilter)
  const patchCamcorderFilter = useStudioStore((s) => s.patchCamcorderFilter)

  const set = (key: keyof CamcorderFilterConfig) => (value: number) =>
    patchCamcorderFilter({ [key]: value } as Partial<CamcorderFilterConfig>)

  return (
    <section className={sectionShell('amber', undefined, filter.enabled)}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Cctv className="size-3.5 text-amber-500" aria-hidden />
          <MicroLabel className="text-amber-300/80">Camcorder</MicroLabel>
        </div>
        <Switch
          aria-label="Enable camcorder filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchCamcorderFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        The found-footage camcorder — effect.app&apos;s Backrooms, ported dial
        for dial: the picture resamples onto a low-res tape grid, decodes its
        colors through a PAL-style chroma carrier, and picks up wobble, crease
        tears, tracking noise and frame jumps, all under the Backrooms
        yellow-green grade with a faint blur haze.
      </p>

      {filter.enabled ? (
        <>
          <SliderRow
            label="Resolution"
            value={filter.resolution}
            min={128}
            max={1024}
            step={1}
            onChange={set('resolution')}
            format={(v) => `${Math.round(v)} px`}
          />
          <SliderRow
            label="Distortion"
            value={filter.distortion}
            min={0}
            max={2.5}
            step={0.01}
            onChange={set('distortion')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Color fringing"
            value={filter.colorFringing}
            min={0}
            max={2}
            step={0.01}
            onChange={set('colorFringing')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Wobble"
            value={filter.wobble}
            min={0}
            max={2}
            step={0.01}
            onChange={set('wobble')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Tape crease"
            value={filter.tapeCrease}
            min={0}
            max={2}
            step={0.01}
            onChange={set('tapeCrease')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Tracking noise"
            value={filter.trackingNoise}
            min={0}
            max={2}
            step={0.01}
            onChange={set('trackingNoise')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Vertical jump"
            value={filter.verticalJump}
            min={0}
            max={2}
            step={0.01}
            onChange={set('verticalJump')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Sparkle"
            value={filter.sparkle}
            min={0}
            max={2}
            step={0.01}
            onChange={set('sparkle')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Flicker"
            value={filter.flicker}
            min={0}
            max={2}
            step={0.01}
            onChange={set('flicker')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Grain"
            value={filter.grain}
            min={0}
            max={2}
            step={0.01}
            onChange={set('grain')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Saturation"
            value={filter.saturation}
            min={0}
            max={2.5}
            step={0.01}
            onChange={set('saturation')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Color shift"
            value={filter.colorShift}
            min={0}
            max={2}
            step={0.01}
            onChange={set('colorShift')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Color blend"
            value={filter.colorBlend}
            min={0}
            max={1}
            step={0.01}
            onChange={set('colorBlend')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Softness"
            value={filter.softness}
            min={0.4}
            max={2}
            step={0.01}
            onChange={set('softness')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Color delay"
            value={filter.colorDelay}
            min={0}
            max={8}
            step={0.1}
            onChange={set('colorDelay')}
            format={(v) => v.toFixed(1)}
          />
          <SliderRow
            label="Sharpening"
            value={filter.sharpening}
            min={0}
            max={2}
            step={0.01}
            onChange={set('sharpening')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Blur"
            value={filter.blur}
            min={0.3}
            max={50}
            step={0.01}
            onChange={set('blur')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Blur mix"
            value={filter.blurMix}
            min={0}
            max={1}
            step={0.01}
            onChange={set('blurMix')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Grade strength"
            value={filter.gradeStrength}
            min={0}
            max={1}
            step={0.01}
            onChange={set('gradeStrength')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchCamcorderFilter({ beatReactive })}
            onStrength={(beatStrength) => patchCamcorderFilter({ beatStrength })}
            strengthLabel="Tape jolt"
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            The tape clock follows the song — pause and the tape pauses.
            Kicks (Tape jolt) punch the tracking, crease and vertical jump
            past their dials. The Backrooms color grade ships baked at the
            preset&apos;s own zone settings; Grade strength fades it. Skipped
            on transparent backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
