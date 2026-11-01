/**
 * Animated background engine — looping video files and GIFs.
 *
 * Two sources, one contract: the renderer needs SYNCHRONOUS access to a
 * drawable frame every rAF, and the offline exporters need DETERMINISTIC
 * frames (same song time → same pixels).
 *
 * - Video files (mp4/webm/mov): a muted, looping <video> drives the live
 *   preview on the wall clock (decorative motion, keeps playing while the
 *   track is paused — same philosophy as the vinyl spin). Exerts of the MP4
 *   pipeline get their OWN private element and seek it to `songTime % length`
 *   before every frame, so exported video is frame-exact.
 *
 * - GIFs: <img> playback can't be seeked, so uploads are decoded ONCE into
 *   an array of frame canvases (omggif — pure JS, no wasm) plus per-frame
 *   delays. Playback is then pure math: pick the frame at
 *   `styleTime % totalDuration` — identical pixels in preview and export,
 *   free-running while paused like every other decorative clock.
 */

import { GifReader } from 'omggif'

/* --------------------------------- GIF cache -------------------------------- */

export interface GifAnimation {
  frames: HTMLCanvasElement[]
  /** Per-frame delay in ms (same length as frames) */
  delays: number[]
  /** Total loop duration in ms */
  duration: number
  width: number
  height: number
}

const gifCache = new Map<string, GifAnimation | 'decoding'>()
const gifJobs = new Map<string, Promise<void>>()

/** Data URLs carry the mime in the prefix — the cheapest possible sniff. */
export function isGifSrc(src: string): boolean {
  return src.startsWith('data:image/gif') || src.startsWith('blob:image/gif')
}

/** Returns the decoded animation, or null while decoding / if not a GIF. */
export function getGifAnimation(src: string): GifAnimation | null {
  if (!src || !isGifSrc(src)) return null
  const entry = gifCache.get(src)
  return entry && entry !== 'decoding' ? entry : null
}

/** Kick off decoding without awaiting (used by upload + preview warm-up). */
export function warmGif(src: string): void {
  if (!src || !isGifSrc(src)) return
  if (gifCache.has(src) || gifJobs.has(src)) return
  const job = decodeGif(src)
    .then((anim) => {
      gifCache.set(src, anim)
    })
    .catch(() => {
      gifCache.delete(src) // renderer falls back to dark; user can re-upload
    })
    .finally(() => {
      gifJobs.delete(src)
    })
  gifJobs.set(src, job)
}

/** Resolves once the GIF is decoded (or rejects). Export-safe. */
export function prepareGif(src: string): Promise<void> {
  if (!src || !isGifSrc(src)) return Promise.reject(new Error('Not a GIF source'))
  warmGif(src)
  const job = gifJobs.get(src)
  return job ?? Promise.resolve()
}

async function decodeGif(dataUrl: string): Promise<GifAnimation> {
  const res = await fetch(dataUrl)
  const buf = await res.arrayBuffer()
  const reader = new GifReader(new Uint8Array(buf))
  const width = reader.width
  const height = reader.height
  const count = reader.numFrames()
  if (width <= 0 || height <= 0 || count < 1) {
    throw new Error('Empty or unsupported GIF')
  }
  // Memory guard: frames are held as canvases (w*h*4 bytes each). Refuse the
  // pathological ones rather than OOM-tab-crashing the studio.
  const bytes = width * height * 4 * count
  if (bytes > 384 * 1024 * 1024) {
    throw new Error('GIF too large to decode — try a smaller resolution')
  }

  // omggif composites each frame into one persistent RGBA buffer (it applies
  // the disposal method between frames), so we snapshot after every blit.
  const pixels = new Uint8ClampedArray(width * height * 4)
  const frames: HTMLCanvasElement[] = []
  const delays: number[] = []
  for (let i = 0; i < count; i++) {
    reader.decodeAndBlitFrameRGBA(i, pixels)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.putImageData(new ImageData(pixels.slice(), width, height), 0, 0)
    frames.push(canvas)
    // omggif surfaces the raw stream value, which is CENTISECONDS in the GIF
    // spec. A delay of 0 means "as fast as possible" — browsers then use
    // 100ms. Mirror that so zero-delay GIFs don't spin absurdly.
    const info = reader.frameInfo(i)
    delays.push((info.delay > 0 ? info.delay : 10) * 10)
  }
  const duration = Math.max(1, delays.reduce((a, b) => a + b, 0))
  return { frames, delays, duration, width, height }
}

