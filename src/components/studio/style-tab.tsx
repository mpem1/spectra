'use client'

import { useState } from 'react'
import { AudioWaveform, BarChart3, Droplet, Grid3x3, Mountain, Move3d, Orbit, Radar, Sparkles, Wand2, Waves, Loader2 } from 'lucide-react'
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
        visualizer.style === 'sphere' ? (
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
              Echo trails redraw where each bar stood a moment ago. Mirror slides
              a faded reflection out from under the road (Mirror offset moves its
              water line); Center aims the vanishing point dead ahead.
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
              Mirror lays a faded lake reflection (Mirror offset slides its
              water line lower), Center grows the range both ways with its
              own hills below.
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
        {(visualizer.style !== 'ribbon' && visualizer.style !== 'terrain' && visualizer.style !== 'sphere') ? (
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

        {visualizer.style === 'sphere' ? (
          // The planet reads best as one clean orb — its mirrored twin just
          // doubled the dots into mush, so the sphere keeps no Mirror
          // choice — just the glow switch. Every other style (including the
          // road and the terrain) answers the full Mirror family below.
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

        {/* Reflection offset: the lake (terrain) and road (perspective)
            reflections fold right at the ground / hide under the road by
            default; this dial slides the water line lower, detaching the
            mirrored copy down the screen. Center mode pins its own fold to
            the ground, so the dial only answers Mirror. */}
        {visualizer.mirror === 'mirror' &&
        (visualizer.style === 'terrain' || visualizer.style === 'perspective') ? (
          <SliderRow
            label="Mirror offset"
            value={visualizer.style === 'terrain' ? visualizer.terrainMirrorDrop : visualizer.perspMirrorDrop}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) =>
              patchVisualizer(
                visualizer.style === 'terrain' ? { terrainMirrorDrop: v } : { perspMirrorDrop: v },
              )
            }
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
