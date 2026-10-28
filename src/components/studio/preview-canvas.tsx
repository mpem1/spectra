'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioEngine } from '@/lib/audio/engine'
import { makeIdleFrame } from '@/lib/visualizer/idle'
import { renderFrame } from '@/lib/visualizer/renderer'
import { resolutionShape, type AudioFrame } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { setPreviewCanvas } from '@/components/studio/canvas-registry'
import { setEngine, setPreviewControls, type PreviewControls } from '@/components/studio/engine-registry'
import { loadAudioFile } from '@/components/studio/load-audio'
import { PlayerBar } from '@/components/studio/player-bar'
import { BgImageTransform } from '@/components/studio/bg-image-transform'
import { cn } from '@/lib/utils'

/** Fallback song length used while no audio is loaded (demo pattern loops). */
const DEMO_DURATION = 60

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

/**
 * Live preview surface.
 *
 * The rAF loop below runs unconditionally (even while paused) so config
 * tweaks repaint instantly; the frame source switches between the
 * AudioEngine analyser and a synthetic idle pattern in demo mode.
 * Also hosts drop-anywhere audio loading and Space / ←→ shortcuts.
 */
export function PreviewCanvas() {
  const config = useStudioStore((s) => s.config)
  const audioMeta = useStudioStore((s) => s.audioMeta)
  const barCount = useStudioStore((s) => s.config.visualizer.barCount)
  const smoothing = useStudioStore((s) => s.config.visualizer.smoothing)
  const patchBackground = useStudioStore((s) => s.patchBackground)
  // The preview mirrors the export resolution's shape, so a portrait/square
  // export is composed on screen exactly as it will render — no surprises.
  const exportResolution = useStudioStore((s) => s.exportSettings.resolution)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<AudioEngine | null>(null)
  const configRef = useRef(config)
  const playingRef = useRef(false)
  const demoTimeRef = useRef(0)
  const currentTimeRef = useRef(0)
  const durationRef = useRef(DEMO_DURATION)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(DEMO_DURATION)
  const [box, setBox] = useState({ w: 640, h: 360 })
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    configRef.current = config
  }, [config])

  /* ------------------------------ playback API ----------------------------- */

  const play = useCallback(() => {
    playingRef.current = true
    setPlaying(true)
    const engine = engineRef.current
    if (engine?.isLoaded) void engine.play()
  }, [])

  const pause = useCallback(() => {
    playingRef.current = false
    setPlaying(false)
    engineRef.current?.pause()
  }, [])

  const seek = useCallback((time: number) => {
    const engine = engineRef.current
    if (engine?.isLoaded) {
      engine.seek(time)
    } else {
      demoTimeRef.current = Math.max(0, Math.min(DEMO_DURATION, time))
    }
    currentTimeRef.current = time
    setCurrentTime(time)
  }, [])

  /* --------------------------- engine lifecycle ---------------------------- */

  useEffect(() => {
    const engine = new AudioEngine()
    engineRef.current = engine
    setEngine(engine)
    setPreviewCanvas(canvasRef.current)
    const controls: PreviewControls = {
      play,
      pause,
      seek,
      isPlaying: () => playingRef.current,
      getTime: () => currentTimeRef.current,
    }
    setPreviewControls(controls)
    engine.onEnded(() => {
      playingRef.current = false
      setPlaying(false)
    })
    return () => {
      setPreviewControls(null)
      setPreviewCanvas(null)
      setEngine(null)
      engine.dispose()
      engineRef.current = null
    }
  }, [play, pause, seek])

  useEffect(() => {
    engineRef.current?.setAnalysisOptions({ barCount, smoothing })
  }, [barCount, smoothing])

  /* ----------------------- drop-anywhere + shortcuts ----------------------- */

  /** Dropped images become the background (with the shade fader available). */
  const setBackgroundFromFile = useCallback(
    (file: File): Promise<void> =>
      new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => {
          patchBackground({ mode: 'image', imageSrc: String(reader.result) })
          resolve()
        }
        reader.onerror = () => resolve()
        reader.readAsDataURL(file)
      }),
    [patchBackground],
  )

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault()
        setDragOver(true)
      }
    }
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragOver(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const image = files.find((f) => f.type.startsWith('image/'))
      const audio = files.find((f) => f.type.startsWith('audio/'))
      if (image) void setBackgroundFromFile(image)
      if (audio) void loadAudioFile(audio)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (playingRef.current) pause()
        else play()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        seek(Math.max(0, currentTimeRef.current - 5))
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        seek(Math.min(durationRef.current, currentTimeRef.current + 5))
      }
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [play, pause, seek, setBackgroundFromFile])

  /* ------------------------------- sizing ---------------------------------- */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const { aspect } = resolutionShape(exportResolution)
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        let w = width
        let h = width / aspect
        if (h > height) {
          h = height
          w = height * aspect
        }
        if (w > 2 && h > 2) setBox({ w: Math.floor(w), h: Math.floor(h) })
      }
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [exportResolution])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.max(2, Math.round(box.w * dpr))
    canvas.height = Math.max(2, Math.round(box.h * dpr))
  }, [box])

  /* ------------------------------- rAF loop -------------------------------- */

  useEffect(() => {
    let raf = 0
    let frameCount = 0
    let last = performance.now()
    let lastUi = 0

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now

      const engine = engineRef.current
      const currentConfig = configRef.current
      const loaded = engine?.isLoaded ?? false

      let frame: AudioFrame
      if (loaded && engine) {
        frame = engine.getLiveFrame()
        currentTimeRef.current = engine.currentTime
        durationRef.current = engine.duration
        // Engine is authoritative while audio is loaded (e.g. natural end).
        if (engine.isPlaying !== playingRef.current) {
          playingRef.current = engine.isPlaying
          setPlaying(engine.isPlaying)
        }
      } else {
        // Demo mode: synthetic idle pattern driven by a clock that only
        // advances while "playing".
        if (playingRef.current) {
          demoTimeRef.current = (demoTimeRef.current + dt) % DEMO_DURATION
        }
        currentTimeRef.current = demoTimeRef.current
        durationRef.current = DEMO_DURATION
        // Decorative clock (cycle colors, wobbles) free-runs on the wall
        // clock so styling stays alive even while the demo clock is paused.
        frame = makeIdleFrame(currentConfig.visualizer.barCount, demoTimeRef.current, now / 1000)
      }

      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          renderFrame(
            { ctx, width: canvas.width, height: canvas.height, frame: frameCount++ },
            frame,
            currentConfig
          )
        }
      }

      // Throttled UI sync (~8 Hz) for the time readout + seek slider.
      if (now - lastUi > 120) {
        lastUi = now
        setCurrentTime(currentTimeRef.current)
        const d = durationRef.current
        setDuration((prev) => (Math.abs(prev - d) > 0.01 ? d : prev))
      }
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  /* --------------------------------- view ---------------------------------- */

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        ref={containerRef}
        className={cn(
          'relative flex min-h-[280px] flex-1 items-center justify-center overflow-hidden rounded-xl border bg-zinc-900/40 p-2 transition-colors sm:p-4',
          dragOver ? 'border-emerald-500 bg-emerald-500/5' : 'border-zinc-800',
        )}
      >
        <div
          className="relative overflow-hidden rounded-lg shadow-2xl shadow-black/60 ring-1 ring-zinc-800"
          style={{ width: box.w, height: box.h }}
        >
          {config.background.mode === 'transparent' ? (
            <div className="checkerboard absolute inset-0" aria-hidden />
          ) : null}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 block h-full w-full"
            aria-label="Visualizer live preview"
          />
          {/* Image-background move / resize surface (image mode only) */}
          <BgImageTransform />
        </div>

        {/* Drop hint */}
        <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11px] text-zinc-500 sm:bottom-3">
          Drop an audio file anywhere — Space plays/pauses, ←/→ skips 5 seconds
        </p>

        {dragOver ? (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-zinc-950/60"
            aria-hidden
          >
            <span className="rounded-lg border border-emerald-500/60 bg-zinc-900/90 px-4 py-2 text-sm font-medium text-emerald-400">
              Drop audio to load
            </span>
          </div>
        ) : null}
      </div>

      <PlayerBar
        playing={playing}
        currentTime={currentTime}
        duration={duration}
        onPlayToggle={() => (playing ? pause() : play())}
        onSeek={seek}
      />

      {/* a11y: audioMeta read so the bar re-renders the track name from the store */}
      <span className="sr-only" aria-live="polite">
        {audioMeta ? `Loaded ${audioMeta.name}` : 'No track loaded'}
      </span>
    </div>
  )
}
