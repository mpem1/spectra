'use client'

import { useRef } from 'react'
import { Disc3, ImagePlus, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import { useStudioStore } from '@/store/studio'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, SectionTitle, SliderRow } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

/** Read a File into a data URL (for the canvas + project persistence). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the image file'))
    reader.readAsDataURL(file)
  })
}

const RPM_PRESETS: { label: string; value: number }[] = [
  { label: '33⅓', value: 33.33 },
  { label: '45', value: 45 },
  { label: 'Stop', value: 0 },
]

/**
 * Album art layer — a square cover with a spinning disc sliding out from
 * behind it (the classic "record out of the sleeve" visualizer look), or the
 * same art across the whole disc face like a CD. Lives at the end of the
 * Style tab and composes with every visualizer style.
 */
export function VinylSection() {
  const disc = useStudioStore((s) => s.config.disc)
  const patchDisc = useStudioStore((s) => s.patchDisc)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file || !file.type.startsWith('image/')) return
    try {
      const imageSrc = await fileToDataUrl(file)
      patchDisc({ imageSrc })
    } catch {
      // Reading failed — keep the previous art.
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
        aria-label="Album art file"
        onChange={(e) => {
          void handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <div className="flex h-7 items-center justify-between">
        <SectionTitle icon={Disc3}>Vinyl &amp; cover</SectionTitle>
        <Switch
          aria-label="Enable album art layer"
          checked={disc.enabled}
          onCheckedChange={(enabled) => patchDisc({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        A square cover with a record sliding out of it, spinning at your set
        speed. The art goes on the vinyl&apos;s center label or across the full
        face like a CD — cover and disc share the same image.
      </p>

      {/* Album art upload */}
      {disc.imageSrc ? (
        <div className="space-y-2">
          <img
            src={disc.imageSrc}
            alt="Album art preview"
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
              Replace art
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-zinc-500 hover:text-red-400"
              aria-label="Remove album art"
              onClick={() => patchDisc({ imageSrc: '' })}
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
          <span className="text-xs font-medium">Upload album art</span>
          <span className="text-[10px] text-zinc-600">PNG / JPG — used by the cover and the disc</span>
        </button>
      )}

      {/* Square cover (the sleeve) */}
      <div className="flex h-8 items-center gap-2">
        <MicroLabel className="flex-1">Square cover</MicroLabel>
        <Switch
          aria-label="Show square cover"
          checked={disc.showCover}
          onCheckedChange={(showCover) => patchDisc({ showCover })}
        />
      </div>
      {disc.showCover ? (
        <>
          <SliderRow
            label="Cover size"
            value={disc.coverSize}
            min={10}
            max={80}
            step={1}
            onChange={(coverSize) => patchDisc({ coverSize })}
            format={(v) => `${Math.round(v)}%`}
          />
          <SliderRow
            label="Cover X"
            value={disc.coverX}
            min={0}
            max={100}
            step={1}
            onChange={(coverX) => patchDisc({ coverX })}
            format={(v) => `${Math.round(v)}%`}
          />
          <SliderRow
            label="Cover Y"
            value={disc.coverY}
            min={0}
            max={100}
            step={1}
            onChange={(coverY) => patchDisc({ coverY })}
            format={(v) => `${Math.round(v)}%`}
          />
          {disc.imageSrc ? (
            <div className="space-y-1">
              <SliderRow
                label="Art zoom"
                value={disc.coverArtZoom ?? 1}
                min={1}
                max={3}
                step={0.05}
                onChange={(coverArtZoom) => patchDisc({ coverArtZoom })}
                format={(v) => `${v.toFixed(2)}×`}
              />
              <SliderRow
                label="Art X"
                value={disc.coverArtX ?? 50}
                min={0}
                max={100}
                step={1}
                onChange={(coverArtX) => patchDisc({ coverArtX })}
                format={(v) => `${Math.round(v)}%`}
              />
              <SliderRow
                label="Art Y"
                value={disc.coverArtY ?? 50}
                min={0}
                max={100}
                step={1}
                onChange={(coverArtY) => patchDisc({ coverArtY })}
                format={(v) => `${Math.round(v)}%`}
              />
              <p className="text-[11px] leading-snug text-zinc-600">
                Art zoom / X / Y adjust the picture inside the square — the
                frame itself stays put.
              </p>
            </div>
          ) : null}
        </>
      ) : null}

      {/* Spinning disc */}
      <div className="flex h-8 items-center gap-2">
        <MicroLabel className="flex-1">Spinning disc</MicroLabel>
        <Switch
          aria-label="Show spinning disc"
          checked={disc.showDisc}
          onCheckedChange={(showDisc) => patchDisc({ showDisc })}
        />
      </div>
      {disc.showDisc ? (
        <>
          <div className="space-y-1.5">
            <MicroLabel>Disc face</MicroLabel>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
              {(
                [
                  { id: 'label', label: 'Vinyl label' },
                  { id: 'full', label: 'Full CD' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={disc.mode === m.id}
                  onClick={() => patchDisc({ mode: m.id })}
                  className={cn(
                    'h-7 rounded-md text-xs transition-colors',
                    disc.mode === m.id
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-snug text-zinc-600">
              {disc.mode === 'label'
                ? 'Vinyl: art on the center label, grooved black record around it.'
                : 'CD: art across the whole face with a punched center hole.'}
            </p>
          </div>
          <SliderRow
            label="Disc size"
            value={disc.discSize}
            min={10}
            max={90}
            step={1}
            onChange={(discSize) => patchDisc({ discSize })}
            format={(v) => `${Math.round(v)}%`}
          />
          <SliderRow
            label="Disc X"
            value={disc.discX}
            min={0}
            max={100}
            step={1}
            onChange={(discX) => patchDisc({ discX })}
            format={(v) => `${Math.round(v)}%`}
          />
          <SliderRow
            label="Disc Y"
            value={disc.discY}
            min={0}
            max={100}
            step={1}
            onChange={(discY) => patchDisc({ discY })}
            format={(v) => `${Math.round(v)}%`}
          />
          {disc.imageSrc ? (
            <div className="space-y-1">
              <SliderRow
                label="Art zoom"
                value={disc.discArtZoom ?? 1}
                min={1}
                max={3}
                step={0.05}
                onChange={(discArtZoom) => patchDisc({ discArtZoom })}
                format={(v) => `${v.toFixed(2)}×`}
              />
              <SliderRow
                label="Art X"
                value={disc.discArtX ?? 50}
                min={0}
                max={100}
                step={1}
                onChange={(discArtX) => patchDisc({ discArtX })}
                format={(v) => `${Math.round(v)}%`}
              />
              <SliderRow
                label="Art Y"
                value={disc.discArtY ?? 50}
                min={0}
                max={100}
                step={1}
                onChange={(discArtY) => patchDisc({ discArtY })}
                format={(v) => `${Math.round(v)}%`}
              />
              <p className="text-[11px] leading-snug text-zinc-600">
                Zooms and slides the art on the {disc.mode === 'label' ? 'center label' : 'CD face'}
                {' '}— it keeps spinning with the record.
              </p>
            </div>
          ) : null}
          <SliderRow
            label="Spin speed"
            value={disc.rpm}
            min={0}
            max={120}
            step={0.5}
            onChange={(rpm) => patchDisc({ rpm })}
            format={(v) => `${v.toFixed(1)} RPM`}
          />
          <div className="grid grid-cols-3 gap-1">
            {RPM_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                aria-label={`Set spin speed to ${p.value === 0 ? 'stop' : `${p.label} RPM`}`}
                aria-pressed={Math.abs(disc.rpm - p.value) < 0.01}
                onClick={() => patchDisc({ rpm: p.value })}
                className={cn(
                  'h-7 rounded-md border text-xs transition-colors',
                  Math.abs(disc.rpm - p.value) < 0.01
                    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                    : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <MicroLabel>Direction</MicroLabel>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
              <button
                type="button"
                aria-pressed={disc.direction === 1}
                onClick={() => patchDisc({ direction: 1 })}
                className={cn(
                  'flex h-7 items-center justify-center gap-1.5 rounded-md text-xs transition-colors',
                  disc.direction === 1
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'text-zinc-400 hover:text-zinc-200',
                )}
              >
                <RotateCw className="size-3.5" aria-hidden />
                Clockwise
              </button>
              <button
                type="button"
                aria-pressed={disc.direction === -1}
                onClick={() => patchDisc({ direction: -1 })}
                className={cn(
                  'flex h-7 items-center justify-center gap-1.5 rounded-md text-xs transition-colors',
                  disc.direction === -1
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'text-zinc-400 hover:text-zinc-200',
                )}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Counter
              </button>
            </div>
          </div>
          <SliderRow
            label="Pulse with music"
            value={disc.pulse}
            min={0}
            max={1}
            step={0.05}
            onChange={(pulse) => patchDisc({ pulse })}
            format={(v) => (v <= 0 ? 'Off' : `+${Math.round(v * 100)}%`)}
          />
          {disc.mode === 'label' ? (
            <div className="flex h-7 items-center justify-between">
              <MicroLabel>Grooves</MicroLabel>
              <Switch
                aria-label="Vinyl groove rings"
                checked={disc.grooves}
                onCheckedChange={(grooves) => patchDisc({ grooves })}
              />
            </div>
          ) : null}
          <SliderRow
            label="Sheen"
            value={disc.sheen}
            min={0}
            max={1}
            step={0.05}
            onChange={(sheen) => patchDisc({ sheen })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </>
      ) : null}
    </section>
  )
}
