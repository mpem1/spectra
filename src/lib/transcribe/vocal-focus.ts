/**
 * Vocal-focus preprocessing for lyrics auto-detect.
 *
 * The detector is a SPEECH model (Whisper) listening to a MUSIC mix. Two
 * cheap DSP tricks measurably help it before a single model parameter
 * changes:
 *
 * 1. CENTER EXTRACTION — lead vocals are almost always mixed to the center
 *    of the stereo image, while pads/guitars/keys spread wide. Mid = the
 *    average of L+R keeps everything (vocals included); side = (L−R)/2 holds
 *    ONLY the off-center stuff. `mid − k·side` therefore keeps the voice and
 *    ducks the wide instruments (hard-panned content drops to (1−k) of its
 *    mid level). Mono files have no sides and pass through untouched.
 * 2. BASS CUT + LOUDNESS NORMALIZE — kick/bass rumble below ~90 Hz carries
 *    no words but masks them; a gentle high-pass removes it, and an RMS
 *    normalize brings quiet masters up to the level Whisper expects (with a
 *    soft clamp so nothing hard-clips).
 *
 * All pure array math — no dependencies, safe to unit-check in the harness.
 */

/** How hard to duck the wide (side) signal, 0..1. 1 = keep only the center
 *  image; 0.8 leaves a little room ambience so the model still hears a
 *  natural-sounding voice rather than a hollow telephone call. */
const SIDE_DUCK = 0.8

/** High-pass corner in Hz — kick fundamental + sub bass live well below. */
const RUMBLE_HZ = 90

/** RMS target after normalize (≈ −21 dBFS) and the soft-clip ceiling. */
const TARGET_RMS = 0.09
const PEAK_CEILING = 0.95

/** Center-focused mono mixdown of every channel in the buffer.
 *  Stereo: mid − SIDE_DUCK·side. Mono (or already-mono input): plain average.
 *  Always returns a fresh array — never the caller's channel data. */
export function vocalFocusMix(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0)
  const length = channels[0].length
  const mid = new Float32Array(length)
  for (const ch of channels) {
    for (let i = 0; i < length; i++) mid[i] += ch[i]
  }
  const n = channels.length
  if (n === 1) return mid
  for (let i = 0; i < length; i++) mid[i] /= n

  if (n < 2) return mid
  // side = (L − R) / 2 for the first two channels; extra channels (rare)
  // already contributed to the mid and just carry the mix along.
  const L = channels[0]
  const R = channels[1]
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const side = (L[i] - R[i]) / 2
    out[i] = mid[i] - SIDE_DUCK * side
  }
  return out
}

/** One-pole high-pass at `hz`, cascaded four times (≈24 dB/oct) so the kick
 *  fundamental and sub bass die without touching the vocal band. */
export function highPass(samples: Float32Array, sampleRate: number, hz = RUMBLE_HZ): Float32Array {
  const dt = 1 / sampleRate
  const rc = 1 / (2 * Math.PI * hz)
  const a = rc / (rc + dt)
  const out = new Float32Array(samples.length)
  for (let pass = 0; pass < 4; pass++) {
    let prevIn = 0
    let prevOut = 0
    const src = pass === 0 ? samples : out
    for (let i = 0; i < samples.length; i++) {
      const x = src[i]
      prevOut = a * (prevOut + x - prevIn)
      prevIn = x
      out[i] = prevOut
    }
  }
  return out
}

/** Whole-clip RMS normalize + soft clamp so quiet masters reach Whisper at a
 *  healthy level and loud masters don't slam the mel spectrogram. */
export function normalizeLoudness(samples: Float32Array): Float32Array {
  const n = samples.length
  if (n === 0) return samples
  let sumSq = 0
  for (let i = 0; i < n; i++) sumSq += samples[i] * samples[i]
  const rms = Math.sqrt(sumSq / n)
  if (rms < 1e-6) return new Float32Array(n)
  // Clamp the gain so a near-silent clip can't blow up into pure noise.
  const gain = Math.min(12, Math.max(0.25, TARGET_RMS / rms))
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = samples[i] * gain
    // Soft knee: linear below the ceiling, gently compressed above it —
    // transients bend instead of hard-clipping into distortion.
    out[i] = x > PEAK_CEILING || x < -PEAK_CEILING ? (Math.tanh(x / PEAK_CEILING) * PEAK_CEILING) : x
  }
  return out
}

/** The full pre-detect chain: channels → center-focused mono → rumble cut →
 *  loudness normalize. This is what the detector feeds to Whisper instead of
 *  the plain mixdown. */
export function vocalFocus(channels: Float32Array[], sampleRate: number): Float32Array {
  return normalizeLoudness(highPass(vocalFocusMix(channels), sampleRate))
}
