'use client'

import { useEffect, useState } from 'react'
import { RotateCcw, Save, X } from 'lucide-react'
import {
  DEFAULT_STUDIO_CONFIG,
  GRADIENT_PRESETS,
  type ColorStop,
  type GradientConfig,
  type GradientPresetId,
} from '@/lib/visualizer/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { gradientCss } from '@/components/studio/color-utils'
import { MicroLabel, SliderRow } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

const PRESET_IDS = Object.keys(GRADIENT_PRESETS) as GradientPresetId[]

const FALLBACK_DEFAULT: GradientConfig = {
  stops: GRADIENT_PRESETS.sunset.stops.map((s) => ({ ...s })),
  angle: 48,
  cycleColors: false,
  cycleSpeed: 0.1,
}

const MY_GRADIENTS_KEY = 'spectra-my-gradients'

interface SavedGradient {
  id: string
  name: string
  gradient: GradientConfig
}

function loadSavedGradients(): SavedGradient[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(MY_GRADIENTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is SavedGradient =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as SavedGradient).id === 'string' &&
        typeof (item as SavedGradient).name === 'string' &&
        typeof (item as SavedGradient).gradient === 'object',
    )
  } catch {
    return []
  }
}

function persistSavedGradients(items: SavedGradient[]): void {
  try {
    window.localStorage.setItem(MY_GRADIENTS_KEY, JSON.stringify(items))
  } catch {
    // Storage full / private mode — saving is best-effort.
  }
}

interface GradientEditorProps {
  value: GradientConfig
  onChange: (gradient: GradientConfig) => void
  /** Reset target; falls back to the default visualizer gradient. */
  default?: GradientConfig
  showPresets?: boolean
  className?: string
}

/**
 * Full gradient editor: preset pills, per-stop color/position, angle with
 * direction hint, hue cycling and "My gradients" (localStorage) — matches the
 * reference panel.
 */
