"use client";

import { useEditorStore } from "@/store/editor";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Plus, RotateCcw, X } from "lucide-react";
import { GRADIENT_PRESETS, type VisualMode } from "@/lib/types";

const MODES: { value: VisualMode; label: string }[] = [
  { value: "bars", label: "Bars" },
  { value: "wave", label: "Wave" },
  { value: "radial", label: "Radial" },
];

export function VisualPanel() {
  const vis = useEditorStore((s) => s.vis);
  const setVis = useEditorStore((s) => s.setVis);
  const setGradientStops = useEditorStore((s) => s.setGradientStops);
  const resetVisual = useEditorStore((s) => s.resetVisual);

  const updateStop = (i: number, patch: { color?: string; position?: number }) => {
    const next = vis.gradientStops.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    setGradientStops(next);
  };

  const addStop = () => {
    if (vis.gradientStops.length >= 6) return;
    const next = [...vis.gradientStops, { color: "#ffffff", position: 1 }];
    setGradientStops(next);
  };

  const removeStop = (i: number) => {
    if (vis.gradientStops.length <= 1) return;
    setGradientStops(vis.gradientStops.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Label htmlFor="vis-mode">Visualizer style</Label>
        <Select value={vis.mode} onValueChange={(v) => setVis("mode", v as VisualMode)}>
          <SelectTrigger id="vis-mode" size="sm" className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>{MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="vis-bars">Elements</Label>
          <span className="text-xs tabular-nums text-muted-foreground">{vis.barCount}</span>
        </div>
        <Slider id="vis-bars" min={16} max={160} step={4} value={[vis.barCount]} onValueChange={([v]) => setVis("barCount", v)} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="vis-sens">Sensitivity</Label>
          <span className="text-xs tabular-nums text-muted-foreground">{vis.sensitivity.toFixed(2)}×</span>
        </div>
        <Slider id="vis-sens" min={0.5} max={2} step={0.05} value={[vis.sensitivity]} onValueChange={([v]) => setVis("sensitivity", v)} />
      </div>

      <div className="rounded-lg border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Gradient</Label>
          <Button variant="ghost" size="sm" onClick={resetVisual} aria-label="Reset visual settings">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {GRADIENT_PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => setGradientStops(p.stops)}
              className="group flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-accent"
              aria-label={`Apply ${p.name} gradient preset`}
            >
              <span
                className="h-3.5 w-6 rounded-sm"
                style={{ background: `linear-gradient(90deg, ${p.stops.map((s) => s.color).join(",")})` }}
              />
              {p.name}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {vis.gradientStops.map((stop, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="color"
                value={stop.color}
                onChange={(e) => updateStop(i, { color: e.target.value })}
                className="h-7 w-9 cursor-pointer rounded border"
                aria-label={`Stop ${i + 1} color`}
              />
              <Slider
                className="flex-1"
                min={0}
                max={1}
                step={0.01}
                value={[stop.position]}
                onValueChange={([v]) => updateStop(i, { position: v })}
                aria-label={`Stop ${i + 1} position`}
              />
              <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(stop.position * 100)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => removeStop(i)}
                disabled={vis.gradientStops.length <= 1}
                aria-label={`Remove stop ${i + 1}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="w-full" onClick={addStop} disabled={vis.gradientStops.length >= 6}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add color stop
          </Button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="grad-angle" className="text-xs">Angle</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{Math.round(vis.gradientAngle)}°</span>
          </div>
          <Slider id="grad-angle" min={0} max={360} step={1} value={[vis.gradientAngle]} onValueChange={([v]) => setVis("gradientAngle", v)} />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="grad-cycle" className="text-xs">Cycle colors</Label>
          <Switch id="grad-cycle" checked={vis.gradientCycle} onCheckedChange={(v) => setVis("gradientCycle", v)} />
        </div>
        {vis.gradientCycle && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="grad-speed" className="text-xs">Cycle speed</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{vis.gradientCycleSpeed}°/s</span>
            </div>
            <Slider id="grad-speed" min={1} max={180} step={1} value={[vis.gradientCycleSpeed]} onValueChange={([v]) => setVis("gradientCycleSpeed", v)} />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="vis-afterglow">Afterglow trails</Label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {vis.afterglow <= 0.01 ? "Off" : Math.round(vis.afterglow * 100) + "%"}
          </span>
        </div>
        <Slider id="vis-afterglow" min={0} max={0.92} step={0.01} value={[vis.afterglow]} onValueChange={([v]) => setVis("afterglow", v)} />
      </div>

      <div className="rounded-lg border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="vis-particles" className="text-sm">Roaming particles</Label>
          <Switch id="vis-particles" checked={vis.particlesEnabled} onCheckedChange={(v) => setVis("particlesEnabled", v)} />
        </div>
        {vis.particlesEnabled && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="vis-pcount" className="text-xs">Count</Label>
              <Input
                id="vis-pcount"
                type="number"
                min={0}
                max={200}
                value={vis.particleCount}
                onChange={(e) => setVis("particleCount", Math.max(0, Math.min(200, Number(e.target.value) || 0)))}
                className="h-7 w-20 text-xs"
              />
            </div>
            <p className="text-xs text-muted-foreground">Particles bounce off the walls and steer around the central zone.</p>
          </div>
        )}
      </div>
    </div>
  );
}
