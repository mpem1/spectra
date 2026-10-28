/**
 * In-browser WebM → MP4 / ProRes 4444 conversion via ffmpeg.wasm.
 *
 * The server-side /api/convert route needs an ffmpeg binary, which many
 * hosting platforms (Vercel, Netlify, …) do not provide in serverless
 * functions. This module runs the exact same transcodes client-side so the
 * Convert feature works on ANY host — the clip never leaves the user's device.
 *
 * Implementation notes:
 * - @ffmpeg/ffmpeg (UMD build) is loaded from unpkg with a jsdelivr fallback;
 *   the UMD webpack build resolves its worker chunk (814.ffmpeg.js) relative to
 *   the CDN script URL, so a plain <script> tag is all it needs.
 * - @ffmpeg/core (single-threaded) is loaded as Blob URLs — required so the
 *   Emscripten binary gets the correct MIME type and no cross-origin issues.
 * - The core includes every codec we need (verified by binary scan):
 *   prores_ks, libvpx-vp8/vp9 (alpha-preserving decoders), libx264, libopus,
 *   libvorbis, pcm_s16le, aac.
 * - Decode uses `-c:v libvpx` on the ProRes path: ffmpeg's native vp8/vp9
 *   decoders silently DROP the WebM BlockAdditional alpha plane (Task 9).
 * - wasm32 has a ~2 GB heap, so ProRes 4444 output is budget-guarded
 *   (see estimateProResBytes / WASM_PRORES_MAX_OUTPUT_BYTES).
 */

const CORE_BASES = [
  'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd',
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd',
]
/** Hard cap for the ProRes 4444 output produced inside the wasm heap. */
export const WASM_PRORES_MAX_OUTPUT_BYTES = 1.2 * 1024 * 1024 * 1024

/**
 * Rough size estimate for ProRes 4444 (≈0.6–0.66 bytes/pixel at native depth;
 * 0.7 keeps the estimate on the safe side) at 30 fps.
 */
export function estimateProResBytes(durationSec: number, width: number, height: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return Number.POSITIVE_INFINITY
  const w = width > 0 ? width : 1280
  const h = height > 0 ? height : 720
  return Math.round(w * h * 30 * 0.7 * durationSec)
}

export interface WebmProbe {
  /** Seconds, or null when the container does not expose it. */
  durationSec: number | null
  width: number
  height: number
}

/**
 * Read duration/size from a WebM blob. MediaRecorder WebMs frequently report
 * `Infinity` duration (no seekhead metadata) — the classic "seek far forward"
 * trick forces Chrome to compute the real duration.
 */
export async function probeWebm(blob: Blob): Promise<WebmProbe> {
  if (typeof document === 'undefined' || blob.size === 0) {
    return { durationSec: null, width: 0, height: 0 }
  }
  const url = URL.createObjectURL(blob)
  const v = document.createElement('video')
  v.preload = 'metadata'
  v.muted = true
  try {
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(finish, 4000)
      function finish() {
        window.clearTimeout(timer)
        v.removeEventListener('loadedmetadata', onMeta)
        v.removeEventListener('error', finish)
        v.removeEventListener('durationchange', onDurChange)
        v.removeEventListener('seeked', finish)
        resolve()
      }
      function onMeta() {
        if (Number.isFinite(v.duration) && v.duration > 0) {
          finish()
        } else {
          // Force Chromium to scan the whole file for the real duration
          v.addEventListener('durationchange', onDurChange, { once: true })
          v.addEventListener('seeked', finish, { once: true })
          try {
            v.currentTime = 1e7
          } catch {
            finish()
          }
        }
      }
      function onDurChange() {
        finish()
      }
      v.addEventListener('loadedmetadata', onMeta, { once: true })
      v.addEventListener('error', finish, { once: true })
      v.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
  const durationSec =
    Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null
  return { durationSec, width: v.videoWidth || 0, height: v.videoHeight || 0 }
}

interface FFmpegInstance {
  on(event: 'log', cb: (e: { type: string; message: string }) => void): unknown
  on(
    event: 'progress',
    cb: (e: { progress: number; time: number }) => void
  ): unknown
  load(opts: {
    coreURL: string
    wasmURL: string
  }): Promise<boolean>
  writeFile(name: string, data: Uint8Array): Promise<boolean>
  readFile(name: string): Promise<Uint8Array | string>
  deleteFile(name: string): Promise<boolean>
  exec(args: string[]): Promise<number>
  terminate(): void
}

type FFmpegCtor = new () => FFmpegInstance

declare global {
  interface Window {
    FFmpegWASM?: { FFmpeg: FFmpegCtor }
  }
}

const loadedScripts = new Set<string>()

function loadScript(src: string): Promise<void> {
  if (loadedScripts.has(src)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.onload = () => {
      loadedScripts.add(src)
      resolve()
    }
    el.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(el)
  })
}

