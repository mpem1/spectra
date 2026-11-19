'use client'

import { Grip } from 'lucide-react'
import type { DitherFilterConfig } from '@/lib/visualizer/types'
import {
  MACPAINT_DEFAULT_PATTERNS,
  MACPAINT_PATTERN_BITS,
  MACPAINT_PATTERN_DENSITY,
  MACPAINT_SLOT_COUNT,
} from '@/lib/visualizer/dither-filter'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { MicroLabel, BeatPunchRow, SliderRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

/** One swatch per MacPaint bitmap pattern — rendered from the engine's own
 *  bit table as an inline SVG data URL (pure string, SSR-safe), ink dots on
 *  a dark tile. The chooser and the matcher read the same table, so they can
 *  never drift apart. */
const MAC_SWATCHES: string[] = Array.from({ length: MACPAINT_SLOT_COUNT }, (_, s) => {
  const rects: string[] = []
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (MACPAINT_PATTERN_BITS[s * 64 + y * 8 + x]) rects.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`)
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">` +
    `<rect width="8" height="8" fill="#09090b"/><g fill="#e4e4e7">${rects.join('')}</g></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
})

/** One option in the Edges chooser — active chip picks up the section's
 *  cyan (the same chip pattern the Halation card runs). */
function MacChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-8 rounded-lg border text-xs transition-colors',
        active
          ? 'border-cyan-400/70 bg-cyan-500/15 text-cyan-200'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
      )}
    >
      {label}
    </button>
  )
}

/**
 * Dither filter card — retro ordered dithering: the whole picture is
 * repainted as chunky dot patterns in a palette of your choosing (the
 * glowing shades poster whose ladder follows your glow color, classic 1-bit
 * black & white, retro color, or your own two colors) with a bloom over the
 * bright dots — or, with the MacPaint engine, effect.app's 38 hand-crafted
 * bitmap screens picked per cell by ink-coverage matching. Deterministic, so
 * every export bakes the identical look; skipped on transparent backgrounds.
 */
export function DitherFilterSection() {
  const filter = useStudioStore((s) => s.config.ditherFilter)
  const patchDitherFilter = useStudioStore((s) => s.patchDitherFilter)

  const set = (key: keyof DitherFilterConfig) => (value: number) =>
    patchDitherFilter({ [key]: value } as Partial<DitherFilterConfig>)

  const mac = filter.mode === 'macpaint'
  const patterns = Array.isArray(filter.macPatterns) ? filter.macPatterns : MACPAINT_DEFAULT_PATTERNS
  const togglePattern = (slot: number) => {
    const next = patterns.includes(slot)
      ? patterns.filter((p) => p !== slot)
      : [...patterns, slot].sort((a, b) => a - b)
    patchDitherFilter({ macPatterns: next })
  }

  return (
    <section className={sectionShell('cyan')}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Grip className="size-3.5 text-cyan-500" aria-hidden />
          <MicroLabel className="text-cyan-300/80">Dither</MicroLabel>
        </div>
        <Switch
          aria-label="Enable dither filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchDitherFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Retro dither print — the whole picture becomes chunky glowing dots,
        like old 1-bit screens and dither-poster art, or effect.app&apos;s
        MacPaint engine: 38 hand-cut bitmap screens matched per cell. Every
        look bakes into every export.
      </p>

      {filter.enabled ? (
        <>
          <div className="space-y-1.5">
            <MicroLabel>Engine</MicroLabel>
            <div className="grid grid-cols-5 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
              {(
                [
                  { id: 'blue', label: 'Blue glow' },
                  { id: 'mono', label: 'B&W' },
                  { id: 'color', label: 'Color' },
                  { id: 'custom', label: 'Custom' },
                  { id: 'macpaint', label: 'MacPaint' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={filter.mode === m.id}
                  onClick={() => patchDitherFilter({ mode: m.id })}
                  className={cn(
                    'h-7 rounded-md text-[11px] leading-none transition-colors',
                    filter.mode === m.id
                      ? 'bg-cyan-500 font-medium text-zinc-950'
                      : 'text-zinc-300 hover:text-zinc-100',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {filter.mode === 'blue' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex h-5 items-center justify-between">
                  <MicroLabel>Glow color</MicroLabel>
                  <ColorPickerButton
                    value={filter.blueInkColor}
                    onChange={(blueInkColor) => patchDitherFilter({ blueInkColor })}
                    ariaLabel="Blue glow color"
                  />
                </div>
                <p className="text-[10px] leading-snug text-zinc-600">
                  The bright-dot shade ladder follows this hue.
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="flex h-5 items-center justify-between">
                  <MicroLabel>Paper color</MicroLabel>
                  <ColorPickerButton
                    value={filter.bluePaperColor}
                    onChange={(bluePaperColor) => patchDitherFilter({ bluePaperColor })}
                    ariaLabel="Blue glow paper color"
                  />
                </div>
                <p className="text-[10px] leading-snug text-zinc-600">
                  The dark cells behind the dots.
                </p>
              </div>
            </div>
          ) : null}

          {filter.mode === 'custom' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex h-5 items-center justify-between">
                  <MicroLabel>Bright dots</MicroLabel>
                  <ColorPickerButton
                    value={filter.inkColor}
                    onChange={(inkColor) => patchDitherFilter({ inkColor })}
                    ariaLabel="Bright dots color"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex h-5 items-center justify-between">
                  <MicroLabel>Dark dots</MicroLabel>
                  <ColorPickerButton
                    value={filter.paperColor}
                    onChange={(paperColor) => patchDitherFilter({ paperColor })}
                    ariaLabel="Dark dots color"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {mac ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="flex h-5 items-center justify-between">
                    <MicroLabel>Ink</MicroLabel>
                    <ColorPickerButton
                      value={filter.macInkColor}
                      onChange={(macInkColor) => patchDitherFilter({ macInkColor })}
                      ariaLabel="MacPaint ink color"
                    />
                  </div>
                  <p className="text-[10px] leading-snug text-zinc-600">
                    The pattern dots&apos; color.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex h-5 items-center justify-between">
                    <MicroLabel>Paper</MicroLabel>
                    <ColorPickerButton
                      value={filter.macPaperColor}
                      onChange={(macPaperColor) => patchDitherFilter({ macPaperColor })}
                      ariaLabel="MacPaint paper color"
                    />
                  </div>
                  <p className="text-[10px] leading-snug text-zinc-600">
                    The sheet behind the dots.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex h-5 items-center justify-between">
                  <MicroLabel>
                    Patterns · {patterns.length}/{MACPAINT_SLOT_COUNT}
                  </MicroLabel>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        patchDitherFilter({
                          macPatterns: Array.from({ length: MACPAINT_SLOT_COUNT }, (_, i) => i),
                        })
                      }
                      className="h-5 rounded border border-zinc-800 px-1.5 text-[10px] text-zinc-400 hover:text-zinc-100"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => patchDitherFilter({ macPatterns: [...MACPAINT_DEFAULT_PATTERNS] })}
                      className="h-5 rounded border border-zinc-800 px-1.5 text-[10px] text-zinc-400 hover:text-zinc-100"
                    >
                      Classic
                    </button>
                  </div>
                </div>
                <div
                  className="grid grid-cols-[repeat(auto-fill,minmax(26px,1fr))] gap-1"
                  role="group"
                  aria-label="Dither patterns the matcher may pick from"
                >
                  {MAC_SWATCHES.map((url, slot) => (
                    <button
                      key={slot}
                      type="button"
                      aria-pressed={patterns.includes(slot)}
                      aria-label={`Pattern ${slot + 1}, ${Math.round(MACPAINT_PATTERN_DENSITY[slot] * 100)}% ink`}
                      title={`Pattern ${slot + 1} · ${Math.round(MACPAINT_PATTERN_DENSITY[slot] * 100)}% ink`}
                      onClick={() => togglePattern(slot)}
                      className={cn(
                        'aspect-square w-full rounded border p-0.5 transition-colors',
                        patterns.includes(slot)
                          ? 'border-cyan-400/80 bg-cyan-500/10'
                          : 'border-zinc-800 opacity-50 hover:opacity-90',
                      )}
                    >
                      <img
                        src={url}
                        alt=""
                        aria-hidden
                        className="h-full w-full rounded-[2px]"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    </button>
                  ))}
                </div>
                <p className="text-[10px] leading-snug text-zinc-600">
                  Each cell picks the enabled screen whose ink coverage best
                  matches its tone — toggle screens out to steer the look (a
                  hatch-only set, dots only, anything). Empty selection plays
                  all 38.
                </p>
              </div>

              <SliderRow
                label="Bitmap width"
                value={filter.macBitmapWidth}
                min={32}
                max={1024}
                step={2}
                onChange={set('macBitmapWidth')}
                format={(v) => `${Math.round(v)} cells`}
              />
              <SliderRow
                label="Threshold"
                value={filter.macThreshold}
                min={0}
                max={1}
                step={0.01}
                onChange={set('macThreshold')}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <SliderRow
                label="Contrast"
                value={filter.macContrast}
                min={0.1}
                max={4}
                step={0.05}
                onChange={set('macContrast')}
                format={(v) => `${v.toFixed(2)}×`}
              />
              <SliderRow
                label="Grain"
                value={filter.macGrain}
                min={0}
                max={1}
                step={0.05}
                onChange={set('macGrain')}
                format={(v) => (v <= 0.005 ? 'Off' : `${Math.round(v * 100)}%`)}
              />
              <SliderRow
                label="Smooth"
                value={filter.macSmoothing}
                min={0}
                max={3}
                step={1}
                onChange={set('macSmoothing')}
                format={(v) => (v <= 0 ? 'Off' : `${Math.round(v)} cell${Math.round(v) > 1 ? 's' : ''}`)}
              />
              <SliderRow
                label="Sharpen"
                value={filter.macSharpen}
                min={-1}
                max={2}
                step={0.05}
                onChange={set('macSharpen')}
                format={(v) =>
                  v < -0.005 ? `Denoise ${(-v).toFixed(2)}` : v > 0.005 ? `Crisp ${v.toFixed(2)}` : 'Off'
                }
              />
              <SliderRow
                label="Radius"
                value={filter.macRadius}
                min={0.5}
                max={5}
                step={0.1}
                onChange={set('macRadius')}
                format={(v) => `${v.toFixed(1)} cells`}
              />

              <div className="space-y-1.5">
                <MicroLabel>Edges</MicroLabel>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      { id: 0, label: 'Off' },
                      { id: 1, label: 'Ink' },
                      { id: 2, label: 'Shade' },
                    ] as const
                  ).map((m) => (
                    <MacChip
                      key={m.id}
                      label={m.label}
                      active={(filter.macEdgeMode ?? 1) === m.id}
                      onClick={() => patchDitherFilter({ macEdgeMode: m.id })}
                    />
                  ))}
                </div>
                {filter.macEdgeMode !== 0 ? (
                  <p className="text-[10px] leading-snug text-zinc-600">
                    Ink stamps solid ink along picture edges; Shade pushes
                    edges toward the paper so the patterns read around them.
                  </p>
                ) : null}
              </div>
              {filter.macEdgeMode !== 0 ? (
                <>
                  <SliderRow
                    label="Edge threshold"
                    value={filter.macEdgeThreshold}
                    min={0.01}
                    max={1}
                    step={0.01}
                    onChange={set('macEdgeThreshold')}
                    format={(v) => `${Math.round(v * 100)}%`}
                  />
                  <SliderRow
                    label="Edge width"
                    value={filter.macEdgeWidth}
                    min={0.5}
                    max={3}
                    step={0.1}
                    onChange={set('macEdgeWidth')}
                    format={(v) => `${v.toFixed(1)} cells`}
                  />
                </>
              ) : null}

              <SliderRow
                label="Strength"
                value={filter.strength}
                min={0}
                max={1}
                step={0.05}
                onChange={set('strength')}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <p className="text-[10px] leading-snug text-zinc-600">
                MacPaint: the grid spans Bitmap width cells along the longer
                side; Threshold + Contrast set where each tone snaps between
                the screens; Smooth flattens noise into even tones, Sharpen
                crispens (negative denoises) at Radius reach; Edges read the
                picture's contours; Grain jitters flat areas. Skipped on
                transparent backgrounds so alpha recordings stay clean.
              </p>
            </>
          ) : (
            <>
              <SliderRow
                label="Dot size"
                value={filter.cellSize}
                min={2}
                max={14}
                step={1}
                onChange={set('cellSize')}
                format={(v) => `${Math.round(v)} px`}
              />
              <SliderRow
                label="Contrast"
                value={filter.contrast}
                min={0}
                max={1}
                step={0.05}
                onChange={set('contrast')}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <SliderRow
                label="Strength"
                value={filter.strength}
                min={0}
                max={1}
                step={0.05}
                onChange={set('strength')}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <SliderRow
                label="Glow"
                value={filter.glow}
                min={0}
                max={1}
                step={0.05}
                onChange={set('glow')}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <BeatPunchRow
                on={filter.beatReactive}
                strength={filter.beatStrength}
                onToggle={(beatReactive) => patchDitherFilter({ beatReactive })}
                onStrength={(beatStrength) => patchDitherFilter({ beatStrength })}
                strengthLabel="Beat flare"
              />
              <p className="text-[10px] leading-snug text-zinc-600">
                Skipped on transparent backgrounds so alpha recordings stay
                clean.
              </p>
            </>
          )}
        </>
      ) : null}
    </section>
  )
}
