'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Music, Pause, Play } from 'lucide-react'
import { AudioEngine } from '@/lib/audio/engine'
import { makeIdleFrame } from '@/lib/visualizer/idle'
import { renderFrame } from '@/lib/visualizer/renderer'
import type { AudioFrame } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { setPreviewCanvas } from '@/components/studio/canvas-registry'
import { setEngine, setPreviewControls, type PreviewControls } from '@/components/studio/engine-registry'
import { formatTime } from '@/components/studio/controls'

/** Fallback song length used while no audio is loaded (demo pattern loops). */
const DEMO_DURATION = 60

/**
 * Live preview surface.
 *
 * The rAF loop below runs unconditionally (even while paused) so config
 * tweaks repaint instantly; the frame source switches between the
 * AudioEngine analyser and a synthetic idle pattern in demo mode.
 */
export function PreviewCanvas() {
  const config = useStudioStore((s) => s.config)
  const audioMeta = useStudioStore((s) => s.audioMeta)
  const barCount = useStudioStore((s) => s.config.visualizer.barCount)
  const smoothing = useStudioStore((s) => s.config.visualizer.smoothing)
  const backgroundMode = useStudioStore((s) => s.config.background.mode)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<AudioEngine | null>(null)
  const configRef = useRef(config)
  const playingRef = useRef(false)
  const demoTimeRef = useRef(0)
  const currentTimeRef = useRef(0)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(DEMO_DURATION)
  const [box, setBox] = useState({ w: 640, h: 360 })

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

  /* ------------------------------- sizing ---------------------------------- */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        let w = width
        let h = (width * 9) / 16
        if (h > height) {
          h = height
          w = (height * 16) / 9
        }
        if (w > 2 && h > 2) setBox({ w: Math.floor(w), h: Math.floor(h) })
      }
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

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
        frame = makeIdleFrame(currentConfig.visualizer.barCount, demoTimeRef.current)
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
        const d = loaded && engine ? engine.duration : DEMO_DURATION
        setDuration((prev) => (Math.abs(prev - d) > 0.01 ? d : prev))
      }
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  /* --------------------------------- view ---------------------------------- */

  const audioLoaded = audioMeta !== null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        ref={containerRef}
        className="relative flex min-h-[280px] flex-1 items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 p-2 sm:p-4"
      >
        <div
          className="relative overflow-hidden rounded-lg shadow-2xl shadow-black/60 ring-1 ring-zinc-800"
          style={{ width: box.w, height: box.h }}
        >
          {backgroundMode === 'transparent' ? (
            <div className="checkerboard absolute inset-0" aria-hidden />
          ) : null}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 block h-full w-full"
            aria-label="Visualizer live preview"
          />
        </div>
      </div>

      {/* Playback bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
        <Button
          size="icon"
          onClick={() => (playing ? pause() : play())}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          className="size-10 shrink-0 rounded-full bg-emerald-500 text-zinc-950 shadow-none hover:bg-emerald-400"
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>

        <div className="hidden min-w-0 max-w-[190px] shrink sm:block">
          <div className="truncate text-xs text-zinc-200">
            {audioMeta?.name ?? 'Untitled session'}
          </div>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-600">
            <Music className="size-3" aria-hidden />
            {audioLoaded ? 'Audio loaded' : 'Demo pattern'}
          </div>
        </div>

        <span className="w-11 shrink-0 text-right text-xs tabular-nums text-zinc-400">
          {formatTime(currentTime)}
        </span>
        <Slider
          aria-label="Seek"
          min={0}
          max={Math.max(1, duration)}
          step={0.1}
          value={[Math.min(currentTime, duration)]}
          onValueChange={(vals: number[]) => seek(vals[0] ?? 0)}
          className="min-w-[120px] flex-1 py-1"
        />
        <span className="w-11 shrink-0 text-xs tabular-nums text-zinc-400">
          {formatTime(duration)}
        </span>
      </div>
    </div>
  )
}
