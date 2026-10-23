import type { AudioEngine } from '@/lib/audio/engine'

/**
 * Module-level singletons shared between PreviewCanvas (owner) and the
 * TopBar / ExportTab consumers. PreviewCanvas registers on mount and
 * clears on unmount.
 */

let engine: AudioEngine | null = null

export function setEngine(e: AudioEngine | null): void {
  engine = e
}

export function getEngine(): AudioEngine | null {
  return engine
}

/** Playback controls that work in both audio mode and demo (idle) mode. */
export interface PreviewControls {
  play: () => void
  pause: () => void
  seek: (time: number) => void
  /** True while the preview is actively playing (audio or demo clock). */
  isPlaying: () => boolean
}

let controls: PreviewControls | null = null

export function setPreviewControls(c: PreviewControls | null): void {
  controls = c
}

export function getPreviewControls(): PreviewControls | null {
  return controls
}
