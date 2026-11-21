'use client'

import { useRef } from 'react'
import { Images, ImagePlus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { PolaroidFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { MicroLabel, BeatPunchRow, SliderRow, ToggleRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

/** One option in a compact chip chooser (backdrop, photo source) — the
 *  active chip picks up the section's teal. */
function Chip({
  label,
  sub,
  active,
  disabled,
  onClick,
}: {
  label: string
  sub: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1.5 transition-colors',
        active
          ? 'border-teal-400/70 bg-teal-500/15 text-teal-200'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      <span className="text-xs font-medium">{label}</span>
      <span className="text-[9px] leading-none text-zinc-500">{sub}</span>
    </button>
  )
}

/**
 * Polaroid prints filter card — the whole page becomes a scattered wall of
 * instant prints (the classic white cards with the square photo window and
 * the chunky chin), and inside every square the finished picture shows
 * through: a wall of live prints of the music video. Grid split cuts each
 * square into sections that drift and shuffle inside the frame on the beat
 * (the effect.app look). Upload a photo to print it on every card, or upload
 * ONE image to spread it across the whole wall — each card shows its own
 * piece of it and the image doubles as the backdrop. Baked into every
 * export; skipped on transparent backgrounds.
 */
export function PolaroidFilterSection() {
  const filter = useStudioStore((s) => s.config.polaroidFilter)
  const patchPolaroidFilter = useStudioStore((s) => s.patchPolaroidFilter)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const mosaicInputRef = useRef<HTMLInputElement>(null)

  const set = (key: keyof PolaroidFilterConfig) => (value: number) =>
    patchPolaroidFilter({ [key]: value } as Partial<PolaroidFilterConfig>)

  const handlePhotoFile = (file: File | undefined): void => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('That file is not an image')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      patchPolaroidFilter({ photoSrc: String(reader.result), photoMode: 'photo' })
      toast.success('Photo set — every print carries it now')
    }
    reader.onerror = () => toast.error('Could not read that image')
    reader.readAsDataURL(file)
  }

  const handleMosaicFile = (file: File | undefined): void => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('That file is not an image')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      patchPolaroidFilter({
        mosaicSrc: String(reader.result),
        photoMode: 'mosaic',
        backdrop: 'image',
      })
      toast.success('Wall image set — every print shows its own piece now')
    }
    reader.onerror = () => toast.error('Could not read that image')
    reader.readAsDataURL(file)
  }

  return (
    <section className={sectionShell('teal')}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Images className="size-3.5 text-teal-500" aria-hidden />
          <MicroLabel className="text-teal-300/80">Polaroid prints</MicroLabel>
        </div>
        <Switch
          aria-label="Enable polaroid prints filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchPolaroidFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        The page becomes a wall of scattered instant prints — every card&apos;s
        square photo window shows the finished picture, YOUR photo, or its own
        piece of one big image laid across the whole page (with that image as
        the backdrop). The wall acts as the page&apos;s background scene: your
        style keeps playing in front of it, and your text stays on top. Grid
        split cuts each square into sections that drift and shuffle inside
        the frame on the beat. Baked into every export.
      </p>

      {filter.enabled ? (
        <>
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchPolaroidFilter({ beatReactive })}
            onStrength={(beatStrength) => patchPolaroidFilter({ beatStrength })}
            strengthLabel="Beat punch"
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            With React to beat on, the whole pile pulses on the song&apos;s low
            end — and on a solid kick the grid-split sections jump to a fresh
            shuffle inside their frames, hold, then drift back home.
          </p>
          <SliderRow
            label="Density"
            value={filter.density}
            min={0}
            max={1}
            step={0.05}
            onChange={set('density')}
            format={(v) => (v <= 0.025 ? 'A few big prints' : v >= 0.975 ? 'A packed wall' : `${Math.round(v * 100)}%`)}
          />
          <SliderRow
            label="Scatter"
            value={filter.scatter}
            min={0}
            max={1}
            step={0.05}
            onChange={set('scatter')}
            format={(v) => (v <= 0.025 ? 'Neat grid' : v >= 0.975 ? 'Messy pile' : `${Math.round(v * 100)}%`)}
          />
          <div className="space-y-1.5">
            <MicroLabel>Backdrop</MicroLabel>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Backdrop">
              <Chip
                label="Paper"
                sub="the studio table"
                active={filter.backdrop === 'paper'}
                onClick={() => patchPolaroidFilter({ backdrop: 'paper' })}
              />
              <Chip
                label="Charcoal"
                sub="dark room, cards pop"
                active={filter.backdrop === 'charcoal'}
                onClick={() => patchPolaroidFilter({ backdrop: 'charcoal' })}
              />
              <Chip
                label="My image"
                sub="your image as the table"
                active={filter.backdrop === 'image'}
                onClick={() => patchPolaroidFilter({ backdrop: 'image' })}
              />
            </div>
          </div>

          <ToggleRow
            label="Grid split"
            checked={filter.gridSplit}
            onCheckedChange={(gridSplit) => patchPolaroidFilter({ gridSplit })}
          />
          {filter.gridSplit ? (
            <>
              <SliderRow
                label="Split drift"
                value={filter.splitAmount}
                min={0}
                max={1}
                step={0.05}
                onChange={set('splitAmount')}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <p className="text-[10px] leading-snug text-zinc-600">
                The effect.app grid split: every photo square shows the
                picture cut into 3×3 sections, each drifting on its own path
                INSIDE the frame — the higher the drift, the further they
                wander (and the harder they jump on a kick with React to
                beat on).
              </p>
            </>
          ) : null}

          <input
            ref={photoInputRef}
            type="file"
            accept="image/png,image/webp,image/jpeg,image/gif,image/svg+xml"
            className="hidden"
            aria-label="Polaroid photo file"
            onChange={(e) => {
              handlePhotoFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <input
            ref={mosaicInputRef}
            type="file"
            accept="image/png,image/webp,image/jpeg,image/gif,image/svg+xml"
            className="hidden"
            aria-label="Polaroid wall image file"
            onChange={(e) => {
              handleMosaicFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <div className="space-y-1.5">
            <MicroLabel>What the frames show</MicroLabel>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="What shows in the frames">
              <Chip
                label="The picture"
                sub="video shows through"
                active={filter.photoMode === 'video'}
                onClick={() => patchPolaroidFilter({ photoMode: 'video' })}
              />
              <Chip
                label="My photo"
                sub="your upload, every card"
                active={filter.photoMode === 'photo'}
                onClick={() => patchPolaroidFilter({ photoMode: 'photo' })}
              />
              <Chip
                label="One image"
                sub="fills the whole wall"
                active={filter.photoMode === 'mosaic'}
                onClick={() => patchPolaroidFilter({ photoMode: 'mosaic', backdrop: 'image' })}
              />
            </div>

            {/* Per-card photo — stored separately from the wall image */}
            {filter.photoSrc || filter.photoMode === 'photo' || filter.photoMode === 'video' ? (
              <div className="space-y-2">
                {filter.photoSrc ? (
                  <>
                    <img
                      src={filter.photoSrc}
                      alt="Polaroid photo preview"
                      className="h-16 w-full rounded-lg border border-zinc-800 bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:16px_16px] object-contain p-1"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 flex-1 border-zinc-800 text-xs text-zinc-300 hover:border-zinc-600"
                        onClick={() => photoInputRef.current?.click()}
                      >
                        <ImagePlus className="size-3.5" aria-hidden />
                        Replace photo
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-zinc-500 hover:text-red-400"
                        aria-label="Remove polaroid photo"
                        onClick={() =>
                          patchPolaroidFilter({ photoSrc: '', photoMode: 'video' })
                        }
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                    {filter.photoMode === 'photo' ? (
                      <SliderRow
                        label="Photo zoom"
                        value={filter.photoZoom ?? 1}
                        min={0.6}
                        max={2.2}
                        step={0.05}
                        onChange={set('photoZoom')}
                        format={(v) => `${Math.round((v / 1) * 100)}%`}
                      />
                    ) : null}
                  </>
                ) : (
                  <button
                    type="button"
                    className="flex h-16 w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 text-zinc-400 transition-colors hover:border-teal-500/60 hover:text-teal-400"
                    onClick={() => photoInputRef.current?.click()}
                  >
                    <ImagePlus className="size-4" aria-hidden />
                    <span className="text-xs font-medium">Upload a photo for the prints</span>
                  </button>
                )}
              </div>
            ) : null}

            {/* The ONE wall image — spread across every card + the backdrop */}
            {filter.mosaicSrc || filter.photoMode === 'mosaic' ? (
              <div className="space-y-2">
                {filter.mosaicSrc ? (
                  <>
                    <img
                      src={filter.mosaicSrc}
                      alt="Polaroid wall image preview"
                      className="h-16 w-full rounded-lg border border-zinc-800 bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:16px_16px] object-contain p-1"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 flex-1 border-zinc-800 text-xs text-zinc-300 hover:border-zinc-600"
                        onClick={() => mosaicInputRef.current?.click()}
                      >
                        <ImagePlus className="size-3.5" aria-hidden />
                        Replace image
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-zinc-500 hover:text-red-400"
                        aria-label="Remove polaroid wall image"
                        onClick={() => patchPolaroidFilter({ mosaicSrc: '' })}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                    {filter.photoMode === 'mosaic' ? (
                      <div className="space-y-1.5">
                        <SliderRow
                          label="Image size"
                          value={filter.mosaicZoom ?? 1}
                          min={0.6}
                          max={2.2}
                          step={0.05}
                          onChange={set('mosaicZoom')}
                          format={(v) => `${Math.round(v * 100)}%`}
                        />
                        <SliderRow
                          label="Position X"
                          value={filter.mosaicPanX ?? 0}
                          min={-1}
                          max={1}
                          step={0.05}
                          onChange={set('mosaicPanX')}
                          format={(v) => `${Math.round(v * 100)}%`}
                        />
                        <SliderRow
                          label="Position Y"
                          value={filter.mosaicPanY ?? 0}
                          min={-1}
                          max={1}
                          step={0.05}
                          onChange={set('mosaicPanY')}
                          format={(v) => `${Math.round(v * 100)}%`}
                        />
                        <p className="text-[10px] leading-snug text-zinc-600">
                          Image size punches the wall image in and out — the
                          background AND the piece inside every print slide
                          together, so the wall stays glued to its backdrop.
                          Position slides it across the frame: push the size
                          above 100% (or use an image wider/taller than the
                          page) to get room to move.
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <button
                    type="button"
                    className="flex h-16 w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 text-zinc-400 transition-colors hover:border-teal-500/60 hover:text-teal-400"
                    onClick={() => mosaicInputRef.current?.click()}
                  >
                    <ImagePlus className="size-4" aria-hidden />
                    <span className="text-xs font-medium">Upload one image for the whole wall</span>
                  </button>
                )}
              </div>
            ) : null}

            <p className="text-[10px] leading-snug text-zinc-600">
              &apos;My photo&apos; prints your upload on every card. &apos;One
              image&apos; spreads a single image across the whole page — each
              print shows the piece of it at its own spot (no two prints
              alike) and the image itself becomes the backdrop, sized and
              positioned with the dials below it. Both stay in your browser
              (they travel in saved projects, not share links).
            </p>
          </div>

          <SliderRow
            label="Mix"
            value={filter.strength}
            min={0}
            max={1}
            step={0.05}
            onChange={set('strength')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            Density packs the wall from a few big prints to a full page of
            small ones; Scatter tilts and scatters them off their slots (0% is
            a neat grid, 100% the messy overlapping pile). The backdrop sets
            the room: light studio paper, charcoal so the white cards pop, or
            your own image as the table. Mix blends the untouched picture back
            over the wall. The wall is the page&apos;s background: your
            visualizer and text always render in front of it. Everything stays
            put between frames — the same look lands in every export. Skipped
            on transparent backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
