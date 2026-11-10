'use client'

import { Layers } from 'lucide-react'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, sectionShell, SliderRow } from '@/components/studio/controls'

/**
 * Layers card — how the moving layers (visualizer, pulse image, vinyl disc,
 * lyrics, titles, watermark) interact with the full-frame filter chain.
 * "Layers stay colored" lifts EVERYTHING above every filter: the layers
 * render into their own transparent overlay and come back in full color on
 * top of the finished look, so the filters only ever texture the background
 * picture. "Text stays legible" is the lighter sibling: only the words
 * (lyrics, titles, watermark) skip the filter chain so they stay crisp and
 * readable, while the visualizer/pulse image/vinyl still take the full
 * filtered look. Neither has anything to do with Flip on kick. Below the
 * toggles, two alpha dials: "Lyrics alpha" fades the lyric layer itself
 * (the same value the Lyrics tab's Opacity dial edits — one state, two
 * doors), and "Filter alpha" is the one dial over the whole chain: how
 * strongly the filtered look shows at all, independent of which filters
 * are switched on.
 */
export function LayersSection() {
  const layers = useStudioStore((s) => s.config.layers)
  const patchLayers = useStudioStore((s) => s.patchLayers)
  const lyrics = useStudioStore((s) => s.config.lyrics)
  const patchLyrics = useStudioStore((s) => s.patchLyrics)

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
      <SliderRow
        label="Lyrics alpha"
        value={lyrics.opacity ?? 1}
        min={0}
        max={1}
        step={0.05}
        onChange={(opacity) => patchLyrics({ opacity })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <p className="-mt-1 text-[11px] leading-snug text-zinc-600">
        Transparency for the words themselves: fades the whole lyric layer —
        glow and outline included — into the picture behind it. The same dial
        as the Lyrics tab&apos;s Opacity, so the two always agree.
      </p>
      <SliderRow
        label="Filter alpha"
        value={layers.filterAlpha ?? 1}
        min={0}
        max={1}
        step={0.05}
        onChange={(filterAlpha) => patchLayers({ filterAlpha })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <p className="-mt-1 text-[11px] leading-snug text-zinc-600">
        A transparency dial on top of the whole filter chain — screen, VHS,
        film, halftone print, glitch and 3D glasses alike: 100% is the
        full-strength look, sliding down fades the filtered frame back into
        the unfiltered one, and 0% hides every filter without touching their
        switches. Inert on transparent backgrounds.
      </p>
    </section>
  )
}
