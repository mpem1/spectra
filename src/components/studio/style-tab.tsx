'use client'

import { useState } from 'react'
import { AudioWaveform, BarChart3, Droplet, Grid3x3, Radar, Sparkles, Wand2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { VisualizerStyle } from '@/lib/visualizer/types'
import { extractPaletteFromArt } from '@/lib/visualizer/palette'
import { useStudioStore } from '@/store/studio'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { GradientEditor } from '@/components/studio/gradient-editor'
import { BackgroundSection } from '@/components/studio/background-section'
import { VinylSection } from '@/components/studio/vinyl-section'
import { WatermarkSection } from '@/components/studio/watermark-section'
import { PulseImageSection } from '@/components/studio/pulse-image-section'
import { MicroLabel, OptionCard, SECTION_ACCENT, SliderRow, sectionShell, type SectionAccent } from '@/components/studio/controls'

const STYLES: { id: VisualizerStyle; label: string; icon: typeof BarChart3 }[] = [
  { id: 'bars', label: 'Bars', icon: BarChart3 },
  { id: 'wave', label: 'Wave', icon: AudioWaveform },
  { id: 'radial', label: 'Radial', icon: Radar },
  { id: 'particles', label: 'Particles', icon: Sparkles },
  { id: 'blob', label: 'Blob', icon: Droplet },
  { id: 'grid', label: 'Grid', icon: Grid3x3 },
]

/** Plain uppercase section label (VISUALIZER / GRADIENT / …) like the reference UI. */
function SectionLabel({ children, accent }: { children: React.ReactNode; accent?: SectionAccent }) {
  return (
    <MicroLabel className={cn('text-[11px] tracking-widest', accent ? SECTION_ACCENT[accent].label : 'text-zinc-500')}>
      {children}
    </MicroLabel>
  )
}

/** One click: pull the visualizer palette straight from the uploaded album art. */
function AutoPaletteButton() {
  const artSrc = useStudioStore((s) => s.config.disc.imageSrc)
  const gradient = useStudioStore((s) => s.config.visualizer.gradient)
  const patchGradient = useStudioStore((s) => s.patchGradient)
  const [busy, setBusy] = useState(false)
  const disabled = !artSrc || busy
  return (
    <button
      type="button"
      disabled={disabled}
      title={
        artSrc
          ? 'Pull this palette from your album art'
          : 'Upload album art in the Vinyl & cover section first'
      }
      onClick={() => {
        if (!artSrc) return
        setBusy(true)
        extractPaletteFromArt(artSrc, 4)
          .then((stops) => {
            patchGradient({ ...gradient, stops })
            toast.success('Palette pulled from your album art')
          })
          .catch(() => toast.error('Could not read colors from that image'))
          .finally(() => setBusy(false))
      }}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors',
        'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Wand2 className="size-3.5 text-emerald-500" aria-hidden />
      )}
      From art
    </button>
  )
}

export function StyleTab() {
  const visualizer = useStudioStore((s) => s.config.visualizer)
  const patchVisualizer = useStudioStore((s) => s.patchVisualizer)
  const patchGradient = useStudioStore((s) => s.patchGradient)

  return (
    <div className="space-y-5">
      {/* Visualizer style — 2-column icon grid (emerald = the app accent) */}
      <section className={sectionShell('emerald', 'space-y-2')}>
        <SectionLabel accent="emerald">VISUALIZER</SectionLabel>
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
      <section className={sectionShell('violet', 'space-y-2')}>
        <div className="flex items-center justify-between">
          <SectionLabel accent="violet">GRADIENT</SectionLabel>
          <AutoPaletteButton />
        </div>
        <GradientEditor value={visualizer.gradient} onChange={patchGradient} />
      </section>

      {/* Shape & motion */}
      <section className={sectionShell('amber')}>
        <SectionLabel accent="amber">SHAPE &amp; MOTION</SectionLabel>

        {/* Orientation — the strip styles can run left→right or top→bottom */}
        {visualizer.style === 'bars' ||
        visualizer.style === 'wave' ||
        visualizer.style === 'grid' ? (
          <div className="space-y-1.5">
            <MicroLabel>Orientation</MicroLabel>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
              {(
                [
                  { id: 'horizontal', label: 'Horizontal' },
                  { id: 'vertical', label: 'Vertical' },
                ] as const
              ).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={visualizer.orientation === o.id}
                  onClick={() => patchVisualizer({ orientation: o.id })}
                  className={cn(
                    'h-7 rounded-md text-xs transition-colors',
                    visualizer.orientation === o.id
                      ? 'bg-emerald-500 font-medium text-zinc-950'
                      : 'text-zinc-300 hover:text-zinc-100',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {/* Side — vertical strips can hang from either edge */}
            {visualizer.orientation === 'vertical' ? (
              <div className="space-y-1.5">
                <MicroLabel>Side</MicroLabel>
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
                  {(
                    [
                      { id: 'left', label: 'Left edge' },
                      { id: 'right', label: 'Right edge' },
                    ] as const
                  ).map((side) => (
                    <button
                      key={side.id}
                      type="button"
                      aria-pressed={visualizer.anchor === side.id}
                      onClick={() => patchVisualizer({ anchor: side.id })}
                      className={cn(
                        'h-7 rounded-md text-xs transition-colors',
                        visualizer.anchor === side.id
                          ? 'bg-emerald-500 font-medium text-zinc-950'
                          : 'text-zinc-300 hover:text-zinc-100',
                      )}
                    >
                      {side.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

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

        {/* Mirror/center axis position (styles with a vertical mirror axis) */}
        {visualizer.mirror !== 'none' &&
        (visualizer.style === 'bars' ||
          visualizer.style === 'wave' ||
          visualizer.style === 'grid') ? (
          <SliderRow
            label="Mirror offset"
            value={visualizer.mirrorOffset}
            min={0}
            max={1}
            step={0.01}
            onChange={(mirrorOffset) => patchVisualizer({ mirrorOffset })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        ) : null}
      </section>

      {/* Layout — move & resize the whole visualizer layer */}
      <section className={sectionShell('cyan')}>
        <SectionLabel accent="cyan">LAYOUT</SectionLabel>
        <p className="text-xs leading-relaxed text-zinc-500">
          Move &amp; resize the visualizer as one layer — e.g. shrink it into a spectrum column
          beside the spinning disc (pair it with Orientation&nbsp;→&nbsp;Vertical for a full-height
          wall). 50 / 50 is the classic full-width layout.
        </p>
        <SliderRow
          label="Position X"
          value={visualizer.positionX}
          min={0}
          max={100}
          step={1}
          onChange={(positionX) => patchVisualizer({ positionX })}
          format={(v) => `${Math.round(v)}%`}
        />
        <SliderRow
          label="Position Y"
          value={visualizer.positionY}
          min={0}
          max={100}
          step={1}
          onChange={(positionY) => patchVisualizer({ positionY })}
          format={(v) => `${Math.round(v)}%`}
        />
        <SliderRow
          label="Size"
          value={visualizer.scale}
          min={0.1}
          max={2.5}
          step={0.05}
          onChange={(scale) => patchVisualizer({ scale })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </section>

      {/* Background */}
      <BackgroundSection />

      {/* Album art — square cover + spinning vinyl/CD */}
      <VinylSection />

      {/* Pulse image — a logo/emblem that breathes with the music */}
      <PulseImageSection />

      {/* Corner watermark — logo or @handle above everything */}
      <WatermarkSection />
    </div>
  )
}
