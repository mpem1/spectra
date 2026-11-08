/**
 * Lyrics transcription worker — "Auto-detect lyrics" engine.
 *
 * Runs Whisper (via transformers.js) fully client-side, in its own thread so
 * the visualizer keeps dancing while the model works. This lives in a worker
 * rather than an API route because the production deployment is a static
 * GitHub Pages export with no server — and as a bonus the song's audio never
 * leaves the user's device. The quantized model (~80 MB) is downloaded from
 * the Hugging Face CDN on first use and cached by the browser afterwards.
 *
 * Protocol:
 *   in  → { type: 'run', audio: Float32Array (16 kHz mono, whole song), overlap: seconds }
 *   out → { type: 'model', stage: 'loading', file, progress }   model download
 *   out → { type: 'status', stage: 'ready' }                    model in memory
 *   out → { type: 'window', index, total, segments }            per 30 s window
 *   out → { type: 'done', segments }                            full result
 *   out → { type: 'error', message }
 *
 * Segments carry absolute song times (seconds) so the caller can drop them
 * straight into LyricLine[].
 */

import { env, pipeline } from '@huggingface/transformers'
import type { AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import { TRANSCRIBE_WINDOW_SECONDS } from './transcribe-shared'

/** Never resolve models from local paths — they live on the HF CDN. */
env.allowLocalModels = false

export interface TranscribeInMessage {
  type: 'run'
  /** 16 kHz mono samples for the WHOLE song */
  audio: Float32Array
  /** Seconds of overlap between consecutive windows — speech inside this
   *  zone at the START of a window was already captured by the previous
   *  window's tail, so it is skipped to avoid duplicated lines. */
  overlap: number
}

export interface TranscribedSegment {
  /** Absolute song time in seconds */
  time: number
  text: string
}

export type TranscribeOutMessage =
  | {
      type: 'model'
      stage: 'loading'
      file: string
      progress: number
      loaded?: number
      total?: number
    }
  | { type: 'status'; stage: 'ready' }
  | { type: 'window'; index: number; total: number; segments: TranscribedSegment[] }
  | { type: 'done'; segments: TranscribedSegment[] }
  | { type: 'error'; message: string }

/** Whisper's native input length — one window per inference. */
const SAMPLE_RATE = 16000

/** Whisper multilingual: auto-detects the language, transcribes in it. */
const MODEL_ID = 'Xenova/whisper-base'
const MODEL_DTYPE = 'q8'

let asr: AutomaticSpeechRecognitionPipeline | null = null

type PostTarget = { postMessage: (message: TranscribeOutMessage) => void }
const post = (message: TranscribeOutMessage): void => {
  ;(self as unknown as PostTarget).postMessage(message)
}

async function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (asr) return asr
  asr = await pipeline('automatic-speech-recognition', MODEL_ID, {
    dtype: MODEL_DTYPE,
    device: 'wasm',
    progress_callback: (info: {
      status: string
      file?: string
      progress?: number
      loaded?: number
      total?: number
    }) => {
      if (info.status !== 'progress' || !info.file) return
      post({
        type: 'model',
        stage: 'loading',
        file: info.file,
        progress: info.progress ?? 0,
        loaded: info.loaded,
        total: info.total,
      })
    },
  })
  return asr
}

interface WhisperChunk {
  text: string
  timestamp: [number | null, number | null]
}

async function run(audio: Float32Array, overlap: number): Promise<void> {
  const transcriber = await getTranscriber()
  post({ type: 'status', stage: 'ready' })

  // Windows OVERLAP: stride = window − overlap, so each window's first
  // `overlap` seconds repeat the previous window's tail. A word that straddles
  // a hard cut would be shredded into garbage by contiguous windows; with the
  // overlap it is fully inside the previous window, and the duplicate hearing
  // of it (segments starting at local time < overlap) is skipped below.
  const stride = Math.max(1, TRANSCRIBE_WINDOW_SECONDS - overlap)
  const durationSec = audio.length / SAMPLE_RATE
  const total = Math.max(1, Math.ceil(durationSec / stride))
  const windowSamples = TRANSCRIBE_WINDOW_SECONDS * SAMPLE_RATE
  const collected: TranscribedSegment[] = []

  for (let i = 0; i < total; i++) {
    const startSec = i * stride
    const from = Math.round(startSec * SAMPLE_RATE)
    const slice = audio.subarray(from, Math.min(from + windowSamples, audio.length))
    // Ignore a sub-second tail — not enough audio to transcribe meaningfully.
    if (slice.length < SAMPLE_RATE) break

    const out = (await transcriber(slice as unknown as Parameters<typeof transcriber>[0], {
      return_timestamps: true,
    })) as { text: string; chunks: WhisperChunk[] | null }

    const segments: TranscribedSegment[] = []
    for (const chunk of out.chunks ?? []) {
      const start = chunk.timestamp?.[0]
      const text = (chunk.text ?? '').trim()
      if (start == null || !text) continue
      // Overlap zone (windows after the first): this audio moment was also
      // the tail of the previous window, where it was already transcribed.
      if (i > 0 && start < overlap) continue
      segments.push({ time: startSec + start, text })
    }

    collected.push(...segments)
    post({ type: 'window', index: i + 1, total, segments })
  }

  post({ type: 'done', segments: collected })
}

self.onmessage = (event: MessageEvent<TranscribeInMessage>): void => {
  if (event.data?.type !== 'run') return
  run(event.data.audio, event.data.overlap).catch((err: unknown) => {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  })
}
