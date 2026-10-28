/**
 * Shared scene-drawing primitives used by BOTH the live preview loop
 * (visualizer-stage.tsx) and the offline exporter (offline-export.ts).
 *
 * Keeping these in one place guarantees that an exported frame is pixel-for-
 * pixel the same pipeline as the preview: background (solid / transparent /
 * image with zoom-pan-mirror + dim) → afterglow trail buffer → visualizer →
 * title + timestamped lyrics overlays.
 */

import type { LyricsState, VisualizerConfig } from '@/lib/types'
import type { LyricLine } from '@/lib/types'
import { findActiveLyricIndex, wrapCanvasText } from '@/lib/lyrics'

/** Cache of decoded background images (data/object URLs), shared by callers. */
export class SceneImages {
  private map = new Map<string, HTMLImageElement>()

  get(url: string): HTMLImageElement {
    let img = this.map.get(url)
    if (!img) {
      img = new Image()
      img.src = url
      this.map.set(url, img)
    }
    return img
  }
}

/**
 * Draws the background layer: transparent clear, solid fill, or a cover-fit
 * (zoomable / pannable / mirrorable) image with a dim overlay.
 * The caller is responsible for having reset the transform.
 */
export function drawSceneBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cfg: VisualizerConfig,
  images: SceneImages
): void {
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
  if (cfg.transparentBg) {
    ctx.clearRect(0, 0, w, h)
  } else {
    ctx.fillStyle = cfg.bgColor
    ctx.fillRect(0, 0, w, h)
  }

  if (cfg.bgImage && !cfg.transparentBg) {
    const img = images.get(cfg.bgImage)
    if (img.complete && img.naturalWidth > 0) {
      const cover = Math.max(w / img.naturalWidth, h / img.naturalHeight)
      const zoom = Math.min(3, Math.max(1, cfg.bgScale))
      const dw = img.naturalWidth * cover * zoom
      const dh = img.naturalHeight * cover * zoom
      // Panning range is the overflow beyond the canvas on each axis
      const panX = Math.max(0, (dw - w) / 2)
      const panY = Math.max(0, (dh - h) / 2)
      const ox = Math.min(1, Math.max(-1, cfg.bgOffsetX)) * panX
      const oy = Math.min(1, Math.max(-1, cfg.bgOffsetY)) * panY
      ctx.save()
      if (cfg.bgMirror) {
        // Flip the image horizontally around the canvas center
        ctx.translate(w, 0)
        ctx.scale(-1, 1)
      }
      ctx.drawImage(img, (w - dw) / 2 + ox, (h - dh) / 2 + oy, dw, dh)
      ctx.restore()
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.95, Math.max(0, cfg.bgImageDim))})`
      ctx.fillRect(0, 0, w, h)
    }
  }
}

/**
 * Persistent offscreen buffer for the afterglow trail layer. `begin` fades the
 * buffer and returns the context the visualizer should render into (or null
 * when afterglow is off — render straight onto the main canvas).
 */
export class AfterglowLayer {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null

  begin(w: number, h: number, afterglow: number): CanvasRenderingContext2D | null {
    const strength = Math.min(0.95, Math.max(0, afterglow))
    if (strength <= 0.001) return null
    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas = document.createElement('canvas')
      this.canvas.width = w
      this.canvas.height = h
      this.ctx = this.canvas.getContext('2d')
    }
    const ctx = this.ctx
    if (!ctx) return null
    // Fade previous trails (alpha-only decay keeps colors intact)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0.04, 1 - strength)})`
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'source-over'
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
    return ctx
  }

  /** Layer the trail buffer onto the main canvas (bg → trails → foreground). */
  composite(target: CanvasRenderingContext2D): void {
    if (this.canvas) target.drawImage(this.canvas, 0, 0)
  }
}

/** Karaoke timing constants (must match the live preview exactly) */
const FADE_IN = 0.28
const FADE_OUT = 0.32
const LYRIC_HOLD = 4.0

