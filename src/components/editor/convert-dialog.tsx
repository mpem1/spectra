'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Ban,
  Check,
  Cpu,
  FileDown,
  FileVideo,
  Film,
  Loader2,
  RotateCcw,
  Server,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react'
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
import { downloadBlob } from '@/lib/format'
import {
  cancelWasmConversion,
  convertWebmInBrowser,
  estimateProResBytes,
  probeWebm,
  WASM_PRORES_MAX_OUTPUT_BYTES,
  type WebmProbe,
} from '@/lib/ffmpeg-wasm'
import { useEditorStore } from '@/store/editor'
import { toast } from '@/hooks/use-toast'

type ConvertFormat = 'mp4' | 'prores4444'
type ConvertEngine = 'server' | 'browser'

interface ConvertResult {
  blob: Blob
  filename: string
  format: ConvertFormat
}

const FORMAT_CARDS: {
  id: ConvertFormat
  title: string
  subtitle: string
  detail: string
}[] = [
  {
    id: 'mp4',
    title: 'MP4 · H.264',
    subtitle: 'Universal',
    detail: 'Imports into DaVinci Resolve, Premiere, Final Cut and any player. A transparent background is flattened to black.',
  },
  {
    id: 'prores4444',
    title: 'MOV · ProRes 4444',
    subtitle: 'Keeps transparency',
    detail: 'Alpha-preserving master format — the one DaVinci Resolve recommends for transparent overlays. Files are large.',
  },
]

const MB = 1024 * 1024

/**
 * Convert a recorded WebM into an editor-friendly format (MP4 / ProRes 4444).
 * Two engines: the server-side ffmpeg API (fast, needs an ffmpeg-capable host)
 * and a fully in-browser ffmpeg.wasm engine that works on any host — including
 * serverless platforms like Vercel where the ffmpeg binary is unavailable and
 * uploads beyond ~4.5 MB get rejected with HTTP 4xx.
 */
