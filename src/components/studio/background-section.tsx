'use client'

import { useRef } from 'react'
import { Blend, Grid3x3, ImagePlus, ImageIcon, Palette, RotateCcw, Trash2 } from 'lucide-react'
import type { BackgroundMode } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { GradientEditor } from '@/components/studio/gradient-editor'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { parseColor, toHex6 } from '@/components/studio/color-utils'
import { MicroLabel, OptionCard, SliderRow } from '@/components/studio/controls'

const MODES: { id: BackgroundMode; label: string; icon: typeof Palette }[] = [
  { id: 'solid', label: 'Solid', icon: Palette },
  { id: 'gradient', label: 'Gradient', icon: Blend },
  { id: 'image', label: 'Image', icon: ImageIcon },
  { id: 'transparent', label: 'Alpha', icon: Grid3x3 },
]

/** Read a File into a data URL (for the canvas + project persistence). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the image file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Image background: upload a PNG/JPG (or drop it on the preview), preview
 * it, and dial in the Shade fader that darkens it behind the visualizer.
 */
function ImageBackgroundSection() {
  const background = useStudioStore((s) => s.config.background)
  const patchBackground = useStudioStore((s) => s.patchBackground)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const transformDirty =
    Math.abs(background.x) > 0.001 || Math.abs(background.y) > 0.001 || Math.abs(background.scale - 1) > 0.001

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file || !file.type.startsWith('image/')) return
    try {
      const imageSrc = await fileToDataUrl(file)
      patchBackground({ mode: 'image', imageSrc })
    } catch {
      // Reading failed — keep the previous background.
    }
  }

  return (
    <section className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
        aria-label="Background image file"
        onChange={(e) => {
          void handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      {background.imageSrc ? (
        <div className="space-y-2">
          <img
            src={background.imageSrc}
            alt="Background preview"
            className="h-24 w-full rounded-lg border border-zinc-800 object-cover"
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
              aria-label="Remove background image"
              onClick={() => patchBackground({ imageSrc: '' })}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 text-zinc-400 transition-colors hover:border-emerald-500/60 hover:text-emerald-400"
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus className="size-5" aria-hidden />
          <span className="text-xs font-medium">Upload PNG / JPG</span>
          <span className="text-[10px] text-zinc-600">or drop an image anywhere on the preview</span>
        </button>
      )}

      <SliderRow
        label="Shade"
        value={background.shade}
        min={0}
        max={1}
        step={0.05}
        onChange={(shade) => patchBackground({ shade })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <SliderRow
        label="Zoom"
        value={background.scale}
        min={0.1}
        max={5}
        step={0.05}
        onChange={(scale) => patchBackground({ scale })}
        format={(v) => `${v.toFixed(2)}×`}
      />
      {transformDirty ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 justify-start px-2 text-xs text-zinc-400 hover:text-emerald-400"
          onClick={() => patchBackground({ x: 0, y: 0, scale: 1 })}
        >
          <RotateCcw className="size-3" aria-hidden />
          Reset position & zoom
        </Button>
      ) : null}
      <p className="text-[11px] leading-snug text-zinc-500">
        On the preview: drag the image to move it, drag the corner handle or
        scroll to zoom. The shade fader darkens the image so the visualizer
        and lyrics stay readable.
      </p>
    </section>
  )
}

/** Background controls — rendered as the last section of the Style tab. */
export function BackgroundSection() {
  const background = useStudioStore((s) => s.config.background)
  const patchBackground = useStudioStore((s) => s.patchBackground)

  const solidRgb = parseColor(background.color) ?? { r: 10, g: 10, b: 10, a: 1 }

  return (
    <div className="space-y-4">
      <span className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">
        BACKGROUND
      </span>

      {/* Mode */}
      <section className="space-y-2">
        <div className="grid grid-cols-4 gap-2">
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
          <GradientEditor
            value={background.gradient}
            onChange={(gradient) => patchBackground({ gradient })}
          />
        </section>
      ) : null}

      {/* Image + shade fader */}
      {background.mode === 'image' ? (
        <ImageBackgroundSection />
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
