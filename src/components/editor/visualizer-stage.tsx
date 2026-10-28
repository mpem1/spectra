'use client'

import { useEffect, useRef } from 'react'
import { getAudioEngine } from '@/lib/audio/engine'
import { createVisualizer, type VisualizerRenderer } from '@/lib/audio/visualizers'
import {
  AfterglowLayer,
  SceneImages,
  drawSceneBackground,
  drawSceneOverlays,
} from '@/lib/render/scene'
import { getFrameSink } from '@/lib/export/frame-sink'
import { useEditorStore } from '@/store/editor'

const ASPECTS: Record<string, number> = {
  '16:9': 16 / 9,
  '1:1': 1,
  '9:16': 9 / 16,
}

/** Smoothed band energies (0..1) — bass / mid / treble / overall level. */
class Bands {
  bass = 0
  mid = 0
  treble = 0
  level = 0

  update(freq: Uint8Array, sampleRate: number, fftSize: number, dt: number): void {
    const binHz = sampleRate / 2 / Math.max(1, freq.length)
    const avg = (fromHz: number, toHz: number): number => {
      const from = Math.max(0, Math.floor(fromHz / binHz))
      const to = Math.min(freq.length, Math.max(from + 1, Math.ceil(toHz / binHz)))
      let sum = 0
      for (let i = from; i < to; i++) sum += freq[i]
      return Math.min(1, sum / (to - from) / 255)
    }
    // Exponential smoothing tuned per-frame (mirrors the analyser's feel)
    const k = Math.min(1, dt * 12)
    this.bass += (avg(20, 250) - this.bass) * k
    this.mid += (avg(250, 2000) - this.mid) * k
    this.treble += (avg(2000, 12000) - this.treble) * k
    this.level += (avg(30, 16000) - this.level) * k
  }
}

export function VisualizerStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const config = useEditorStore((s) => s.config)
  const showLyrics = useEditorStore((s) => s.showLyrics)
  const lyrics = useEditorStore((s) => s.lyrics)
  const lyricsSize = useEditorStore((s) => s.lyricsSize)
  const lyricsPosition = useEditorStore((s) => s.lyricsPosition)
  const lyricsColor = useEditorStore((s) => s.lyricsColor)
  const lyricsGlowColor = useEditorStore((s) => s.lyricsGlowColor)
  const lyricsGlow = useEditorStore((s) => s.lyricsGlow)

  // Keep live refs so the rAF loop never re-subscribes
  const configRef = useRef(config)
  const lyricsRef = useRef({
    showLyrics,
    lyrics,
    lyricsSize,
    lyricsPosition,
    lyricsColor,
    lyricsGlowColor,
    lyricsGlow,
  })
  useEffect(() => {
    configRef.current = config
  }, [config])
  useEffect(() => {
    lyricsRef.current = {
      showLyrics,
      lyrics,
      lyricsSize,
      lyricsPosition,
      lyricsColor,
      lyricsGlowColor,
      lyricsGlow,
    }
  }, [showLyrics, lyrics, lyricsSize, lyricsPosition, lyricsColor, lyricsGlowColor, lyricsGlow])

  // Push analysis settings to the engine whenever they change
  useEffect(() => {
    getAudioEngine().setAnalysis({ fftSize: config.fftSize, smoothing: config.smoothing })
  }, [config.fftSize, config.smoothing])

  // Letterbox the canvas inside its container at the chosen aspect ratio
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      if (rect.width < 10 || rect.height < 10) return
      const aspect = ASPECTS[configRef.current.aspect] ?? 16 / 9
      let cssW = rect.width
      let cssH = cssW / aspect
      if (cssH > rect.height) {
        cssH = rect.height
        cssW = cssH * aspect
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      let w = Math.max(2, Math.round(cssW * dpr))
      let h = Math.max(2, Math.round(cssH * dpr))
      // H.264-friendly even dimensions
      w -= w % 2
      h -= h % 2
      canvas.style.width = `${Math.round(cssW)}px`
      canvas.style.height = `${Math.round(cssH)}px`
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  // Re-measure when the aspect ratio changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const aspect = ASPECTS[config.aspect] ?? 16 / 9
    const parent = canvas.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    let cssW = rect.width
    let cssH = cssW / aspect
    if (cssH > rect.height) {
      cssH = rect.height
      cssW = cssH * aspect
    }
    canvas.style.width = `${Math.round(cssW)}px`
    canvas.style.height = `${Math.round(cssH)}px`
  }, [config.aspect])

  // Register the canvas on the engine (recorders read it from there)
  useEffect(() => {
    const engine = getAudioEngine()
    engine.canvasEl = canvasRef.current
    return () => {
      engine.canvasEl = null
    }
  }, [])

  // Render loop
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let monoTime = 0
    const bands = new Bands()
    const images = new SceneImages()
    const afterglow = new AfterglowLayer()
    let renderer: VisualizerRenderer | null = null
    let rendererType: string | null = null

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000))
      last = now
      monoTime += dt

      const cfg = configRef.current
      const engine = getAudioEngine()
      const { freq, wave } = engine.readAudio()
      bands.update(freq, engine.sampleRate, engine.analyser?.fftSize ?? 2048, dt)

      const w = canvas.width
      const h = canvas.height
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      drawSceneBackground(ctx, w, h, cfg, images)

      const trailCtx = afterglow.begin(w, h, cfg.afterglow)
      const target = trailCtx ?? ctx
      if (!renderer || rendererType !== cfg.type) {
        renderer = createVisualizer(cfg.type)
        rendererType = cfg.type
      }
      renderer({
        ctx: target,
        width: target.canvas.width,
        height: target.canvas.height,
        time: monoTime,
        dt,
        freq,
        wave,
        bass: bands.bass,
        mid: bands.mid,
        treble: bands.treble,
        level: bands.level,
        config: cfg,
      })
      if (trailCtx) afterglow.composite(ctx)
      drawSceneOverlays(ctx, w, h, cfg, lyricsRef.current, engine.currentTime, !!engine.track)

      const sink = getFrameSink()
      if (sink) sink(canvas, now)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      ref={wrapRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      data-testid="stage-wrap"
    >
      <canvas
        ref={canvasRef}
        className="rounded-lg shadow-[0_0_60px_-12px_rgba(0,0,0,0.9)]"
        aria-label="Visualizer canvas"
      />
    </div>
  )
}
