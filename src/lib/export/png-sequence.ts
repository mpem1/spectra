/**
 * PNG image-sequence capture — the zero-dependency way to get TRANSPARENT
 * footage into DaVinci Resolve.
 *
 * Every gated frame of the live canvas is encoded to PNG (which always keeps
 * its alpha channel) and appended to a ZIP archive:
 *
 * - Chrome/Edge: the ZIP is streamed straight to disk via the File System
 *   Access API, so even multi-GB sequences never touch memory.
 * - Everything else: the archive is assembled in memory and downloaded at the
 *   end (fine for short clips; a live size estimate warns before limits).
 *
 * Resolve import: unzip, then Media Pool → import the FIRST frame with
 * "Image Sequence" enabled and set the sequence to the capture frame rate.
 *
 * Frames are gated to a constant frame rate from the rAF sink; if a PNG
 * encode takes longer than one frame slot, the previous frame's PNG is
 * duplicated for the missed slots so the 1 frame = 1 slot mapping (and
 * therefore audio sync in the NLE) is preserved exactly.
 */

import { Zip, ZipDeflate } from 'fflate'

export interface PngSequenceOptions {
  fps: number
  suggestedName?: string
}

export type PngSequenceSaveMode = 'disk' | 'memory'

export interface PngSequenceStartResult {
  started: boolean
  mode: PngSequenceSaveMode
  /** 'cancelled' when the save dialog was dismissed by the user */
  reason?: string
}

export interface PngSequenceFinishResult {
  /** Null when the file was streamed to disk */
  blob: Blob | null
  frames: number
  mode: PngSequenceSaveMode
  error?: string
}

interface FSWritable {
  write: (data: unknown) => Promise<void>
  close: () => Promise<void>
  abort?: (reason?: unknown) => Promise<void>
}

interface SaveFilePickerWindow {
  showSaveFilePicker?: (options?: {
    suggestedName?: string
    types?: { description?: string; accept: Record<string, string[]> }[]
  }) => Promise<{ createWritable: () => Promise<FSWritable> }>
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class PngSequenceRecorder {
  /** File System Access API (streaming to disk) availability */
  static get canStreamToDisk(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof (window as SaveFilePickerWindow).showSaveFilePicker === 'function'
    )
  }

  private zip: Zip | null = null
  private writable: FSWritable | null = null

  private readonly fps: number
  private readonly frameDurMs: number
  private readonly suggestedName: string

  private startedAtMs = 0
  private nextFrameMs = 0
  private frameIndex = 0
  private owed = 0
  private busy = false
  private lastBlob: Blob | null = null
  private totalPngBytes = 0

  private mode: PngSequenceSaveMode = 'memory'
  private zipChunks: Uint8Array[] = []
  private zipFinal = false
  private resolveZipDone: (() => void) | null = null
  private outQueue: Promise<void> = Promise.resolve()
  private zipError: unknown = null
  private writeChain: Promise<void> = Promise.resolve()
  private finished = false

  constructor(opts: PngSequenceOptions) {
    this.fps = Math.max(1, Math.min(60, Math.round(opts.fps)))
    this.frameDurMs = 1000 / this.fps
    this.suggestedName = opts.suggestedName ?? `spectra-frames-${this.fps}fps.zip`
  }

  get frames(): number {
    return this.frameIndex
  }

  get saveMode(): PngSequenceSaveMode {
    return this.mode
  }

  /** Running estimate of the finished ZIP size (sum of captured PNG bytes;
   *  stored entries add essentially no overhead). */
  get estimatedBytes(): number {
    return this.totalPngBytes
  }

  /** Open the output (disk stream when possible) and prepare the ZIP writer. */
  async start(): Promise<PngSequenceStartResult> {
    if (this.zip) return { started: true, mode: this.mode }
    const w = window as SaveFilePickerWindow

    if (typeof w.showSaveFilePicker === 'function') {
      try {
        const handle = await w.showSaveFilePicker({
          suggestedName: this.suggestedName,
          types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
        })
        this.writable = await handle.createWritable()
        this.mode = 'disk'
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return { started: false, mode: 'memory', reason: 'cancelled' }
        }
        // Headless/blocked pickers degrade to the in-memory archive
        this.mode = 'memory'
      }
    } else {
      this.mode = 'memory'
    }

