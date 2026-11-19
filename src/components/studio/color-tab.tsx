'use client'

import { NeonSplitFilterSection } from '@/components/studio/neon-split-filter-section'
import { ColorGradeSection } from '@/components/studio/color-grade-section'

/**
 * Color tab — everything that recolors the whole finished picture, in one
 * place: the Neon Split look (effect.app's preset with every parameter
 * dialable) and the classic black & white / sepia grades. These are the
 * color stage of the filter chain — the color grade tones whatever is
 * beneath it, so the two stack.
 */
export function ColorTab() {
  return (
    <div className="space-y-5">
      <p className="px-1 text-xs leading-relaxed text-zinc-500">
        Color tools for the whole finished picture — the Neon Split look from
        effect.app with every parameter on a dial, plus the classic black
        &amp; white and sepia grades. Everything here is baked into every
        export.
      </p>

      {/* Neon split — the effect.app preset: gradient map + bloom + film
          grain, all parameters dialable */}
      <NeonSplitFilterSection />

      {/* Color grade — black & white / sepia tone shaping, stacks over (or
          under) the neon look */}
      <ColorGradeSection />
    </div>
  )
}