async function toBlobURL(url: string, mime: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url} (HTTP ${res.status})`)
  const buf = await res.arrayBuffer()
  return URL.createObjectURL(new Blob([buf], { type: mime }))
}

async function pickBase(bases: string[], file: string): Promise<string> {
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/${file}`, { method: 'HEAD' })
      if (res.ok) return base
    } catch {
      /* try next CDN */
    }
  }
  throw new Error(
    'Could not reach the ffmpeg.wasm CDN (unpkg / jsdelivr). Check your network and try again.'
  )
}

let instance: FFmpegInstance | null = null
let loadPromise: Promise<FFmpegInstance> | null = null

async function getFFmpeg(): Promise<FFmpegInstance> {
  if (instance) return instance
  if (!loadPromise) {
    loadPromise = (async () => {
      // The UMD wrapper is self-hosted in /public/ffmpeg (two ~4 KB files,
      // pinned to the same version as the core): loading it cross-origin from
      // a CDN makes the build spawn its Web Worker on the CDN origin, which
      // browsers block (SecurityError), and its classWorkerURL escape hatch is
      // broken by webpack transforms. Same-origin script → same-origin worker.
      await loadScript('/ffmpeg/ffmpeg.js')
      const FF = window.FFmpegWASM?.FFmpeg
      if (!FF) throw new Error('ffmpeg.wasm did not initialize correctly.')
      const inst = new FF()
      const coreBase = await pickBase(CORE_BASES, 'ffmpeg-core.js')
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm'),
      ])
      await inst.load({ coreURL, wasmURL })
      instance = inst
      return inst
    })()
  }
  try {
    return await loadPromise
  } catch (err) {
    loadPromise = null
    throw err
  }
}

export interface WasmConvertOptions {
  format: 'mp4' | 'prores4444'
  /** Real clip length in seconds (for accurate progress %). */
  durationSec?: number | null
  onProgress?: (p: { pct: number | null; elapsedMs: number; logLine: string }) => void
}

export interface WasmConvertResult {
  blob: Blob
  ext: 'mp4' | 'mov'
}

/**
 * Convert a WebM recording entirely in the browser.
 * Throws Error with a user-presentable message on failure.
 */
export async function convertWebmInBrowser(
  webm: Blob,
  opts: WasmConvertOptions
): Promise<WasmConvertResult> {
  const ffmpeg = await getFFmpeg()
  const startedAt = Date.now()
  const outName = opts.format === 'mp4' ? 'output.mp4' : 'output.mov'
  let latestLog = ''
  let offLog: unknown
  let offProgress: unknown

  const emit = (pct: number | null) =>
    opts.onProgress?.({ pct, elapsedMs: Date.now() - startedAt, logLine: latestLog })

  try {
    offLog = ffmpeg.on('log', ({ message }) => {
      latestLog = message
      emit(null)
    })
    offProgress = ffmpeg.on('progress', ({ time }) => {
      const dur = opts.durationSec ?? 0
      emit(dur > 0 ? Math.min(99.9, (time / 1e6 / dur) * 100) : null)
    })

    await ffmpeg.writeFile('input.webm', new Uint8Array(await webm.arrayBuffer()))

    const args =
      opts.format === 'mp4'
        ? [
            '-y',
            '-i', 'input.webm',
            '-c:v', 'libx264',
            '-crf', '18',
            '-preset', 'veryfast',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-c:a', 'aac',
            '-b:a', '192k',
            outName,
          ]
        : [
            '-y',
            // libvpx decoder keeps the VP8/VP9 alpha plane alive (native decoders drop it)
            '-c:v', 'libvpx',
            '-i', 'input.webm',
            '-c:v', 'prores_ks',
            '-profile:v', '4444',
            '-pix_fmt', 'yuva444p10le',
            '-c:a', 'pcm_s16le',
            outName,
          ]

    const code = await ffmpeg.exec(args)
    if (code !== 0) {
      throw new Error(
        `In-browser conversion failed${latestLog ? ` — ${latestLog.slice(0, 200)}` : ''}.`
      )
    }

    const data = await ffmpeg.readFile(outName)
    if (typeof data === 'string' || data.byteLength === 0) {
      throw new Error('In-browser conversion produced an empty file.')
    }
    // Copy out of the wasm heap before touching the MEMFS file again
    const bytes = new Uint8Array(data.byteLength)
    bytes.set(data)
    const blob = new Blob([bytes], {
      type: opts.format === 'mp4' ? 'video/mp4' : 'video/quicktime',
    })
    return { blob, ext: opts.format === 'mp4' ? 'mp4' : 'mov' }
  } finally {
    if (typeof offLog === 'function') (offLog as () => void)()
    if (typeof offProgress === 'function') (offProgress as () => void)()
    try {
      await ffmpeg.deleteFile('input.webm')
    } catch {
      /* ignore */
    }
    try {
      await ffmpeg.deleteFile(outName)
    } catch {
      /* ignore */
    }
  }
}

/**
 * Abort the running in-browser conversion (kills the wasm worker; the next
 * conversion transparently reloads a fresh engine).
 */
export function cancelWasmConversion(): void {
  if (instance) {
    try {
      instance.terminate()
    } catch {
      /* ignore */
    }
    instance = null
    loadPromise = null
  }
}
