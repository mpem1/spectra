'use client'

import { Film } from 'lucide-react'
import type { ExposureFilterConfig, ExposureStockId } from '@/lib/visualizer/types'
import { EXPOSURE_STOCKS } from '@/lib/visualizer/exposure-filter'
import { useStudioStore } from '@/store/studio'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SliderRow, sectionShell, MicroLabel } from '@/components/studio/controls'

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

/** Percent readout for the Amount dials — 100% is the published look. */
const pct = (v: number) => `${Math.round(v * 100)}%`

/**
 * Exposure filter card — effect.app's Instant Film effect (renamed
 * Exposure here), rebuilt from the site's own decrypted shader and its
 * own stock LUT data. The whole picture is graded through a real instant
 * film stock — Polaroid 600/669/690 (plus expired), Instax Mini and Fuji
 * FP-100C (warm/cool/expired) — with the two Amount dials deciding how
 * much of the stock's color and lightness land on the frame. Like the
 * other filter cards, the card collapses to one line while the switch is
 * off; flipping it on opens the dial set.
 */
export function ExposureSection() {
  const filter = useStudioStore((s) => s.config.exposureFilter)
  const patch = useStudioStore((s) => s.patchExposureFilter)

  const stock: ExposureStockId = filter.stock ?? 'polaroid-600'
  const set = (key: keyof ExposureFilterConfig) => (value: number) =>
    patch({ [key]: value } as Partial<ExposureFilterConfig>)

  return (
    <section className={sectionShell('amber')}>
      <div className="flex h-7 items-center justify-between">
        <div className="flex items-center gap-2">
          <Film className="size-3.5 text-amber-500" aria-hidden />
          <MicroLabel className="text-amber-300/80">Exposure</MicroLabel>
        </div>
        <Switch
          aria-label="Enable exposure filter"
          checked={filter.enabled}
          onCheckedChange={(enabled) => patch({ enabled })}
        />
      </div>

      {/* Like the other filter cards, the card is minimized while the
          switch is off — one line keeps it discoverable, flipping the
          switch opens the full dial set. */}
      {filter.enabled ? (
        <>
          <p className="text-[11px] leading-snug text-zinc-600">
            Instant film, rebuilt from effect.app&apos;s own Instant Film
            effect — the whole picture is graded through a real film
            stock&apos;s color fingerprint (Polaroid, Instax and Fuji
            FP-100C packs, expired film included), with the Color and Light
            dials deciding how much of the stock lands on the frame. Every
            stock here is the real site&apos;s own LUT data, and everything
            bakes into the preview and every export.
          </p>

          <div className="space-y-3">
            <Group>Film stock</Group>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MicroLabel>Type</MicroLabel>
              <Select
                value={stock}
                onValueChange={(value) => patch({ stock: value as ExposureStockId })}
              >
                <SelectTrigger size="sm" className="w-[200px]" aria-label="Film stock">
                  <SelectValue placeholder="Polaroid 600" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {EXPOSURE_STOCKS.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Group>Amount</Group>
            <SliderRow
              label="Color"
              value={filter.color ?? 1}
              min={0}
              max={2}
              step={0.01}
              onChange={set('color')}
              format={(v) =>
                v <= 0.005 ? 'Untouched' : v >= 1.995 ? 'Double' : pct(v)
              }
            />
            <SliderRow
              label="Light"
              value={filter.light ?? 1}
              min={0}
              max={2}
              step={0.01}
              onChange={set('light')}
              format={(v) =>
                v <= 0.005 ? 'Untouched' : v >= 1.995 ? 'Double' : pct(v)
              }
            />
          </div>
        </>
      ) : null}
    </section>
  )
}
