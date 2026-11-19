'use client'

import { NeonSplitFilterSection } from '@/components/studio/neon-split-filter-section'
import { ColorGradeSection } from '@/components/studio/color-grade-section'
import { HalationSection } from '@/components/studio/halation-section'

/**
 * Color tab — everything that recolors the whole finished picture, in one
 * place: the Neon Split look (effect.app's preset with every parameter
 * dialable), the classic black & white / sepia grades and the Halation
 * film glow (effect.app's Halation effect). These are the color stage of
 * the filter chain — the color grade tones whatever is beneath it, and the
 * halation glows whatever is beneath it, so they stack in that order.
 */
export function ColorTab() {
  return (
    <div className="space-y-5">
      <p className="px-1 text-xs leading-relaxed text-zinc-500">
        Color tools for the whole finished picture — the Neon Split look from
        effect.app with every parameter on a dial, the classic black &amp;
        white and sepia grades, and the film Halation glow. Everything here
        is baked into every export.
      </p>

      {/* Neon split — the effect.app preset: gradient map + bloom + film
          grain, all parameters dialable */}
      <NeonSplitFilterSection />

      {/* Color grade — black & white / sepia tone shaping, stacks over (or
          under) the neon look */}
      <ColorGradeSection />

      {/* Halation — the film highlight-bleed glow (effect.app's Halation
          effect), glowing the finished tones beneath it */}
      <HalationSection />
    </div>
  )
}
