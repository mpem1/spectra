'use client'

import { Fingerprint } from 'lucide-react'
import type { TextureFilterType } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { MicroLabel, SliderRow, sectionShell } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

/** The material picker's eight chips — label + a two-word tell, compact
 *  like the Halftone card's choosers (44px min touch target). */
const TEXTURES: { id: TextureFilterType; label: string; sub: string }[] = [
  { id: 'grain', label: 'Grain', sub: 'film speckle' },
  { id: 'paper', label: 'Paper', sub: 'fibers, wrinkles' },
  { id: 'canvas', label: 'Canvas', sub: 'woven threads' },
  { id: 'concrete', label: 'Concrete', sub: 'mineral pits' },
  { id: 'glass', label: 'Glass', sub: 'smears, bends' },
  { id: 'foil', label: 'Foil', sub: 'crumpled metal' },
  { id: 'rust', label: 'Rust', sub: 'oxidation' },
  { id: 'dirt', label: 'Dirt', sub: 'grime, specks' },
]

/**
 * Texture filter card — the finished picture printed onto a physical
 * material: film grain, paper, canvas, concrete, glass, crumpled foil,
 * rust or dirt. Each material is a bump surface whose flaws DISPLACE the
 * picture (the image warps around every pit, fiber and crease — the
 * displacement) and catch a lit-relief shading from the upper left, so
 * the texture reads through the image instead of sitting flat on top of
 * it. The image's own colors stay its own — the texture bends it, it
 * doesn't tint it. Amount is the master dial; Scale sizes the material's
 * features.
 */
export function TextureFilterSection() {
  const filter = useStudioStore((s) => s.config.textureFilter)
  const patchTextureFilter = useStudioStore((s) => s.patchTextureFilter)

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
        concrete, glass, crumpled foil, rust or dirt. The surface&apos;s flaws
        push the picture around (the displacement), so pits, fibers and
        creases show THROUGH the image — the texture bends the whole
        picture instead of tinting it, so its colors stay its own. Amount
        sets how hard the picture bends; Scale sets how big the flaws are.
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
                            : 'Old grime: settled blotches and crisp specks that dent and scratch the picture.'}
            </p>
          </div>

          <SliderRow
            label="Amount"
            value={filter.amount}
            min={0}
            max={1}
            step={0.05}
            onChange={(amount) => patchTextureFilter({ amount })}
            format={(v) => (v <= 0.025 ? 'Off' : `${Math.round(v * 100)}%`)}
          />
          <SliderRow
            label="Scale"
            value={filter.scale}
            min={0.4}
            max={3}
            step={0.1}
            onChange={(scale) => patchTextureFilter({ scale })}
            format={(v) => `${v.toFixed(1)}×`}
          />

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
