'use client'

import { useEffect, useRef } from 'react'
import { Dices, Redo2, RotateCcw, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useStudioStore, type StudioTab } from '@/store/studio'
import { randomizeLook } from '@/lib/visualizer/randomizer'
import { StyleTab } from '@/components/studio/style-tab'
import { ColorTab } from '@/components/studio/color-tab'
import { FiltersTab } from '@/components/studio/filters-tab'
import { LyricsTab } from '@/components/studio/lyrics-tab'
import { ExportTab } from '@/components/studio/export-tab'
import { PresetsTab } from '@/components/studio/presets-tab'

// Text-only triggers: six labels in a 3×2 grid — each cell gets ~110px, so
// even the widest label ("Filters") fits comfortably; a single 6-column row
// would squeeze every cell to ~55px.
const TABS: { id: StudioTab; label: string }[] = [
  { id: 'style', label: 'Style' },
  { id: 'color', label: 'Color' },
  { id: 'filters', label: 'Filters' },
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'export', label: 'Export' },
  { id: 'presets', label: 'Presets' },
]

export function ControlPanel() {
  const activeTab = useStudioStore((s) => s.activeTab)
  const setActiveTab = useStudioStore((s) => s.setActiveTab)
  const canUndo = useStudioStore((s) => s.lookPast.length > 0)
  const canRedo = useStudioStore((s) => s.lookFuture.length > 0)
  const pushLookSnapshot = useStudioStore((s) => s.pushLookSnapshot)
  const undoLook = useStudioStore((s) => s.undoLook)
  const redoLook = useStudioStore((s) => s.redoLook)
  const resetLook = useStudioStore((s) => s.resetLook)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Roll one fresh look on a clean slate: everything the randomizer owns
  // (style dials, color tools, filters) is first defaulted/off so previous
  // picks never stack, then the visualizer switches to a different style
  // card, its LAYOUT rolls (position anywhere on the track, size 20–160%),
  // ALL of its Shape & Motion dials and picks roll, 0–2 color tools and
  // 0–2 filters are picked (the gradient map's ramp roll can land custom
  // colors — sampled from the loaded background image or video when there
  // is one), and the backdrop is set to a fresh solid or
  // gradient in a fresh brightness mood — unless an image or video IS the
  // backdrop, in which case the media stays put (and the invert-over-media
  // stencil flips on 50/50) and the toast says so.
  // The toast lists exactly what moved.
  // The pre-roll snapshot lands first so Undo / Redo / Reset can walk the
  // roll streak back and forward.
  const handleRandomize = () => {
    pushLookSnapshot()
    const { changed } = randomizeLook()
    toast.success('Fresh look rolled', {
      description: changed.length ? changed.join(' · ') : 'Nothing to roll — the pool came up empty.',
    })
  }

  // The history trio: step back one roll, step forward again, or jump all
  // the way back to the look from before the first roll (the rolled looks
  // stay on the redo stack, so Redo walks them back in one at a time).
  const handleUndo = () => {
    if (undoLook()) toast.success('One roll undone')
  }
  const handleRedo = () => {
    if (redoLook()) toast.success('Roll redone')
  }
  const handleReset = () => {
    if (resetLook())
      toast.success('Look reset', {
        description: 'Back to the look from before the rolls — Redo brings them back.',
      })
  }

  // Reset panel scroll when switching tabs so each tab opens at the top
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [activeTab])

  return (
    <aside className="flex w-full shrink-0 flex-col lg:w-[360px]">
      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-800 bg-zinc-900 p-3">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as StudioTab)}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          {/* h-auto: the base TabsList is h-9 (36px, one row) — six tabs in a
              3×2 grid need two rows, and the fixed height made the second row
              (Lyrics / Export / Presets) bleed out of the list and float over
              the panel content. h-auto lets the grid size itself. */}
          <TabsList className="grid h-auto w-full shrink-0 grid-cols-3 gap-1 bg-zinc-950/70 p-1">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="text-xs text-zinc-400 hover:text-zinc-200 data-[state=active]:bg-emerald-500 data-[state=active]:text-zinc-950 data-[state=active]:font-semibold data-[state=active]:hover:text-zinc-950 dark:data-[state=active]:bg-emerald-500 dark:data-[state=active]:text-zinc-950"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {/* The randomizer — a large full-width button filling the strip
              right under the tab grid (Style / Color / Filters · Lyrics /
              Export / Presets), so it is reachable from every tab without
              scrolling into any panel. Each click rolls a fresh look on a
              clean slate — including a different visualizer style card — so
              previous picks never stack. */}
          <button
            type="button"
            aria-label="Randomize the look: starts from a clean slate, switches to a different visualizer style, rolls its layout (position anywhere, size 20–160%) and ALL of its Shape & Motion dials and picks, sets the background to a fresh solid or gradient (an active image or video backdrop stays put and may arm the invert-over-media stencil), flips the Filters tab's Layers switches, then picks 0–2 color tools and 0–2 filters — re-rolling each picked effect's color presets and color fields too"
            title="Randomize: clean slate, then a new visualizer style + all of its Shape & Motion rolled + fresh background solid/gradient (image/video backdrop stays put, invert-over-media may flip on) + Layers switches flipped + 0–2 color tools, 0–2 filters — colors and presets re-rolled"
            onClick={handleRandomize}
            className="group flex h-12 w-full shrink-0 items-center justify-center gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-sm font-semibold text-emerald-300 transition-all duration-200 hover:border-emerald-400 hover:bg-emerald-500 hover:text-zinc-950 hover:shadow-[0_0_24px_-6px] hover:shadow-emerald-500/60 active:scale-[0.98]"
          >
            <Dices
              className="size-4.5 transition-transform duration-300 group-hover:rotate-12 group-active:rotate-45"
              aria-hidden
            />
            Randomize look
          </button>
          {/* The history trio for the randomizer: Undo steps one roll back,
              Redo steps forward again, Reset jumps back to the look from
              before the first roll (the rolled looks stay on the redo
              stack). All three sit disabled until a roll gives them
              something to do, and Reset keeps Redo alive for walk-backs. */}
          <div className="grid shrink-0 grid-cols-3 gap-1">
            <button
              type="button"
              aria-label="Undo: step back one rolled look"
              title="Undo — step back one rolled look"
              onClick={handleUndo}
              disabled={!canUndo}
              className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/70 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-40"
            >
              <Undo2 className="size-3.5" aria-hidden />
              Undo
            </button>
            <button
              type="button"
              aria-label="Redo: step forward one rolled look (after an undo or a reset)"
              title="Redo — step forward one rolled look (after an undo or a reset)"
              onClick={handleRedo}
              disabled={!canRedo}
              className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/70 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-40"
            >
              <Redo2 className="size-3.5" aria-hidden />
              Redo
            </button>
            <button
              type="button"
              aria-label="Reset: back to the look from before the rolls — the rolled looks stay on the redo stack"
              title="Reset — back to the look from before the rolls; Redo walks them back in"
              onClick={handleReset}
              disabled={!canUndo}
              className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/70 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-40"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Reset
            </button>
          </div>
          {/* lg:max-h safety cap sized to the fixed chrome above it on
              desktop: header 56 + main padding 32 + card padding 24 + the
              two-row tab grid ~84 + the randomizer button 48 + the history
              row 36 + three flex gaps 36 → 316px. The flex min-h-0 chain
              does the real work; this just backstops it. */}
          <div
            ref={scrollRef}
            className="slim-scrollbar min-h-0 flex-1 overflow-y-auto pr-1 lg:max-h-[calc(100vh-316px)]"
          >
            <TabsContent value="style">
              <StyleTab />
            </TabsContent>
            <TabsContent value="color">
              <ColorTab />
            </TabsContent>
            <TabsContent value="filters">
              <FiltersTab />
            </TabsContent>
            <TabsContent value="lyrics">
              <LyricsTab />
            </TabsContent>
            <TabsContent value="export">
              <ExportTab />
            </TabsContent>
            <TabsContent value="presets">
              <PresetsTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </aside>
  )
}