    this.zip = new Zip((err, dat, final) => {
      if (err) {
        this.zipError = err
        return
      }
      if (this.mode === 'disk' && this.writable) {
        const writable = this.writable
        this.outQueue = this.outQueue
          .then(async () => {
            await writable.write(dat)
            if (final) await writable.close()
          })
          .catch((e: unknown) => {
            this.zipError = e
          })
      } else {
        this.zipChunks.push(dat)
        if (final) this.resolveZipDone?.()
      }
    })
    return { started: true, mode: this.mode }
  }

  /** Called once per rendered frame from the render loop (CFR gated). */
  handleFrame(canvas: HTMLCanvasElement, nowMs: number): void {
    if (this.finished || !this.zip) return
    if (!this.startedAtMs) this.startedAtMs = nowMs
    const elapsed = nowMs - this.startedAtMs

    let due = 0
    while (this.nextFrameMs <= elapsed) {
      this.nextFrameMs += this.frameDurMs
      due++
    }
    if (due <= 0) return

    // Accumulate owed slots; when a PNG encode is still in flight the previous
    // frame is duplicated for missed slots, preserving exact frame/slot count
    this.owed += due
    if (this.busy) return
    const take = this.owed
    this.owed = 0
    this.busy = true
    canvas.toBlob((blob) => {
      this.busy = false
      if (this.finished) return
      if (blob) {
        this.lastBlob = blob
        this.totalPngBytes += blob.size
      }
      if (this.lastBlob) this.enqueueWrite(take)
    }, 'image/png')
  }

  private enqueueWrite(count: number): void {
    const blob = this.lastBlob
    const zip = this.zip
    if (!blob || !zip) return
    this.writeChain = this.writeChain.then(async () => {
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        for (let i = 0; i < count; i++) {
          this.frameIndex++
          const entry = new ZipDeflate(
            `frame_${String(this.frameIndex).padStart(6, '0')}.png`,
            { level: 0 } // PNGs are already deflate-compressed — store them
          )
          zip.add(entry)
          entry.push(bytes, true)
        }
      } catch (err) {
        this.zipError = err
      }
    })
  }

  /** Stop capturing, finalize the ZIP and close the output. */
  async finish(): Promise<PngSequenceFinishResult> {
    const zip = this.zip
    const mode = this.mode
    const frames = this.frameIndex
    if (this.finished || !zip) {
      return { blob: null, frames, mode, error: 'Recorder was not started.' }
    }
    this.finished = true

    // Let an in-flight PNG encode land so its frames join the archive
    for (let i = 0; i < 66 && this.busy; i++) await sleep(30)
    await this.writeChain.catch(() => {})

    try {
      zip.end()
    } catch (err) {
      this.zipError = err
    }

    if (this.zipError) {
      await this.discardOutput().catch(() => {})
      return {
        blob: null,
        frames: this.frameIndex,
        mode,
        error: this.zipError instanceof Error ? this.zipError.message : 'ZIP writer failed.',
      }
    }

    if (mode === 'disk') {
      await this.outQueue.catch(() => {})
      if (this.zipError) {
        return {
          blob: null,
          frames: this.frameIndex,
          mode,
          error: this.zipError instanceof Error ? this.zipError.message : 'Writing to disk failed.',
        }
      }
      return { blob: null, frames: this.frameIndex, mode }
    }

    await Promise.race([
      new Promise<void>((resolve) => {
        this.resolveZipDone = resolve
        if (this.zipFinal) resolve()
      }),
      sleep(10_000),
    ])
    const blob = new Blob(this.zipChunks as BlobPart[], { type: 'application/zip' })
    this.zipChunks = []
    if (blob.size === 0) {
      return { blob: null, frames: this.frameIndex, mode, error: 'No frames were captured.' }
    }
    return { blob, frames: this.frameIndex, mode }
  }

  /** Abort and throw away everything captured so far. */
  cancel(): void {
    if (this.finished) return
    this.finished = true
    try {
      this.zip?.end()
    } catch {
      /* aborting — final state irrelevant */
    }
    void this.discardOutput().catch(() => {})
  }

  private async discardOutput(): Promise<void> {
    await this.writeChain.catch(() => {})
    this.zipChunks = []
    if (this.writable) {
      const writable = this.writable
      this.writable = null
      try {
        await writable.abort?.()
      } catch {
        /* already closed */
      }
    }
  }
}
