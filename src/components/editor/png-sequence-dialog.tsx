'use client'

import { useEffect, useRef, useState } from 'react'
import { Ban, Check, Circle, Images, Info, Loader2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { downloadBlob, formatTime } from '@/lib/format'
import { PngSequenceRecorder } from '@/lib/export/png-sequence'
import { setFrameSink } from '@/lib/export/frame-sink'
import { getAudioEngine } from '@/lib/audio/engine'
import { useEditorStore } from '@/store/editor'
import { toast } from '@/hooks/use-toast'

const MB = 1024 * 1024
/** In-memory assembly becomes risky beyond roughly this size */
const MEMORY_WARN_BYTES = 1.2 * 1024 * 1024 * 1024

type Phase = 'idle' | 'recording' | 'done'

/**
 * Export the visualizer as a PNG image sequence (ZIP). This is the
 * zero-dependency route for TRANSPARENT footage into DaVinci Resolve: no
 * ffmpeg, no uploads, no conversion — Resolve imports the frames natively
 * with full alpha.
 */
export function PngSequenceDialog({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [fps, setFps] = useState<30 | 60>(30)
  const [phase, setPhase] = useState<Phase>('idle')
  const [saveMode, setSaveMode] = useState<'disk' | 'memory'>('memory')
  const [progress, setProgress] = useState({ frames: 0, elapsedSec: 0, estBytes: 0 })
  const [result, setResult] = useState<{
    blob: Blob | null
    frames: number
    filename: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const recorderRef = useRef<PngSequenceRecorder | null>(null)
  const startedAtRef = useRef(0)
  const transparentBg = useEditorStore((s) => s.config.transparentBg)

  // Live progress while capturing
  useEffect(() => {
    if (phase !== 'recording') return
    const tick = () => {
      const rec = recorderRef.current
      if (!rec) return
      setProgress({
        frames: rec.frames,
        elapsedSec: (Date.now() - startedAtRef.current) / 1000,
        estBytes: rec.estimatedBytes,
      })
    }
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [phase])

  // Clear the frame sink no matter how the dialog closes
  const reset = () => {
    setFrameSink(null)
    recorderRef.current = null
    setPhase('idle')
    setProgress({ frames: 0, elapsedSec: 0, estBytes: 0 })
  }

  const onOpenChange = (next: boolean) => {
    if (!next && phase === 'recording') {
      recorderRef.current?.cancel()
      reset()
    }
    setOpen(next)
    if (next) {
      setPhase('idle')
      setResult(null)
      setError(null)
      setProgress({ frames: 0, elapsedSec: 0, estBytes: 0 })
    }
  }

  const start = async () => {
    const canvas = getAudioEngine().canvasEl
    if (!canvas) {
      setError('The preview canvas is not ready yet — try again in a moment.')
      return
    }
    setStarting(true)
    setError(null)
    const rec = new PngSequenceRecorder({
      fps,
      suggestedName: `spectra-frames-${fps}fps-${Date.now()}.zip`,
    })
    const started = await rec.start()
    setStarting(false)
    if (!started.started) {
      // User dismissed the save dialog — not an error
      if (started.reason !== 'cancelled') {
        setError(started.reason ?? 'Could not start the capture.')
      }
      return
    }
    recorderRef.current = rec
    setSaveMode(started.mode)
    startedAtRef.current = Date.now()
    setFrameSink((c, now) => rec.handleFrame(c, now))
    setPhase('recording')
  }

  const finish = async (cancel = false) => {
    const rec = recorderRef.current
    if (!rec) return
    setFrameSink(null)
    recorderRef.current = null
    if (cancel) {
      rec.cancel()
      setPhase('idle')
      return
    }
    const res = await rec.finish()
    setPhase('idle')
    if (res.error) {
      setError(res.error)
      return
    }
    if (res.mode === 'disk') {
      setResult(null)
      toast({
        title: 'PNG sequence saved',
        description: `${res.frames} frames streamed to the ZIP you picked — unzip it and import into your editor.`,
      })
      setPhase('done')
      setResult({ blob: null, frames: res.frames, filename: '' })
    } else {
      setResult({
        blob: res.blob,
        frames: res.frames,
        filename: `spectra-frames-${fps}fps-${Date.now()}.zip`,
      })
      setPhase('done')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Images className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">PNG Seq</span>
        </Button>
      </DialogTrigger>
      {/* `dark` re-applies theme tokens inside the portal (the app's dark class
          lives on its root div, which the portal escapes) */}
      <DialogContent className="dark bg-background text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export a PNG image sequence</DialogTitle>
          <DialogDescription>
            Lossless frame-by-frame capture — DaVinci Resolve imports PNG sequences
            natively, with full transparency and no conversion software.
          </DialogDescription>
        </DialogHeader>

        {phase === 'done' && result ? (
          <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-3" aria-live="polite">
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
              <Check className="h-4 w-4 shrink-0" aria-hidden />
              Sequence captured — {result.frames} frames
            </p>
            {result.blob ? (
              <>
                <p className="font-mono text-[11px] text-zinc-400">
                  {result.filename} · {(result.blob.size / MB).toFixed(1)} MB
                </p>
                <Button
                  className="w-full"
                  onClick={() => result.blob && downloadBlob(result.blob, result.filename)}
                  aria-label={`Download ${result.filename}`}
                >
                  <Images className="h-4 w-4" aria-hidden />
                  Download ZIP
                </Button>
              </>
            ) : (
              <p className="text-xs leading-snug text-zinc-400">
                Streamed straight to the ZIP file you picked — nothing else to do here.
              </p>
            )}
            <p className="text-[11px] leading-snug text-zinc-500">
              In DaVinci Resolve: unzip, then Media Pool → Import Media → select the
              first PNG (enable &ldquo;Image Sequence&rdquo;) → set the clip frame rate to{' '}
              {fps} fps. Drop your music on the timeline — frame counts line up 1:1.
            </p>
          </div>
        ) : phase === 'recording' ? (
          <div className="space-y-3" aria-live="polite">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 font-semibold text-zinc-100">
                <Circle className="h-3 w-3 animate-pulse fill-red-500 text-red-500" aria-hidden />
                Capturing frames
              </span>
              <span className="font-mono tabular-nums text-zinc-400">
                {progress.frames} frames · {formatTime(progress.elapsedSec)}
              </span>
            </div>
            <Progress
              value={progress.estBytes > 0 ? Math.min(100, (progress.estBytes / MEMORY_WARN_BYTES) * 100) : undefined}
              className={progress.estBytes > MEMORY_WARN_BYTES ? 'h-2' : 'h-2 opacity-50'}
            />
            <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-zinc-500">
              <span>
                {saveMode === 'disk'
                  ? 'Streaming directly to the ZIP on disk'
                  : `Assembling in memory · est. ${(progress.estBytes / MB).toFixed(0)} MB`}
              </span>
            </div>
            {saveMode === 'memory' && progress.estBytes > MEMORY_WARN_BYTES && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-snug text-amber-300">
                This sequence is getting very large for in-memory assembly. Stop soon,
                or use Chrome/Edge which streams the ZIP straight to disk.
              </p>
            )}
            <p className="text-xs leading-snug text-zinc-500">
              Recording runs in real time — start playback, then press Stop when done.
              The preview keeps animating normally while frames are captured.
            </p>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => void finish(false)}>
                <Square className="h-4 w-4" aria-hidden />
                Stop &amp; save sequence
              </Button>
              <Button variant="outline" onClick={() => void finish(true)} aria-label="Cancel sequence capture">
                <Ban className="h-4 w-4" aria-hidden />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {transparentBg && (
              <p className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs leading-snug text-emerald-300">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Transparent background is on — every frame keeps the alpha channel.
                This is the recommended export for transparent overlays in Resolve.
              </p>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Frame rate
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([30, 60] as const).map((value) => {
                  const active = fps === value
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFps(value)}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                        active
                          ? 'border-emerald-500/70 bg-emerald-500/10 text-zinc-100'
                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      {value} fps
                      <span className="text-[10px] font-medium text-zinc-500">
                        {value === 30 ? 'smaller file' : 'smoother motion'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <p className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-xs leading-snug text-zinc-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
              {PngSequenceRecorder.canStreamToDisk
                ? 'On save, your browser will ask where to put the ZIP — frames stream straight to disk, so length is not a problem.'
                : 'This browser assembles the ZIP in memory — best for clips up to a couple of minutes. Chrome/Edge stream directly to disk instead.'}
            </p>

            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-snug text-red-300">
                {error}
              </p>
            )}

            <Button className="w-full" onClick={() => void start()} disabled={starting}>
              {starting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Images className="h-4 w-4" aria-hidden />
              )}
              {starting ? 'Preparing…' : 'Start frame capture'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
