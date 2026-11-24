'use client'

import { useRef } from 'react'
import { Fingerprint, ImagePlus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { TextureFilterType } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, SliderRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

/** The material picker's chips — label + a two-word tell, compact like
 *  the Halftone card's choosers (44px min touch target). 'Custom' swaps
 *  the procedural surfaces for the user's own uploaded texture image. */
const TEXTURES: { id: TextureFilterType; label: string; sub: string }[] = [
  { id: 'grain', label: 'Grain', sub: 'film speckle' },
  { id: 'paper', label: 'Paper', sub: 'fibers, wrinkles' },
  { id: 'canvas', label: 'Canvas', sub: 'woven threads' },
  { id: 'concrete', label: 'Concrete', sub: 'mineral pits' },
  { id: 'glass', label: 'Glass', sub: 'smears, bends' },
  { id: 'foil', label: 'Foil', sub: 'crumpled metal' },
  { id: 'rust', label: 'Rust', sub: 'oxidation' },
  { id: 'dirt', label: 'Dirt', sub: 'grime, specks' },
  { id: 'custom', label: 'Custom', sub: 'your image' },
]

/**
 * Texture filter card — the finished picture printed onto a physical
 * material: film grain, paper, canvas, concrete, glass, crumpled foil,
 * rust, dirt — or the user's OWN uploaded texture image. Each surface is
 * a bump map whose flaws DISPLACE the picture (the image warps around
 * every pit, fiber and crease — the displacement) and catch a lit-relief
 * shading from the upper left, so the texture reads through the image
 * instead of sitting flat on top of it. The image's own colors stay its
 * own — the texture bends it, it doesn't tint it. Amount is the master
 * dial; Scale sizes the procedural materials' features; the custom
 * texture gets its own Size / Move X / Move Y / Rotate / Contrast dials.
 */
export function TextureFilterSection() {
  const filter = useStudioStore((s) => s.config.textureFilter)
  const patchTextureFilter = useStudioStore((s) => s.patchTextureFilter)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File | undefined): void => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('That file is not an image')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      patchTextureFilter({ customSrc: String(reader.result) })
      toast.success('Custom texture set')
    }
    reader.onerror = () => toast.error('Could not read that image')
    reader.readAsDataURL(file)
  }

  return (
    <section className={sectionShell('emerald', undefined, filter.enabled)}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Fingerprint className="size-3.5 text-emerald-500" aria-hidden />
          <MicroLabel className="text-emerald-300/80">Texture</MicroLabel>
        </div>
        <Switch
          aria-label="Enable texture filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchTextureFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Prints the finished picture onto a material — grain, paper, canvas,
        concrete, glass, crumpled foil, rust, dirt, or your own uploaded
        texture image. The surface&apos;s flaws push the picture around (the
        displacement), so pits, fibers and creases show THROUGH the image —
        the texture bends the whole picture instead of tinting it, so its
        colors stay its own. Amount sets how hard the picture bends; Scale
        sets how big the flaws are.
      </p>

      {filter.enabled ? (
        <>
          <div className="space-y-1.5">
            <MicroLabel>Material</MicroLabel>
            <div
              className="grid grid-cols-4 gap-1.5"
              role="group"
              aria-label="Texture material"
            >
              {TEXTURES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={filter.type === m.id}
                  aria-label={`${m.label} texture`}
                  onClick={() => patchTextureFilter({ type: m.id })}
                  className={cn(
                    'flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 transition-colors',
                    filter.type === m.id
                      ? 'border-emerald-400/70 bg-emerald-500/15 text-emerald-200'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
                  )}
                >
                  <span className="text-xs font-medium leading-none">{m.label}</span>
                  <span className="text-[9px] leading-none text-zinc-500">{m.sub}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] leading-snug text-zinc-600">
              {filter.type === 'grain'
                ? 'Fine film speckle that flickers like real film (24 frames a second) — the classic grain wash over the whole picture.'
                : filter.type === 'paper'
                  ? 'Printing paper: soft wrinkles and short fibers the picture bends around.'
                  : filter.type === 'canvas'
                    ? 'A woven artist canvas — the picture lands on crossing threads.'
                    : filter.type === 'concrete'
                      ? 'Rough mineral wall: blotchy stone with little pits the picture dips into.'
                      : filter.type === 'glass'
                        ? 'Frosted glass with cleaning smears — the picture refracts around every streak.'
                        : filter.type === 'foil'
                          ? 'Crumpled metal foil — big creases that fold and glint through the picture.'
                          : filter.type === 'rust'
                            ? 'Corroded metal: oxidation blooms that buckle the picture around every patch.'
                            : filter.type === 'custom'
                              ? 'Your own picture as the displacement map — bright areas push the picture one way, dark areas pull the other, so the frame warps around your image. It tiles, so moving it never runs out of texture.'
                              : 'Old grime: settled blotches and crisp specks that dent and scratch the picture.'}
            </p>
          </div>

          {filter.type === 'custom' ? (
            <>
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                className="hidden"
                aria-label="Custom texture image file"
                onChange={(e) => {
                  handleFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              {filter.customSrc ? (
                <div className="space-y-2">
                  <img
                    src={filter.customSrc}
                    alt="Custom texture preview"
                    className="h-14 w-full rounded-lg border border-zinc-800 object-cover"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 flex-1 border-zinc-800 text-xs text-zinc-300 hover:border-zinc-600"
                      onClick={() => inputRef.current?.click()}
                    >
                      <ImagePlus className="size-3.5" aria-hidden />
                      Replace texture
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-zinc-500 hover:text-red-400"
                      aria-label="Remove custom texture image"
                      onClick={() => patchTextureFilter({ customSrc: '' })}
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
                  <span className="text-xs font-medium">Upload a texture image</span>
                  <span className="text-[10px] text-zinc-600">
                    its bright spots push, dark spots pull
                  </span>
                </button>
              )}

              <SliderRow
                label="Size"
                value={filter.customSize}
                min={0.2}
                max={4}
                step={0.1}
                onChange={(customSize) => patchTextureFilter({ customSize })}
                format={(v) => `${v.toFixed(1)}×`}
              />
              <SliderRow
                label="Move X"
                value={filter.customX}
                min={-1}
                max={1}
                step={0.02}
                onChange={(customX) => patchTextureFilter({ customX })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <SliderRow
                label="Move Y"
                value={filter.customY}
                min={-1}
                max={1}
                step={0.02}
                onChange={(customY) => patchTextureFilter({ customY })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <SliderRow
                label="Rotate"
                value={filter.customRotate}
                min={-180}
                max={180}
                step={1}
                onChange={(customRotate) => patchTextureFilter({ customRotate })}
                format={(v) => `${Math.round(v)}°`}
              />
              <SliderRow
                label="Contrast"
                value={filter.customContrast}
                min={0}
                max={2}
                step={0.05}
                onChange={(customContrast) => patchTextureFilter({ customContrast })}
                format={(v) => (v <= 0.025 ? 'Flat' : `${Math.round(v * 100)}%`)}
              />
            </>
          ) : null}

          <SliderRow
            label="Amount"
            value={filter.amount}
            min={0}
            max={1}
            step={0.05}
            onChange={(amount) => patchTextureFilter({ amount })}
            format={(v) => (v <= 0.025 ? 'Off' : `${Math.round(v * 100)}%`)}
          />
          {filter.type !== 'custom' ? (
            <SliderRow
              label="Scale"
              value={filter.scale}
              min={0.4}
              max={3}
              step={0.1}
              onChange={(scale) => patchTextureFilter({ scale })}
              format={(v) => `${v.toFixed(1)}×`}
            />
          ) : null}

          <p className="text-[10px] leading-snug text-zinc-600">
            The texture is a static surface — it never crawls or flickers
            (except Grain, which flickers like film). Skipped on transparent
            backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
