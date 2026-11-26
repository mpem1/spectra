'use client'

import { Blocks, Circle, Diamond, Egg, Triangle, type LucideIcon } from 'lucide-react'
import type { CubifyFilterConfig, CubifyShape } from '@/lib/visualizer/types'
import { CUBIFY_SHAPE_ORDER } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, BeatPunchRow, SliderRow, ToggleRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

/** Group divider inside the card — a small uppercase header with a rule. */
function Group({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {children}
      </span>
      <span className="h-px flex-1 bg-zinc-800/80" aria-hidden />
    </div>
  )
}

/** One tile-shape chip in the mix chooser — toggles its shape in or out of
 *  the grid's pattern (multi-select; the mix semantics live in the hint
 *  below the row). Tinted to this card's orange accent. */
function ShapeChip({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon
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
        'flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg border px-1 py-1.5 transition-colors',
        active
          ? 'border-orange-400/70 bg-orange-500/15 text-orange-200'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
      )}
    >
      <Icon className="size-4" aria-hidden />
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </button>
  )
}

const SHAPE_CHIPS: { id: CubifyShape; label: string; icon: LucideIcon }[] = [
  { id: 'cube', label: 'Cubes', icon: Blocks },
  { id: 'circle', label: 'Circles', icon: Circle },
  { id: 'oval', label: 'Ovals', icon: Egg },
  { id: 'diamond', label: 'Diamonds', icon: Diamond },
  { id: 'triangle', label: 'Triangles', icon: Triangle },
]

/**
 * Cubify card — effect.app's Cubify effect, ported 1:1 from its shader: the
 * frame resamples through an array of glass tiles (rotated exponential grid,
 * per-cell edge-pull warp = the 3D depth, optional hard pixel snap, RGB
 * dispersion on the edges). The Shape mix chooser cuts the grid into cubes,
 * circles, ovals, diamonds or triangles — one shape tiles everything, two
 * alternate in a checkerboard, three or more shuffle cell by cell. Shape
 * mixes run one clean warp per pixel (no RGB split — that glass belongs to
 * the lone cube) and cut visible tile silhouettes (Tile gaps — the picture
 * shows through between the tiles, never painted black). The beads are
 * screen-true: circles render round whatever the stretch dial does. Dials
 * match the original effect's controls. Deterministic, so every export bakes
 * the identical look; skipped on transparent backgrounds.
 */
