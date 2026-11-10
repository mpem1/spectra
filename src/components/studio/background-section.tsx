'use client'

import { useRef } from 'react'
import {
  Blend,
  Clapperboard,
  FlipHorizontal2,
  FlipVertical2,
  Grid3x3,
  ImagePlus,
  ImageIcon,
  Palette,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { BackgroundMode } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { GradientEditor } from '@/components/studio/gradient-editor'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { parseColor, toHex6 } from '@/components/studio/color-utils'
import { MicroLabel, OptionCard, SECTION_ACCENT, SliderRow, ToggleRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'
import {
  forgetAnimatedBackground,
  isGifSrc,
  warmGif,
} from '@/lib/visualizer/animated-bg'

const MODES: { id: BackgroundMode; label: string; icon: typeof Palette }[] = [
  { id: 'solid', label: 'Solid', icon: Palette },
  { id: 'gradient', label: 'Gradient', icon: Blend },
  { id: 'image', label: 'Image', icon: ImageIcon },
  { id: 'video', label: 'Video', icon: Clapperboard },
  { id: 'transparent', label: 'Alpha', icon: Grid3x3 },
]

/** Read a File into a data URL (for the canvas + project persistence). */
function fileToDataUrl(file: File, kind = 'image'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(`Could not read the ${kind} file`))
    reader.readAsDataURL(file)
  })
}

/**
 * Controls shared by the image and video/GIF backgrounds: shade fader, zoom,
 * media blur, mirror flips and the reset button.
 */