/** Frame index at a given loop position (ms), deterministic. */
export function gifFrameAt(anim: GifAnimation, timeMs: number): HTMLCanvasElement | null {
  if (anim.frames.length === 0) return null
  if (anim.frames.length === 1) return anim.frames[0]
  let t = ((timeMs % anim.duration) + anim.duration) % anim.duration
  for (let i = 0; i < anim.frames.length; i++) {
    t -= anim.delays[i]
    if (t < 0) return anim.frames[i]
  }
  return anim.frames[anim.frames.length - 1]
}

/* -------------------------------- Video cache -------------------------------- */

/** Live-preview elements: muted, looping, wall-clock playback. */
const previewVideos = new Map<string, HTMLVideoElement>()

/** Export-private elements registered by the offline renderers (seek-driven). */
const exportVideos = new Map<string, HTMLVideoElement>()

function createVideoElement(src: string, forExport: boolean): HTMLVideoElement {
  const v = document.createElement('video')
  v.src = src
  v.muted = true
  v.loop = true
  v.playsInline = true
  v.preload = 'auto'
  // Exports drive currentTime manually — never autoplay those.
  if (!forExport) void v.play().catch(() => {/* autoplay may wait for a gesture */})
  return v
}

/**
 * The element the renderer should draw right now: the export's private
 * seek-driven one when an export is running, otherwise the looping preview
 * element (created lazily). Null while still loading (dark fallback frame).
 */
export function getBackgroundVideo(src: string): HTMLVideoElement | null {
  if (!src) return null
  const exp = exportVideos.get(src)
  if (exp) return exp.readyState >= 2 ? exp : null
  let v = previewVideos.get(src)
  if (!v) {
    v = createVideoElement(src, false)
    previewVideos.set(src, v)
  }
  return v.readyState >= 2 ? v : null
}

/**
 * Create + register the export-private video element and wait for it to be
 * seekable (readyState ≥ 2). Call once before frame 0.
 */
export function prepareExportVideo(src: string): Promise<HTMLVideoElement> {
  if (!src) return Promise.reject(new Error('No background video set'))
  releaseExportVideo(src)
  const v = createVideoElement(src, true)
  exportVideos.set(src, v)
  return new Promise((resolve, reject) => {
    if (v.readyState >= 2) {
      resolve(v)
      return
    }
    const ok = () => {
      cleanup()
      resolve(v)
    }
    const bad = () => {
      cleanup()
      if (exportVideos.get(src) === v) exportVideos.delete(src)
      reject(new Error('Background video could not be loaded'))
    }
    const cleanup = () => {
      v.removeEventListener('loadeddata', ok)
      v.removeEventListener('error', bad)
    }
    v.addEventListener('loadeddata', ok)
    v.addEventListener('error', bad)
  })
}

/**
 * Seek the export element to `timeSec % videoLength` and wait until the new
 * frame is actually presented — the per-frame anchor of deterministic export.
 * Falls back after a short timeout so an unhelpful 'seeked' can't hang the
 * render loop.
 */
export function seekExportVideo(src: string, timeSec: number): Promise<void> {
  const v = exportVideos.get(src)
  if (!v) return Promise.resolve()
  const dur = Number.isFinite(v.duration) ? v.duration : 0
  const target = dur > 0 ? timeSec % dur : Math.max(0, timeSec)
  if (Math.abs(v.currentTime - target) < 0.004 && v.readyState >= 2) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      v.removeEventListener('seeked', finish)
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(finish, 250)
    v.addEventListener('seeked', finish)
    try {
      v.currentTime = target
    } catch {
      finish()
    }
  })
}

/** Drop the export-private element (called in the exporter's finally). */
export function releaseExportVideo(src: string): void {
  const v = exportVideos.get(src)
  if (v) {
    v.pause()
    v.removeAttribute('src')
    v.load()
    exportVideos.delete(src)
  }
}

/** Forget every cached element/animation for a source (upload replaced). */
export function forgetAnimatedBackground(src: string): void {
  if (!src) return
  releaseExportVideo(src)
  const pv = previewVideos.get(src)
  if (pv) {
    pv.pause()
    pv.removeAttribute('src')
    pv.load()
    previewVideos.delete(src)
  }
  gifCache.delete(src)
}
