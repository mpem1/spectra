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
        {/*
          Mobile: pin the video (canvas + player bar) to the top of the
          viewport so it stays on screen while the settings below scroll —
          tweaks stay visible as they are made. The wrapper goes full-bleed
          with an opaque page-color backdrop so panel content slides cleanly
          underneath instead of peeking through the gutters. Desktop uses the
          fixed two-pane shell, so sticky is scoped to below lg.
        */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col max-lg:sticky max-lg:top-0 max-lg:z-30 max-lg:-mx-4 max-lg:px-4 max-lg:pt-2 max-lg:pb-3 max-lg:bg-zinc-950 max-lg:shadow-lg max-lg:shadow-black/30">
          <PreviewCanvas />
        </div>
        <ControlPanel />
      </main>
    </div>
  )
}
