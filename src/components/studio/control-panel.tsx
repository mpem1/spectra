'use client'

import { useEffect, useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useStudioStore, type StudioTab } from '@/store/studio'
import { VisualTab } from '@/components/studio/visual-tab'
import { BackgroundTab } from '@/components/studio/background-tab'
import { LyricsTab } from '@/components/studio/lyrics-tab'
import { ExportTab } from '@/components/studio/export-tab'

const TABS: { id: StudioTab; label: string }[] = [
  { id: 'visual', label: 'Visual' },
  { id: 'background', label: 'Background' },
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'export', label: 'Export' },
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
          <TabsList className="grid w-full shrink-0 grid-cols-4 bg-zinc-950/70 p-1">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="text-xs text-zinc-400 hover:text-zinc-200 data-[state=active]:bg-zinc-800 data-[state=active]:text-emerald-400 data-[state=active]:hover:text-emerald-400"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div ref={scrollRef} className="slim-scrollbar min-h-0 flex-1 overflow-y-auto pr-1 lg:max-h-[calc(100vh-150px)]">
            <TabsContent value="visual">
              <VisualTab />
            </TabsContent>
            <TabsContent value="background">
              <BackgroundTab />
            </TabsContent>
            <TabsContent value="lyrics">
              <LyricsTab />
            </TabsContent>
            <TabsContent value="export">
              <ExportTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </aside>
  )
}
