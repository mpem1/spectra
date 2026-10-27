'use client'

import { Camera, Circle, Download, Square } from 'lucide-react'
import { toast } from 'sonner'
import type { ExportLength, ExportQuality, ExportResolution } from '@/lib/visualizer/types'
import {
  useStudioStore,
  downloadBlob,
  EXPORT_QUALITY_LABELS,
} from '@/store/studio'
import { getPreviewCanvas } from '@/components/studio/canvas-registry'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MicroLabel } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

const RESOLUTION_LABELS: Record<ExportResolution, string> = {
  '1280x720': '1280 × 720',
  '1920x1080': '1920 × 1080',
  '1080x1080': '1080 × 1080',
  '720x1280': '720 × 1280',
}

const LENGTH_LABELS: Record<ExportLength, string> = {
  full: 'Full song',
  '30s': '30 seconds',
  '15s': '15 seconds',
}

const PHASE_LABELS: Record<string, string> = {
  preparing: 'Preparing…',
  rendering: 'Rendering frames…',
  encoding: 'Encoding video…',
  muxing: 'Muxing MP4…',
  done: 'Finalizing…',
}

function formatElapsed(seconds: number): string {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function ExportTab() {
  const audioMeta = useStudioStore((s) => s.audioMeta)
  const backgroundMode = useStudioStore((s) => s.config.background.mode)
  const exportSettings = useStudioStore((s) => s.exportSettings)
  const setExportSettings = useStudioStore((s) => s.setExportSettings)
  const exportJob = useStudioStore((s) => s.exportJob)
  const startExport = useStudioStore((s) => s.startExport)
  const cancelExport = useStudioStore((s) => s.cancelExport)
  const recording = useStudioStore((s) => s.recording)
  const recordElapsed = useStudioStore((s) => s.recordElapsed)
  const startRecording = useStudioStore((s) => s.startRecording)
  const stopRecording = useStudioStore((s) => s.stopRecording)

  const exporting = exportJob.active
  const progress = exportJob.progress
  const hasAudio = audioMeta !== null
  const alphaRecording = backgroundMode === 'transparent'

  const handleSnapshot = () => {
    const canvas = getPreviewCanvas()
    if (!canvas) {
      toast.error('Preview canvas not ready')
      return
    }
    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, 'spectra-frame.png')
        toast.success('Frame saved', { description: 'spectra-frame.png' })
      } else {
        toast.error('Could not read the canvas frame')
      }
    }, 'image/png')
  }

  return (
    <div className="space-y-3">
      {/* Deterministic export */}
      <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-100">
            <Download className="size-3.5 text-zinc-400" aria-hidden />
            Deterministic export
          </h3>
          <Badge className="border border-emerald-500/30 bg-emerald-500/10 text-[9px] font-semibold tracking-widest text-emerald-400">
            FRAME-EXACT
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <MicroLabel>Format</MicroLabel>
            <Select
              value={exportSettings.format}
              onValueChange={() => setExportSettings({ format: 'mp4' })}
              disabled={exporting}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Export format">
                <SelectValue placeholder="Format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mp4">MP4 (H.264 + audio)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <MicroLabel>Frame rate</MicroLabel>
            <Select
              value={String(exportSettings.fps)}
              onValueChange={(v) => setExportSettings({ fps: Number(v) as 24 | 30 | 60 })}
              disabled={exporting}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Frame rate">
                <SelectValue placeholder="Frame rate" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24 fps</SelectItem>
                <SelectItem value="30">30 fps</SelectItem>
                <SelectItem value="60">60 fps</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <MicroLabel>Resolution</MicroLabel>
            <Select
              value={exportSettings.resolution}
              onValueChange={(resolution) =>
                setExportSettings({ resolution: resolution as ExportResolution })
              }
              disabled={exporting}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Resolution">
                <SelectValue placeholder="Resolution" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(RESOLUTION_LABELS) as ExportResolution[]).map((res) => (
                  <SelectItem key={res} value={res}>
                    {RESOLUTION_LABELS[res]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <MicroLabel>Length</MicroLabel>
            <Select
              value={exportSettings.length}
              onValueChange={(length) => setExportSettings({ length: length as ExportLength })}
              disabled={exporting}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Export length">
                <SelectValue placeholder="Length" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(LENGTH_LABELS) as ExportLength[]).map((len) => (
                  <SelectItem key={len} value={len}>
                    {LENGTH_LABELS[len]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <MicroLabel>Quality</MicroLabel>
            <Select
              value={exportSettings.quality ?? 'high'}
              onValueChange={(quality) => setExportSettings({ quality: quality as ExportQuality })}
              disabled={exporting}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Export quality">
                <SelectValue placeholder="Quality" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(EXPORT_QUALITY_LABELS) as ExportQuality[]).map((q) => (
                  <SelectItem key={q} value={q}>
                    {EXPORT_QUALITY_LABELS[q]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-500">
          Renders offline frame-by-frame and muxes your{' '}
          <span className="inline-block rounded border border-zinc-700 bg-zinc-950 px-1 py-px font-medium text-zinc-300">
            original audio file
          </span>{' '}
          — no clicks, no drift, perfect sync. Opens directly in DaVinci Resolve.
        </p>
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Glow and gradient-heavy visuals need bitrate — if the file looks soft, raise{' '}
          <span className="font-medium text-zinc-400">Quality</span> before dropping resolution.
        </p>

        {exporting && progress ? (
          <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-emerald-400">
                {PHASE_LABELS[progress.phase] ?? 'Working…'}
              </span>
              <span className="tabular-nums text-zinc-300">
                {Math.round(progress.progress * 100)}%
              </span>
            </div>
            <Progress
              value={Math.round(progress.progress * 100)}
              aria-label="Export progress"
              className="h-2 bg-zinc-800"
            />
            <div className="flex items-center justify-between text-[10px] tabular-nums text-zinc-500">
              <span>t = {progress.time.toFixed(1)}s</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-zinc-700 text-xs"
                onClick={cancelExport}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block w-full">
                <Button
                  className="h-11 w-full border border-zinc-800 bg-zinc-950 font-semibold text-zinc-100 shadow-none hover:border-zinc-700 hover:bg-black disabled:pointer-events-auto disabled:opacity-40"
                  disabled={!hasAudio || exporting || recording}
                  onClick={() => void startExport()}
                >
                  <Download className="size-4" />
                  Export MP4
                </Button>
              </span>
            </TooltipTrigger>
            {!hasAudio ? (
              <TooltipContent>
                <p className="text-xs">Load audio first — export muxes your audio file.</p>
              </TooltipContent>
            ) : null}
          </Tooltip>
        )}
        {!hasAudio ? (
          <p className="text-center text-[11px] text-zinc-600">Load audio first to enable export.</p>
        ) : null}
      </section>

      {/* Live recording */}
      <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-100">
            <Circle
              className={cn(
                'size-3 fill-current',
                recording ? 'animate-pulse text-red-500' : 'text-zinc-600',
              )}
              aria-hidden
            />
            Live recording (WebM/MP4)
          </h3>
          {recording ? (
            <span className="flex items-center gap-1.5 text-xs tabular-nums text-red-400">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-red-500" />
              </span>
              REC {formatElapsed(recordElapsed)}
            </span>
          ) : null}
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-500">
          Real-time screen capture with the recorded audio track. Quick, but the audio is
          re-recorded — for perfectly synced output use the deterministic export above.
        </p>
        {alphaRecording ? (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-[11px] text-emerald-300/90">
            Alpha recording (VP8 + alpha) is active because transparent background is on.
          </p>
        ) : null}

        {recording ? (
          <Button
            className="h-10 w-full bg-red-600 font-semibold text-white hover:bg-red-500"
            onClick={stopRecording}
          >
            <Square className="size-4 fill-current" />
            Stop recording · {formatElapsed(recordElapsed)}
          </Button>
        ) : (
          <Button
            className="h-10 w-full border border-zinc-800 bg-zinc-950 font-medium text-zinc-100 shadow-none hover:border-zinc-700 hover:bg-black"
            disabled={exporting}
            onClick={startRecording}
          >
            <span className="size-2.5 rounded-full bg-red-500" aria-hidden />
            Start recording
          </Button>
        )}
      </section>

      {/* Snapshot */}
      <Button
        variant="outline"
        className="h-10 w-full border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900"
        onClick={handleSnapshot}
      >
        <Camera className="size-4" />
        Snapshot current frame (PNG)
      </Button>
    </div>
  )
}
