'use client'

import { Glasses } from 'lucide-react'
import type { AnaglyphFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, SliderRow, sectionShell } from '@/components/studio/controls'

/**
 * 3D glasses filter card — the old-school paper anaglyph look: the whole
 * picture is re-projected twice, once through red and once through cyan,
 * shifted apart so every edge wears classic red/blue fringes that pop with
 * the beat. Baked into every export; skipped on transparent backgrounds.
 */
export function AnaglyphFilterSection() {
  const filter = useStudioStore((s) => s.config.anaglyphFilter)
  const patchAnaglyphFilter = useStudioStore((s) => s.patchAnaglyphFilter)

  const set = (key: keyof AnaglyphFilterConfig) => (value: number) =>
    patchAnaglyphFilter({ [key]: value } as Partial<AnaglyphFilterConfig>)

  return (
    <section className={sectionShell('rose')}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Glasses className="size-3.5 text-rose-500" aria-hidden />
          <MicroLabel className="text-rose-300/80">3D Glasses</MicroLabel>
        </div>
        <Switch
          aria-label="Enable 3D glasses filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchAnaglyphFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        The old-school paper 3D-glasses look — the whole picture is re-projected
        twice, once through red and once through cyan, shifted apart so every
        edge wears classic red/blue fringes. Baked into every export.
      </p>

      {filter.enabled ? (
        <>
          <SliderRow
            label="Depth"
            value={filter.depth}
            min={0}
            max={1}
            step={0.05}
            onChange={set('depth')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Beat pop"
            value={filter.reactivity}
            min={0}
            max={1}
            step={0.05}
            onChange={set('reactivity')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Mix"
            value={filter.strength}
            min={0}
            max={1}
            step={0.05}
            onChange={set('strength')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            Depth sets how far apart the red/cyan layers sit, Beat pop pushes
            them wider on the song&apos;s low end, and Mix blends the glasses
            look back toward the untouched picture. Skipped on transparent
            backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
