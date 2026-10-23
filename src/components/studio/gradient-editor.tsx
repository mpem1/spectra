'use client'

import { RotateCcw, X } from 'lucide-react'
import {
  DEFAULT_STUDIO_CONFIG,
  GRADIENT_PRESETS,
  type ColorStop,
  type GradientConfig,
  type GradientPresetId,
} from '@/lib/visualizer/types'
import { Button } from '@/components/ui/button'
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

interface GradientEditorProps {
  value: GradientConfig
  onChange: (gradient: GradientConfig) => void
  /** Reset target; falls back to the default visualizer gradient. */
  default?: GradientConfig
  showPresets?: boolean
  className?: string
}

/**
 * Full gradient editor: presets, per-stop color/position/opacity,
 * angle and hue-cycling — matches the reference panel layout.
 */
export function GradientEditor({
  value,
  onChange,
  default: defaultGradient,
  showPresets = true,
  className,
}: GradientEditorProps) {
  const resetTo = defaultGradient ?? FALLBACK_DEFAULT

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

  return (
    <div className={cn('space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <MicroLabel className="text-zinc-400">Gradient</MicroLabel>
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

      {/* Preset chips */}
      {showPresets ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Gradient presets">
          {PRESET_IDS.map((id) => {
            const preset = GRADIENT_PRESETS[id]
            const active =
              value.stops.length === preset.stops.length &&
              value.stops.every((s, i) => s.color === preset.stops[i].color && s.position === preset.stops[i].position)
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                aria-label={`Apply ${preset.name} gradient preset`}
                onClick={() =>
                  onChange({ ...value, stops: preset.stops.map((s) => ({ ...s })) })
                }
                className={cn(
                  'flex w-14 flex-col items-center gap-1 rounded-lg border p-1.5 transition-colors',
                  active
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-transparent hover:border-zinc-700'
                )}
              >
                <span
                  className="size-7 rounded-full border border-zinc-700 shadow-inner"
                  style={{ background: gradientCss(preset.stops, 90) }}
                />
                <span className="text-[10px] leading-none text-zinc-400">{preset.name}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {/* Color stops */}
      <div className="space-y-1.5" role="group" aria-label="Gradient color stops">
        {value.stops.map((stop, index) => (
          <div key={`${index}-${stop.position}-${stop.color}`} className="flex items-center gap-2">
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
      <SliderRow
        label="Angle"
        value={value.angle}
        min={0}
        max={360}
        step={1}
        onChange={(angle) => onChange({ ...value, angle })}
        format={(v) => `${Math.round(v)}°`}
      />

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
        <SliderRow
          label="Cycle speed"
          value={value.cycleSpeed}
          min={0.05}
          max={2}
          step={0.05}
          onChange={(cycleSpeed) => onChange({ ...value, cycleSpeed })}
          format={(v) => `${v.toFixed(2)}x`}
        />
      ) : null}
    </div>
  )
}

/** Convenience: the factory default gradient from the shared config contract. */
export function defaultVisualizerGradient(): GradientConfig {
  return structuredClone(DEFAULT_STUDIO_CONFIG.visualizer.gradient)
}
