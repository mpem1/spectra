'use client'

import { ImagePlus, type LucideIcon } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/** 11px uppercase micro-label used across all studio panels. */
export function MicroLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('text-[11px] font-medium uppercase tracking-wider text-zinc-500', className)}>
      {children}
    </span>
  )
}

/** Subtle per-section accent hues — every section of the Style tab lives in
 * its own faintly tinted card with a matching header, so the panel scans as
 * clearly separated, color-coded blocks. Full literal class strings so the
 * Tailwind scanner picks them all up.
 *
 * `shell` is the resting (switch off) card; `onShell` is the same card with
 * a brighter border — same hue, one step lighter and far more opaque — so
 * a section whose switch is flipped on reads at a glance. */
export type SectionAccent =
  | 'emerald'
  | 'violet'
  | 'amber'
  | 'cyan'
  | 'rose'
  | 'lime'
  | 'fuchsia'
  | 'teal'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'purple'
  | 'pink'

export const SECTION_ACCENT: Record<SectionAccent, { shell: string; onShell: string; icon: string; label: string; dz: string }> = {
  emerald: {
    shell: 'border-emerald-500/20 bg-emerald-500/[0.04]',
    onShell: 'border-emerald-400/50 bg-emerald-500/[0.04]',
    icon: 'text-emerald-500',
    label: 'text-emerald-300/80',
    dz: 'border-emerald-500/40 bg-emerald-500/[0.06] text-zinc-300 hover:border-emerald-400/80 hover:text-emerald-300',
  },
  violet: {
    shell: 'border-violet-500/20 bg-violet-500/[0.04]',
    onShell: 'border-violet-400/50 bg-violet-500/[0.04]',
    icon: 'text-violet-500',
    label: 'text-violet-300/80',
    dz: 'border-violet-500/40 bg-violet-500/[0.06] text-zinc-300 hover:border-violet-400/80 hover:text-violet-300',
  },
  amber: {
    shell: 'border-amber-500/20 bg-amber-500/[0.04]',
    onShell: 'border-amber-400/50 bg-amber-500/[0.04]',
    icon: 'text-amber-500',
    label: 'text-amber-300/80',
    dz: 'border-amber-500/40 bg-amber-500/[0.06] text-zinc-300 hover:border-amber-400/80 hover:text-amber-300',
  },
  cyan: {
    shell: 'border-cyan-500/20 bg-cyan-500/[0.04]',
    onShell: 'border-cyan-400/50 bg-cyan-500/[0.04]',
    icon: 'text-cyan-500',
    label: 'text-cyan-300/80',
    dz: 'border-cyan-500/40 bg-cyan-500/[0.06] text-zinc-300 hover:border-cyan-400/80 hover:text-cyan-300',
  },
  rose: {
    shell: 'border-rose-500/20 bg-rose-500/[0.04]',
    onShell: 'border-rose-400/50 bg-rose-500/[0.04]',
    icon: 'text-rose-500',
    label: 'text-rose-300/80',
    dz: 'border-rose-500/40 bg-rose-500/[0.06] text-zinc-300 hover:border-rose-400/80 hover:text-rose-300',
  },
  lime: {
    shell: 'border-gold-500/20 bg-gold-500/[0.04]',
    onShell: 'border-gold-400/50 bg-gold-500/[0.04]',
    icon: 'text-gold-500',
    label: 'text-gold-300/80',
    dz: 'border-gold-500/40 bg-gold-500/[0.06] text-zinc-300 hover:border-gold-400/80 hover:text-gold-300',
  },
  fuchsia: {
    shell: 'border-sky-500/20 bg-sky-500/[0.04]',
    onShell: 'border-sky-400/50 bg-sky-500/[0.04]',
    icon: 'text-sky-500',
    label: 'text-sky-300/80',
    dz: 'border-sky-500/40 bg-sky-500/[0.06] text-zinc-300 hover:border-sky-400/80 hover:text-sky-300',
  },
  teal: {
    shell: 'border-teal-500/20 bg-teal-500/[0.04]',
    onShell: 'border-teal-400/50 bg-teal-500/[0.04]',
    icon: 'text-teal-500',
    label: 'text-teal-300/80',
    dz: 'border-teal-500/40 bg-teal-500/[0.06] text-zinc-300 hover:border-teal-400/80 hover:text-teal-300',
  },
  orange: {
    shell: 'border-orange-500/20 bg-orange-500/[0.04]',
    onShell: 'border-orange-400/50 bg-orange-500/[0.04]',
    icon: 'text-orange-500',
    label: 'text-orange-300/80',
    dz: 'border-orange-500/40 bg-orange-500/[0.06] text-zinc-300 hover:border-orange-400/80 hover:text-orange-300',
  },
  yellow: {
    shell: 'border-yellow-500/20 bg-yellow-500/[0.04]',
    onShell: 'border-yellow-400/50 bg-yellow-500/[0.04]',
    icon: 'text-yellow-500',
    label: 'text-yellow-300/80',
    dz: 'border-yellow-500/40 bg-yellow-500/[0.06] text-zinc-300 hover:border-yellow-400/80 hover:text-yellow-300',
  },
  green: {
    shell: 'border-green-500/20 bg-green-500/[0.04]',
    onShell: 'border-green-400/50 bg-green-500/[0.04]',
    icon: 'text-green-500',
    label: 'text-green-300/80',
    dz: 'border-green-500/40 bg-green-500/[0.06] text-zinc-300 hover:border-green-400/80 hover:text-green-300',
  },
  purple: {
    shell: 'border-purple-500/20 bg-purple-500/[0.04]',
    onShell: 'border-purple-400/50 bg-purple-500/[0.04]',
    icon: 'text-purple-500',
    label: 'text-purple-300/80',
    dz: 'border-purple-500/40 bg-purple-500/[0.06] text-zinc-300 hover:border-purple-400/80 hover:text-purple-300',
  },
  pink: {
    shell: 'border-pink-500/20 bg-pink-500/[0.04]',
    onShell: 'border-pink-400/50 bg-pink-500/[0.04]',
    icon: 'text-pink-500',
    label: 'text-pink-300/80',
    dz: 'border-pink-500/40 bg-pink-500/[0.06] text-zinc-300 hover:border-pink-400/80 hover:text-pink-300',
  },
}

