'use client'

import { useRef } from 'react'
import {
  AudioWaveform,
  BarChart3,
  Droplets,
  Grid3x3,
  ImagePlus,
  MoveHorizontal,
  Orbit,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { CustomColorPresets } from '@/components/editor/custom-color-presets'
import {
  GRADIENT_PRESETS,
  VISUALIZER_META,
  type AspectRatio,
  type FftSize,
  type GradientStop,
  type VisualizerType,
} from '@/lib/types'
import { useEditorStore } from '@/store/editor'
import { toast } from '@/hooks/use-toast'

const TYPE_ICONS: Record<VisualizerType, React.ComponentType<{ className?: string }>> = {
  bars: BarChart3,
  wave: AudioWaveform,
  radial: Orbit,
  particles: Sparkles,
  blob: Droplets,
  grid: Grid3x3,
}

const MAX_BG_IMAGE_BYTES = 2.5 * 1024 * 1024

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
      {children}
    </h3>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  display?: (v: number) => string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-zinc-400">{label}</Label>
        <span className="font-mono text-xs text-zinc-300">
          {display ? display(value) : value}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  )
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-xs text-zinc-400">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}

export function StylePanel() {
  const config = useEditorStore((s) => s.config)
  const setConfig = useEditorStore((s) => s.setConfig)
  const setGradientStops = useEditorStore((s) => s.setGradientStops)
  const resetConfig = useEditorStore((s) => s.resetConfig)
  const bgInputRef = useRef<HTMLInputElement | null>(null)

  const updateStop = (i: number, patch: Partial<GradientStop>) => {
    setGradientStops(config.gradientStops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  const addStop = () => {
    if (config.gradientStops.length >= 6) return
    setGradientStops([...config.gradientStops, { color: '#ffffff', position: 1 }])
  }

  const removeStop = (i: number) => {
    if (config.gradientStops.length <= 1) return
    setGradientStops(config.gradientStops.filter((_, idx) => idx !== i))
  }

  const stopsMatchPreset = (preset: GradientStop[]) => {
    const stops = config.gradientStops
    if (stops.length !== preset.length) return false
    return stops.every(
      (s, i) =>
        s.color.toLowerCase() === preset[i].color.toLowerCase() &&
        Math.abs(s.position - preset[i].position) < 0.005
    )
  }

  const showBarCount = config.type === 'bars' || config.type === 'radial' || config.type === 'grid'
  const showLineWidth = config.type !== 'particles'
  const showParticles = config.type === 'particles'
  const showMirror = config.type === 'bars' || config.type === 'wave' || config.type === 'grid'
  const showRotation = config.type === 'radial' || config.type === 'blob'

  const onBgImage = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Not an image',
        description: 'Please choose a PNG, JPG or WebP image.',
        variant: 'destructive',
      })
      return
    }
    if (file.size > MAX_BG_IMAGE_BYTES) {
      toast({
        title: 'Image too large',
        description: 'Please use an image smaller than 2.5 MB.',
        variant: 'destructive',
      })
      return
    }
    const reader = new FileReader()
    reader.onload = () => setConfig({ bgImage: String(reader.result) })
    reader.onerror = () =>
      toast({ title: 'Could not read image', variant: 'destructive' })
    reader.readAsDataURL(file)
  }

  return (
    <ScrollArea className="h-[calc(100vh-300px)] min-h-[420px]">
      <div className="space-y-5 pr-3">
        {/* Visualizer type */}
        <section className="space-y-3">
          <SectionTitle>Visualizer</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            {VISUALIZER_META.map(({ type, label, description }) => {
              const Icon = TYPE_ICONS[type]
              const active = config.type === type
              return (
                <button
                  key={type}
                  type="button"
                  title={description}
                  aria-pressed={active}
                  onClick={() => setConfig({ type })}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                    active
                      ? 'border-emerald-500/70 bg-emerald-500/10 text-emerald-300'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              )
            })}
          </div>
        </section>

        <Separator className="bg-zinc-800/70" />

        {/* Gradient — multi-stop palette with angle + hue cycling */}
        <section className="space-y-3">
          <SectionTitle>Gradient</SectionTitle>

          <div className="flex flex-wrap gap-1.5">
            {GRADIENT_PRESETS.map((p) => {
              const active = stopsMatchPreset(p.stops)
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setGradientStops(p.stops.map((s) => ({ ...s })))}
                  aria-pressed={active}
                  aria-label={`Apply ${p.name} gradient preset`}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                    active
                      ? 'border-emerald-500/70 bg-emerald-500/10 text-emerald-300'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  <span
                    className="h-3.5 w-6 rounded-sm"
                    style={{
                      background: `linear-gradient(90deg, ${p.stops
                        .map((s) => s.color)
                        .join(',')})`,
                    }}
                  />
                  {p.name}
                </button>
              )
            })}
          </div>

          <div className="space-y-2">
            {config.gradientStops.map((stop, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="color"
                  value={stop.color}
                  onChange={(e) => updateStop(i, { color: e.target.value })}
                  aria-label={`Color stop ${i + 1}`}
                  className="h-7 w-9 shrink-0 cursor-pointer rounded-md border border-zinc-800 bg-zinc-900 p-0.5"
                />
                <Slider
                  className="flex-1"
                  min={0}
                  max={1}
                  step={0.01}
                  value={[stop.position]}
                  onValueChange={(v) => updateStop(i, { position: v[0] })}
                  aria-label={`Color stop ${i + 1} position`}
                />
                <span className="w-7 shrink-0 text-right font-mono text-xs text-zinc-400">
                  {Math.round(stop.position * 100)}
                </span>
                <button
                  type="button"
                  onClick={() => removeStop(i)}
                  disabled={config.gradientStops.length <= 1}
                  aria-label={`Remove color stop ${i + 1}`}
                  className="shrink-0 rounded p-1 text-zinc-500 transition hover:text-red-400 disabled:pointer-events-none disabled:opacity-30"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={addStop}
              disabled={config.gradientStops.length >= 6}
            >
              <Plus className="h-3.5 w-3.5" /> Add color stop
            </Button>
          </div>

          <SliderRow
            label="Angle"
            value={config.gradientAngle}
            min={0}
            max={360}
            step={1}
            display={(v) => `${Math.round(v)}°`}
            onChange={(v) => setConfig({ gradientAngle: v })}
          />
          <p className="-mt-2 text-[11px] leading-snug text-zinc-500">
            Direction the gradient runs across the canvas — 0° left to right, 90° top to
            bottom, 270° bottom to top.
          </p>

          <SwitchRow
            label="Cycle colors"
            checked={config.gradientCycle}
            onChange={(v) => setConfig({ gradientCycle: v })}
          />
          {config.gradientCycle && (
            <SliderRow
              label="Cycle speed"
              value={config.gradientCycleSpeed}
              min={1}
              max={180}
              step={1}
              display={(v) => `${Math.round(v)}°/s`}
              onChange={(v) => setConfig({ gradientCycleSpeed: v })}
            />
          )}

          <Separator className="bg-zinc-800/50" />

          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">My gradients</Label>
            <CustomColorPresets />
          </div>
        </section>

        <Separator className="bg-zinc-800/70" />

        {/* Shape & motion */}
        <section className="space-y-4">
          <SectionTitle>Shape &amp; motion</SectionTitle>
          {showBarCount && (
            <SliderRow
              label={config.type === 'grid' ? 'Grid columns' : 'Bar count'}
              value={config.barCount}
              min={8}
              max={160}
              step={4}
              onChange={(v) => setConfig({ barCount: v })}
            />
          )}
          {showLineWidth && (
            <SliderRow
              label="Line weight"
              value={config.lineWidth}
              min={0.2}
              max={3}
              step={0.1}
              display={(v) => v.toFixed(1)}
              onChange={(v) => setConfig({ lineWidth: v })}
            />
          )}
          {showParticles && (
            <SliderRow
              label="Particles"
              value={config.particleCount}
              min={20}
              max={400}
              step={10}
              onChange={(v) => setConfig({ particleCount: v })}
            />
          )}
          <SliderRow
            label="Glow"
            value={config.glow}
            min={0}
            max={48}
            step={1}
            onChange={(v) => setConfig({ glow: v })}
          />
          <SliderRow
            label="Afterglow trails"
            value={config.afterglow}
            min={0}
            max={0.95}
            step={0.05}
            display={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
            onChange={(v) => setConfig({ afterglow: v })}
          />
          <p className="-mt-2 text-[11px] leading-snug text-zinc-500">
            Motion trails that linger behind the visualizer, in front of the background.
          </p>
          {showMirror && (
            <SwitchRow
              label="Mirror"
              checked={config.mirror}
              onChange={(v) => setConfig({ mirror: v })}
            />
          )}
          {showRotation && (
            <SwitchRow
              label="Slow rotation"
              checked={config.rotation}
              onChange={(v) => setConfig({ rotation: v })}
            />
          )}
        </section>

        <Separator className="bg-zinc-800/70" />

        {/* Analysis */}
        <section className="space-y-4">
          <SectionTitle>Audio analysis</SectionTitle>
          <SliderRow
            label="Smoothing"
            value={config.smoothing}
            min={0}
            max={0.95}
            step={0.05}
            display={(v) => v.toFixed(2)}
            onChange={(v) => setConfig({ smoothing: v })}
          />
          <SliderRow
            label="Sensitivity"
            value={config.sensitivity}
            min={0.4}
            max={3}
            step={0.05}
            display={(v) => `${v.toFixed(2)}x`}
            onChange={(v) => setConfig({ sensitivity: v })}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-500">FFT size</Label>
              <Select
                value={String(config.fftSize)}
                onValueChange={(v) => setConfig({ fftSize: Number(v) as FftSize })}
              >
                <SelectTrigger size="sm" aria-label="FFT size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[512, 1024, 2048, 4096].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-500">Aspect ratio</Label>
              <Select
                value={config.aspect}
                onValueChange={(v) => setConfig({ aspect: v as AspectRatio })}
              >
                <SelectTrigger size="sm" aria-label="Aspect ratio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9 landscape</SelectItem>
                  <SelectItem value="1:1">1:1 square</SelectItem>
                  <SelectItem value="9:16">9:16 vertical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <Separator className="bg-zinc-800/70" />

        {/* Background */}
        <section className="space-y-3">
          <SectionTitle>Background</SectionTitle>
          <SwitchRow
            label="Transparent background"
            checked={config.transparentBg}
            onChange={(v) => setConfig({ transparentBg: v })}
          />
          {config.transparentBg ? (
            <p className="-mt-1 text-[11px] leading-snug text-zinc-500">
              Color and image are hidden — recordings export WebM with an alpha channel and
              snapshots export transparent PNGs. DaVinci Resolve can&apos;t read WebM: use the{' '}
              <span className="text-zinc-300">Convert</span> button (top bar) to transcode the clip
              to ProRes 4444 MOV with the alpha intact.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-500">Background color</Label>
                <input
                  type="color"
                  value={config.bgColor}
                  onChange={(e) => setConfig({ bgColor: e.target.value })}
                  aria-label="Background color"
                  className="h-9 w-full cursor-pointer rounded-md border border-zinc-800 bg-zinc-900 p-1"
                />
              </div>
              {config.bgImage ? (
                <div className="space-y-3">
                  <img
                    src={config.bgImage}
                    alt="Background preview"
                    className="h-20 w-full rounded-lg border border-zinc-800 object-cover"
                  />
                  <SliderRow
                    label="Image dim"
                    value={config.bgImageDim}
                    min={0}
                    max={0.95}
                    step={0.05}
                    display={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => setConfig({ bgImageDim: v })}
                  />
                  <SliderRow
                    label="Image size"
                    value={config.bgScale}
                    min={1}
                    max={3}
                    step={0.05}
                    display={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => setConfig({ bgScale: v })}
                  />
                  <SliderRow
                    label="Move horizontally"
                    value={config.bgOffsetX}
                    min={-1}
                    max={1}
                    step={0.02}
                    display={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => setConfig({ bgOffsetX: v })}
                  />
                  <SliderRow
                    label="Move vertically"
                    value={config.bgOffsetY}
                    min={-1}
                    max={1}
                    step={0.02}
                    display={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => setConfig({ bgOffsetY: v })}
                  />
                  <SwitchRow
                    label="Flip horizontally"
                    checked={config.bgMirror}
                    onChange={(v) => setConfig({ bgMirror: v })}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() =>
                        setConfig({ bgScale: 1, bgOffsetX: 0, bgOffsetY: 0 })
                      }
                    >
                      <MoveHorizontal className="h-4 w-4" /> Recenter
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setConfig({ bgImage: null })}
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => bgInputRef.current?.click()}
                >
                  <ImagePlus className="h-4 w-4" /> Add background image
                </Button>
              )}
            </>
          )}
          <input
            ref={bgInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label="Background image file"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onBgImage(file)
              e.target.value = ''
            }}
          />
        </section>

        <Separator className="bg-zinc-800/70" />

        {/* Text overlay */}
        <section className="space-y-3">
          <SectionTitle>Text overlay</SectionTitle>
          <SwitchRow
            label="Show title"
            checked={config.showTitle}
            onChange={(v) => setConfig({ showTitle: v })}
          />
          {config.showTitle && (
            <>
              <Input
                value={config.title}
                onChange={(e) => setConfig({ title: e.target.value })}
                placeholder="Track title"
                aria-label="Overlay title"
                maxLength={80}
              />
              <Input
                value={config.subtitle}
                onChange={(e) => setConfig({ subtitle: e.target.value })}
                placeholder="Subtitle (artist, album…)"
                aria-label="Overlay subtitle"
                maxLength={80}
              />
            </>
          )}
        </section>

        <Separator className="bg-zinc-800/70" />

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            resetConfig()
            toast({ title: 'Style reset to defaults' })
          }}
        >
          <RotateCcw className="h-4 w-4" /> Reset to defaults
        </Button>
      </div>
    </ScrollArea>
  )
}
