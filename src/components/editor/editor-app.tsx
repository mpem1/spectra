'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Circle,
  FileDown,
  Images,
  Mic2,
  Bookmark,
  Palette,
  Square,
  UploadCloud,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConvertDialog } from '@/components/editor/convert-dialog'
import { ExportDialog } from '@/components/editor/export-dialog'
import { ExportPanel } from '@/components/editor/export-panel'
import { LyricsPanel } from '@/components/editor/lyrics-panel'
import { PlayerBar } from '@/components/editor/player-bar'
import { PngSequenceDialog } from '@/components/editor/png-sequence-dialog'
import { PresetsPanel } from '@/components/editor/presets-panel'
import { StylePanel } from '@/components/editor/style-panel'
import { VisualizerStage } from '@/components/editor/visualizer-stage'
import { getAudioEngine } from '@/lib/audio/engine'
import { Mp4CanvasRecorder } from '@/lib/export/mp4-recorder'
import { setFrameSink } from '@/lib/export/frame-sink'
import { genLyricId, parseLrc } from '@/lib/lyrics'
import { useEditorStore } from '@/store/editor'
import { toast } from '@/hooks/use-toast'

const MAX_BG_IMAGE_BYTES = 2.5 * 1024 * 1024
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i
const LYRICS_EXT = /\.(lrc|txt|srt)$/i