export function GradientEditor({
  value,
  onChange,
  default: defaultGradient,
  showPresets = true,
  className,
}: GradientEditorProps) {
  const resetTo = defaultGradient ?? FALLBACK_DEFAULT

  const [saved, setSaved] = useState<SavedGradient[]>([])
  const [name, setName] = useState('')

  useEffect(() => {
    // Deferred so hydration completes before localStorage state lands.
    const id = window.setTimeout(() => setSaved(loadSavedGradients()), 0)
    return () => window.clearTimeout(id)
  }, [])

  const updateStop = (index: number, partial: Partial<ColorStop>) => {
    const stops = value.stops.map((stop, i) => (i === index ? { ...stop, ...partial } : stop))
    onChange({ ...value, stops })
  }

  const addStop = () => {
    const stop: ColorStop = { color: '#ffffff', position: 50, opacity: 100 }
    const stops = [...value.stops, stop].sort((a, b) => a.position - b.position)
    onChange({ ...value, stops })
  }

  const removeStop = (index: number) => {
    if (value.stops.length <= 2) return
    onChange({ ...value, stops: value.stops.filter((_, i) => i !== index) })
  }

  const saveGradient = () => {
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    const item: SavedGradient = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: trimmed,
      gradient: structuredClone(value),
    }
    const next = [...saved, item]
    setSaved(next)
    persistSavedGradients(next)
    setName('')
  }

  const deleteGradient = (id: string) => {
    const next = saved.filter((g) => g.id !== id)
    setSaved(next)
    persistSavedGradients(next)
  }

  return (
    <div className={cn('space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3', className)}>
      {/* Header (reset only — the section label already says GRADIENT) */}
      <div className="flex items-center justify-end">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-zinc-500 hover:text-zinc-200"
          aria-label="Reset gradient to default"
          title="Reset gradient"
          onClick={() => onChange(structuredClone(resetTo))}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </div>

      {/* Preset pills */}
      {showPresets ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Gradient presets">
          {PRESET_IDS.map((id) => {
            const preset = GRADIENT_PRESETS[id]
            const active =
              value.stops.length === preset.stops.length &&
              value.stops.every(
                (s, i) => s.color === preset.stops[i].color && s.position === preset.stops[i].position,
              )
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                aria-label={`Apply ${preset.name} gradient preset`}
                onClick={() => onChange({ ...value, stops: preset.stops.map((s) => ({ ...s })) })}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2 py-1 transition-colors',
                  active
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-600',
                )}
              >
                <span
                  className="size-4 rounded-full border border-zinc-700"
                  style={{ background: gradientCss(preset.stops, 90) }}
                  aria-hidden
                />
                <span className="text-[11px] leading-none text-zinc-300">{preset.name}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {/* Color stops */}
      <div className="space-y-1.5" role="group" aria-label="Gradient color stops">
        {value.stops.map((stop, index) => (
          // Stable key — a key derived from color/position would remount the
          // row on every change and slam the color picker popover shut.
          <div key={index} className="flex items-center gap-2">
            <ColorPickerButton
              value={stop.color}
              onChange={(color) => updateStop(index, { color })}
              showAlpha
              ariaLabel={`Stop ${index + 1} color`}
            />
            <Slider
              aria-label={`Stop ${index + 1} position`}
              min={0}
              max={100}
              step={1}
              value={[stop.position]}
              onValueChange={(vals: number[]) => updateStop(index, { position: vals[0] ?? 0 })}
              className="flex-1 py-1"
            />
            <span className="w-8 text-right text-xs tabular-nums text-zinc-300">
              {Math.round(stop.position)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-zinc-500 hover:text-red-400"
              aria-label={`Delete stop ${index + 1}`}
              disabled={value.stops.length <= 2}
              onClick={() => removeStop(index)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>

      {/* Add stop */}
      <Button
        variant="outline"
        className="h-8 w-full border-dashed border-zinc-700 text-xs text-zinc-400 hover:border-emerald-500/60 hover:text-emerald-400"
        onClick={addStop}
      >
        + Add color stop
      </Button>

      {/* Angle */}
      <div className="space-y-1">
        <SliderRow
          label="Angle"
          value={value.angle}
          min={0}
          max={360}
          step={1}
          onChange={(angle) => onChange({ ...value, angle })}
          format={(v) => `${Math.round(v)}°`}
        />
        <p className="text-[11px] leading-snug text-zinc-500">
          Direction the gradient runs across the canvas — 0° left to right, 90° top to bottom,
          270° bottom to top.
        </p>
      </div>

      {/* Cycle colors */}
      <div className="flex h-7 items-center justify-between">
        <MicroLabel>Cycle colors</MicroLabel>
        <Switch
          aria-label="Cycle colors over time"
          checked={value.cycleColors}
          onCheckedChange={(cycleColors) => onChange({ ...value, cycleColors })}
        />
      </div>

      {value.cycleColors ? (
        <div className="space-y-2">
          <SliderRow
            label="Cycle speed"
            value={value.cycleSpeed}
            min={0.05}
            max={2}
            step={0.05}
            onChange={(cycleSpeed) => onChange({ ...value, cycleSpeed })}
            format={(v) => `${v.toFixed(2)}x`}
          />
          <p className="text-[11px] leading-snug text-zinc-500">
            The gradient sweeps smoothly back and forth through your palette — colors always stay
            within the colors you picked.
          </p>
        </div>
      ) : null}

      {/* My gradients */}
      <div className="space-y-2 border-t border-zinc-800 pt-3">
        <MicroLabel className="text-zinc-400">My gradients</MicroLabel>
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveGradient()
            }}
            placeholder="Name this gradient…"
            className="h-9 flex-1 text-xs"
            aria-label="Gradient name"
          />
          <Button
            size="sm"
            className="h-9 bg-zinc-100 font-medium text-zinc-900 shadow-none hover:bg-white"
            disabled={name.trim().length === 0}
            onClick={saveGradient}
          >
            <Save className="size-3.5" aria-hidden />
            Save
          </Button>
        </div>
        {saved.length === 0 ? (
          <p className="text-[11px] text-zinc-600">
            No saved gradients yet — pick two colors and hit Save.
          </p>
        ) : (
          <div className="slim-scrollbar max-h-36 space-y-1 overflow-y-auto pr-1">
            {saved.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-2 py-1.5"
              >
                <span
                  className="size-4 shrink-0 rounded-full border border-zinc-700"
                  style={{ background: gradientCss(item.gradient.stops, 90) }}
                  aria-hidden
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-xs text-zinc-200 hover:text-emerald-400"
                  aria-label={`Apply saved gradient ${item.name}`}
                  onClick={() => onChange(structuredClone(item.gradient))}
                >
                  {item.name}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-zinc-600 hover:text-red-400"
                  aria-label={`Delete saved gradient ${item.name}`}
                  onClick={() => deleteGradient(item.id)}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Convenience: the factory default gradient from the shared config contract. */
export function defaultVisualizerGradient(): GradientConfig {
  return structuredClone(DEFAULT_STUDIO_CONFIG.visualizer.gradient)
}
