/**
 * Pure post-processing for the lyrics auto-detect transcription results.
 *
 * Lives apart from the worker so the harness can exercise it without
 * downloading a model, and so the rules stay small and auditable:
 *
 * 1. HALLUCINATION GUARD — Whisper (a speech model) invents stock phrases
 *    when it listens to long instrumental stretches ("Thank you.",
 *    "Please subscribe.", "[Music]" …). They arrive as REAL lyric lines and
 *    pollute the detected set, so the short canonical list is dropped on
 *    exact (normalized) match.
 * 2. ECHO COLLAPSE — on music the model sometimes re-emits the SAME phrase
 *    on consecutive 2-second timestamp chunks (a stuck loop of one line
 *    flooding the whole intro). Back-to-back duplicates collapse to the
 *    first hearing; real choruses survive because other lines sit between
 *    the repeats.
 * 3. NULL-START RECOVERY — a chunk occasionally opens with a missing start
 *    timestamp (the model skipped the opening timestamp token). Its words
 *    are real: recover the start from the previous chunk's end instead of
 *    dropping the line (only when a previous end exists — a bare first
 *    chunk with no timestamps carries no placeable time).
 */

export interface TimedSegment {
  /** Absolute song time in seconds */
  time: number
  text: string
}

/** Canonical Whisper hallucinations on non-speech audio — normalized (lowercase, punctuation stripped) exact matches. */
const HALLUCINATION_LIST = new Set([
  'thank you',
  'thank you for watching',
  'thanks for watching',
  'please subscribe',
  'please subscribe to my channel',
  'music',
  'applause',
  'inaudible',
  'silence',
  'amaraorg community captions',
  'subtitles by the amaraorg community',
])

/** Loose normalization for comparisons: lowercase, letters/digits/apostrophes/spaces only. */
export function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Drop canonical hallucinations and collapse back-to-back duplicate lines. */
export function filterSegments<T extends TimedSegment>(segments: T[]): T[] {
  const out: T[] = []
  for (const seg of segments) {
    const norm = normalizeForCompare(seg.text)
    if (!norm || HALLUCINATION_LIST.has(norm)) continue
    const last = out[out.length - 1]
    if (last && normalizeForCompare(last.text) === norm) continue
    out.push(seg)
  }
  return out
}

export interface WhisperChunk {
  text: string
  timestamp: [number | null, number | null]
}

/** Recover placeable start times for chunks that Whisper left timestamp-less:
 *  a chunk with a null start inherits the previous chunk's end (the model
 *  emits timestamps sequentially, so an unmarked chunk sits right after the
 *  marked one). Chunks with no recoverable position keep null and the caller
 *  skips them. */
export function recoverNullStarts(chunks: WhisperChunk[]): Array<{ time: number | null; text: string }> {
  const out: Array<{ time: number | null; text: string }> = []
  let prevEnd: number | null = null
  for (const chunk of chunks) {
    const [start, end] = chunk.timestamp ?? [null, null]
    const time = start ?? (prevEnd != null ? prevEnd : null)
    const settledEnd = end ?? (time != null ? time : null)
    prevEnd = settledEnd
    out.push({ time, text: chunk.text })
  }
  return out
}
