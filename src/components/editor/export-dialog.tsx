'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Ban, Check, Clapperboard, Download, FileVideo, Info, Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { downloadBlob, formatTime } from '@/lib/format'
import { ExportCancelledError, exportOfflineMp4 } from '@/lib/export/offline-export'
import type { AspectRatio } from '@/lib/types'
import { useEditorStore } from '@/store/editor'
import { toast } from '@/hooks/use-toast'

const MB = 1024 * 1024

type Phase = 'idle' | 'rendering' | 'done'
type Quality = 'standard' | 'high' | 'max'

const QUALITY_BPP: Record<Quality, number> = {
  standard: 0.1,
  high: 0.2,
  max: 0.32,
}

const QUALITY_LABEL: Record<Quality, string> = {
  standard: 'Standard',
  high: 'High',
  max: 'Maximum',
}

/** Output resolution presets per canvas aspect ("1080p"-style naming) */
const RESOLUTIONS: Record<AspectRatio, { width: number; height: number; label: string }[]> = {
  '16:9': [
    { width: 1280, height: 720, label: '720p' },
    { width: 1920, height: 1080, label: '1080p' },
    { width: 2560, height: 1440, label: '1440p' },
    { width: 3840, height: 2160, label: '4K' },
  ],
  '9:16': [
    { width: 720, height: 1280, label: '720p' },
    { width: 1080, height: 1920, label: '1080p' },
    { width: 1440, height: 2560, label: '1440p' },
    { width: 2160, height: 3840, label: '4K' },
  ],
  '1:1': [
    { width: 720, height: 720, label: '720' },
    { width: 1080, height: 1080, label: '1080' },
    { width: 1440, height: 1440, label: '1440' },
    { width: 2160, height: 2160, label: '2160' },
  ],
}

const FPS_OPTIONS = [24, 30, 60] as const

/** Static client capability, read hydration-safely */
const subscribeNoop = () => () => {}
function getWebCodecsSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.VideoEncoder === 'function'
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'track'
  )
}

/**
 * Offline video export: renders every visualizer frame deterministically from
 * the decoded original audio and muxes H.264 + AAC into an MP4 whose audio is
 * sample-accurate with respect to the picture — no clicks, no drift, and the
 * file drops straight into DaVinci Resolve with the music already in sync.
 */
