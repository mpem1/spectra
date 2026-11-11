/**
 * "Auto-detect lyrics" orchestrator (main thread).
 *
 * Takes the decoded AudioBuffer from the audio engine and runs it through
 * the vocal-focus preprocessor (center extraction + rumble cut + loudness
 * normalize — see ./vocal-focus: Whisper is a speech model listening to a
 * music mix, and emphasis measurably recovers words the plain mixdown
 * loses, especially early-song lines buried under the intro), resamples to
 * 16 kHz (Whisper's input rate), and hands the samples to the transcription
 * worker. Resolves with time-stamped LyricLine[] ready for patchLyrics().
 *
 * The returned handle exposes cancel() — the worker is terminated and the
 * promise rejects with a DetectCancelled error the caller can recognize.
 */

import type { LyricLine } from '@/lib/visualizer/types'
import type { TranscribeOutMessage } from './transcribe-worker'
import { TRANSCRIBE_WINDOW_SECONDS } from './transcribe-shared'
import { vocalFocus } from './vocal-focus'

const TARGET_RATE = 16000
/** Seconds of overlap between consecutive windows (dedupe zone). */
const WINDOW_OVERLAP = 2

/** Thrown when the user stops a running detection — not an error to report. */
export class DetectCancelled extends Error {
  constructor() {
    super('Lyrics detection cancelled')
    this.name = 'DetectCancelled'
  }
}

export interface DetectProgress {
  phase: 'model' | 'listening'
  /** Model file being downloaded + its progress 0..100 (phase 'model'). */
  file?: string
  modelProgress?: number
  /** Window index / total being transcribed (phase 'listening'). */
  window?: number
  totalWindows?: number
  /** Lines heard so far. */
  partialLines?: LyricLine[]
}

export interface DetectHandle {
  promise: Promise<LyricLine[]>
  cancel: () => void
}

/**
 * Resample mono samples to 16 kHz. OfflineAudioContext resamples the source
 * buffer (at the track's rate) into a 16 kHz destination — exactly the kind
 * of resample ASR wants.
 */
async function resampleTo16k(mono: Float32Array, sourceRate: number): Promise<Float32Array> {
  if (sourceRate === TARGET_RATE) return mono
  const frames = Math.max(1, Math.ceil((mono.length * TARGET_RATE) / sourceRate))
  const ctx = new OfflineAudioContext(1, frames, TARGET_RATE)
  const sourceBuffer = ctx.createBuffer(1, mono.length, sourceRate)
  sourceBuffer.copyToChannel(mono, 0)
  const source = ctx.createBufferSource()
  source.buffer = sourceBuffer
  source.connect(ctx.destination)
  source.start()
  const rendered = await ctx.startRendering()
  return rendered.getChannelData(0).slice()
}

function toLyricLines(segments: { time: number; text: string }[]): LyricLine[] {
  return segments
    .map((s) => ({ time: Math.round(s.time * 100) / 100, text: s.text }))
    .sort((a, b) => a.time - b.time)
}

/** Rough window count for progress display before the worker reports it. */
export function estimateWindowCount(durationSeconds: number): number {
  return Math.max(1, Math.ceil(durationSeconds / TRANSCRIBE_WINDOW_SECONDS))
}

export function detectLyricsFromBuffer(
  audioBuffer: AudioBuffer,
  onProgress: (progress: DetectProgress) => void,
): DetectHandle {
  const worker = new Worker(new URL('./transcribe-worker.ts', import.meta.url), { type: 'module' })

  let cancelled = false
  let settled = false
  let rejectPromise: ((reason: unknown) => void) | null = null
  /** Display-only accumulator for the "lines so far" progress readout. */
  const partials: { time: number; text: string }[] = []

  const fail = (reason: unknown) => {
    if (settled) return
    settled = true
    worker.terminate()
    rejectPromise?.(reason)
  }

  const promise = new Promise<LyricLine[]>((resolve, reject) => {
    rejectPromise = reject
    let totalWindows = estimateWindowCount(audioBuffer.duration)

    worker.addEventListener(
      'message',
      (event: MessageEvent<TranscribeOutMessage>) => {
        const message = event.data
        if (cancelled || settled) return
        switch (message.type) {
          case 'model':
            onProgress({
              phase: 'model',
              file: message.file,
              modelProgress: message.progress,
            })
            break
          case 'status':
            if (message.stage !== 'ready') return
            onProgress({ phase: 'listening', window: 0, totalWindows, partialLines: [] })
            break
          case 'window':
            totalWindows = Math.max(totalWindows, message.total)
            partials.push(...message.segments)
            onProgress({
              phase: 'listening',
              window: message.index,
              totalWindows: message.total,
              partialLines: toLyricLines(partials),
            })
            break
          case 'done': {
            // The worker's final list is authoritative — the same segments
            // already streamed through 'window' messages for the partial
            // progress readout, so don't accumulate them twice.
            settled = true
            worker.terminate()
            resolve(toLyricLines(message.segments))
            break
          }
          case 'error':
            fail(new Error(message.message))
            break
        }
      },
    )
    worker.addEventListener('error', (event) => {
      fail(new Error(event.message || 'Transcription worker crashed'))
    })
    worker.addEventListener('messageerror', () => {
      fail(new Error('Transcription worker message failed to deserialize'))
    })

    void resampleTo16k(
      vocalFocus(
        // Channel views into the engine's buffer — vocalFocus only reads
        // them and returns its own array, so no copies needed here.
        Array.from({ length: audioBuffer.numberOfChannels }, (_, c) => audioBuffer.getChannelData(c)),
        audioBuffer.sampleRate,
      ),
      audioBuffer.sampleRate,
    )
      .then((mono16k) => {
        if (cancelled || settled) return
        const copy = new Float32Array(mono16k) // transferable copy
        worker.postMessage({ type: 'run', audio: copy, overlap: WINDOW_OVERLAP }, [copy.buffer])
      })
      .catch((err: unknown) => {
        fail(err instanceof Error ? err.message : 'Could not prepare the audio for transcription')
      })
  })

  return {
    promise,
    cancel: () => {
      if (cancelled || settled) return
      cancelled = true
      fail(new DetectCancelled())
    },
  }
}
