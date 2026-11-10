'use client'

import type { LucideIcon } from 'lucide-react'
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
 * Tailwind scanner picks them all up. */
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

export const SECTION_ACCENT: Record<SectionAccent, { shell: string; icon: string; label: string }> = {
  emerald: {
    shell: 'border-emerald-500/20 bg-emerald-500/[0.04]',
    icon: 'text-emerald-500',
    label: 'text-emerald-300/80',
  },
  violet: {
    shell: 'border-violet-500/20 bg-violet-500/[0.04]',
    icon: 'text-violet-500',
    label: 'text-violet-300/80',
  },
  amber: {
    shell: 'border-amber-500/20 bg-amber-500/[0.04]',
    icon: 'text-amber-500',
    label: 'text-amber-300/80',
  },
  cyan: {
    shell: 'border-cyan-500/20 bg-cyan-500/[0.04]',
    icon: 'text-cyan-500',
    label: 'text-cyan-300/80',
  },
  rose: {
    shell: 'border-rose-500/20 bg-rose-500/[0.04]',
    icon: 'text-rose-500',
    label: 'text-rose-300/80',
  },
  lime: {
    shell: 'border-lime-500/20 bg-lime-500/[0.04]',
    icon: 'text-lime-500',
    label: 'text-lime-300/80',
  },
  fuchsia: {
    shell: 'border-fuchsia-500/20 bg-fuchsia-500/[0.04]',
    icon: 'text-fuchsia-500',
    label: 'text-fuchsia-300/80',
  },
  teal: {
    shell: 'border-teal-500/20 bg-teal-500/[0.04]',
    icon: 'text-teal-500',
    label: 'text-teal-300/80',
  },
  orange: {
    shell: 'border-orange-500/20 bg-orange-500/[0.04]',
    icon: 'text-orange-500',
    label: 'text-orange-300/80',
  },
  yellow: {
    shell: 'border-yellow-500/20 bg-yellow-500/[0.04]',
    icon: 'text-yellow-500',
    label: 'text-yellow-300/80',
  },
  green: {
    shell: 'border-green-500/20 bg-green-500/[0.04]',
    icon: 'text-green-500',
    label: 'text-green-300/80',
  },
  purple: {
    shell: 'border-purple-500/20 bg-purple-500/[0.04]',
    icon: 'text-purple-500',
    label: 'text-purple-300/80',
  },
  pink: {
    shell: 'border-pink-500/20 bg-pink-500/[0.04]',
    icon: 'text-pink-500',
    label: 'text-pink-300/80',
  },
}

/** Standard card shell for a studio section — the accent-tinted separation card. */
export function sectionShell(accent: SectionAccent, extra?: string): string {
  return cn('space-y-3 rounded-xl border p-3', SECTION_ACCENT[accent].shell, extra)
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
}: {
  on: boolean
  strength: number
  onToggle: (on: boolean) => void
  onStrength: (v: number) => void
  strengthLabel?: string
}) {
  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
      <div className="flex h-5 items-center justify-between">
        <MicroLabel className="text-zinc-400">React to beat</MicroLabel>
        <Switch aria-label="React to beat" checked={on} onCheckedChange={onToggle} />
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

/** Icon + label selectable card (visualizer styles / background modes). */
export function OptionCard({
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
        'flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-lg border px-1 py-2.5 transition-colors',
        active
          ? 'border-emerald-400 bg-emerald-500 text-zinc-950 shadow-[0_0_16px_-4px] shadow-emerald-500/50'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:text-zinc-100'
      )}
    >
      <Icon className="size-5" aria-hidden />
      <span className="text-xs font-medium">{label}</span>
    </button>
  )
}
