'use client'

import type { LucideIcon } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

/** 11px uppercase micro-label used across all studio panels. */
export function MicroLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('text-[11px] font-medium uppercase tracking-wider text-zinc-500', className)}>
      {children}
    </span>
  )
}

/** Formats seconds as m:ss for time readouts. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Section header: small lucide icon + uppercase title + optional right slot. */
export function SectionTitle({
  icon: Icon,
  children,
  right,
  className,
}: {
  icon: LucideIcon
  children: React.ReactNode
  right?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Icon className="size-3.5 text-emerald-500" aria-hidden />
      <MicroLabel className="text-zinc-400">{children}</MicroLabel>
      {right ? <div className="ml-auto flex items-center gap-1">{right}</div> : null}
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
          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
      )}
    >
      <Icon className="size-5" aria-hidden />
      <span className="text-xs font-medium">{label}</span>
    </button>
  )
}
