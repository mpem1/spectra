"use client";

import { useRef } from "react";
import { useEditorStore } from "@/store/editor";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImagePlus, Trash2 } from "lucide-react";

export function BackgroundPanel() {
  const vis = useEditorStore((s) => s.vis);
  const setVis = useEditorStore((s) => s.setVis);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setVis("bgEnabled", true);
      window.dispatchEvent(new CustomEvent("spectra:bg-image", { detail: { image: img, url, name: file.name } }));
    };
    img.src = url;
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="bg-file">Background image</Label>
        <div className="flex items-center gap-2">
          <Input
            id="bg-file"
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button variant="outline" size="sm" className="flex-1" onClick={() => fileRef.current?.click()}>
            <ImagePlus className="mr-2 h-4 w-4" /> Choose image
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setVis("bgEnabled", false);
              window.dispatchEvent(new CustomEvent("spectra:bg-image", { detail: null }));
            }}
            aria-label="Remove background image"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {vis.bgEnabled ? "Image loaded" : "No image — gradient/solid backdrop in use"}
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="bg-scale">Zoom</Label>
          <span className="text-xs tabular-nums text-muted-foreground">{vis.bgScale.toFixed(2)}×</span>
        </div>
        <Slider
          id="bg-scale"
          min={1}
          max={3}
          step={0.01}
          value={[vis.bgScale]}
          onValueChange={([v]) => setVis("bgScale", v)}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="bg-ox">Offset X</Label>
          <span className="text-xs tabular-nums text-muted-foreground">{Math.round(vis.bgOffsetX * 100)}</span>
        </div>
        <Slider
          id="bg-ox"
          min={-0.5}
          max={0.5}
          step={0.01}
          value={[vis.bgOffsetX]}
          onValueChange={([v]) => setVis("bgOffsetX", v)}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="bg-oy">Offset Y</Label>
          <span className="text-xs tabular-nums text-muted-foreground">{Math.round(vis.bgOffsetY * 100)}</span>
        </div>
        <Slider
          id="bg-oy"
          min={-0.5}
          max={0.5}
          step={0.01}
          value={[vis.bgOffsetY]}
          onValueChange={([v]) => setVis("bgOffsetY", v)}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="bg-mirror">Mirror horizontally</Label>
        <Switch id="bg-mirror" checked={vis.bgMirror} onCheckedChange={(v) => setVis("bgMirror", v)} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="bg-dim">Dim overlay</Label>
          <span className="text-xs tabular-nums text-muted-foreground">{Math.round(vis.bgDim * 100)}%</span>
        </div>
        <Slider
          id="bg-dim"
          min={0}
          max={0.9}
          step={0.01}
          value={[vis.bgDim]}
          onValueChange={([v]) => setVis("bgDim", v)}
        />
      </div>

      <div className="rounded-lg border border-dashed p-3">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="bg-transparent" className="text-sm">Transparent background</Label>
            <p className="text-xs text-muted-foreground">
              Render with alpha for PNG/WebM alpha exports
            </p>
          </div>
          <Switch
            id="bg-transparent"
            checked={vis.transparentBg}
            onCheckedChange={(v) => setVis("transparentBg", v)}
          />
        </div>
      </div>
    </div>
  );
}
