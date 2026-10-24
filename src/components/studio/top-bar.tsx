'use client'

import { useState } from 'react'
import { Clapperboard, Download, ImageDown, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useStudioStore } from '@/store/studio'
import { exportPngSequence, PNG_SEQ_MAX_FRAMES } from '@/lib/export/png-seq'
import { getEngine } from '@/components/studio/engine-registry'
import { downloadBlob } from '@/store/studio'
import { ConvertDialog } from '@/components/studio/convert-dialog'
import { Button } from '@/components/ui/button'

/**
 * Spectra top bar: brand mark on the left, the four capture/export quick
 * actions on the right — Record · Export video · PNG Seq · Convert.
 */
export function TopBar() {
  const audioMeta = useStudioStore((s) => s.audioMeta)
  const recording = useStudioStore((s) => s.recording)
  const recordElapsed = useStudioStore((s) => s.recordElapsed)
  const startRecording = useStudioStore((s) => s.startRecording)
  const stopRecording = useStudioStore((s) => s.stopRecording)
  const exportJob = useStudioStore((s) => s.exportJob)
  const startExport = useStudioStore((s) => s.startExport)

  const [convertOpen, setConvertOpen] = useState(false)
  const [pngBusy, setPngBusy] = useState(false)
  const [pngPct, setPngPct] = useState(0)

  const handlePngSeq = async () => {
    if (pngBusy) return
    const engine = getEngine()
    const audioBuffer = engine?.audioBuffer
    if (!audioBuffer) {
      toast.error('Load audio first', {
        description: 'PNG sequence renders the song offline, frame by frame.',
      })
      return
    }
    setPngBusy(true)
    setPngPct(0)
    const cancel = { cancelled: false }
    try {
      const { config, exportSettings } = useStudioStore.getState()
      const result = await exportPngSequence({
        config,
        settings: exportSettings,
        audioBuffer,
        onProgress: (p) => setPngPct(p.progress),
        signal: cancel,
      })
      downloadBlob(result.blob, 'spectra-frames.zip')
      toast.success('PNG sequence exported', {
        description: `${result.frames} frames · ${(result.blob.size / (1024 * 1024)).toFixed(1)} MB${
          result.capped ? ` · capped at ${PNG_SEQ_MAX_FRAMES}` : ''
        }`,
      })
    } catch (err) {
      if (cancel.cancelled) toast.info('PNG sequence cancelled')
      else
        toast.error('PNG sequence failed', {
          description: err instanceof Error ? err.message : 'Unknown error.',
        })
    } finally {
      setPngBusy(false)
      setPngPct(0)
    }
  }

  const recSeconds = Math.floor(recordElapsed)
  const recLabel = `${Math.floor(recSeconds / 60)}:${String(recSeconds % 60).padStart(2, '0')}`

  return (
    <header className="shrink-0 border-b border-zinc-800 bg-zinc-950">
      <div className="flex h-14 items-center gap-3 px-4">
        {/* Brand */}
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 ring-1 ring-zinc-800"
            aria-hidden
          >
            <span
              className="size-4.5 rounded-full"
              style={{
                background:
                  'radial-gradient(circle at 32% 30%, #7dd3fc 0%, #818cf8 42%, #c084fc 72%, #f472b6 100%)',
              }}
            />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight text-zinc-100">
              Spectra
            </div>
            <div className="hidden truncate text-[11px] leading-tight text-zinc-500 sm:block">
              Audio visualizer editor
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className={cnRecord(recording)}
            aria-label={recording ? `Stop recording at ${recLabel}` : 'Start recording'}
            onClick={() => (recording ? stopRecording() : startRecording())}
          >
            <span
              className={
                recording
                  ? 'relative flex size-2'
                  : 'size-2 rounded-full bg-red-500'
              }
              aria-hidden
            >
              {recording ? (
                <>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-red-500" />
                </>
              ) : null}
            </span>
            <span className="hidden md:inline">{recording ? `Stop · ${recLabel}` : 'Record'}</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="border-zinc-800 bg-zinc-900/60 hover:border-zinc-600 hover:bg-zinc-900"
            disabled={exportJob.active || !audioMeta}
            onClick={() => void startExport()}
          >
            {exportJob.active ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Clapperboard className="size-4" aria-hidden />
            )}
            <span className="hidden md:inline">
              {exportJob.active
                ? `${Math.round((exportJob.progress?.progress ?? 0) * 100)}%`
                : 'Export video'}
            </span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="border-zinc-800 bg-zinc-900/60 hover:border-zinc-600 hover:bg-zinc-900"
            disabled={pngBusy || !audioMeta}
            onClick={() => void handlePngSeq()}
          >
            {pngBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ImageDown className="size-4" aria-hidden />
            )}
            <span className="hidden md:inline">
              {pngBusy ? `PNG ${Math.round(pngPct * 100)}%` : 'PNG Seq'}
            </span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="border-zinc-800 bg-zinc-900/60 hover:border-zinc-600 hover:bg-zinc-900"
            onClick={() => setConvertOpen(true)}
          >
            <Download className="size-4" aria-hidden />
            <span className="hidden md:inline">Convert</span>
          </Button>
        </div>
      </div>

      <ConvertDialog open={convertOpen} onOpenChange={setConvertOpen} />
    </header>
  )
}

function cnRecord(recording: boolean): string {
  return recording
    ? 'border-red-500/50 bg-red-500/10 text-red-300 hover:border-red-500 hover:bg-red-500/20'
    : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-600 hover:bg-zinc-900'
}