export function ExportDialog({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ pct: 0, label: '', elapsedSec: 0 })
  const [result, setResult] = useState<{
    blob: Blob
    frames: number
    durationSec: number
    width: number
    height: number
    fps: number
    audio: boolean
    audioCodec: string | null
    filename: string
  } | null>(null)

  const track = useEditorStore((s) => s.track)
  const audioFile = useEditorStore((s) => s.audioFile)
  const aspect = useEditorStore((s) => s.config.aspect)
  const transparentBg = useEditorStore((s) => s.config.transparentBg)
  const config = useEditorStore((s) => s.config)
  const showLyrics = useEditorStore((s) => s.showLyrics)
  const lyricsLines = useEditorStore((s) => s.lyrics)
  const lyricsSize = useEditorStore((s) => s.lyricsSize)
  const lyricsPosition = useEditorStore((s) => s.lyricsPosition)
  const lyricsColor = useEditorStore((s) => s.lyricsColor)
  const lyricsGlowColor = useEditorStore((s) => s.lyricsGlowColor)
  const lyricsGlow = useEditorStore((s) => s.lyricsGlow)

  const webCodecsOk = useSyncExternalStore(subscribeNoop, getWebCodecsSupported, () => false)

  const [resIndex, setResIndex] = useState(1)
  const [fps, setFps] = useState<(typeof FPS_OPTIONS)[number]>(30)
  const [quality, setQuality] = useState<Quality>('high')
  const [fullTrack, setFullTrack] = useState(true)
  const [includeAudio, setIncludeAudio] = useState(true)
  const [rangeStart, setRangeStart] = useState('0')
  const [rangeEnd, setRangeEnd] = useState('10')

  const cancelRef = useRef({ cancelled: false })
  const startedAtRef = useRef(0)

  const resolutions = RESOLUTIONS[aspect]
  const res = resolutions[Math.min(resIndex, resolutions.length - 1)]
  const duration = track?.duration ?? 0
  const bitrate = Math.round(
    Math.min(40_000_000, Math.max(4_000_000, res.width * res.height * fps * QUALITY_BPP[quality]))
  )
  const estBytes = duration > 0 && fullTrack ? (bitrate * duration) / 8 : null

  // Elapsed timer while rendering
  useEffect(() => {
    if (phase !== 'rendering') return
    const tick = () =>
      setProgress((p) => ({ ...p, elapsedSec: (Date.now() - startedAtRef.current) / 1000 }))
    const id = window.setInterval(tick, 500)
    return () => window.clearInterval(id)
  }, [phase])

  const onOpenChange = (next: boolean) => {
    if (!next && phase === 'rendering') {
      cancelRef.current.cancelled = true
      setPhase('idle')
      setProgress({ pct: 0, label: '', elapsedSec: 0 })
    }
    setOpen(next)
    if (next) {
      setPhase('idle')
      setResult(null)
      setError(null)
      setProgress({ pct: 0, label: '', elapsedSec: 0 })
      cancelRef.current = { cancelled: false }
      setRangeStart('0')
      setRangeEnd(String(Math.min(10, Math.max(1, Math.floor(duration)) || 10)))
    }
  }

  const start = async () => {
    if (!audioFile) {
      setError('The original audio file is not available — load the track again.')
      return
    }
    const startSec = fullTrack ? 0 : Math.max(0, Number(rangeStart) || 0)
    const endSec = fullTrack ? duration : Number(rangeEnd) || 0
    if (!fullTrack && endSec - startSec < 0.2) {
      setError('The selected range is too short (minimum 0.2 s).')
      return
    }
    cancelRef.current = { cancelled: false }
    setError(null)
    setResult(null)
    setPhase('rendering')
    startedAtRef.current = Date.now()
    setProgress({ pct: 0, label: 'Preparing…', elapsedSec: 0 })

    try {
      const out = await exportOfflineMp4({
        audioFile,
        config,
        lyrics: {
          showLyrics,
          lyrics: lyricsLines,
          lyricsSize,
          lyricsPosition,
          lyricsColor,
          lyricsGlowColor,
          lyricsGlow,
        },
        width: res.width,
        height: res.height,
        fps,
        bitrate,
        startSec,
        endSec,
        includeAudio,
        cancelToken: cancelRef.current,
        onProgress: (pct, label) => setProgress((p) => ({ ...p, pct, label })),
      })
      const filename = `spectra-${slugify(track?.name ?? 'track')}-${res.height}p-${fps}fps.mp4`
      setResult({ ...out, filename })
      setPhase('done')
      // Test/automation hook — also handy for support debugging
      ;(window as unknown as { __spectraLastExport?: unknown }).__spectraLastExport = {
        blob: out.blob,
        filename,
      }
      toast({
        title: 'Export ready — frame-accurate MP4',
        description: out.audio
          ? 'Original audio muxed in perfect sync. Drops straight into DaVinci Resolve.'
          : 'Video only (no audio encoder was available) — add your song on the timeline.',
      })
    } catch (err) {
      if (err instanceof ExportCancelledError || cancelRef.current.cancelled) {
        setPhase('idle')
        setProgress({ pct: 0, label: '', elapsedSec: 0 })
        return
      }
      const message = err instanceof Error ? err.message : 'Unknown export error'
      setError(message)
      setPhase('idle')
      toast({ title: 'Export failed', description: message, variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Clapperboard className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Export video</span>
        </Button>
      </DialogTrigger>
      {/* `dark` re-applies the theme tokens inside the portal (the app's dark
          class lives on its root div, which the portal escapes) */}
      <DialogContent className="dark bg-background text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export video (offline render)</DialogTitle>
          <DialogDescription>
            Renders every frame directly from your audio file — no real-time capture, so the
            picture and the music are locked together sample-for-sample. No clicks, no drift.
          </DialogDescription>
        </DialogHeader>

        {phase === 'done' && result ? (
          <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-3" aria-live="polite">
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
              <Check className="h-4 w-4 shrink-0" aria-hidden />
              Export ready — {result.frames} frames · {formatTime(result.durationSec)}
            </p>
            <p className="font-mono text-[11px] text-zinc-400">
              {result.filename} · {(result.blob.size / MB).toFixed(1)} MB ·{' '}
              {result.width}×{result.height} @ {result.fps} fps
              {result.audio ? ` · audio: ${result.audioCodec ?? 'none'}` : ' · video only'}
            </p>
            <Button
              className="w-full"
              onClick={() => downloadBlob(result.blob, result.filename)}
              aria-label={`Download ${result.filename}`}
            >
              <Download className="h-4 w-4" aria-hidden />
              Download MP4
            </Button>
            <p className="text-[11px] leading-snug text-zinc-500">
              The MP4 already contains the original audio, perfectly synced. In DaVinci Resolve:
              Media Pool → Import Media → drop it on the timeline — nothing to line up.
            </p>
          </div>
        ) : phase === 'rendering' ? (
          <div className="space-y-3" aria-live="polite">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 font-semibold text-zinc-100">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-400" aria-hidden />
                Rendering offline
              </span>
              <span className="font-mono tabular-nums text-zinc-400">
                {progress.pct > 0 ? `${Math.round(progress.pct * 100)}%` : ''} ·{' '}
                {formatTime(progress.elapsedSec)}
              </span>
            </div>
            <Progress value={Math.max(2, progress.pct * 100)} className="h-2" />
            <p className="truncate font-mono text-[11px] text-zinc-500">{progress.label}</p>
            <p className="text-xs leading-snug text-zinc-500">
              Faster than real time — you can switch tabs while it renders.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                cancelRef.current.cancelled = true
              }}
              aria-label="Cancel export"
            >
              <Ban className="h-4 w-4" aria-hidden />
              Cancel
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {!webCodecsOk && (
              <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-snug text-red-300">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                This browser has no WebCodecs video encoder. Offline export needs Chrome, Edge,
                Firefox 130+ or Safari 16.4+.
              </p>
            )}
            {transparentBg && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-snug text-amber-300">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Transparent background is on, but MP4 cannot store transparency — the export will
                use your solid background color. Use PNG Seq for alpha footage.
              </p>
            )}

            {/* Resolution */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Resolution ({aspect})
              </Label>
              <div className="grid grid-cols-4 gap-2">
                {resolutions.map((r, i) => {
                  const active = i === resIndex
                  return (
                    <button
                      key={r.label}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setResIndex(i)}
                      className={`rounded-xl border px-2 py-2.5 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                        active
                          ? 'border-emerald-500/70 bg-emerald-500/10'
                          : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
                      }`}
                    >
                      <span className={`block text-sm font-semibold ${active ? 'text-zinc-100' : 'text-zinc-400'}`}>
                        {r.label}
                      </span>
                      <span className="block font-mono text-[10px] text-zinc-500">
                        {r.width}×{r.height}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* FPS + quality */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Frame rate
                </Label>
                <div className="grid grid-cols-3 gap-1.5">
                  {FPS_OPTIONS.map((value) => {
                    const active = fps === value
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setFps(value)}
                        className={`rounded-xl border px-1 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                          active
                            ? 'border-emerald-500/70 bg-emerald-500/10 text-zinc-100'
                            : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        {value}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Quality
                </Label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(Object.keys(QUALITY_BPP) as Quality[]).map((q) => {
                    const active = quality === q
                    return (
                      <button
                        key={q}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setQuality(q)}
                        className={`rounded-xl border px-1 py-2 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                          active
                            ? 'border-emerald-500/70 bg-emerald-500/10 text-zinc-100'
                            : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        {QUALITY_LABEL[q]}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Range */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="export-full-track" className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Full track
                </Label>
                <Switch id="export-full-track" checked={fullTrack} onCheckedChange={setFullTrack} />
              </div>
              {!fullTrack && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="export-range-start" className="text-[11px] text-zinc-500">
                      Start (seconds)
                    </Label>
                    <Input
                      id="export-range-start"
                      type="number"
                      min={0}
                      max={duration}
                      step={0.1}
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                      className="h-9 font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="export-range-end" className="text-[11px] text-zinc-500">
                      End (seconds)
                    </Label>
                    <Input
                      id="export-range-end"
                      type="number"
                      min={0}
                      max={duration}
                      step={0.1}
                      value={rangeEnd}
                      onChange={(e) => setRangeEnd(e.target.value)}
                      className="h-9 font-mono"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Audio */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="export-audio" className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                    Include audio
                  </Label>
                  <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
                    Taken from the original file — sample-accurate, full quality.
                  </p>
                </div>
                <Switch id="export-audio" checked={includeAudio} onCheckedChange={setIncludeAudio} />
              </div>
            </div>

            <p className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-[11px] leading-snug text-zinc-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
              {estBytes != null && (
                <span className="font-mono">
                  ~{(estBytes / MB).toFixed(0)} MB ·{' '}
                </span>
              )}
              <span>
                {res.width}×{res.height} @ {fps} fps · {(bitrate / 1_000_000).toFixed(0)} Mbps ·
                renders offline, faster than real time.
              </span>
            </p>

            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-snug text-red-300">
                {error}
              </p>
            )}

            <Button
              className="w-full"
              onClick={() => void start()}
              disabled={!webCodecsOk || !track || !audioFile || duration <= 0}
            >
              <FileVideo className="h-4 w-4" aria-hidden />
              Render {fullTrack ? 'full track' : 'selected range'}
            </Button>
            {!track && (
              <p className="text-center text-[11px] text-zinc-500">
                Load an audio track first — the export renders from the original file.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
