'use client'

import { Contrast } from 'lucide-react'
import type { ColorGradeFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, SliderRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

const LOOKS: { id: ColorGradeFilterConfig['look']; label: string; sub: string }[] = [
  { id: 'bw', label: 'Black & white', sub: 'neutral mono' },
  { id: 'sepia', label: 'Sepia', sub: 'warm archive print' },
]

/**
 * Color grade card — the classic tone grades: Black & white (neutral
 * luminance mono) and Sepia (the warm brown archive print), with strength,
 * contrast and (sepia) warmth dials. The color stage of the filter chain —
 * it tones whatever sits beneath it, so it stacks with Neon Split.
 */
export function ColorGradeSection() {
  const filter = useStudioStore((s) => s.config.colorGradeFilter)
  const patch = useStudioStore((s) => s.patchColorGradeFilter)

  return (
    <section className={sectionShell('amber')}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Contrast className="size-3.5 text-amber-500" aria-hidden />
          <MicroLabel className="text-amber-300/80">Color grade</MicroLabel>
        </div>
        <Switch
          aria-label="Enable color grade"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patch({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        The classic tone grades — Black &amp; white maps the picture to neutral
        luminance, Sepia runs it through the warm brown archive print. It
        grades whatever is beneath it, so it stacks with Neon Split. Baked
        into every export.
      </p>

      {filter.enabled ? (
        <>
          <div className="space-y-1.5">
            <MicroLabel>Grade</MicroLabel>
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Color grade look">
              {LOOKS.map((look) => (
                <button
                  key={look.id}
                  type="button"
                  aria-pressed={filter.look === look.id}
                  onClick={() => patch({ look: look.id })}
                  className={cn(
                    'flex min-h-[44px] flex-col justify-center gap-0.5 rounded-lg border px-2.5 py-2 transition-colors',
                    filter.look === look.id
                      ? 'border-amber-400/70 bg-amber-500/15'
                      : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700',
                  )}
                >
                  <span
                    className={cn(
                      'text-xs font-medium',
                      filter.look === look.id ? 'text-amber-200' : 'text-zinc-300',
                    )}
                  >
                    {look.label}
                  </span>
                  <span className="text-[9px] leading-none text-zinc-500">{look.sub}</span>
                </button>
              ))}
            </div>
          </div>
          <SliderRow
            label="Strength"
            value={filter.strength}
            min={0}
            max={1}
            step={0.05}
            onChange={(strength) => patch({ strength })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Contrast"
            value={filter.contrast}
            min={0}
            max={1}
            step={0.05}
            onChange={(contrast) => patch({ contrast })}
            format={(v) => (v < 0.475 ? 'Washed' : v <= 0.525 ? 'Neutral' : `+${Math.round((v - 0.5) * 200)}%`)}
          />
          {filter.look === 'sepia' ? (
            <SliderRow
              label="Warmth"
              value={filter.warmth ?? 0.5}
              min={0}
              max={1}
              step={0.05}
              onChange={(warmth) => patch({ warmth })}
              format={(v) => (v <= 0.025 ? 'Plain mono' : v <= 0.475 ? 'Light' : v <= 0.525 ? 'Classic' : 'Deep amber')}
            />
          ) : null}
        </>
      ) : null}
    </section>
  )
}
