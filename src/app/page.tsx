'use client'

import { useEffect } from 'react'
import { ControlPanel } from '@/components/studio/control-panel'
import { PreviewCanvas } from '@/components/studio/preview-canvas'
import { SharedLookLoader } from '@/components/studio/shared-look-loader'
import { TopBar } from '@/components/studio/top-bar'
import { useStudioStore } from '@/store/studio'
import { registerCustomFonts } from '@/lib/visualizer/custom-fonts'

/** Registers imported fonts (config.fonts) with the browser whenever the
 * library changes — import, project open, share link — so the canvas can
 * use them no matter which panel is on screen. */
function CustomFontLoader() {
  const fonts = useStudioStore((s) => s.config.fonts)
  useEffect(() => {
    void registerCustomFonts(fonts)
  }, [fonts])
  return null
}

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 lg:h-screen lg:overflow-hidden">
      <SharedLookLoader />
      <CustomFontLoader />
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