export function ConvertDialog() {
  const lastRecording = useEditorStore((s) => s.lastRecording)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<ConvertFormat>('mp4')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [engine, setEngine] = useState<ConvertEngine>('server')
  const [engineTouched, setEngineTouched] = useState(false)
  const [caps, setCaps] = useState<{ ffmpeg: boolean } | null>(null)
  const [probe, setProbe] = useState<WebmProbe | null>(null)
  const [progress, setProgress] = useState<{
    pct: number | null
    elapsedMs: number
    logLine: string
  } | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [browserError, setBrowserError] = useState<string | null>(null)
  const [result, setResult] = useState<ConvertResult | null>(null)

  const source: Blob | null = file ?? lastRecording?.blob ?? null
  const sourceLabel = file ? file.name : lastRecording ? 'Last recording' : null
  const sourceIsAlpha = !file && (lastRecording?.alpha ?? false)
  // For a picked file the probe is authoritative; for the in-memory recording
  // the record timer is (MediaRecorder WebMs often lack duration metadata)
  const durationSec = file
    ? probe?.durationSec ?? null
    : lastRecording?.durationSec ?? probe?.durationSec ?? null

  // Probe the clip (resolution/duration) whenever the source changes
  useEffect(() => {
    if (!open || !source) {
      setProbe(null)
      return
    }
    let cancelled = false
    setProbe(null)
    void probeWebm(source).then((p) => {
      if (!cancelled) setProbe(p)
    })
    return () => {
      cancelled = true
    }
  }, [open, source])

  // Check whether this host can run server-side ffmpeg conversion
  useEffect(() => {
    if (!open || caps) return
    let cancelled = false
    void fetch('/api/convert')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { ffmpeg?: boolean } | null) => {
        if (cancelled) return
        setCaps({ ffmpeg: !!data?.ffmpeg })
      })
      .catch(() => {
        if (!cancelled) setCaps({ ffmpeg: false })
      })
    return () => {
      cancelled = true
    }
  }, [open, caps])

  // Auto-pick the engine until the user chooses one explicitly
  useEffect(() => {
    if (engineTouched || !caps) return
    setEngine(caps.ffmpeg ? 'server' : 'browser')
  }, [caps, engineTouched])

  const pickEngine = (next: ConvertEngine) => {
    setEngineTouched(true)
    setEngine(next)
  }

  const wasmProResEstimate =
    format === 'prores4444' && durationSec
      ? estimateProResBytes(durationSec, probe?.width || 1280, probe?.height || 720)
      : null
  const wasmProResBlocked =
    engine === 'browser' &&
    format === 'prores4444' &&
    (wasmProResEstimate === null ||
      (wasmProResEstimate !== null && wasmProResEstimate > WASM_PRORES_MAX_OUTPUT_BYTES))

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      // Sensible default: transparent recordings should go the ProRes route
      setFormat(useEditorStore.getState().lastRecording?.alpha && !file ? 'prores4444' : 'mp4')
      setServerError(null)
      setBrowserError(null)
      setProgress(null)
      setResult(null)
    }
  }

  const makeResult = (blob: Blob): ConvertResult => {
    const base = (file?.name ?? 'spectra-recording').replace(/\.webm$/i, '')
    const ext = format === 'mp4' ? 'mp4' : 'mov'
    return {
      blob,
      filename: `${base}-${format === 'mp4' ? 'h264' : 'prores4444'}.${ext}`,
      format,
    }
  }

  const convert = async () => {
    if (!source || busy || wasmProResBlocked) return
    setBusy(true)
    setServerError(null)
    setBrowserError(null)
    setProgress(null)
    try {
      if (engine === 'server') {
        const res = await fetch(`/api/convert?format=${format}`, {
          method: 'POST',
          headers: { 'Content-Type': 'video/webm' },
          body: source,
        })
        if (!res.ok) {
          const info = (await res.json().catch(() => null)) as { error?: string } | null
          const status = res.status
          const hint =
            status === 413
              ? 'This host rejected the upload (body size limit).'
              : status === 400 || status === 422 || status === 500 || status === 502
                ? 'This host could not run the server-side conversion.'
                : `Server error ${status}.`
          throw new Error(`${hint}${info?.error ? ` ${info.error}` : ''}`)
        }
        setResult(makeResult(await res.blob()))
        toast({
          title: 'Conversion ready',
          description: 'Hit Download to save the converted file.',
        })
      } else {
        const wasm = await convertWebmInBrowser(source, {
          format,
          durationSec,
          onProgress: setProgress,
        })
        setProgress(null)
        setResult(makeResult(wasm.blob))
        toast({
          title: 'Conversion ready',
          description: 'Converted in your browser — hit Download to save it.',
        })
      }
    } catch (err) {
      const raw =
        err instanceof Error
          ? err.message
          : typeof err === 'string' && err.length > 0
            ? err
            : 'Unknown error'
      const message = /terminate/i.test(raw) ? 'Conversion cancelled.' : raw
      if (engine === 'server') {
        // Keep the dialog open and nudge towards the in-browser engine
        setServerError(message)
        toast({ title: 'Conversion failed', description: message, variant: 'destructive' })
      } else {
        setBrowserError(message)
        toast({ title: 'Conversion failed', description: message, variant: 'destructive' })
      }
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const onCancel = () => {
    if (engine === 'browser') {
      cancelWasmConversion()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileDown className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Convert</span>
        </Button>
      </DialogTrigger>
      {/* `dark` re-applies the theme tokens inside the portal (the app's dark
          class lives on its root div, which the portal escapes); text-foreground
          re-declares the color so inherited body colors don't leak in */}
      <DialogContent className="dark bg-background text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Convert for your video editor</DialogTitle>
          <DialogDescription>
            WebM recordings can&apos;t be imported into DaVinci Resolve and most editors.
            Convert to MP4 or ProRes 4444 here.
          </DialogDescription>
        </DialogHeader>

        {/* Source */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Source</p>
          {source && sourceLabel ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-sm text-zinc-200">
                <FileVideo className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
                <span className="truncate">{sourceLabel}</span>
                <span className="shrink-0 font-mono text-[11px] text-zinc-500">
                  {[
                    `${(source.size / MB).toFixed(1)} MB`,
                    durationSec ? `${durationSec.toFixed(1)}s` : null,
                    probe?.width ? `${probe.width}×${probe.height}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              {file && (
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  aria-label="Clear chosen file and use the last recording"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-2.5 text-sm text-zinc-500">
              No recording yet — pick a .webm file below or record a new one.
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" aria-hidden />
            {source ? 'Choose a different .webm' : 'Choose a .webm file'}
          </Button>
        </div>

        {/* Format */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Output format</p>
          <div className="grid gap-2">
            {FORMAT_CARDS.map((card) => {
              const active = format === card.id
              return (
                <button
                  key={card.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFormat(card.id)}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                    active
                      ? 'border-emerald-500/70 bg-emerald-500/10'
                      : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      active ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300' : 'border-zinc-700 text-transparent'
                    }`}
                  >
                    <Check className="h-3 w-3" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-100">{card.title}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          card.id === 'prores4444'
                            ? 'bg-fuchsia-500/15 text-fuchsia-300'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {card.subtitle}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-snug text-zinc-500">{card.detail}</span>
                  </span>
                </button>
              )
            })}
          </div>
          {sourceIsAlpha && format === 'mp4' && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-snug text-amber-300">
              This recording has a transparent background — choose ProRes 4444 to keep the
              alpha channel. MP4 will flatten it to black.
            </p>
          )}
        </div>

        {/* Engine */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Conversion engine
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={engine === 'server'}
              onClick={() => pickEngine('server')}
              className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                engine === 'server'
                  ? 'border-emerald-500/70 bg-emerald-500/10'
                  : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
              }`}
            >
              <Server className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
                  Server ffmpeg
                  {caps && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        caps.ffmpeg
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {caps.ffmpeg ? 'available' : 'unavailable'}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                  Fast native transcode. Needs a host with ffmpeg.
                </span>
              </span>
            </button>
            <button
              type="button"
              aria-pressed={engine === 'browser'}
              onClick={() => pickEngine('browser')}
              className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                engine === 'browser'
                  ? 'border-emerald-500/70 bg-emerald-500/10'
                  : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
              }`}
            >
              <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
              <span className="min-w-0">
                <span className="text-sm font-semibold text-zinc-100">In-browser (wasm)</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                  Works on any host (Vercel included). Slower; nothing is uploaded. First run downloads a ~32 MB engine, cached afterwards.
                </span>
              </span>
            </button>
          </div>
          {engine === 'browser' && format === 'prores4444' && wasmProResEstimate !== null && (
            <p className="font-mono text-[11px] text-zinc-500">
              Estimated ProRes output: {(wasmProResEstimate / MB).toFixed(0)} MB
            </p>
          )}
          {wasmProResBlocked && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-snug text-amber-300">
              The in-browser engine can&apos;t allocate ProRes 4444 for a clip this long
              (browser memory limit). Use the server engine on an ffmpeg-capable host, or keep
              in-browser ProRes clips under about a minute of 720p.
            </p>
          )}
          {browserError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-snug text-red-300">
              {browserError}
            </p>
          )}
          {serverError && (
            <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-snug text-red-300">
              <span className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{serverError}</span>
              </span>
              <Button size="sm" variant="outline" className="h-7 w-full" onClick={() => pickEngine('browser')}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Retry with the in-browser engine
              </Button>
            </div>
          )}
        </div>

        {busy && engine === 'browser' && (
          <div className="space-y-1.5" aria-live="polite">
            <Progress
              value={progress?.pct ?? undefined}
              className={`h-2 ${progress?.pct == null ? 'animate-pulse' : ''}`}
            />
            <div className="flex items-center justify-between gap-3 font-mono text-[11px] text-zinc-500">
              <span className="shrink-0">
                {progress?.pct != null ? `${progress.pct.toFixed(0)}%` : 'Converting…'}
                {' · '}
                {((progress?.elapsedMs ?? 0) / 1000).toFixed(0)}s
              </span>
              <span className="truncate">{progress?.logLine ?? ''}</span>
            </div>
          </div>
        )}

        {result && (
          <div
            className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-3"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-emerald-300">
                <Check className="h-4 w-4 shrink-0" aria-hidden />
                Conversion ready
              </span>
              <span className="shrink-0 font-mono text-[11px] text-zinc-400">
                {(result.blob.size / MB).toFixed(1)} MB
              </span>
            </div>
            <p className="truncate font-mono text-[11px] text-zinc-400">{result.filename}</p>
            <Button
              className="w-full"
              onClick={() => downloadBlob(result.blob, result.filename)}
              aria-label={`Download ${result.filename}`}
            >
              <FileDown className="h-4 w-4" aria-hidden />
              Download {result.format === 'mp4' ? 'MP4' : 'ProRes 4444 MOV'}
            </Button>
            <p className="text-[11px] leading-snug text-zinc-500">
              {result.format === 'mp4'
                ? 'H.264 MP4 — imports into DaVinci Resolve, Premiere, Final Cut and any player.'
                : 'ProRes 4444 MOV — transparency preserved, the format DaVinci Resolve recommends for alpha overlays.'}
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => void convert()} disabled={!source || busy || wasmProResBlocked}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {engine === 'browser' ? 'Converting in-browser…' : 'Converting — large clips can take a minute…'}
              </>
            ) : (
              <>
                <Film className="h-4 w-4" aria-hidden />
                Convert {format === 'mp4' ? 'to MP4' : 'to ProRes 4444 MOV'}
                <span className="ml-1 hidden text-emerald-300 sm:inline">
                  {engine === 'browser' ? '· in-browser' : '· on server'}
                </span>
              </>
            )}
          </Button>
          {busy && engine === 'browser' && (
            <Button variant="outline" onClick={onCancel} aria-label="Cancel in-browser conversion">
              <Ban className="h-4 w-4" aria-hidden />
              Cancel
            </Button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".webm,video/webm"
          className="hidden"
          aria-label="Choose a WebM file to convert"
          onChange={(e) => {
            const picked = e.target.files?.[0]
            if (picked) setFile(picked)
            e.target.value = ''
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
