'use client'

import { useRef } from 'react'
import { AudioLines, ImagePlus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useStudioStore } from '@/store/studio'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, SliderRow } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

/**
 * Pulse image — a PNG/SVG emblem that floats over (or behind) the scene and
 * breathes with the music: it swells on the bass and energy the same way the
 * blob and radial visualizers react, with optional slow spin and a
 * palette-tinted glow.
 */
export function PulseImageSection() {
  const pulseImage = useStudioStore((s) => s.config.pulseImage)
  const patchPulseImage = useStudioStore((s) => s.patchPulseImage)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File | undefined): void => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('That file is not an image')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      patchPulseImage({ imageSrc: String(reader.result) })
      toast.success('Pulse image set — press play and watch it dance')
    }
    reader.onerror = () => toast.error('Could not read that image')
    reader.readAsDataURL(file)
  }

  return (
    <section className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        aria-label="Pulse image file"
        onChange={(e) => {
          handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <AudioLines className="size-3.5 text-emerald-500" aria-hidden />
          <MicroLabel className="text-zinc-400">Pulse image</MicroLabel>
        </div>
        <Switch
          aria-label="Enable pulse image layer"
          checked={pulseImage.enabled}
          onCheckedChange={(enabled) => patchPulseImage({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        A logo or emblem that floats over the scene and pulses with the music
        — it swells on the bass the same way the blob and radial styles
        react. PNG with transparency works best.
      </p>

      {pulseImage.enabled ? (
        <>
          {pulseImage.imageSrc ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pulseImage.imageSrc}
                alt="Pulse image preview"
                className="h-16 w-full rounded-lg border border-zinc-800 bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:16px_16px] object-contain p-1"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 flex-1 border-zinc-800 text-xs text-zinc-300 hover:border-zinc-600"
                  onClick={() => inputRef.current?.click()}
                >
                  <ImagePlus className="size-3.5" aria-hidden />
                  Replace image
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-zinc-500 hover:text-red-400"
                  aria-label="Remove pulse image"
                  onClick={() => patchPulseImage({ imageSrc: '' })}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="flex h-16 w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 text-zinc-400 transition-colors hover:border-emerald-500/60 hover:text-emerald-400"
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus className="size-4" aria-hidden />
              <span className="text-xs font-medium">Upload your logo / emblem</span>
            </button>
          )}

          <SliderRow
            label="Position X"
            value={pulseImage.x}
            min={0}
            max={100}
            step={1}
            onChange={(x) => patchPulseImage({ x })}
            format={(v) => `${Math.round(v)}%`}
          />
          <SliderRow
            label="Position Y"
            value={pulseImage.y}
            min={0}
            max={100}
            step={1}
            onChange={(y) => patchPulseImage({ y })}
            format={(v) => `${Math.round(v)}%`}
          />
          <SliderRow
            label="Size"
            value={pulseImage.size}
            min={4}
            max={100}
            step={1}
            onChange={(size) => patchPulseImage({ size })}
            format={(v) => `${Math.round(v)}%`}
          />
          <SliderRow
            label="Pulse strength"
            value={pulseImage.pulse}
            min={0}
            max={1}
            step={0.05}
            onChange={(pulse) => patchPulseImage({ pulse })}
            format={(v) => `${Math.round(v * 100)}%`}
          />

          <div className="space-y-1.5">
            <MicroLabel>Layer</MicroLabel>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
              {(
                [
                  { id: 'back', label: 'Behind vinyl' },
                  { id: 'front', label: 'In front' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={pulseImage.layer === m.id}
                  onClick={() => patchPulseImage({ layer: m.id })}
                  className={cn(
                    'h-7 rounded-md text-xs transition-colors',
                    pulseImage.layer === m.id
                      ? 'bg-emerald-500 font-medium text-zinc-950'
                      : 'text-zinc-300 hover:text-zinc-100',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { key: 'spin', label: 'Slow spin' },
                { key: 'glow', label: 'Palette glow' },
              ] as const
            ).map(({ key, label }) => (
              <div key={key} className="flex h-8 items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5">
                <MicroLabel>{label}</MicroLabel>
                <Switch
                  aria-label={`Toggle ${label.toLowerCase()}`}
                  checked={pulseImage[key]}
                  onCheckedChange={(v) => patchPulseImage({ [key]: v })}
                />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}
