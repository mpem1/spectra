/**
 * Shared constants for the lyrics transcription pipeline.
 *
 * Lives in its own module so the main thread can import it without pulling
 * the worker module (and its transformers.js dependency graph) into the
 * server/main bundle — the worker file references `self` at top level and
 * must only ever be entered as a Web Worker.
 */

/** Whisper's native input length — one window per inference (seconds). */
export const TRANSCRIBE_WINDOW_SECONDS = 30
