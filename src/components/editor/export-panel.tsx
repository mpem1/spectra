'use client'

/**
 * Export tab — the quick one-page export panel:
 *
 * 1. Deterministic export (frame-exact): renders every frame offline from the
 *    original audio and either muxes an H.264/AAC MP4 (opens directly in
 *    DaVinci Resolve, sample-accurate sync) or packs a ZIP of alpha PNGs.
 * 2. Live recording: real-time capture with the recorded audio track.
 * 3. Snapshot: download the current frame as a transparent-capable PNG.
 *
 * The advanced dialog (custom range, quality ladder, 4K, include-audio toggle)
 * stays available via the top bar's "Export video" button.
 */

import { useRef, useState, useSyncExternalStore } from 'react'
import {
  Camera,
  Circle,
  CircleStop,
  Download,
  Film,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { downloadBlob, formatTime } from '@/lib/format'
import { ExportCancelledError, exportOfflineMp4 } from '@/lib/export/offline-export'
import { exportOfflinePngZip } from '@/lib/export/offline-png'
import { getAudioEngine } from '@/lib/audio/engine'
import type { AspectRatio } from '@/lib/types'
import { useEditorStore } from '@/store/editor'
import { toast } from '@/hooks/use-toast'

type ExportFormat = 'mp4' | 'png'
type ExportFps = 24 | 30 | 60
type ExportRes = '720' | '1080'
type ExportTrim = 'full' | '30' | '15' | '10'

/** Output sizes per canvas aspect ("720p"/"1080p"-style naming) */
const RESOLUTIONS: Record<AspectRatio, Record<ExportRes, { width: number; height: number }>> = {
  '16:9': {
    '720': { width: 1280, height: 720 },
    '1080': { width: 1920, height: 1080 },
  },
  '9:16': {
    '720': { width: 720, height: 1280 },
    '1080': { width: 1080, height: 1920 },
  },
  '1:1': {
    '720': { width: 720, height: 720 },
    '1080': { width: 1080, height: 1080 },
  },
}

const FPS_OPTIONS: ExportFps[] = [24, 30, 60]

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

interface ExportPanelProps {
  recording: boolean
  recElapsed: number
  /** Argument = force the WebM path so a transparent background keeps its alpha. */
  onStartRecording: (preferAlpha: boolean) => void
  onStopRecording: () => void
}

export function ExportPanel({ recording, recElapsed, onStartRecording, onStopRecording }: ExportPanelProps) {
  const track = useEditorStore((s) => s.track)
  const audioFile = useEditorStore((s) => s.audioFile)
  const config = useEditorStore((s) => s.config)
  const showLyrics = useEditorStore((s) => s.showLyrics)
  const lyricsLines = useEditorStore((s) => s.lyrics)
  const lyricsSize = useEditorStore((s) => s.lyricsSize)
  const lyricsPosition = useEditorStore((s) => s.lyricsPosition)
  const lyricsColor = useEditorStore((s) => s.lyricsColor)
  const lyricsGlowColor = useEditorStore((s) => s.lyricsGlowColor)
  const lyricsGlow = useEditorStore((s) => s.lyricsGlow)

  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [fps, setFps] = useState<ExportFps>(30)
  const [res, setRes] = useState<ExportRes>('720')
  const [trim, setTrim] = useState<ExportTrim>('full')
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState({ pct: 0, label: '' })

  const cancelRef = useRef({ cancelled: false })
  const webCodecsOk = useSyncExternalStore(subscribeNoop, getWebCodecsSupported, () => false)

  const duration = track?.duration ?? 0
  const size = RESOLUTIONS[config.aspect][res]
  const bitrate = Math.round(
    Math.min(40_000_000, Math.max(4_000_000, size.width * size.height * fps * 0.2))
  )

  const lyrics = {
    showLyrics,
    lyrics: lyricsLines,
    lyricsSize,
    lyricsPosition,
    lyricsColor,
    lyricsGlowColor,
    lyricsGlow,
  }

  const setStage = (pct: number, label: string) => setProgress({ pct, label })

  const runExport = async () => {
    if (exporting || !audioFile || !track) return
    const endSec = trim === 'full' ? duration : Math.min(Number(trim), duration)
    cancelRef.current = { cancelled: false }
    setExporting(true)
    setStage(0, 'Preparing…')
    try {
      if (format === 'mp4') {
        const out = await exportOfflineMp4({
          audioFile,
          config,
          lyrics,
          width: size.width,
          height: size.height,
          fps,
          bitrate,
          startSec: 0,
          endSec,
          includeAudio: true,
          cancelToken: cancelRef.current,
          onProgress: setStage,
        })
        const filename = `spectra-${slugify(track.name)}-${out.height}p-${fps}fps.mp4`
        downloadBlob(out.blob, filename)
        toast({
          title: 'Export complete',
          description: out.audio
            ? `${out.frames} frames · ${formatTime(out.durationSec)} · original audio muxed in perfect sync.`
            : `${out.frames} frames · video only (no audio encoder available) — add your song on the timeline.`,
        })
      } else {
        const out = await exportOfflinePngZip({
          audioFile,
          config,
          lyrics,
          width: size.width,
          height: size.height,
          fps,
          startSec: 0,
          endSec,
          cancelToken: cancelRef.current,
          onProgress: setStage,
        })
        const filename = `spectra-${slugify(track.name)}-${out.height}p-${fps}fps-pngseq.zip`
        downloadBlob(out.blob, filename)
        toast({
          title: 'PNG sequence exported',
          description: `${out.frames} frames · ${formatTime(out.durationSec)}${
            config.transparentBg ? ' · alpha preserved' : ''
          }.`,
        })
      }
      ;(window as unknown as { __spectraLastExport?: unknown }).__spectraLastExport = {
        format,
        fps,
        size,
        trim,
      }
    } catch (err) {
      if (err instanceof ExportCancelledError || cancelRef.current.cancelled) {
        toast({ title: 'Export cancelled' })
      } else {
        console.error('[Spectra] Export failed:', err)
        toast({
          title: 'Export failed',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        })
      }
    } finally {
      setExporting(false)
      setStage(0, '')
    }
  }

  const snapshot = () => {
    const canvas = getAudioEngine().canvasEl
    if (!canvas) {
      toast({ title: 'Canvas not ready', description: 'Try again in a moment.', variant: 'destructive' })
      return
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        toast({ title: 'Snapshot failed', variant: 'destructive' })
        return
      }
      downloadBlob(blob, `spectra-snapshot-${Date.now()}.png`)
      toast({ title: 'Snapshot saved (PNG with alpha)' })
    }, 'image/png')
  }

  const recClock = `${Math.floor(recElapsed / 60)}:${String(Math.floor(recElapsed % 60)).padStart(2, '0')}`

  return (
    <div className="space-y-5">
      {/* ---------------- Deterministic export ---------------- */}
      <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Film className="h-4 w-4 text-emerald-400" aria-hidden />
          Deterministic export
          <span className="ml-auto rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
            FRAME-EXACT
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="exp-format" className="text-xs text-zinc-400">
              Format
            </Label>
            <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)} disabled={exporting}>
              <SelectTrigger id="exp-format" size="sm" aria-label="Export format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mp4">MP4 (H.264 + audio)</SelectItem>
                <SelectItem value="png">PNG sequence (alpha)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-fps" className="text-xs text-zinc-400">
              Frame rate
            </Label>
            <Select value={String(fps)} onValueChange={(v) => setFps(Number(v) as ExportFps)} disabled={exporting}>
              <SelectTrigger id="exp-fps" size="sm" aria-label="Frame rate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FPS_OPTIONS.map((f) => (
                  <SelectItem key={f} value={String(f)}>
                    {f} fps
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-res" className="text-xs text-zinc-400">
              Resolution
            </Label>
            <Select value={res} onValueChange={(v) => setRes(v as ExportRes)} disabled={exporting}>
              <SelectTrigger id="exp-res" size="sm" aria-label="Resolution">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="720">
                  {RESOLUTIONS[config.aspect]['720'].width} × {RESOLUTIONS[config.aspect]['720'].height}
                </SelectItem>
                <SelectItem value="1080">
                  {RESOLUTIONS[config.aspect]['1080'].width} × {RESOLUTIONS[config.aspect]['1080'].height}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-trim" className="text-xs text-zinc-400">
              Length
            </Label>
            <Select value={trim} onValueChange={(v) => setTrim(v as ExportTrim)} disabled={exporting}>
              <SelectTrigger id="exp-trim" size="sm" aria-label="Export length">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full song</SelectItem>
                <SelectItem value="30">First 30s (test)</SelectItem>
                <SelectItem value="15">First 15s (test)</SelectItem>
                <SelectItem value="10">First 10s (test)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {format === 'mp4' ? (
          <p className="flex gap-1.5 text-xs leading-snug text-zinc-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Renders offline frame-by-frame and muxes your <strong className="text-zinc-300">original audio
              file</strong> — no clicks, no drift, perfect sync. Opens directly in DaVinci Resolve.
            </span>
          </p>
        ) : (
          <p className="flex gap-1.5 text-xs leading-snug text-zinc-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              One PNG per frame inside a ZIP, rendered offline. With “Transparent background” on, alpha is
              preserved — unzip, import the first PNG with “Image Sequence” enabled, drop in your song.
            </span>
          </p>
        )}

        {config.transparentBg && format === 'mp4' && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs leading-snug text-amber-300">
            MP4 cannot store transparency — this export paints your solid background color. Pick “PNG
            sequence (alpha)” (or Live recording below) for transparent footage.
          </p>
        )}

        {exporting && (
          <div className="space-y-1.5" aria-live="polite">
            <Progress value={Math.max(2, progress.pct * 100)} className="h-2" />
            <p className="truncate font-mono text-[11px] text-zinc-500" data-testid="export-stage">
              {progress.label}
            </p>
          </div>
        )}

        {exporting ? (
          <Button
            variant="destructive"
            className="w-full"
            onClick={() => {
              cancelRef.current.cancelled = true
            }}
          >
            <CircleStop className="h-4 w-4" aria-hidden /> Cancel export
          </Button>
        ) : (
          <Button
            className="w-full"
            onClick={() => void runExport()}
            disabled={!track || !audioFile || duration <= 0 || (format === 'mp4' && !webCodecsOk)}
          >
            <Download className="h-4 w-4" aria-hidden />
            Export {format === 'mp4' ? 'MP4' : 'PNG ZIP'}
          </Button>
        )}
        {!track && (
          <p className="text-center text-[11px] text-zinc-500">
            Load an audio track first — the export renders from the original file.
          </p>
        )}
      </section>

      {/* ---------------- Live recording ---------------- */}
      <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Circle
            className={`h-4 w-4 ${recording ? 'animate-pulse fill-red-500 text-red-500' : 'text-zinc-500'}`}
            aria-hidden
          />
          Live recording (WebM/MP4)
          {recording && (
            <span className="ml-auto font-mono text-xs tabular-nums text-red-400">{recClock}</span>
          )}
        </div>
        <p className="text-xs leading-snug text-zinc-500">
          Real-time capture with the recorded audio track. Quick, but the audio is re-recorded — for
          perfectly synced output use the deterministic export above.
        </p>
        {recording ? (
          <Button variant="destructive" className="w-full" onClick={onStopRecording}>
            <CircleStop className="h-4 w-4" aria-hidden /> Stop recording
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onStartRecording(config.transparentBg)}
            disabled={!track || exporting}
          >
            <Circle className="h-4 w-4 fill-red-500 text-red-500" aria-hidden /> Start recording
          </Button>
        )}
        {config.transparentBg && !recording && (
          <p className="text-xs leading-snug text-zinc-500">
            Alpha recording (WebM + alpha) is active because transparent background is on — use{' '}
            <span className="text-zinc-300">Convert</span> (top bar) to transcode it to ProRes 4444 MOV
            for DaVinci Resolve.
          </p>
        )}
      </section>

      {/* ---------------- Snapshot ---------------- */}
      <Button variant="outline" className="w-full" onClick={snapshot} disabled={exporting}>
        <Camera className="h-4 w-4" aria-hidden /> Snapshot current frame (PNG)
      </Button>
    </div>
  )
}
