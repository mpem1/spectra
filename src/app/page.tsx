'use client'

import { ControlPanel } from '@/components/studio/control-panel'
import { PreviewCanvas } from '@/components/studio/preview-canvas'
import { SharedLookLoader } from '@/components/studio/shared-look-loader'
import { TopBar } from '@/components/studio/top-bar'

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 lg:h-screen lg:overflow-hidden">
      <SharedLookLoader />
      <TopBar />
      <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PreviewCanvas />
        </div>
        <ControlPanel />
      </main>
    </div>
  )
}
