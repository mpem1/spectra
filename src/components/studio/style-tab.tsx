'use client'

import { useRef, useState } from 'react'
import { AudioWaveform, BarChart3, Disc3, Droplet, Grid3x3, ImagePlus, Loader2, Mountain, Move3d, Orbit, Radar, Sparkles, Trash2, Wand2, Waves } from 'lucide-react'
import { toast } from 'sonner'
import type { VisualizerStyle } from '@/lib/visualizer/types'
import { extractPaletteFromArt } from '@/lib/visualizer/palette'
import { useStudioStore } from '@/store/studio'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { GradientEditor } from '@/components/studio/gradient-editor'
import { BackgroundSection } from '@/components/studio/background-section'
import { VinylSection } from '@/components/studio/vinyl-section'
import { WatermarkSection } from '@/components/studio/watermark-section'
import { PulseImageSection } from '@/components/studio/pulse-image-section'
import { MicroLabel, OptionCard, SECTION_ACCENT, SliderRow, sectionShell, type SectionAccent } from '@/components/studio/controls'
import { ColorPickerButton } from '@/components/studio/color-picker'

const STYLES: { id: VisualizerStyle; label: string; icon: typeof BarChart3 }[] = [
  { id: 'bars', label: 'Bars', icon: BarChart3 },
  { id: 'wave', label: 'Wave', icon: AudioWaveform },
  { id: 'radial', label: 'Radial', icon: Radar },
  { id: 'particles', label: 'Particles', icon: Sparkles },
  { id: 'blob', label: 'Blob', icon: Droplet },
  { id: 'grid', label: 'Grid', icon: Grid3x3 },
  { id: 'ribbon', label: 'Ribbon', icon: Waves },
  { id: 'perspective', label: 'Perspective', icon: Move3d },
  { id: 'terrain', label: 'Terrain', icon: Mountain },
  { id: 'sphere', label: 'Sphere', icon: Orbit },
  { id: 'serato', label: 'Serato', icon: Disc3 },
  { id: 'imgviz', label: 'Image', icon: ImagePlus },
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
  const imageInputRef = useRef<HTMLInputElement>(null)

  const handleImageFile = (file: File | undefined): void => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('That file is not an image')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      patchVisualizer({ imgvizSrc: String(reader.result) })
      toast.success('Image set — press play and watch it light up')
    }
    reader.onerror = () => toast.error('Could not read that image')
    reader.readAsDataURL(file)
  }

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
        {/* Transparency — fade the whole visualizer layer into the background */}
        <SliderRow
          label="Transparency"
          value={visualizer.transparency}
          min={0}
          max={1}
          step={0.05}
          onChange={(transparency) => patchVisualizer({ transparency })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <p className="text-xs leading-relaxed text-zinc-500">
          See-through the bars: 0% is the solid classic look, 100% fades the whole
          visualizer into the background behind it.
        </p>
      </section>

      {/* Image visualizer — the custom PNG style's own card. It sits right
          under the style grid (previously buried inside "Shape & motion",
          where nobody could tell the controls belonged to this style). */}
      {visualizer.style === 'imgviz' ? (
        <section className={sectionShell('rose', 'space-y-2')}>
          <SectionLabel accent="rose">IMAGE VISUALIZER</SectionLabel>
          <p className="text-xs leading-relaxed text-zinc-500">
            Your PNG is the visualizer — everything below belongs to it: what
            fills its shape, how its edges glow and how it sparks.
          </p>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/webp,image/jpeg,image/svg+xml"
            className="hidden"
            aria-label="Image visualizer file"
            onChange={(e) => {
              handleImageFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          {visualizer.imgvizSrc ? (
            <div className="space-y-2">
              <img
                src={visualizer.imgvizSrc}
                alt="Image visualizer artwork preview"
                className="h-16 w-full rounded-lg border border-zinc-800 bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:16px_16px] object-contain p-1"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 flex-1 border-zinc-800 text-xs text-zinc-300 hover:border-zinc-600"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <ImagePlus className="size-3.5" aria-hidden />
                  Replace image
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-zinc-500 hover:text-red-400"
                  aria-label="Remove image visualizer artwork"
                  onClick={() => patchVisualizer({ imgvizSrc: '' })}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="flex h-16 w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 text-zinc-400 transition-colors hover:border-rose-500/60 hover:text-rose-400"
              onClick={() => imageInputRef.current?.click()}
            >
              <ImagePlus className="size-4" aria-hidden />
              <span className="text-xs font-medium">Upload your PNG</span>
            </button>
          )}
          <SliderRow
            label="Artwork size"
            value={visualizer.imgvizSize}
            min={15}
            max={100}
            step={1}
            onChange={(imgvizSize) => patchVisualizer({ imgvizSize })}
            format={(v) => `${Math.round(v)}%`}
          />
          <SliderRow
            label="Artwork dim"
            value={visualizer.imgvizDim}
            min={0}
            max={1}
            step={0.05}
            onChange={(imgvizDim) => patchVisualizer({ imgvizDim })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <div className="flex h-8 items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5">
            <MicroLabel>React to music</MicroLabel>
            <Switch
              aria-label="Toggle music motion"
              checked={visualizer.imgvizMotion}
              onCheckedChange={(imgvizMotion) => patchVisualizer({ imgvizMotion })}
            />
          </div>
          {visualizer.imgvizMotion ? (
            <SliderRow
              label="Motion amount"
              value={visualizer.imgvizMotionAmount}
              min={0}
              max={1}
              step={0.05}
              onChange={(imgvizMotionAmount) => patchVisualizer({ imgvizMotionAmount })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          ) : null}
          <div className="space-y-1.5">
            <MicroLabel>Inner visualizer</MicroLabel>
            <div className="grid grid-cols-4 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
              {(
                [
                  { id: 'bars', label: 'Bars' },
                  { id: 'wave', label: 'Wave' },
                  { id: 'radial', label: 'Radial' },
                  { id: 'particles', label: 'Dots' },
                  { id: 'blob', label: 'Blob' },
                  { id: 'grid', label: 'Grid' },
                  { id: 'ribbon', label: 'Ribbon' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={visualizer.imgvizInner === m.id}
                  onClick={() => patchVisualizer({ imgvizInner: m.id })}
                  className={cn(
                    'h-7 rounded-md text-[11px] transition-colors',
                    visualizer.imgvizInner === m.id
                      ? 'bg-emerald-500 font-medium text-zinc-950'
                      : 'text-zinc-300 hover:text-zinc-100',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <SliderRow
            label="Inner gain"
            value={visualizer.imgvizInnerGain}
            min={0.2}
            max={2}
            step={0.05}
            onChange={(imgvizInnerGain) => patchVisualizer({ imgvizInnerGain })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderRow
            label="Inner X"
            value={visualizer.imgvizInnerX}
            min={0}
            max={100}
            step={1}
            onChange={(imgvizInnerX) => patchVisualizer({ imgvizInnerX })}
            format={(v) => `${Math.round(v)}%`}
          />
          <SliderRow
            label="Inner Y"
            value={visualizer.imgvizInnerY}
            min={0}
            max={100}
            step={1}
            onChange={(imgvizInnerY) => patchVisualizer({ imgvizInnerY })}
            format={(v) => `${Math.round(v)}%`}
          />
          <div className="flex h-8 items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5">
            <MicroLabel>Glowing edges</MicroLabel>
            <Switch
              aria-label="Toggle glowing edges"
              checked={visualizer.imgvizGlow}
              onCheckedChange={(imgvizGlow) => patchVisualizer({ imgvizGlow })}
            />
          </div>
          {visualizer.imgvizGlow ? (
            <>
              <div className="space-y-1.5">
                <div className="flex h-5 items-center justify-between">
                  <MicroLabel>Glow color</MicroLabel>
                  {visualizer.imgvizGlowMode === 'custom' ? (
                    <ColorPickerButton
                      value={visualizer.imgvizGlowColor}
                      onChange={(imgvizGlowColor) => patchVisualizer({ imgvizGlowColor })}
                      showAlpha
                      ariaLabel="Glow color"
                    />
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
                  {(
                    [
                      { id: 'palette', label: 'Match scene' },
                      { id: 'custom', label: 'Custom' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={visualizer.imgvizGlowMode === m.id}
                      onClick={() => patchVisualizer({ imgvizGlowMode: m.id })}
                      className={cn(
                        'h-7 rounded-md text-xs transition-colors',
                        visualizer.imgvizGlowMode === m.id
                          ? 'bg-emerald-500 font-medium text-zinc-950'
                          : 'text-zinc-300 hover:text-zinc-100',
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <SliderRow
                label="Glow strength"
                value={visualizer.imgvizGlowStrength}
                min={0}
                max={1}
                step={0.05}
                onChange={(imgvizGlowStrength) => patchVisualizer({ imgvizGlowStrength })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </>
          ) : null}
          <div className="flex h-8 items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5">
            <MicroLabel>Electricity</MicroLabel>
            <Switch
              aria-label="Toggle electricity"
              checked={visualizer.imgvizBolt}
              onCheckedChange={(imgvizBolt) => patchVisualizer({ imgvizBolt })}
            />
          </div>
          {visualizer.imgvizBolt ? (
            <>
              <div className="space-y-1.5">
                <div className="flex h-5 items-center justify-between">
                  <MicroLabel>Bolt color</MicroLabel>
                  {visualizer.imgvizBoltMode === 'custom' ? (
                    <ColorPickerButton
                      value={visualizer.imgvizBoltColor}
                      onChange={(imgvizBoltColor) => patchVisualizer({ imgvizBoltColor })}
                      showAlpha
                      ariaLabel="Bolt color"
                    />
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
                  {(
                    [
                      { id: 'palette', label: 'Match scene' },
                      { id: 'custom', label: 'Custom' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={visualizer.imgvizBoltMode === m.id}
                      onClick={() => patchVisualizer({ imgvizBoltMode: m.id })}
                      className={cn(
                        'h-7 rounded-md text-xs transition-colors',
                        visualizer.imgvizBoltMode === m.id
                          ? 'bg-emerald-500 font-medium text-zinc-950'
                          : 'text-zinc-300 hover:text-zinc-100',
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <SliderRow
                label="Bolt density"
                value={visualizer.imgvizBoltDensity}
                min={0}
                max={1}
                step={0.05}
                onChange={(imgvizBoltDensity) => patchVisualizer({ imgvizBoltDensity })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <SliderRow
                label="Bolt reach"
                value={visualizer.imgvizBoltLength}
                min={0.3}
                max={2}
                step={0.05}
                onChange={(imgvizBoltLength) => patchVisualizer({ imgvizBoltLength })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </>
          ) : null}
          <p className="text-xs leading-relaxed text-zinc-500">
            The inner visualizer is one of the seven real styles, clipped to
            your PNG&apos;s own shape (Dots = Particles; Bar count, Roundness
            and Gap in Shape &amp; motion below dress the inner bars). Glowing
            edges tint and bloom the artwork&apos;s exact contour with the
            beat; Electricity throws branching lightning with sparks crawling
            along the edge; React to music swells and drifts the artwork —
            switch it off to pin it perfectly still. PNG with transparency
            works best; the Layout section moves and resizes the whole layer.
          </p>
        </section>
      ) : null}

      {/* Gradient — the perspective style keeps its own strict two-color
          split (Up / Down pickers above), so the palette editor would sit
          there doing nothing. Terrain DOES use the palette — it sweeps it
          across the landscape's columns. */}
      {visualizer.style !== 'perspective' ? (
        <section className={sectionShell('violet', 'space-y-2')}>
          <div className="flex items-center justify-between">
            <SectionLabel accent="violet">GRADIENT</SectionLabel>
            <AutoPaletteButton />
          </div>
          <GradientEditor value={visualizer.gradient} onChange={patchGradient} />
        </section>
      ) : null}

      {/* Shape & motion */}
      <section className={sectionShell('amber')}>
        <SectionLabel accent="amber">SHAPE &amp; MOTION</SectionLabel>

        {/* The Image style's own card (artwork + effects) sits right under
            the style grid — this section only keeps the shared dials that
            tune the visualizer inside the PNG. */}
        {visualizer.style === 'imgviz' ? (
          <p className="text-xs leading-relaxed text-zinc-500">
            These tune the visualizer inside your PNG: Bar count and Smoothing
            shape the spectrum, Sensitivity its punch, Roundness and Gap the
            bars. The artwork itself, its glow and its electricity live in the
            Image visualizer card near the top.
          </p>
        ) : null}

        {/* Orientation — the long strip styles can run left→right or top→bottom
            (the perspective road rotates with them: vertical points its
            vanishing at the top edge, near pills at the bottom — the terrain
            landscape rotates the same way, horizon turning vertical — and
            the sphere quarter-rolls its whole axis into the horizontal) */}
        {visualizer.style === 'bars' ||
        visualizer.style === 'wave' ||
        visualizer.style === 'grid' ||
        visualizer.style === 'ribbon' ||
        visualizer.style === 'perspective' ||
        visualizer.style === 'terrain' ||
        visualizer.style === 'sphere' ||
        visualizer.style === 'serato' ? (
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
            {/* Side — vertical strips can hang from either edge (the sphere
                has no edges to hang from, so it skips this choice) */}
            {visualizer.orientation === 'vertical' && visualizer.style !== 'sphere' ? (
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

        {visualizer.style !== 'serato' ? (
          <>
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
          </>
        ) : null}
        {(visualizer.style === 'perspective' || visualizer.style === 'terrain') ? (
          <>
            {/* Horizon line height — where the road's up/down halves meet
                (perspective) or where the terrain's vanishing line sits
                (terrain) */}
            <SliderRow
              label="Horizon"
              value={visualizer.mirrorOffset}
              min={0.1}
              max={0.9}
              step={0.01}
              onChange={(mirrorOffset) => patchVisualizer({ mirrorOffset })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SliderRow
              label="Flow speed"
              value={visualizer.flowSpeed}
              min={0}
              max={1}
              step={0.05}
              onChange={(flowSpeed) => patchVisualizer({ flowSpeed })}
              format={(v) => v.toFixed(2)}
            />
          </>
        ) : null}

        {/* Perspective — the reference look's own colors & LED dressing */}
        {visualizer.style === 'perspective' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <MicroLabel>Up color</MicroLabel>
                <div className="flex h-8 items-center">
                  <ColorPickerButton
                    value={visualizer.perspUp}
                    onChange={(perspUp) => patchVisualizer({ perspUp })}
                    ariaLabel="Up side color"
                  />
                  <span className="ml-2 truncate text-xs text-zinc-500">above the line</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <MicroLabel>Down color</MicroLabel>
                <div className="flex h-8 items-center">
                  <ColorPickerButton
                    value={visualizer.perspDown}
                    onChange={(perspDown) => patchVisualizer({ perspDown })}
                    ariaLabel="Down side color"
                  />
                  <span className="ml-2 truncate text-xs text-zinc-500">below the line</span>
                </div>
              </div>
            </div>
            <SliderRow
              label="LED texture"
              value={visualizer.perspTexture}
              min={0}
              max={1}
              step={0.05}
              onChange={(perspTexture) => patchVisualizer({ perspTexture })}
              format={(v) => v.toFixed(2)}
            />
            <SliderRow
              label="Echo trails"
              value={visualizer.perspEcho}
              min={0}
              max={1}
              step={0.05}
              onChange={(perspEcho) => patchVisualizer({ perspEcho })}
              format={(v) => v.toFixed(2)}
            />
            <p className="text-xs leading-relaxed text-zinc-500">
              The reference look: red bars above the line, blue below, streaming
              out of a vanishing point on the right while heights ride the music.
              Echo trails redraw where each bar stood a moment ago. Mirror lays
              a faded twin under the road — the bars&apos; exact 1:1 flip across
              the water line (Mirror offset moves that line lower); Center
              converges a twin tunnel dead ahead.
            </p>
          </>
        ) : null}

        {/* Terrain — the 3D landscape's own dressing */}
        {visualizer.style === 'terrain' ? (
          <>
            <SliderRow
              label="Fill"
              value={visualizer.terrainFill}
              min={0}
              max={1}
              step={0.05}
              onChange={(terrainFill) => patchVisualizer({ terrainFill })}
              format={(v) => v.toFixed(2)}
            />
            <p className="text-xs leading-relaxed text-zinc-500">
              A 3D landscape of spectrum ridges rolling toward the camera —
              rows bunch at the horizon, bass lifts the near hills, and the
              surface streams forward with Flow speed. The palette sweeps
              across the columns; Fill 0 is the pure glowing wireframe;
              Mirror pulls the range onto a shore with a faded lake below —
              Mirror offset slides the lake on its own axis while the range
              stays put: positive sinks the water line below the shore,
              negative raises it into the range (high water — the foothills
              submerge and dim). The reflection is always the range&apos;s
              exact 1:1 flip. Center grows the range both ways with its own
              hills below (Spread dials their depth). Zero is always the
              factory look.
            </p>
          </>
        ) : null}
        {/* Sphere — the 3D planet's own dressing */}
        {visualizer.style === 'sphere' ? (
          <>
            <SliderRow
              label="Spin"
              value={visualizer.sphereSpin}
              min={0}
              max={1}
              step={0.05}
              onChange={(sphereSpin) => patchVisualizer({ sphereSpin })}
              format={(v) => v.toFixed(2)}
            />
            <SliderRow
              label="Quills"
              value={visualizer.sphereQuills}
              min={0}
              max={1}
              step={0.05}
              onChange={(sphereQuills) => patchVisualizer({ sphereQuills })}
              format={(v) => v.toFixed(2)}
            />
            <p className="text-xs leading-relaxed text-zinc-500">
              A 3D planet of dots spinning on a tilted axis — every latitude
              rides its own frequency band, so the bass equator surges while
              the poles crackle with treble, and the back hemisphere prints
              dim for the depth. Quills grows the audio spikes; Spin sets the
              rotation; Vertical rolls the axis sideways. The palette
              sweeps pole to pole.
            </p>
          </>
        ) : null}
        {/* Serato — the turntable strip's own dressing */}
        {visualizer.style === 'serato' ? (
          <>
            <SliderRow
              label="Zoom"
              value={visualizer.seratoWindow}
              min={4}
              max={30}
              step={1}
              onChange={(seratoWindow) => patchVisualizer({ seratoWindow })}
              format={(v) => `${Math.round(v)}s window`}
            />
            <SliderRow
              label="Strip height"
              value={visualizer.seratoHeight}
              min={0.3}
              max={1}
              step={0.02}
              onChange={(seratoHeight) => patchVisualizer({ seratoHeight })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <div className="space-y-1.5">
              <MicroLabel>Colors</MicroLabel>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
                {(
                  [
                    { id: 'rainbow', label: 'Rainbow' },
                    { id: 'palette', label: 'Palette' },
                    { id: 'solid', label: 'Solid' },
                  ] as const
                ).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={visualizer.seratoColors === c.id}
                    onClick={() => patchVisualizer({ seratoColors: c.id })}
                    className={cn(
                      'h-7 rounded-md text-xs transition-colors',
                      visualizer.seratoColors === c.id
                        ? 'bg-emerald-500 font-medium text-zinc-950'
                        : 'text-zinc-300 hover:text-zinc-100',
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs leading-relaxed text-zinc-500">
              The DJ deck wave: your whole track scrolls under a fixed needle
              dead center — past on the left, what&apos;s coming on the right.
              Rainbow colors passages by their own frequency content (bassy
              parts green, crisp parts pink) like the turntables do; Palette
              sweeps your gradient across the strip; Solid paints one color.
              Zoom sets how many seconds the window shows. Needs a loaded
              track — the envelope is computed from your audio the moment the
              style draws.
            </p>
          </>
        ) : null}

        <SliderRow
          label="Sensitivity"
          value={visualizer.sensitivity}
          min={0.1}
          max={3}
          step={0.1}
          onChange={(sensitivity) => patchVisualizer({ sensitivity })}
          format={(v) => v.toFixed(1)}
        />
        {(visualizer.style !== 'ribbon' && visualizer.style !== 'terrain' && visualizer.style !== 'sphere') ? (
          <SliderRow
            label="Roundness"
            value={visualizer.roundness}
            min={0}
            max={1}
            step={0.05}
            onChange={(roundness) => patchVisualizer({ roundness })}
            format={(v) => v.toFixed(2)}
          />
        ) : null}
        {(visualizer.style !== 'ribbon' &&
          visualizer.style !== 'terrain' &&
          visualizer.style !== 'sphere' &&
          visualizer.style !== 'serato') ? (
          <SliderRow
            label="Gap"
            value={visualizer.gap}
            min={0}
            max={0.8}
            step={0.05}
            onChange={(gap) => patchVisualizer({ gap })}
            format={(v) => v.toFixed(2)}
          />
        ) : null}

        {visualizer.style === 'sphere' || visualizer.style === 'serato' || visualizer.style === 'imgviz' ? (
          // The planet reads best as one clean orb — its mirrored twin just
          // doubled the dots into mush, so the sphere keeps no Mirror choice.
          // The Serato strip is already symmetric around its needle, and the
          // deck wave has no twin either. The image style is one freeform
          // artwork — glow switch only. Every other style answers the full
          // Mirror family below.
          <div className="space-y-1.5 pt-1">
            <MicroLabel>Glow</MicroLabel>
            <div className="flex h-8 items-center justify-end">
              <Switch
                aria-label="Toggle glow"
                checked={visualizer.glow}
                onCheckedChange={(glow) => patchVisualizer({ glow })}
              />
            </div>
          </div>
        ) : (
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
        )}

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

        {/* Terrain's dial answers both mirror modes, signed both ways from
            the factory look at 0: Mirror offset slides ONLY the lake on its
            own axis — the range stays planted on its shore. Positive sinks
            the water line toward the bottom edge, negative raises it into
            the range (high water). The reflection is always the exact 1:1
            flip of the land above the line. Spread scales how deep the
            Center underside grows. Perspective's road reflection keeps its
            own one-way water line under the road. */}
        {visualizer.style === 'terrain' && visualizer.mirror !== 'none' ? (
          <SliderRow
            label={visualizer.mirror === 'mirror' ? 'Mirror offset' : 'Spread'}
            value={visualizer.terrainMirrorDrop}
            min={-1}
            max={1}
            step={0.01}
            onChange={(terrainMirrorDrop) => patchVisualizer({ terrainMirrorDrop })}
            format={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`}
          />
        ) : null}

        {visualizer.mirror === 'mirror' && visualizer.style === 'perspective' ? (
          <SliderRow
            label="Mirror offset"
            value={visualizer.perspMirrorDrop}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => patchVisualizer({ perspMirrorDrop: v })}
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
