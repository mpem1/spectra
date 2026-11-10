'use client'

import { Glasses, Plus, X } from 'lucide-react'
import type { AnaglyphFilterConfig } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { MicroLabel, BeatPunchRow, SliderRow, ToggleRow, sectionShell } from '@/components/studio/controls'

/** Hard cap mirroring the renderer's MAX_TINTS — 4 lenses per side is plenty
 *  (each adds a full-frame multiply pass) and keeps the card compact. */
const MAX_TINTS = 4

/** Factory tints — the classic red/cyan paper glasses. Also the fallback
 *  when a side's list is missing (old saved projects). */
const DEFAULT_LEFT: string[] = ['#ff0000']
const DEFAULT_RIGHT: string[] = ['#00ffff']

/**
 * One side's tint list: a row per color (swatch picker + remove) and a
 * dashed "+ Add tint" button, mirroring the gradient editor's stop list.
 * The last tint can't be removed (an empty lens would draw nothing), and
 * the list caps at MAX_TINTS to match the renderer.
 */
function TintList({
  label,
  colors,
  fallback,
  onChange,
}: {
  label: string
  colors?: string[]
  fallback: string[]
  onChange: (colors: string[]) => void
}) {
  const list = colors && colors.length > 0 ? colors : fallback

  return (
    <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
      <div className="flex items-center justify-between">
        <MicroLabel>{label}</MicroLabel>
        <span className="text-[10px] tabular-nums text-zinc-600">
          {list.length}/{MAX_TINTS}
        </span>
      </div>
      {list.map((color, i) => (
        <div key={i} className="flex h-6 items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/60 px-2">
          <MicroLabel>
            Tint {i + 1}
            <span className="ml-1 normal-case tracking-normal text-zinc-600">
              {i === 0 ? '· base' : '· tracer'}
            </span>
          </MicroLabel>
          <div className="flex items-center gap-1.5">
            <ColorPickerButton
              ariaLabel={`${label} tint ${i + 1} color`}
              value={color}
              onChange={(c) => {
                const next = [...list]
                next[i] = c
                onChange(next)
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-zinc-600 hover:text-red-400"
              aria-label={`Remove ${label} tint ${i + 1}`}
              disabled={list.length <= 1}
              onClick={() => onChange(list.filter((_, j) => j !== i))}
            >
              <X className="size-3" />
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        className="h-7 w-full border-dashed border-zinc-700 text-xs text-zinc-400 hover:border-rose-500/60 hover:text-rose-400"
        aria-label={`Add ${label} tint`}
        disabled={list.length >= MAX_TINTS}
        onClick={() => onChange([...list, '#ffffff'])}
      >
        <Plus className="size-3" aria-hidden />
        Add tint
      </Button>
    </div>
  )
}

/**
 * 3D glasses filter card — the old-school paper anaglyph look: the whole
 * picture is re-projected twice, once through the left tints and once through
 * the right tints, shifted apart so every edge wears color fringes. Each lens
 * can stack up to 4 tint colors; Depth goes well past the classic amount for
 * a wide-POP look. React to beat makes the fringes pop wider on every kick,
 * and Flip on kick turns the glasses around on every hit — the whole stack
 * mirrors, holds, then swings back home. Baked into every export; skipped on
 * transparent backgrounds.
 */
export function AnaglyphFilterSection() {
  const filter = useStudioStore((s) => s.config.anaglyphFilter)
  const patchAnaglyphFilter = useStudioStore((s) => s.patchAnaglyphFilter)

  const set = (key: keyof AnaglyphFilterConfig) => (value: number) =>
    patchAnaglyphFilter({ [key]: value } as Partial<AnaglyphFilterConfig>)

  return (
    <section className={sectionShell('rose')}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Glasses className="size-3.5 text-rose-500" aria-hidden />
          <MicroLabel className="text-rose-300/80">3D Glasses</MicroLabel>
        </div>
        <Switch
          aria-label="Enable 3D glasses filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patchAnaglyphFilter({ enabled })}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-600">
        The old-school paper 3D-glasses look — the whole picture is re-projected
        twice, once through each lens&apos;s colors, shifted apart so every edge
        wears color fringes. Tint 1 is the base layer; extra tints stack
        outward like a tracer trail instead of blending in. Flip on kick turns
        the glasses around on every hit; Depth pop flattens the 3D to zero on
        every hit and lets it bloom back out. Baked into every export.
      </p>

      {filter.enabled ? (
        <>
          <BeatPunchRow
            on={filter.beatReactive}
            strength={filter.reactivity}
            onToggle={(beatReactive) => patchAnaglyphFilter({ beatReactive })}
            onStrength={(reactivity) => patchAnaglyphFilter({ reactivity })}
            strengthLabel="Beat pop"
          />
          <ToggleRow
            label="Flip on kick"
            checked={filter.beatFlip}
            onCheckedChange={(beatFlip) => patchAnaglyphFilter({ beatFlip })}
          />
          {filter.beatFlip ? (
            <>
              <SliderRow
                label="Kick sensitivity"
                value={filter.flipSensitivity}
                min={0}
                max={1}
                step={0.05}
                onChange={set('flipSensitivity')}
                format={(v) =>
                  v <= 0.025 ? 'Slams only' : v >= 0.975 ? 'Every hit' : `${Math.round(v * 100)}%`
                }
              />
              <SliderRow
                label="Flip hold"
                value={filter.flipHold}
                min={0}
                max={1}
                step={0.05}
                onChange={set('flipHold')}
                format={(v) => (v < 0.025 ? 'Quick flash' : `${(v * 2).toFixed(1)}s`)}
              />
              <p className="text-[10px] leading-snug text-zinc-600">
                On a kick the whole stereo stack mirrors — the left lens&apos;s
                copies jump to the right side and the right lens&apos;s to the
                left, like the glasses turned around — holds for Flip hold,
                then swings back through the clean full-color picture to rest.
                Sensitivity listens for the HIT on a clean sub-bass channel
                (the same detector as the halftone print&apos;s flip — each
                card keeps its own dials, so dialed the same they fire
                together): lower = only the hardest slams, higher = every tap.
              </p>
            </>
          ) : null}
          <ToggleRow
            label="Depth pop on kick"
            checked={filter.depthPop}
            onCheckedChange={(depthPop) => patchAnaglyphFilter({ depthPop })}
          />
          {filter.depthPop ? (
            <>
              <SliderRow
                label="Hit sensitivity"
                value={filter.popSensitivity}
                min={0}
                max={1}
                step={0.05}
                onChange={set('popSensitivity')}
                format={(v) =>
                  v <= 0.025 ? 'Slams only' : v >= 0.975 ? 'Every hit' : `${Math.round(v * 100)}%`
                }
              />
              <SliderRow
                label="Flat hold"
                value={filter.popHold}
                min={0}
                max={1}
                step={0.05}
                onChange={set('popHold')}
                format={(v) => (v < 0.025 ? 'Quick flash' : `${(v * 2).toFixed(1)}s`)}
              />
              <p className="text-[10px] leading-snug text-zinc-600">
                On a kick the 3D depth snaps to 0% — both lenses land on top
                of each other and the picture goes clean and flat — holds for
                Flat hold, then blooms back out to your Depth dial. Same kick
                detector as the flip: dialed the same, they fire on the same
                kicks, so the glasses mirror while the picture is flat and the
                3D blooms home as they swing back. Sensitivity listens for the
                HIT on a clean sub-bass channel: lower = only the hardest
                slams, higher = every tap.
              </p>
            </>
          ) : null}
          <SliderRow
            label="Depth"
            value={filter.depth}
            min={0}
            max={2.5}
            step={0.05}
            onChange={set('depth')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <TintList
            label="Left lens"
            colors={filter.leftColors}
            fallback={DEFAULT_LEFT}
            onChange={(leftColors) => patchAnaglyphFilter({ leftColors })}
          />
          <TintList
            label="Right lens"
            colors={filter.rightColors}
            fallback={DEFAULT_RIGHT}
            onChange={(rightColors) => patchAnaglyphFilter({ rightColors })}
          />
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
            Depth sets how far apart the two base layers sit (100% is the
            classic paper-glasses amount, push it to 250% for a wide stereo
            pop), Beat pop pushes them wider on the song&apos;s low end when
            React to beat is on, Depth pop snaps them together to 0% on each
            detected kick before blooming back out, and Mix blends the glasses
            look back toward the untouched picture. Tint 1 on each lens is the
            base layer that builds the picture — it never gets diluted. Every
            added tint sits one separation-step further out, so the trail
            extends outward step by step (tint 2 at double, tint 3 at triple
            the offset). Skipped on transparent backgrounds so alpha
            recordings stay clean.
          </p>
        </>
      ) : null}
    </section>
  )
}