export function CubifyFilterSection() {
  const filter = useStudioStore((s) => s.config.cubifyFilter)
  const patchCubifyFilter = useStudioStore((s) => s.patchCubifyFilter)

  const set = (key: keyof CubifyFilterConfig) => (value: number) =>
    patchCubifyFilter({ [key]: value } as Partial<CubifyFilterConfig>)

  // The factory mix (the lone captured cube) is the one look that keeps the
  // original's chromatic dispersion and never cuts silhouettes.
  const cubeOnly = filter.shapes.length === 1 && filter.shapes[0] === 'cube'

  // Toggle one shape in or out of the mix, always re-stored in canonical
  // order. The last active shape can't leave — the grid is never shapeless.
  const toggleShape = (id: CubifyShape) => {
    const active = filter.shapes.includes(id)
    if (active && filter.shapes.length === 1) return
    const next = CUBIFY_SHAPE_ORDER.filter((s) =>
      active ? s !== id && filter.shapes.includes(s) : s === id || filter.shapes.includes(s),
    )
    patchCubifyFilter({ shapes: next })
  }

  const mixNote =
    filter.shapes.length === 1
      ? 'One shape tiles every cell.'
      : filter.shapes.length === 2
        ? 'Two shapes alternate in a checkerboard.'
        : `${filter.shapes.length} shapes shuffle cell by cell.`

  return (
    <section className={sectionShell('orange', undefined, filter.enabled)}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Blocks className="size-3.5 text-orange-500" aria-hidden />
          <MicroLabel className="text-orange-300/80">Cubify</MicroLabel>
        </div>
        <Switch
          aria-label="Enable cubify filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchCubifyFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        Cubify — the whole picture refracts through an array of glass tiles:
        the frame snaps onto a rotated grid and every cell bends its content
        toward the tile edges, reading as 3D blocks, bubbles, gems or folded
        prisms. The real effect.app algorithm, dial for dial — plus tile
        shapes beyond the original cube, each one cut out of the mosaic with
        the picture showing through between them.
      </p>

      {filter.enabled ? (
        <>
          <div className="space-y-1.5">
            <Group>Shape mix</Group>
            <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Tile shapes">
              {SHAPE_CHIPS.map((chip) => (
                <ShapeChip
                  key={chip.id}
                  icon={chip.icon}
                  label={chip.label}
                  active={filter.shapes.includes(chip.id)}
                  onClick={() => toggleShape(chip.id)}
                />
              ))}
            </div>
            <p className="text-[10px] leading-snug text-zinc-600" aria-live="polite">
              {mixNote} Tap more to mix them — the grid carries every shape at
              once, each cell printing exactly one of them.
            </p>
          </div>
          {!cubeOnly ? (
            <SliderRow
              label="Tile gaps"
              value={filter.gaps}
              min={0}
              max={1}
              step={0.05}
              onChange={set('gaps')}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          ) : null}
          <SliderRow
            label="Cube size"
            value={filter.scale}
            min={0}
            max={8}
            step={0.01}
            onChange={set('scale')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Cube stretch"
            value={filter.stretch}
            min={-1}
            max={1}
            step={0.01}
            onChange={set('stretch')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Depth distortion"
            value={filter.depth}
            min={0}
            max={5}
            step={0.01}
            onChange={set('depth')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Rotation angle"
            value={filter.angle}
            min={0}
            max={90}
            step={1}
            onChange={set('angle')}
            format={(v) => `${Math.round(v)}°`}
          />
          <ToggleRow
            label="Hard edges"
            checked={filter.hard}
            onCheckedChange={(hard) => patchCubifyFilter({ hard })}
          />
          <SliderRow
            label="Position offset X"
            value={filter.offsetX}
            min={-1}
            max={1}
            step={0.01}
            onChange={set('offsetX')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Position offset Y"
            value={filter.offsetY}
            min={-1}
            max={1}
            step={0.01}
            onChange={set('offsetY')}
            format={(v) => v.toFixed(2)}
          />
          <SliderRow
            label="Animation speed X"
            value={filter.speedX}
            min={-5}
            max={5}
            step={0.01}
            onChange={set('speedX')}
            format={(v) => `${v.toFixed(2)} cells/s`}
          />
          <SliderRow
            label="Animation speed Y"
            value={filter.speedY}
            min={-5}
            max={5}
            step={0.01}
            onChange={set('speedY')}
            format={(v) => `${v.toFixed(2)} cells/s`}
          />
          {cubeOnly ? (
            <SliderRow
              label="Dispersion"
              value={filter.dispersion}
              min={0}
              max={1}
              step={0.001}
              onChange={set('dispersion')}
              format={(v) => `${(v * 100).toFixed(1)}%`}
            />
          ) : null}
          <SliderRow
            label="Mix"
            value={filter.blend}
            min={0}
            max={1}
            step={0.05}
            onChange={set('blend')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.beatStrength}
            onToggle={(beatReactive) => patchCubifyFilter({ beatReactive })}
            onStrength={(beatStrength) => patchCubifyFilter({ beatStrength })}
            strengthLabel="Beat lift"
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            The grid drifts with the song (speed dials above). Hard edges
            snaps every tile to hard pixels — cubes to their corners, beads
            to center-or-rim, diamonds to their points, triangles to the
            fold. Tile gaps cuts each mixed shape out of the mosaic — the
            untouched picture shows through between the tiles instead of any
            paint, so circles read as round beads floating on the frame
            (beads inscribe the cell's smaller screen dimension, so a circle
            is a circle whatever the stretch dial does; 0% keeps the
            seamless glass). The chromatic dispersion
            glass belongs to the lone cube — shape mixes run one clean warp
            so their shapes never print stacked RGB ghost copies. Skipped on
            transparent backgrounds so alpha recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
