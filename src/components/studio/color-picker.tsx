'use client'

import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { alphaOf, parseColor, toCss, toHex6, withAlpha } from '@/components/studio/color-utils'
import { cn } from '@/lib/utils'

interface ColorPickerButtonProps {
  value: string
  onChange: (color: string) => void
  /** Show an opacity slider inside the picker (persists alpha into an 8-digit hex). */
  showAlpha?: boolean
  ariaLabel?: string
  className?: string
}

/**
 * Compact color swatch (28×20) that opens a tiny custom picker:
 * native <input type="color"> + hex input + optional alpha slider.
 */
export function ColorPickerButton({
  value,
  onChange,
  showAlpha = false,
  ariaLabel = 'Pick color',
  className,
}: ColorPickerButtonProps) {
  const [open, setOpen] = useState(false)
  const [hexText, setHexText] = useState(value)
  const [prevOpen, setPrevOpen] = useState(open)
  const alpha = alphaOf(value)
  const rgb = parseColor(value) ?? { r: 255, g: 255, b: 255, a: 1 }

  // Re-seed the editable hex text each time the popover opens (render-time
  // derived-state reset — avoids a setState-in-effect cascade).
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) setHexText(toHex6(rgb))
  }

  const commitHex = (text: string) => {
    setHexText(text)
    const parsed = parseColor(text.startsWith('#') ? text : `#${text}`)
    if (parsed) onChange(withAlpha(toHex6(parsed), showAlpha ? alpha : 1))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${ariaLabel} (current color ${value})`}
          className={cn(
            'checkerboard h-5 w-7 shrink-0 rounded border border-zinc-700 shadow-sm transition-colors hover:border-zinc-500',
            className
          )}
        >
          <span
            className="block h-full w-full rounded-[3px]"
            style={{ backgroundColor: toCss(value) }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-60 space-y-3 p-3">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Color
          </span>
          <input
            type="color"
            value={toHex6(rgb)}
            onChange={(e) => onChange(withAlpha(e.target.value, showAlpha ? alpha : 1))}
            className="h-9 w-full cursor-pointer rounded-md border border-zinc-800 bg-zinc-950 p-1"
            aria-label={`${ariaLabel} — native color wheel`}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Hex
          </span>
          <Input
            value={hexText}
            onChange={(e) => commitHex(e.target.value)}
            spellCheck={false}
            className="h-8 font-mono text-xs"
            aria-label={`${ariaLabel} — hex value`}
            placeholder="#rrggbb"
          />
        </label>

        {showAlpha ? (
          <div className="space-y-1">
            <div className="flex h-5 items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Opacity
              </span>
              <span className="text-xs tabular-nums text-zinc-300">
                {Math.round(alpha * 100)}%
              </span>
            </div>
            <Slider
              aria-label={`${ariaLabel} — opacity`}
              min={0}
              max={100}
              step={1}
              value={[Math.round(alpha * 100)]}
              onValueChange={(vals: number[]) => {
                const pct = vals[0] ?? 100
                onChange(withAlpha(value, pct / 100))
              }}
              className="py-1"
            />
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
