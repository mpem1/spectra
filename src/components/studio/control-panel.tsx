'use client'

import { useEffect, useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useStudioStore, type StudioTab } from '@/store/studio'
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
          <TabsList className="grid w-full shrink-0 grid-cols-3 gap-1 bg-zinc-950/70 p-1">
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
          <div
            ref={scrollRef}
            className="slim-scrollbar min-h-0 flex-1 overflow-y-auto pr-1 lg:max-h-[calc(100vh-150px)]"
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
