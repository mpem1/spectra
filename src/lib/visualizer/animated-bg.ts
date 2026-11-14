/**
 * Animated background engine — looping video files and GIFs.
 *
 * Two sources, one contract: the renderer needs SYNCHRONOUS access to a
 * drawable frame every rAF, and the offline exporters need DETERMINISTIC
 * frames (same song time → same pixels).
 *
 * - Video files (mp4/webm/mov): a looping <video> drives the live
 *   preview on the wall clock (decorative motion, keeps playing while the
 *   track is paused — same philosophy as the vinyl spin). It is muted
 *   unless the user opts into the clip's own audio (getPreviewVideoElement
 *   + the engine's attachVideoElement). The last drawable
 *   frame is held across the native loop seam so the wrap never flashes.
 *   Exports of the MP4 pipeline get their OWN private element and seek it to
 *   `songTime % length` before every frame, so exported video is frame-exact.
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

/** What the renderer should draw for a video background: media + its size. */
export interface BackgroundMedia {
  media: CanvasImageSource
  width: number
  height: number
}

interface PreviewVideoEntry {
  el: HTMLVideoElement
  /** Last drawable frame, blitted here to hold across the loop seam. */
  snap: HTMLCanvasElement | null
  /** performance.now() of the last snapshot blit. */
  snapAt: number
  /** performance.now() of the last drawable observation. */
  drawableAt: number
}

/** Live-preview elements: muted, looping, wall-clock playback. */
const previewVideos = new Map<string, PreviewVideoEntry>()

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

// Loop-seam hold tuning: the native `loop` wrap re-seeks to frame 0 and the
// element's ready state can dip for a frame — without a hold, that frame
// paints the dark base and the user sees a flash at every loop point.
// Refresh the held frame every ~120ms routinely and every frame during the
// final approach to the end; hold it for at most 1s before admitting the
// media is really gone (load failure → dark fallback as before).
const HOLD_MS = 1000
const SNAP_INTERVAL_MS = 120
const SNAP_EDGE_MS = 300

function blitSnapshot(entry: PreviewVideoEntry, now: number): void {
  const v = entry.el
  if (!entry.snap) entry.snap = document.createElement('canvas')
  if (entry.snap.width !== v.videoWidth) entry.snap.width = v.videoWidth
  if (entry.snap.height !== v.videoHeight) entry.snap.height = v.videoHeight
  const g = entry.snap.getContext('2d')
  if (!g) return
  try {
    g.drawImage(v, 0, 0)
    entry.snapAt = now
  } catch {
    /* a torn draw just means the next blit retries */
  }
}

function observePreviewVideo(entry: PreviewVideoEntry): BackgroundMedia | null {
  const v = entry.el
  const now = performance.now()
  const drawable = v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0
  if (drawable) {
    // Keep the hold-frame fresh. A paused element never changes, so only its
    // first blit matters; playing elements blit near the seam every frame.
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0
    const nearSeam = dur > 0 && dur - v.currentTime <= SNAP_EDGE_MS / 1000
    if (!entry.snap || (!v.paused && (nearSeam || now - entry.snapAt >= SNAP_INTERVAL_MS))) {
      blitSnapshot(entry, now)
    }
    entry.drawableAt = now
    // Mid-seek (the loop wrap re-seeks to frame 0) some pipelines invalidate
    // the presented frame — draw the held frame so the seam stays continuous.
    if (v.seeking && entry.snap) {
      return { media: entry.snap, width: entry.snap.width, height: entry.snap.height }
    }
    return { media: v, width: v.videoWidth, height: v.videoHeight }
  }
  // Ready state dipped at the seam or during a decode stall: hold the last
  // frame briefly so the wrap never flashes the dark base. A genuinely dead
  // media (load failure) times out of the hold and falls back to dark.
  if (entry.snap && now - entry.drawableAt <= HOLD_MS) {
    return { media: entry.snap, width: entry.snap.width, height: entry.snap.height }
  }
  return null
}

/**
 * The media the renderer should draw right now: the export's private
 * seek-driven element when an export is running (deterministic — no hold,
 * the exporter awaits every seek), otherwise the looping preview element
 * (created lazily) with a held frame across the loop seam so the wrap never
 * flashes. Null while still loading (dark fallback frame).
 */
export function getBackgroundMedia(src: string): BackgroundMedia | null {
  if (!src) return null
  const exp = exportVideos.get(src)
  if (exp) {
    return exp.readyState >= 2
      ? { media: exp, width: exp.videoWidth, height: exp.videoHeight }
      : null
  }
  let entry = previewVideos.get(src)
  if (!entry) {
    entry = { el: createVideoElement(src, false), snap: null, snapAt: 0, drawableAt: 0 }
    previewVideos.set(src, entry)
  }
  return observePreviewVideo(entry)
}

/**
 * The live-preview video element for `src`, created (and auto-played) on
 * first use — the same element the renderer draws, so unmuting it and
 * attaching it to the audio engine plays the clip's own sound in sync with
 * the picture. Null only when `src` is empty.
 */
export function getPreviewVideoElement(src: string): HTMLVideoElement | null {
  if (!src) return null
  let entry = previewVideos.get(src)
  if (!entry) {
    entry = { el: createVideoElement(src, false), snap: null, snapAt: 0, drawableAt: 0 }
    previewVideos.set(src, entry)
  }
  return entry.el
}

/**
 * Mute (or unmute) every cached preview video element — the video-audio
 * toggle-off path keeps all of them silent even while they keep looping.
 */
export function setPreviewVideosMuted(muted: boolean): void {
  for (const entry of previewVideos.values()) entry.el.muted = muted
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
    pv.el.pause()
    pv.el.removeAttribute('src')
    pv.el.load()
    previewVideos.delete(src)
  }
  gifCache.delete(src)
}
