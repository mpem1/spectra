'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Circle, Download, Radio, Square } from 'lucide-react'
import type { ExportProgress } from '@/lib/visualizer/types'
import { exportMP4 } from '@/lib/export/exporter'
import { toast } from 'sonner'
import { useStudioStore } from '@/store/studio'
import { getEngine, getPreviewControls } from '@/components/studio/engine-registry'
import { getPreviewCanvas } from '@/components/studio/canvas-registry'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MicroLabel } from '@/components/studio/controls'
import type { ExportLength, ExportResolution } from '@/lib/visualizer/types'
import { cn } from '@/lib/utils'

const RESOLUTION_LABELS: Record<ExportResolution, string> = {
  '1280x720': '1280 × 720 · 16:9',
  '1920x1080': '1920 × 1080 · 16:9',
  '1080x1080': '1080 × 1080 · 1:1',
  '720x1280': '720 × 1280 · 9:16',
}

const LENGTH_LABELS: Record<ExportLength, string> = {
  full: 'Full song',
  '30s': '30 seconds',
  '15s': '15 seconds',
}

const PHASE_LABELS: Record<ExportProgress['phase'], string> = {
  preparing: 'Preparing…',
  rendering: 'Rendering frames…',
  encoding: 'Encoding video…',
  muxing: 'Muxing MP4…',
  done: 'Finalizing…',
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function formatElapsed(seconds: number): string {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function pickRecorderMime(alpha: boolean): string {
  const candidates = alpha
    ? ['video/webm;codecs=vp9', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) {
      return candidate
    }
  }
  return ''
}

export function ExportTab() {
  const audioMeta = useStudioStore((s) => s.audioMeta)
  const backgroundMode = useStudioStore((s) => s.config.background.mode)
  const exportSettings = useStudioStore((s) => s.exportSettings)
  const setExportSettings = useStudioStore((s) => s.setExportSettings)

  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const cancelFlagRef = useRef({ cancelled: false })

  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTickRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  const hasAudio = audioMeta !== null
  const alphaRecording = backgroundMode === 'transparent'

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
      const rec = recorderRef.current
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null
        rec.stop()
      }
    }
  }, [])

  const handleExport = async () => {
    const engine = getEngine()
    const audioBuffer = engine?.audioBuffer
    if (!audioBuffer) {
      toast.error('Load audio first', {
        description: 'Deterministic export muxes your original audio file.',
      })
      return
    }
    const { config, exportSettings: settings } = useStudioStore.getState()
    cancelFlagRef.current = { cancelled: false }
    setExporting(true)
    setProgress(null)
    try {
      // `signal` is honored by the exporter (cooperative cancel flag).
      const opts = {
        config,
        settings,
        audioBuffer,
        onProgress: (p: ExportProgress) => setProgress(p),
        signal: cancelFlagRef.current,
        onNotice: (message: string) => toast.warning('Export notice', { description: message }),
      }
      const blob = await exportMP4(opts)
      downloadBlob(blob, 'pulse-studio.mp4')
      toast.success('MP4 exported', {
        description: `pulse-studio.mp4 · ${(blob.size / (1024 * 1024)).toFixed(1)} MB`,
      })
    } catch (err) {
      if (cancelFlagRef.current.cancelled) {
        toast.info('Export cancelled')
      } else {
        toast.error('Export failed', {
          description: err instanceof Error ? err.message : 'Unknown error while exporting.',
        })
      }
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }

  const stopRecording = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
    recorderRef.current = null
    setRecording(false)
    getPreviewControls()?.pause()
  }

  const startRecording = () => {
    const canvas = getPreviewCanvas()
    if (!canvas) {
      toast.error('Preview canvas not ready')
      return
    }
    const alpha = useStudioStore.getState().config.background.mode === 'transparent'
    let stream: MediaStream
    try {
      stream = canvas.captureStream(30)
    } catch {
      toast.error('Canvas capture is not supported in this browser')
      return
    }
    const mimeType = pickRecorderMime(alpha)
    let recorder: MediaRecorder
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    } catch {
      toast.error('MediaRecorder could not start in this browser')
      return
    }
    chunksRef.current = []
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' })
      stream.getTracks().forEach((t) => t.stop())
      if (blob.size > 0) {
        downloadBlob(blob, 'pulse-recording.webm')
        toast.success('Recording saved', {
          description: `pulse-recording.webm · ${(blob.size / (1024 * 1024)).toFixed(1)} MB`,
        })
      } else {
        toast.error('Recording was empty')
      }
    }
    recorder.start()
    recorderRef.current = recorder

    // Force playback from the top so the capture is a full run-through.
    getPreviewControls()?.seek(0)
    getPreviewControls()?.play()

    setRecording(true)
    setElapsed(0)
    startTickRef.current = Date.now()
    timerRef.current = window.setInterval(() => {
      const secs = (Date.now() - startTickRef.current) / 1000
      setElapsed(secs)
      // Auto-stop once playback has finished (audio ended or demo loop wrapped).
      const controls = getPreviewControls()
      if (secs > 1.5 && controls && !controls.isPlaying()) stopRecording()
    }, 250)
  }

  const handleSnapshot = () => {
    const canvas = getPreviewCanvas()
    if (!canvas) {
      toast.error('Preview canvas not ready')
      return
    }
    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, 'pulse-frame.png')
        toast.success('Frame saved', { description: 'pulse-frame.png' })
      } else {
        toast.error('Could not read the canvas frame')
      }
    }, 'image/png')
  }

  return (
    <div className="space-y-4">
      {/* Deterministic export */}
      <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-zinc-100">Deterministic export</h3>
          <Badge className="border border-emerald-500/30 bg-emerald-500/10 text-[9px] font-semibold tracking-widest text-emerald-400">
            FRAME-EXACT
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <MicroLabel>Format</MicroLabel>
            <Select
              value={exportSettings.format}
              onValueChange={(format) => setExportSettings({ format: 'mp4' })}
              disabled={exporting}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Export format">
                <SelectValue placeholder="Format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mp4">MP4 (H.264 + au)</SelectItem>
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
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px] leading-snug text-zinc-500">
          <p>Renders offline frame-by-frame, and muxes your audio file.</p>
          <p>No clicks, no drift, perfect sync. Opens directly in DaVinci Resolve.</p>
        </div>

        {exporting && progress ? (
          <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-emerald-400">{PHASE_LABELS[progress.phase]}</span>
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
                onClick={() => {
                  cancelFlagRef.current.cancelled = true
                }}
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
                  className="h-11 w-full bg-emerald-500 font-semibold text-zinc-950 shadow-none hover:bg-emerald-400 disabled:pointer-events-auto disabled:opacity-40"
                  disabled={!hasAudio || exporting || recording}
                  onClick={handleExport}
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
              className={cn('size-3 fill-current', recording ? 'text-red-500' : 'text-zinc-600')}
              aria-hidden
            />
            Live recording (WebM)
          </h3>
          {recording ? (
            <span className="flex items-center gap-1.5 text-xs tabular-nums text-red-400">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-red-500" />
              </span>
              REC {formatElapsed(elapsed)}
            </span>
          ) : (
            <Radio className="size-3.5 text-zinc-600" aria-hidden />
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-500">
          Real-time capture of the preview canvas with playback running from the top. Quick, but
          canvas video only — for perfectly synced output with your audio track, use the
          deterministic export above.
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
            Stop recording · {formatElapsed(elapsed)}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="h-10 w-full border-red-500/40 text-red-400 hover:border-red-500 hover:bg-red-500/10 hover:text-red-300"
            disabled={exporting}
            onClick={startRecording}
          >
            <span className="size-2 rounded-full bg-red-500" aria-hidden />
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
