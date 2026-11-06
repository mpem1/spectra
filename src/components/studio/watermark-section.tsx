'use client'

import { useRef } from 'react'
import { ImagePlus, Stamp, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { WatermarkConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, SliderRow } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

const CORNERS: { id: WatermarkConfig['position']; label: string }[] = [
  { id: 'tl', label: 'Top left' },
  { id: 'tr', label: 'Top right' },
  { id: 'bl', label: 'Bottom left' },
  { id: 'br', label: 'Bottom right' },
]

/**
 * Corner watermark — a small logo image or @handle text that sits on top of
 * everything (lyrics, title, every export), so posted videos stay credited.
 */
export function WatermarkSection() {
  const watermark = useStudioStore((s) => s.config.watermark)
  const patchWatermark = useStudioStore((s) => s.patchWatermark)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File | undefined): void => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('That file is not an image')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      patchWatermark({ imageSrc: String(reader.result) })
      toast.success('Watermark logo set')
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
        aria-label="Watermark image file"
        onChange={(e) => {
          handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Stamp className="size-3.5 text-emerald-500" aria-hidden />
          <MicroLabel className="text-zinc-400">Corner watermark</MicroLabel>
        </div>
        <Switch
          aria-label="Enable corner watermark"
          checked={watermark.enabled}
          onCheckedChange={(enabled) => patchWatermark({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        A small logo or @handle pinned to a corner of the video — above lyrics
        and titles, and baked into every export, so your clips stay credited.
      </p>

      {watermark.enabled ? (
        <>
          {watermark.imageSrc ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={watermark.imageSrc}
                alt="Watermark preview"
                className="h-14 w-full rounded-lg border border-zinc-800 bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:16px_16px] object-contain p-1"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 flex-1 border-zinc-800 text-xs text-zinc-300 hover:border-zinc-600"
                  onClick={() => inputRef.current?.click()}
                >
                  <ImagePlus className="size-3.5" aria-hidden />
                  Replace logo
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-zinc-500 hover:text-red-400"
                  aria-label="Remove watermark logo"
                  onClick={() => patchWatermark({ imageSrc: '' })}
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
              <span className="text-xs font-medium">Upload a logo (PNG with transparency)</span>
            </button>
          )}

          <div className="space-y-1.5">
            <MicroLabel>…or a text handle</MicroLabel>
            <Input
              value={watermark.text}
              maxLength={40}
              placeholder="@yourhandle"
              aria-label="Watermark text"
              className="h-8 border-zinc-800 bg-zinc-950/60 text-xs"
              onChange={(e) => patchWatermark({ text: e.target.value })}
            />
            <p className="text-[10px] leading-snug text-zinc-600">
              Used when no logo is set — perfect for a channel name.
            </p>
          </div>

          <div className="space-y-1.5">
            <MicroLabel>Corner</MicroLabel>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
              {CORNERS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={watermark.position === c.id}
                  onClick={() => patchWatermark({ position: c.id })}
                  className={cn(
                    'h-7 rounded-md text-xs transition-colors',
                    watermark.position === c.id
                      ? 'bg-emerald-500 font-medium text-zinc-950'
                      : 'text-zinc-300 hover:text-zinc-100',
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <SliderRow
            label="Size"
            value={watermark.size}
            min={24}
            max={160}
            step={2}
            onChange={(size) => patchWatermark({ size })}
            format={(v) => `${Math.round(v)}px`}
          />
          <SliderRow
            label="Opacity"
            value={watermark.opacity}
            min={0.05}
            max={1}
            step={0.05}
            onChange={(opacity) => patchWatermark({ opacity })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </>
      ) : null}
    </section>
  )
}