/** Draws the timestamped lyrics overlay, synced to the given song time. */
function drawLyrics(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ly: LyricsState,
  songTime: number
) {
  if (!ly.showLyrics || ly.lyrics.length === 0) return

  const t = songTime
  const idx = findActiveLyricIndex(ly.lyrics, t)
  if (idx < 0) return

  // Each line holds for up to 4s. When a new line starts while an older one is
  // still showing, the new text is stacked BELOW it (max 2 lines on screen);
  // a line fades out when its hold expires or once two newer lines have started.
  // Only the two most recently started lines can be visible
  const active: { line: LyricLine; alpha: number }[] = []
  for (let i = Math.max(0, idx - 1); i <= idx; i++) {
    const line = ly.lyrics[i]
    const evictAt = ly.lyrics[i + 2]?.time ?? Number.POSITIVE_INFINITY
    const outAt = Math.min(line.time + LYRIC_HOLD, evictAt)
    const alpha =
      Math.min(1, (t - line.time) / FADE_IN) *
      Math.min(1, Math.max(0, (outAt - t) / FADE_OUT))
    if (alpha > 0.02) active.push({ line, alpha })
  }
  if (active.length === 0) return

  const fontSize = Math.round(
    Math.min(w, h) * 0.046 * Math.min(2.5, Math.max(0.5, ly.lyricsSize))
  )
  ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  // Wrap every visible line; the older line's rows come first (top of the
  // block), the newest line's rows land at the bottom
  const lineHeight = fontSize * 1.32
  const rows: { text: string; alpha: number }[] = []
  for (const a of active) {
    for (const row of wrapCanvasText(ctx, a.line.text, w * 0.82, 4)) {
      rows.push({ text: row, alpha: a.alpha })
    }
  }
  if (rows.length === 0) return
  const blockH = rows.length * lineHeight
  let startY: number
  if (ly.lyricsPosition === 'top') {
    startY = h * 0.1 + fontSize
  } else if (ly.lyricsPosition === 'center') {
    startY = (h - blockH) / 2 + fontSize * 0.8
  } else {
    startY = h * 0.9 - blockH + fontSize
  }

  // Dark outline keeps the text readable on bright backgrounds. Text color and
  // glow are the lyric overlay's OWN settings — fully independent from the
  // visualizer gradient (colorA/colorB) and the visualizer glow slider.
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(2, fontSize / 9)
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = Math.min(48, Math.max(0, ly.lyricsGlow))
  ctx.shadowColor = ly.lyricsGlowColor
  ctx.fillStyle = ly.lyricsColor
  for (let i = 0; i < rows.length; i++) {
    const y = startY + i * lineHeight
    ctx.globalAlpha = rows[i].alpha
    ctx.strokeText(rows[i].text, w / 2, y)
    ctx.fillText(rows[i].text, w / 2, y)
  }
  ctx.shadowBlur = 0
  ctx.globalAlpha = 1
}

/**
 * Draws the title/subtitle + lyrics overlays on top of the visualizer.
 * `songTime` is the position within the track (seconds); `hasTrack` mirrors
 * the live stage's "no lyrics without a loaded track" guard.
 */
export function drawSceneOverlays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cfg: VisualizerConfig,
  lyrics: LyricsState,
  songTime: number,
  hasTrack: boolean
): void {
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0

  // Title / subtitle
  if (cfg.showTitle && cfg.title.trim()) {
    const margin = w * 0.055
    const baseY = h - h * 0.06

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.shadowBlur = cfg.glow * 0.45
    ctx.shadowColor = cfg.colorA
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 ${Math.round(w * 0.032)}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`
    ctx.fillText(cfg.title, margin, baseY)

    if (cfg.subtitle.trim()) {
      ctx.font = `500 ${Math.round(w * 0.019)}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`
      ctx.globalAlpha = 0.68
      ctx.fillText(cfg.subtitle, margin, baseY + Math.round(h * 0.032))
      ctx.globalAlpha = 1
    }
    ctx.shadowBlur = 0
  }

  // Timestamped lyrics (karaoke-style, follows the playhead)
  if (hasTrack) drawLyrics(ctx, w, h, lyrics, songTime)
}
