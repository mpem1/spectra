'use client'

import { Layers } from 'lucide-react'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, sectionShell } from '@/components/studio/controls'

/**
 * Layers card — how the moving layers (visualizer, pulse image, vinyl disc,
 * lyrics, titles, watermark) interact with the full-frame filter chain.
 * "Layers stay colored" lifts them above EVERY filter: they render into
 * their own transparent overlay and come back in full color on top of the
 * finished look, so the filters only ever texture the background picture.
 * Works with any filter combination — halftone print, 3D glasses, glitch,
 * screen, VHS, film — and has nothing to do with Flip on kick.
 */
export function LayersSection() {
  const layers = useStudioStore((s) => s.config.layers)
  const patchLayers = useStudioStore((s) => s.patchLayers)

  return (
    <section className={sectionShell('teal')} aria-label="Layers">
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="size-3.5 text-teal-500" aria-hidden />
          <MicroLabel className="text-teal-300/80">Layers</MicroLabel>
        </div>
        <Switch
          aria-label="Layers stay colored above the filters"
          checked={layers.stayColored}
          onCheckedChange={(stayColored) => patchLayers({ stayColored })}
        />
      </div>
      {layers.stayColored ? (
        <p className="text-[11px] leading-snug text-zinc-600">
          The moving layers — visualizer, pulse image, vinyl cover, lyrics,
          titles and the watermark — stay in full color on top of every
          filter (screen, VHS, film, halftone print, glitch, 3D glasses).
          The filters only texture the background picture. Skipped on
          transparent backgrounds so alpha recordings stay clean.
        </p>
      ) : (
        <p className="text-[11px] leading-snug text-zinc-600">
          Turn on to keep the moving layers — visualizer, pulse image, vinyl
          cover, lyrics, titles and the watermark — in full color above every
          filter, whatever filter you use. Off, the filters finish the whole
          frame like they always did.
        </p>
      )}
    </section>
  )
}
