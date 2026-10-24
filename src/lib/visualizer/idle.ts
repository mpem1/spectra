/**
 * Pulse Studio — idle preview frame.
 *
 * A deterministic fake "musical" frame so the preview canvas keeps animating
 * beautifully before any audio is loaded (and keeps the same AudioFrame shape
 * the renderer already consumes).
 */
import type { AudioFrame } from './types'

const WAVE_POINTS = 2048
const TWO_PI = Math.PI * 2

/**
 * Deterministic pseudo-spectrum for `barCount` bars at `time` seconds:
 * layered sines with a bass-heavy tilt. `styleTime` drives decorative motion
 * (defaults to `time`); the preview passes a wall clock so styling keeps
 * animating while paused. Same inputs always yield the same frame — safe for
 * both preview and export code paths.
 */
export function makeIdleFrame(
  barCount: number,
  time: number,
  styleTime: number = time,
): AudioFrame {
  const count = Math.max(1, Math.floor(barCount))
  const freq = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const waveA = Math.sin(time * 1.7 + i * 0.35)
    const waveB = 0.5 + 0.5 * Math.sin(time * 0.43 + i * 0.09)
    let v = 0.3 + 0.25 * waveA * waveB
    // Bass boost: low bars pump harder.
    v *= 1 + 0.7 * Math.pow(1 - i / count, 2)
    freq[i] = clamp01(v)
  }

  const wave = new Float32Array(WAVE_POINTS)
  for (let i = 0; i < WAVE_POINTS; i++) {
    const x = i / (WAVE_POINTS - 1)
    const v =
      0.45 * Math.sin(time * 2.4 + x * Math.PI * 6) +
      0.3 * Math.sin(time * 1.6 + x * Math.PI * 13 + 1.7) +
      0.15 * Math.sin(time * 3.7 + x * Math.PI * 27 + 4.2)
    wave[i] = clamp(v, -1, 1)
  }

  return {
    time,
    styleTime,
    freq,
    wave,
    energy: 0.4,
    bass: 0.5,
    treble: 0.3,
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function clamp01(v: number): number {
  return clamp(v, 0, 1)
}
