'use client'

import { useEffect, useRef } from 'react'
import { Dices } from 'lucide-react'
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
  const scrollRef = useRef<HTMLDivElement>(null)

  // Roll one randomized variation: 1–2 style dials, 0–2 color tools and
  // 0–2 filters, every pick within ±25% of its factory default on the
  // slider track. The toast lists exactly what moved.
  const handleRandomize = () => {
    const { changed } = randomizeLook()
    toast.success('Look randomized', {
      description: changed.length ? changed.join(' · ') : 'Nothing to nudge — try a different style first.',
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
              scrolling into any panel. */}
          <button
            type="button"
            aria-label="Randomize the look: nudges 1–2 style dials, 0–2 color tools and 0–2 filters within 25% of their defaults"
            title="Randomize: 1–2 style dials, 0–2 color tools, 0–2 filters — every dial within ±25% of its default"
            onClick={handleRandomize}
            className="group flex h-12 w-full shrink-0 items-center justify-center gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-sm font-semibold text-emerald-300 transition-all duration-200 hover:border-emerald-400 hover:bg-emerald-500 hover:text-zinc-950 hover:shadow-[0_0_24px_-6px] hover:shadow-emerald-500/60 active:scale-[0.98]"
          >
            <Dices
              className="size-4.5 transition-transform duration-300 group-hover:rotate-12 group-active:rotate-45"
              aria-hidden
            />
            Randomize look
          </button>
          {/* lg:max-h safety cap sized to the fixed chrome above it on
              desktop: header 56 + main padding 32 + card padding 24 + the
              two-row tab grid ~84 + the randomizer button 48 + two flex
              gaps 24 → 268px. The flex min-h-0 chain does the real work;
              this just backstops it. */}
          <div
            ref={scrollRef}
            className="slim-scrollbar min-h-0 flex-1 overflow-y-auto pr-1 lg:max-h-[calc(100vh-268px)]"
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
