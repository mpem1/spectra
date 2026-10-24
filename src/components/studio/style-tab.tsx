'use client'

import { AudioWaveform, BarChart3, Droplet, Grid3x3, Radar, Sparkles } from 'lucide-react'
import type { VisualizerStyle } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { GradientEditor } from '@/components/studio/gradient-editor'
import { BackgroundSection } from '@/components/studio/background-section'
import { MicroLabel, OptionCard, SliderRow } from '@/components/studio/controls'

const STYLES: { id: VisualizerStyle; label: string; icon: typeof BarChart3 }[] = [
  { id: 'bars', label: 'Bars', icon: BarChart3 },
  { id: 'wave', label: 'Wave', icon: AudioWaveform },
  { id: 'radial', label: 'Radial', icon: Radar },
  { id: 'particles', label: 'Particles', icon: Sparkles },
  { id: 'blob', label: 'Blob', icon: Droplet },
  { id: 'grid', label: 'Grid', icon: Grid3x3 },
]

/** Plain uppercase section label (VISUALIZER / GRADIENT / …) like the reference UI. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <MicroLabel className="text-[11px] tracking-widest text-zinc-500">{children}</MicroLabel>
}

export function StyleTab() {
  const visualizer = useStudioStore((s) => s.config.visualizer)
  const patchVisualizer = useStudioStore((s) => s.patchVisualizer)
  const patchGradient = useStudioStore((s) => s.patchGradient)

  return (
    <div className="space-y-5">
      {/* Visualizer style — 2-column icon grid */}
      <section className="space-y-2">
        <SectionLabel>VISUALIZER</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
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

      {/* Gradient */}
      <section className="space-y-2">
        <SectionLabel>GRADIENT</SectionLabel>
        <GradientEditor value={visualizer.gradient} onChange={patchGradient} />
      </section>

      {/* Shape & motion */}
      <section className="space-y-3">
        <SectionLabel>SHAPE &amp; MOTION</SectionLabel>
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

        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="space-y-1.5">
            <MicroLabel>Mirror</MicroLabel>
            <Select
              value={visualizer.mirror}
              onValueChange={(mirror) =>
                patchVisualizer({ mirror: mirror as typeof visualizer.mirror })
              }
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
        </div>
      </section>

      {/* Background */}
      <BackgroundSection />
    </div>
  )
}