/** Standard card shell for a studio section — the accent-tinted separation
 * card. Pass `on` (the feature's enabled switch) to brighten AND thicken the
 * border (1px dim -> 2px brighter, same hue) so every turned-on section
 * reads at a glance; the colors crossfade smoothly. */
export function sectionShell(accent: SectionAccent, extra?: string, on?: boolean): string {
  const a = SECTION_ACCENT[accent]
  return cn(
    'space-y-3 rounded-xl p-3 transition-colors duration-300',
    on ? 'border-2' : 'border',
    on ? a.onShell : a.shell,
    extra,
  )
}

/** Formats seconds as m:ss for time readouts. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Section header: small lucide icon + uppercase title + optional right slot.
 * With an accent, the icon + label pick up the section's color coding. */
export function SectionTitle({
  icon: Icon,
  children,
  right,
  className,
  accent,
}: {
  icon: LucideIcon
  children: React.ReactNode
  right?: React.ReactNode
  className?: string
  accent?: SectionAccent
}) {
  const a = accent ? SECTION_ACCENT[accent] : null
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Icon className={cn('size-3.5', a ? a.icon : 'text-emerald-500')} aria-hidden />
      <MicroLabel className={a ? a.label : 'text-zinc-400'}>{children}</MicroLabel>
      {right ? <div className="ml-auto flex items-center gap-1">{right}</div> : null}
    </div>
  )
}

/** Label + control on one row, the standard dense studio toggle row — the
 *  optional control slot renders left of the switch (chips, readouts). */