export function EditorApp() {
  const config = useEditorStore((s) => s.config)
  const setConfig = useEditorStore((s) => s.setConfig)
  const loadTrack = useEditorStore((s) => s.loadTrack)
  const setLyrics = useEditorStore((s) => s.setLyrics)
  const setLastRecording = useEditorStore((s) => s.setLastRecording)
  const track = useEditorStore((s) => s.track)

  const [recording, setRecording] = useState(false)
  const [recElapsed, setRecElapsed] = useState(0)
  const [dragActive, setDragActive] = useState(false)
  const recorderRef = useRef<Mp4CanvasRecorder | null>(null)
  const recStartRef = useRef(0)
  const recTimerRef = useRef<number | null>(null)
  const recDurationRef = useRef(0)

  // ---------------------------------------------------------------- recording
  const stopRecording = useCallback(async () => {
    if (recTimerRef.current) {
      window.clearInterval(recTimerRef.current)
      recTimerRef.current = null
    }
    const engine = getAudioEngine()
    engine.stopAudioTap()
    setFrameSink(null)
    setRecording(false)

    const rec = recorderRef.current
    recorderRef.current = null
    if (rec) {
      const out = await rec.finish()
      if (out.blob) {
        setLastRecording({
          blob: out.blob,
          alpha: useEditorStore.getState().config.transparentBg,
          durationSec: recDurationRef.current,
        })
        toast({
          title: 'Recording saved (MP4)',
          description: `${out.frames} frames · ready to download via Convert, or export offline for perfect sync.`,
        })
      } else {
        toast({ title: 'Recording failed', description: out.error, variant: 'destructive' })
      }
      return
    }
    // WebM fallback
    const webm = await engine.stopWebmRecording()
    if (webm) {
      setLastRecording({
        blob: webm.blob,
        alpha: useEditorStore.getState().config.transparentBg,
        durationSec: recDurationRef.current,
      })
      toast({
        title: 'Recording saved (WebM)',
        description: 'Use the Convert button to make it editor-friendly.',
      })
    }
  }, [setLastRecording])

  const startRecording = useCallback(async (preferAlpha = false) => {
    const engine = getAudioEngine()
    const canvas = engine.canvasEl
    if (!canvas) {
      toast({ title: 'Canvas not ready', description: 'Try again in a moment.', variant: 'destructive' })
      return
    }
    recStartRef.current = Date.now()
    recDurationRef.current = 0
    setRecElapsed(0)
    recTimerRef.current = window.setInterval(() => {
      recDurationRef.current = (Date.now() - recStartRef.current) / 1000
      setRecElapsed(recDurationRef.current)
    }, 250)

    // MP4 (H.264) cannot carry alpha — transparent recordings must take the
    // WebM/MediaRecorder path so the alpha channel survives.
    if (Mp4CanvasRecorder.supported && !preferAlpha) {
      const rec = new Mp4CanvasRecorder({
        fps: 30,
        width: canvas.width,
        height: canvas.height,
        sampleRate: engine.sampleRate,
      })
      const started = await rec.start(true)
      if (!started.started) {
        window.clearInterval(recTimerRef.current)
        recTimerRef.current = null
        toast({ title: 'Cannot start recording', description: started.reason, variant: 'destructive' })
        return
      }
      recorderRef.current = rec
      setFrameSink((c, now) => rec.handleFrame(c, now))
      engine.startAudioTap((ch0, ch1) => rec.audioChunk(ch0, ch1))
      setRecording(true)
      toast({ title: `Recording MP4 (${started.codec ?? 'h.264'})` })
    } else {
      const res = engine.startWebmRecording(canvas)
      if ('error' in res) {
        window.clearInterval(recTimerRef.current)
        recTimerRef.current = null
        toast({ title: 'Cannot start recording', description: res.error, variant: 'destructive' })
        return
      }
      setRecording(true)
      toast({ title: `Recording WebM (${res.mime})` })
    }
  }, [])

  useEffect(() => {
    return () => {
      if (recTimerRef.current) window.clearInterval(recTimerRef.current)
    }
  }, [])

  // Debug/support handle (also used by E2E tooling)
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__spectra = {
      engine: getAudioEngine(),
      store: useEditorStore,
    }
  }, [])

  // Rehydrate persisted settings after mount so the first client render
  // matches SSR exactly (no hydration mismatch, see store skipHydration).
  useEffect(() => {
    void useEditorStore.persist.rehydrate()
  }, [])

  // ---------------------------------------------------------------- drag & drop
  const loadBackgroundImage = useCallback(
    (file: File) => {
      if (file.size > MAX_BG_IMAGE_BYTES) {
        toast({ title: 'Image too large', description: 'Please use an image smaller than 2.5 MB.', variant: 'destructive' })
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        setConfig({ bgImage: String(reader.result) })
        toast({ title: 'Background image set', description: file.name })
      }
      reader.onerror = () =>
        toast({ title: 'Could not read image', variant: 'destructive' })
      reader.readAsDataURL(file)
    },
    [setConfig]
  )

  const handleFiles = useCallback(
    async (files: File[]) => {
      for (const f of files) {
        if (f.type.startsWith('audio/') || AUDIO_EXT.test(f.name)) {
          await loadTrack(f)
          toast({ title: 'Track loaded', description: f.name })
          return
        }
      }
      for (const f of files) {
        if (f.type.startsWith('image/')) {
          loadBackgroundImage(f)
          return
        }
      }
      for (const f of files) {
        if (LYRICS_EXT.test(f.name) || f.type.startsWith('text/')) {
          try {
            const lines = parseLrc(await f.text())
            if (lines.length > 0) {
              setLyrics(lines.map((l) => ({ ...l, id: genLyricId() })))
              useEditorStore.getState().setShowLyrics(true)
              toast({ title: 'Lyrics imported', description: `${lines.length} lines from ${f.name}` })
            } else {
              toast({
                title: 'No timestamped lines found',
                description: `Use [mm:ss.xx] line format in ${f.name}.`,
                variant: 'destructive',
              })
            }
          } catch {
            toast({ title: 'Could not read lyrics file', variant: 'destructive' })
          }
          return
        }
      }
      if (files.length > 0) {
        toast({ title: 'Unsupported file type', description: files[0].name, variant: 'destructive' })
      }
    },
    [loadTrack, loadBackgroundImage, setLyrics]
  )

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setDragActive(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragActive(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length > 0) void handleFiles(files)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [handleFiles])

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }
      if (!useEditorStore.getState().track) return
      const engine = getAudioEngine()
      if (e.code === 'Space') {
        e.preventDefault()
        if (engine.paused) void engine.play().catch(() => {})
        else engine.pause()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        engine.seek(engine.currentTime + 5)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        engine.seek(engine.currentTime - 5)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="dark flex min-h-dvh flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="border-b border-zinc-800/70">
        <div className="mx-auto flex h-14 w-full max-w-[1700px] items-center gap-3 px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-violet-500 text-zinc-950">
              <Circle className="h-3.5 w-3.5 fill-current" aria-hidden />
            </div>
            <h1 className="text-sm font-semibold tracking-tight">Spectra</h1>
            <span className="hidden text-xs text-zinc-500 md:inline">
              Audio visualizer editor
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant={recording ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => (recording ? void stopRecording() : void startRecording())}
              disabled={!track}
              aria-label={recording ? 'Stop recording' : 'Record'}
            >
              {recording ? (
                <>
                  <Square className="h-4 w-4 text-red-400" aria-hidden />
                  <span className="hidden font-mono sm:inline">
                    {Math.floor(recElapsed / 60)}:{String(Math.floor(recElapsed % 60)).padStart(2, '0')}
                  </span>
                  <span className="sm:hidden">Stop</span>
                </>
              ) : (
                <>
                  <Circle className="h-3.5 w-3.5 fill-red-500 text-red-500" aria-hidden />
                  <span className="hidden sm:inline">Record</span>
                </>
              )}
            </Button>
            <ExportDialog disabled={!track || recording} />
            <PngSequenceDialog disabled={!track || recording} />
            <ConvertDialog />
          </div>
        </div>
      </header>

      {/* Main: canvas left, panels right */}
      <main className="mx-auto flex w-full max-w-[1700px] flex-1 flex-col lg:flex-row">
        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col p-4" aria-label="Visualizer stage">
          <div className="relative min-h-[260px] flex-1">
            <div className="absolute inset-0">
              <VisualizerStage />
            </div>
            {dragActive && (
              <div
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-500/70 bg-zinc-950/80 backdrop-blur-sm"
                data-testid="drop-overlay"
                aria-hidden="true"
              >
                <UploadCloud className="h-10 w-10 text-emerald-400" />
                <p className="text-sm font-medium text-zinc-100">Drop files to load</p>
                <p className="text-xs text-zinc-400">
                  Audio (mp3/wav) · Background image · Lyrics (.lrc / .txt)
                </p>
              </div>
            )}
          </div>
          <p className="mt-2 text-center text-[11px] text-zinc-600">
            Drop an audio file anywhere — Space plays/pauses, ←/→ skips 5 seconds
          </p>
        </section>

        <aside
          className="w-full shrink-0 border-t border-zinc-800/70 lg:h-auto lg:w-[400px] lg:border-l lg:border-t-0"
          aria-label="Editor panels"
        >
          <Tabs defaultValue="style" className="flex h-full flex-col">
            <TabsList className="mx-4 mt-4 grid shrink-0 grid-cols-4">
              <TabsTrigger value="style" className="gap-1.5">
                <Palette className="h-3.5 w-3.5" aria-hidden /> Style
              </TabsTrigger>
              <TabsTrigger value="lyrics" className="gap-1.5">
                <Mic2 className="h-3.5 w-3.5" aria-hidden /> Lyrics
              </TabsTrigger>
              <TabsTrigger value="export" className="gap-1.5">
                <FileDown className="h-3.5 w-3.5" aria-hidden /> Export
              </TabsTrigger>
              <TabsTrigger value="presets" className="gap-1.5">
                <Bookmark className="h-3.5 w-3.5" aria-hidden /> Presets
              </TabsTrigger>
            </TabsList>
            <div className="spectra-scroll max-h-[60vh] flex-1 overflow-y-auto px-4 pb-6 pt-4 lg:max-h-none lg:min-h-0">
              <TabsContent value="style">
                <StylePanel />
              </TabsContent>
              <TabsContent value="lyrics">
                <LyricsPanel />
              </TabsContent>
              <TabsContent value="export">
                <ExportPanel
                  recording={recording}
                  recElapsed={recElapsed}
                  onStartRecording={(preferAlpha) => void startRecording(preferAlpha)}
                  onStopRecording={() => void stopRecording()}
                />
              </TabsContent>
              <TabsContent value="presets">
                <PresetsPanel />
              </TabsContent>
            </div>
          </Tabs>
        </aside>
      </main>

      {/* Player — sticky so transport stays on screen while scrolling long
          panels, and docks into its natural spot at the end of the page. */}
      <footer
        className="sticky bottom-0 z-40 mt-auto border-t border-zinc-800/70 bg-background"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto w-full max-w-[1700px] px-4 py-4">
          <PlayerBar />
        </div>
      </footer>
    </div>
  )
}
