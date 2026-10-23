'use client'

import { Blend, Droplets, Grid3x3, Palette } from 'lucide-react'
import type { BackgroundMode } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Input } from '@/components/ui/input'
import { GradientEditor } from '@/components/studio/gradient-editor'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { parseColor, toHex6 } from '@/components/studio/color-utils'
import { OptionCard, SectionTitle, SliderRow } from '@/components/studio/controls'

const MODES: { id: BackgroundMode; label: string; icon: typeof Palette }[] = [
  { id: 'solid', label: 'Solid', icon: Palette },
  { id: 'gradient', label: 'Gradient', icon: Blend },
  { id: 'transparent', label: 'Alpha', icon: Grid3x3 },
]

export function BackgroundTab() {
  const background = useStudioStore((s) => s.config.background)
  const patchBackground = useStudioStore((s) => s.patchBackground)

  const solidRgb = parseColor(background.color) ?? { r: 10, g: 10, b: 10, a: 1 }

  return (
    <div className="space-y-4">
      {/* Mode */}
      <section className="space-y-2">
        <SectionTitle icon={Palette}>Mode</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map(({ id, label, icon }) => (
            <OptionCard
              key={id}
              icon={icon}
              label={label}
              active={background.mode === id}
              onClick={() => patchBackground({ mode: id })}
            />
          ))}
        </div>
      </section>

      {/* Solid color */}
      {background.mode === 'solid' ? (
        <section className="space-y-2">
          <SectionTitle icon={Droplets}>Solid color</SectionTitle>
          <div className="flex items-center gap-2">
            <ColorPickerButton
              value={background.color}
              onChange={(color) => patchBackground({ color })}
              ariaLabel="Background color"
              className="h-8 w-10"
            />
            <input
              type="color"
              value={toHex6(solidRgb)}
              onChange={(e) => patchBackground({ color: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded-md border border-zinc-800 bg-zinc-950 p-0.5"
              aria-label="Native background color picker"
            />
            <Input
              value={background.color}
              onChange={(e) => {
                const parsed = parseColor(e.target.value)
                if (parsed) patchBackground({ color: toHex6(parsed) })
              }}
              spellCheck={false}
              className="h-8 flex-1 font-mono text-xs"
              aria-label="Background hex color"
              placeholder="#0a0a0a"
            />
          </div>
        </section>
      ) : null}

      {/* Gradient */}
      {background.mode === 'gradient' ? (
        <section className="space-y-2">
          <SectionTitle icon={Blend}>Background gradient</SectionTitle>
          <GradientEditor
            value={background.gradient}
            onChange={(gradient) => patchBackground({ gradient })}
          />
        </section>
      ) : null}

      {/* Transparent hint */}
      {background.mode === 'transparent' ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-[11px] leading-relaxed text-emerald-300/90">
          The canvas renders with full alpha — export to MP4 keeps transparency
          where supported, and WebM recording captures the alpha channel.
        </p>
      ) : null}

      {/* Vignette / Grain */}
      <section className="space-y-3">
        <SectionTitle icon={Droplets}>Atmosphere</SectionTitle>
        <SliderRow
          label="Vignette"
          value={background.vignette}
          min={0}
          max={1}
          step={0.05}
          onChange={(vignette) => patchBackground({ vignette })}
          format={(v) => v.toFixed(2)}
        />
        <SliderRow
          label="Grain"
          value={background.grain}
          min={0}
          max={1}
          step={0.05}
          onChange={(grain) => patchBackground({ grain })}
          format={(v) => v.toFixed(2)}
        />
      </section>
    </div>
  )
}