export function ToggleRow({
  label,
  checked,
  onCheckedChange,
  children,
}: {
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <div className="flex h-5 items-center justify-between">
      <MicroLabel>{label}</MicroLabel>
      <div className="flex items-center gap-2">
        {children}
        <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
      </div>
    </div>
  )
}

/** Label + numeric readout + slider, the standard dense studio slider row. */
export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
  disabled?: boolean
}) {
  return (
    <div className="space-y-1">
      <div className="flex h-5 items-center justify-between">
        <MicroLabel>{label}</MicroLabel>
        <span className="text-xs tabular-nums text-zinc-300">
          {format ? format(value) : value}
        </span>
      </div>
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(vals: number[]) => onChange(vals[0] ?? min)}
        disabled={disabled}
        className="py-1"
      />
    </div>
  )
}

/**
 * "React to beat" switch + punch slider shared by every filter card — the
 * filter twin of the background's beat bounce / beat shake / blur pulse.
 * On = the filter rests at exactly the dialed-in look between kicks and
 * punches harder while the song's low end hits; off = the plain, steady
 * look (pixel-identical to the filter without the feature).
 */
export function BeatPunchRow({
  on,
  strength,
  onToggle,
  onStrength,
  strengthLabel = 'Beat punch',
  disabled,
}: {
  on: boolean
  strength: number
  onToggle: (on: boolean) => void
  onStrength: (v: number) => void
  strengthLabel?: string
  disabled?: boolean
}) {
  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
      <div className="flex h-5 items-center justify-between">
        <MicroLabel className="text-zinc-400">React to beat</MicroLabel>
        <Switch aria-label="React to beat" checked={on} onCheckedChange={onToggle} disabled={disabled} />
      </div>
      {on ? (
        <>
          <SliderRow
            label={strengthLabel}
            value={strength}
            min={0}
            max={1}
            step={0.05}
            onChange={onStrength}
            disabled={disabled}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <p className="text-[10px] leading-snug text-zinc-600">
            Stays exactly where you set it between kicks, punches harder on
            every beat.
          </p>
        </>
      ) : null}
    </div>
  )
}

/** Icon + label selectable card (visualizer styles / background modes).
 * `className` lets a caller resize the cell (the custom-image styles span
 * a full grid row so they stand out); `sub` adds a small tell under the
 * label that inherits the active/inactive text color. */
export function OptionCard({
  icon: Icon,
  label,
  sub,
  active,
  onClick,
  className,
}: {
  icon: LucideIcon
  label: string
  sub?: string
  active: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-lg border px-1 py-2.5 transition-colors',
        active
          ? 'border-emerald-400 bg-emerald-500 text-zinc-950 shadow-[0_0_16px_-4px] shadow-emerald-500/50'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100',
        className,
      )}
    >
      <Icon className="size-5" aria-hidden />
      <span className="text-xs font-medium">{label}</span>
      {sub ? <span className="text-[10px] leading-none opacity-60">{sub}</span> : null}
    </button>
  )
}

/** The shared "upload your own image" dropzone — every custom-image entry
 * point (image visualizer, pulse logo, album art, background picture,
 * texture map, polaroid prints, watermark) renders this same prominent
 * dashed target: taller than a plain button, dashed border and a faint
 * wash in the section's accent so the spots that take YOUR picture read
 * at a glance in the panel. */
export function ImageDropzone({
  label,
  hint,
  accent,
  icon: Icon = ImagePlus,
  onClick,
  className,
  ariaLabel,
}: {
  label: string
  hint?: string
  accent: SectionAccent
  icon?: LucideIcon
  onClick: () => void
  className?: string
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'flex h-20 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed transition-colors',
        SECTION_ACCENT[accent].dz,
        className,
      )}
    >
      <Icon className="size-5" aria-hidden />
      <span className="text-xs font-medium">{label}</span>
      {hint ? <span className="text-[10px] leading-none text-zinc-500">{hint}</span> : null}
    </button>
  )
}
