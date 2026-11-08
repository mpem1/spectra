'use client'

import { ScreenFilterSection } from '@/components/studio/screen-filter-section'

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
    </div>
  )
}
