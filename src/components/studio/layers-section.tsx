'use client'

import { Layers } from 'lucide-react'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, sectionShell } from '@/components/studio/controls'

/**
 * Layers card — how the moving layers (visualizer, pulse image, vinyl disc,
 * lyrics, titles, watermark) interact with the full-frame filter chain.
 * "Layers stay colored" lifts EVERYTHING above every filter: the layers
 * render into their own transparent overlay and come back in full color on
 * top of the finished look, so the filters only ever texture the background
 * picture. "Text stays legible" is the lighter sibling: only the words
 * (lyrics, titles, watermark) skip the filter chain so they stay crisp and
 * readable, while the visualizer/pulse image/vinyl still take the full
 * filtered look. Neither has anything to do with Flip on kick.
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
        <>
          <p className="text-[11px] leading-snug text-zinc-600">
            The moving layers — visualizer, pulse image, vinyl cover, lyrics,
            titles and the watermark — stay in full color on top of every
            filter (screen, VHS, film, halftone print, glitch, 3D glasses).
            The filters only texture the background picture. Skipped on
            transparent backgrounds so alpha recordings stay clean.
          </p>
          <p className="text-[11px] leading-snug text-zinc-600">
            Every layer is already above the filters, so the text switch below
            has nothing left to do here.
          </p>
        </>
      ) : (
        <>
          <div className="flex h-7 items-center justify-between">
            <MicroLabel>Text stays legible</MicroLabel>
            <Switch
              aria-label="Text stays legible above the filters"
              checked={layers.textClear}
              onCheckedChange={(textClear) => patchLayers({ textClear })}
            />
          </div>
          {layers.textClear ? (
            <p className="text-[11px] leading-snug text-zinc-600">
              The words — lyrics, titles and the watermark — skip every filter
              pass and render crisp on top, so they stay readable through
              screen, VHS, film, halftone print, glitch and 3D glasses. The
              visualizer, pulse image and vinyl still take the full filtered
              look. Skipped on transparent backgrounds so alpha recordings
              stay clean.
            </p>
          ) : (
            <p className="text-[11px] leading-snug text-zinc-600">
              Off, the filters finish the whole frame like they always did.
              Turn on to keep just the words readable: the lyrics, titles and
              watermark skip every filter and render crisp on top, while the
              visualizer, pulse image and vinyl ride through the filters.
            </p>
          )}
        </>
      )}
    </section>
  )
}
