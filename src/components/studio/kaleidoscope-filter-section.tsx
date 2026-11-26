'use client'

import { Aperture } from 'lucide-react'
import type { KaleidoscopeFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'
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

/**
 * One option in the segment-style chooser (Classic / Mandala / Fan) — the
 * same chip pattern as the gradient map's shift-motion chooser, tinted to
 * this card's fuchsia accent.
 */
function StyleChip({
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
          ? 'border-fuchsia-400/70 bg-fuchsia-500/15 text-fuchsia-200'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
      )}
    >
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[9px] leading-none text-zinc-500">{sub}</span>
    </button>
  )
}

/**
 * Kaleidoscope card — the whole picture mirrored through a radial array of
 * wedge slices around a center point. Segment style picks how each wedge
 * treats the slice (classic alternating reflections, all-mirrored mandala,
 * direct pinwheel fan), and the source-motion dials move the sampled
 * picture around under the mirrors — so a still background image reads as
 * a working kaleidoscope instead of one stationary mirrored picture.
 * Deterministic, so every export bakes the identical look; skipped on
 * transparent backgrounds.
 */
export function KaleidoscopeFilterSection() {
  const filter = useStudioStore((s) => s.config.kaleidoscopeFilter)
  const patchKaleidoscopeFilter = useStudioStore((s) => s.patchKaleidoscopeFilter)

  const set = (key: keyof KaleidoscopeFilterConfig) => (value: number) =>
    patchKaleidoscopeFilter({ [key]: value } as Partial<KaleidoscopeFilterConfig>)

  return (
    <section className={sectionShell('fuchsia', undefined, filter.enabled)}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Aperture className="size-3.5 text-fuchsia-500" aria-hidden />
          <MicroLabel className="text-fuchsia-300/80">Kaleidoscope</MicroLabel>
        </div>
        <Switch
          aria-label="Enable kaleidoscope filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchKaleidoscopeFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Kaleidoscope — the whole picture mirrored through a radial array of
        wedge slices around a center point. Pick the segment style, then let
        the picture drift under the mirrors so the pattern keeps re-forming.
      </p>

      {filter.enabled ? (
        <>
          <SliderRow
            label="Segments"
            value={filter.segments}
            min={2}
            max={24}
            step={1}
            onChange={set('segments')}
            format={(v) => `${Math.round(v)} wedges`}
          />
          <div className="space-y-1.5">
            <Group>Segment style</Group>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Segment style">
              <StyleChip
                label="Classic"
                sub="seams reflect"
                active={filter.mirrorMode === 'alternate'}
                onClick={() => patchKaleidoscopeFilter({ mirrorMode: 'alternate' })}
              />
              <StyleChip
                label="Mandala"
                sub="every wedge flips"
                active={filter.mirrorMode === 'mandala'}
                onClick={() => patchKaleidoscopeFilter({ mirrorMode: 'mandala' })}
              />
              <StyleChip
                label="Fan"
                sub="no mirroring"
                active={filter.mirrorMode === 'direct'}
                onClick={() => patchKaleidoscopeFilter({ mirrorMode: 'direct' })}
              />
            </div>
          </div>
          <SliderRow
            label="Spin"
            value={filter.spin}
            min={-0.5}
            max={0.5}
            step={0.01}
            onChange={set('spin')}
            format={(v) => `${v.toFixed(2)} rev/s`}
          />
          <SliderRow
            label="Zoom"
            value={filter.zoom}
            min={1}
            max={4}
            step={0.05}
            onChange={set('zoom')}
            format={(v) => `${v.toFixed(2)}×`}
          />
          <div className="grid grid-cols-2 gap-3">
            <SliderRow
              label="Center X"
              value={filter.centerX}
              min={0}
              max={100}
              step={1}
              onChange={set('centerX')}
              format={(v) => `${Math.round(v)}%`}
            />
            <SliderRow
              label="Center Y"
              value={filter.centerY}
              min={0}
              max={100}
              step={1}
              onChange={set('centerY')}
              format={(v) => `${Math.round(v)}%`}
            />
          </div>
          <SliderRow
            label="Mix"
            value={filter.blend}
            min={0}
            max={1}
            step={0.05}
            onChange={set('blend')}
            format={(v) => `${Math.round(v * 100)}%`}
          />

          <Group>Source motion</Group>
          <SliderRow
            label="Wander"
            value={filter.wander}
            min={0}
            max={1}
            step={0.05}
            onChange={set('wander')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Wander speed"
            value={filter.wanderSpeed}
            min={0}
            max={3}
            step={0.05}
            onChange={set('wanderSpeed')}
            format={(v) => `${v.toFixed(2)} cyc/s`}
          />
          <SliderRow
            label="Breathe"
            value={filter.breathe}
            min={0}
            max={1}
            step={0.05}
            onChange={set('breathe')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchKaleidoscopeFilter({ beatReactive })}
            onStrength={(beatStrength) => patchKaleidoscopeFilter({ beatStrength })}
            strengthLabel="Beat kick"
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            Source motion moves the picture around under the mirrors — with a
            still background image, wander and breathe are what make the
            scope actually work instead of freezing into one stationary
            mirrored picture. On a beat the array kicks a wedge and the
            source snaps to a fresh spot. Skipped on transparent
            backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