function MediaBackgroundControls() {
  const background = useStudioStore((s) => s.config.background)
  const patchBackground = useStudioStore((s) => s.patchBackground)

  const transformDirty =
    Math.abs(background.x) > 0.001 ||
    Math.abs(background.y) > 0.001 ||
    Math.abs(background.scale - 1) > 0.001

  return (
    <>
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
      <SliderRow
        label="Blur"
        value={background.blur}
        min={0}
        max={1}
        step={0.05}
        onChange={(blur) => patchBackground({ blur })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      {/* Beat motion — zoom / shake / blur swell, all driven by the bass */}
      <section className="space-y-1.5">
        <MicroLabel>With the beat</MicroLabel>
        <SliderRow
          label="Beat bounce"
          value={background.pulse}
          min={0}
          max={1}
          step={0.05}
          onChange={(pulse) => patchBackground({ pulse })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <SliderRow
          label="Beat shake"
          value={background.shake}
          min={0}
          max={1}
          step={0.05}
          onChange={(shake) => patchBackground({ shake })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <SliderRow
          label="Blur pulse"
          value={background.blurPulse}
          min={0}
          max={1}
          step={0.05}
          onChange={(blurPulse) => patchBackground({ blurPulse })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <ToggleRow
          label="Flip on kick"
          checked={!!background.beatFlip}
          onCheckedChange={(beatFlip) => patchBackground({ beatFlip })}
        />
        {background.beatFlip ? (
          <>
            <SliderRow
              label="Kick sensitivity"
              value={background.flipSensitivity ?? 0.1}
              min={0}
              max={1}
              step={0.05}
              onChange={(flipSensitivity) => patchBackground({ flipSensitivity })}
              format={(v) =>
                v <= 0.025 ? 'Slams only' : v >= 0.975 ? 'Every hit' : `${Math.round(v * 100)}%`
              }
            />
            <SliderRow
              label="Flip hold"
              value={background.flipHold ?? 0.2}
              min={0}
              max={1}
              step={0.05}
              onChange={(flipHold) => patchBackground({ flipHold })}
              format={(v) => (v < 0.025 ? 'Quick flash' : `${(v * 2).toFixed(1)}s`)}
            />
            <p className="text-[10px] leading-snug text-zinc-600">
              On every detected kick the picture mirrors — like Flip horizontal
              for a moment — holds for Flip hold, then dissolves back to the
              resting picture. Same kick detector as the halftone print and
              3D glasses flips (each card keeps its own dials): lower
              sensitivity = only the hardest slams, higher = every tap.
            </p>
          </>
        ) : null}
      </section>
      {/* Mirror toggles — compose to none / H / V / both */}
      <section className="space-y-1.5">
        <MicroLabel>Mirror</MicroLabel>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={background.flipX}
            onClick={() => patchBackground({ flipX: !background.flipX })}
            className={cn(
              'flex h-11 items-center justify-center gap-2 rounded-lg border text-xs font-medium transition-colors',
              background.flipX
                ? 'border-emerald-400 bg-emerald-500 text-zinc-950'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100',
            )}
          >
            <FlipHorizontal2 className="size-4" aria-hidden />
            Flip horizontal
          </button>
          <button
            type="button"
            aria-pressed={background.flipY}
            onClick={() => patchBackground({ flipY: !background.flipY })}
            className={cn(
              'flex h-11 items-center justify-center gap-2 rounded-lg border text-xs font-medium transition-colors',
              background.flipY
                ? 'border-emerald-400 bg-emerald-500 text-zinc-950'
                : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100',
            )}
          >
            <FlipVertical2 className="size-4" aria-hidden />
            Flip vertical
          </button>
        </div>
      </section>
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
    </>
  )
}

/**
 * Image background: upload a PNG/JPG, preview it, and dial in the shade /
 * blur / zoom controls. GIF uploads are routed to the Video mode, where they
 * are decoded into deterministic frames (exports stay frame-exact).
 */
function ImageBackgroundSection() {
  const background = useStudioStore((s) => s.config.background)
  const patchBackground = useStudioStore((s) => s.patchBackground)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      if (file.type === 'image/gif') {
        // Animated GIFs belong in the deterministic Video/GIF pipeline.
        const videoSrc = await fileToDataUrl(file)
        forgetAnimatedBackground(background.videoSrc)
        warmGif(videoSrc)
        patchBackground({ mode: 'video', videoSrc })
        toast.info('Animated GIF set as background', {
          description: 'GIFs use the Video background mode so exports stay frame-exact.',
        })
        return
      }
      if (!file.type.startsWith('image/')) return
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

      <MediaBackgroundControls />

      <p className="text-[11px] leading-snug text-zinc-500">
        On the preview: drag the image to move it, drag the corner handle or
        scroll to zoom. The shade fader darkens the image so the visualizer
        and lyrics stay readable. Animated GIFs are sent to the Video mode.
      </p>
    </section>
  )
}

/**
 * Video / GIF background: upload an MP4/WebM/MOV clip or an animated GIF.
 * Videos loop muted on the wall clock (and are seeked frame-by-frame in
 * deterministic exports); GIFs are decoded once into frame canvases so both
 * preview and export pick frames by song time — pixel-identical.
 */
function VideoBackgroundSection() {
  const background = useStudioStore((s) => s.config.background)
  const patchBackground = useStudioStore((s) => s.patchBackground)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const MAX_VIDEO_BYTES = 120 * 1024 * 1024 // data URLs live in memory + IndexedDB

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      if (file.type === 'image/gif') {
        const videoSrc = await fileToDataUrl(file, 'GIF')
        forgetAnimatedBackground(background.videoSrc)
        warmGif(videoSrc)
        patchBackground({ mode: 'video', videoSrc })
        return
      }
      if (!file.type.startsWith('video/')) return
      if (file.size > MAX_VIDEO_BYTES) {
        toast.error('Video is too large', {
          description: 'Keep background clips under ~120 MB — a short loop is plenty.',
        })
        return
      }
      const videoSrc = await fileToDataUrl(file, 'video')
      forgetAnimatedBackground(background.videoSrc)
      patchBackground({ mode: 'video', videoSrc })
    } catch {
      // Reading failed — keep the previous background.
    }
  }

  const remove = () => {
    forgetAnimatedBackground(background.videoSrc)
    patchBackground({ videoSrc: '' })
  }

  return (
    <section className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,image/gif"
        className="hidden"
        aria-label="Background video or GIF file"
        onChange={(e) => {
          void handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      {background.videoSrc ? (
        <div className="space-y-2">
          {isGifSrc(background.videoSrc) ? (
            <img
              src={background.videoSrc}
              alt="Background GIF preview"
              className="h-24 w-full rounded-lg border border-zinc-800 object-cover"
            />
          ) : (
            <video
              src={background.videoSrc}
              muted
              loop
              autoPlay
              playsInline
              className="h-24 w-full rounded-lg border border-zinc-800 object-cover"
            />
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 flex-1 border-zinc-800 text-xs text-zinc-300 hover:border-zinc-600"
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus className="size-3.5" aria-hidden />
              Replace
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-zinc-500 hover:text-red-400"
              aria-label="Remove background video"
              onClick={remove}
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
          <Clapperboard className="size-5" aria-hidden />
          <span className="text-xs font-medium">Upload MP4 / WebM / GIF</span>
          <span className="text-[10px] text-zinc-600">a short loop is all you need</span>
        </button>
      )}

      <MediaBackgroundControls />

      <p className="text-[11px] leading-snug text-zinc-500">
        The clip loops automatically and stays muted behind your track. Videos
        loop in real time; GIFs are decoded into frames so the exported MP4 is
        frame-exact. The shade fader keeps the visualizer readable.
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
    <div className={sectionShell('rose', 'space-y-4')}>
      <span className={cn('text-[11px] font-medium uppercase tracking-widest', SECTION_ACCENT.rose.label)}>
        BACKGROUND
      </span>

      {/* Mode */}
      <section className="space-y-2">
        <div className="grid grid-cols-5 gap-2">
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

      {/* Video / GIF background */}
      {background.mode === 'video' ? (
        <VideoBackgroundSection />
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
