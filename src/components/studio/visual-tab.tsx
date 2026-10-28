'use client'

import { AudioWaveform, BarChart3, Palette, Radar, Sparkles } from 'lucide-react'
import type { VisualizerStyle } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { GradientEditor } from '@/components/studio/gradient-editor'
import { MicroLabel, OptionCard, SectionTitle, SliderRow } from '@/components/studio/controls'

const STYLES: { id: VisualizerStyle; label: string; icon: typeof BarChart3 }[] = [
  { id: 'bars', label: 'Bars', icon: BarChart3 },
  { id: 'wave', label: 'Wave', icon: AudioWaveform },
  { id: 'radial', label: 'Radial', icon: Radar },
  { id: 'particles', label: 'Particles', icon: Sparkles },
]

export function VisualTab() {
  const visualizer = useStudioStore((s) => s.config.visualizer)
  const patchVisualizer = useStudioStore((s) => s.patchVisualizer)
  const patchGradient = useStudioStore((s) => s.patchGradient)

  return (
    <div className="space-y-4">
      {/* Style */}
      <section className="space-y-2">
        <SectionTitle icon={BarChart3}>Style</SectionTitle>
        <div className="grid grid-cols-4 gap-2">
          {STYLES.map(({ id, label, icon }) => (
            <OptionCard
              key={id}
              icon={icon}
              label={label}
              active={visualizer.style === id}
              onClick={() => patchVisualizer({ style: id })}
            />
          ))}
        </div>
      </section>

      {/* Shape sliders */}
      <section className="space-y-3">
        <SliderRow
          label="Bar count"
          value={visualizer.barCount}
          min={16}
          max={256}
          step={8}
          onChange={(barCount) => patchVisualizer({ barCount })}
        />
        <SliderRow
          label="Smoothing"
          value={visualizer.smoothing}
          min={0}
          max={0.95}
          step={0.05}
          onChange={(smoothing) => patchVisualizer({ smoothing })}
          format={(v) => v.toFixed(2)}
        />
        <SliderRow
          label="Sensitivity"
          value={visualizer.sensitivity}
          min={0.1}
          max={3}
          step={0.1}
          onChange={(sensitivity) => patchVisualizer({ sensitivity })}
          format={(v) => v.toFixed(1)}
        />
        <SliderRow
          label="Roundness"
          value={visualizer.roundness}
          min={0}
          max={1}
          step={0.05}
          onChange={(roundness) => patchVisualizer({ roundness })}
          format={(v) => v.toFixed(2)}
        />
        <SliderRow
          label="Gap"
          value={visualizer.gap}
          min={0}
          max={0.8}
          step={0.05}
          onChange={(gap) => patchVisualizer({ gap })}
          format={(v) => v.toFixed(2)}
        />
      </section>

      {/* Mirror + glow */}
      <section className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <MicroLabel>Mirror</MicroLabel>
          <Select
            value={visualizer.mirror}
            onValueChange={(mirror) => patchVisualizer({ mirror: mirror as typeof visualizer.mirror })}
          >
            <SelectTrigger size="sm" className="w-full" aria-label="Mirror mode">
              <SelectValue placeholder="Mirror" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="mirror">Mirror</SelectItem>
              <SelectItem value="center">Center</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <MicroLabel>Glow</MicroLabel>
          <div className="flex h-8 items-center justify-end">
            <Switch
              aria-label="Toggle glow"
              checked={visualizer.glow}
              onCheckedChange={(glow) => patchVisualizer({ glow })}
            />
          </div>
        </div>
      </section>

      {/* Gradient */}
      <section className="space-y-2">
        <SectionTitle icon={Palette}>Gradient</SectionTitle>
        <GradientEditor value={visualizer.gradient} onChange={patchGradient} />
      </section>
    </div>
  )
}
