'use client'

import { ScreenFilterSection } from '@/components/studio/screen-filter-section'
import { VhsFilterSection } from '@/components/studio/vhs-filter-section'
import { FilmFilterSection } from '@/components/studio/film-filter-section'
import { HalftoneFilterSection } from '@/components/studio/halftone-filter-section'
import { GlitchFilterSection } from '@/components/studio/glitch-filter-section'
import { AnaglyphFilterSection } from '@/components/studio/anaglyph-filter-section'

/**
 * Filters tab — finishing looks laid over the ENTIRE composed picture
 * (visualizer, disc, lyrics, watermark included). One card per filter,
 * each with its own enable switch and sliders; new filters slot in as
 * additional cards below. Every filter is deterministic, so previews and
 * exports bake the identical look.
 */
export function FiltersTab() {
  return (
    <div className="space-y-5">
      <p className="px-1 text-xs leading-relaxed text-zinc-500">
        Finishing looks drawn over the whole picture — like putting the finished
        video behind a special screen or lens. Turn one on, dial it in, and it
        gets baked into every export.
      </p>

      {/* CRT — scanlines + RGB phosphor mask + color split + glow */}
      <ScreenFilterSection />

      {/* VHS tape — wobble + tracking noise + dropouts */}
      <VhsFilterSection />

      {/* Film reel — scratches + dust & hair + flicker */}
      <FilmFilterSection />

      {/* Halftone print — 45° dots on darker tones only */}
      <HalftoneFilterSection />

      {/* Glitch — blocky corruption bursts + shifted slices + color bars */}
      <GlitchFilterSection />

      {/* 3D glasses — red/cyan anaglyph re-projection with beat pop */}
      <AnaglyphFilterSection />
    </div>
  )
}
