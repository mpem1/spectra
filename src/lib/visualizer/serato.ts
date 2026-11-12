/**
 * Serato-style waveform envelope — the whole-track analysis behind the
 * scrolling "turntable" strip.
 *
 * The Serato look is NOT the live spectrum: it is the song's own amplitude
 * waveform sliding under a fixed needle, colored segment by segment the way
 * Serato colors loud/bright passages. So this module precomputes, once per
 * loaded track, a column envelope from the decoded AudioBuffer:
 *
 *   - `peak` — max |sample| per column (~512-sample hop) → bar height
 *   - `zcr`  — zero-crossing rate per column → spectral brightness → the
 *     rainbow hue (low crossings = bassy = green … high = crisp = pink),
 *     mirroring how Serato's colored wave maps frequency content to hue
 *
 * Determinism contract (same as the rest of the engine): the envelope is
 * pure math over the decoded PCM, so the preview and the offline exporter
 * produce identical pixels. The exporter awaits `prepareSeratoEnvelope`
 * before frame 0; the preview builds lazily in small time-sliced batches
 * the first time the style draws (no long main-thread stall).
 */

/** Structural AudioBuffer — satisfied by the real one and by harness fakes. */
export interface SeratoSourceBuffer {
  sampleRate: number
  length: number
  numberOfChannels: number
  getChannelData(channel: number): Float32Array
}

export interface SeratoEnvelope {
  /** Columns per second (sampleRate / HOP). */
  columnsPerSec: number
  /** Max |sample| per column, 0..1-ish. */
  peak: Float32Array
  /** Zero-crossing rate per column (crossings / samples), ~0..0.5. */
  zcr: Float32Array
  /** 95th-percentile peak — the amplitude the loudest passages hit. */
  loudRef: number
  /** Track duration in seconds. */
  seconds: number
}

/** ~512 samples per column ≈ 11.6 ms at 44.1 kHz — fine enough for deep
 *  zoom-ins (a 4 s window spreads ~344 columns across the strip), cheap
 *  enough that a 10-minute track stays a few hundred KB. */
const HOP = 512

/** WeakMap cache keyed by buffer identity — new track → fresh envelope. */
const cache = new WeakMap<SeratoSourceBuffer, SeratoEnvelope>()

/** The buffer the renderer should read: bound by the preview on load and by
 *  the exporters on prepare (the exporter's decoded buffer wins during
 *  export so its frames stay deterministic). */
let currentSource: SeratoSourceBuffer | null = null

export function bindSeratoSource(buffer: SeratoSourceBuffer | null): void {
  currentSource = buffer
}

/** Preview build state — one time-sliced build at a time, cancelled when the
 *  source changes (track replaced / cleared). */
let building: {
  buffer: SeratoSourceBuffer
  env: SeratoEnvelope
  nextCol: number
  timer: ReturnType<typeof setTimeout> | null
} | null = null

/** Sync full build — used by the exporters (they await before frame 0) and
 *  by the harness (deterministic tests need the whole envelope at once). */
export function buildSeratoEnvelope(buffer: SeratoSourceBuffer): SeratoEnvelope {
  const cached = cache.get(buffer)
  if (cached) return cached
  const env = computeEnvelope(buffer)
  cache.set(buffer, env)
  return env
}

/** Export-side await — same math, async signature for the prepare step. */
export async function prepareSeratoEnvelope(buffer: SeratoSourceBuffer): Promise<SeratoEnvelope> {
  return buildSeratoEnvelope(buffer)
}

/** The envelope the renderer should draw right now, or null while one is
 *  still being computed (the strip shows its needle-only placeholder).
 *  Kicks the time-sliced preview build on first request. */
export function currentSeratoEnvelope(): SeratoEnvelope | null {
  const buffer = currentSource
  if (!buffer) return null
  const cached = cache.get(buffer)
  if (cached) return cached
  kickPreviewBuild(buffer)
  return null
}

function kickPreviewBuild(buffer: SeratoSourceBuffer): void {
  if (building && building.buffer === buffer) return
  cancelPreviewBuild()
  const cols = Math.max(1, Math.floor(buffer.length / HOP))
  building = {
    buffer,
    env: {
      columnsPerSec: buffer.sampleRate / HOP,
      peak: new Float32Array(cols),
      zcr: new Float32Array(cols),
      loudRef: 0,
      seconds: buffer.length / buffer.sampleRate,
    },
    nextCol: 0,
    timer: null,
  }
  const step = (): void => {
    if (!building || building.buffer !== buffer) return
    const { env, nextCol } = building
    const endCol = Math.min(cols, nextCol + 4000)
    fillColumns(buffer, env, nextCol, endCol)
    building.nextCol = endCol
    if (endCol >= cols) {
      env.loudRef = percentile95(env.peak)
      cache.set(buffer, env)
      building = null
      return
    }
    building.timer = setTimeout(step, 0)
  }
  step()
}

function cancelPreviewBuild(): void {
  if (building?.timer !== null && building?.timer !== undefined) {
    clearTimeout(building.timer)
  }
  building = null
}

function computeEnvelope(buffer: SeratoSourceBuffer): SeratoEnvelope {
  const cols = Math.max(1, Math.floor(buffer.length / HOP))
  const env: SeratoEnvelope = {
    columnsPerSec: buffer.sampleRate / HOP,
    peak: new Float32Array(cols),
    zcr: new Float32Array(cols),
    loudRef: 0,
    seconds: buffer.length / buffer.sampleRate,
  }
  fillColumns(buffer, env, 0, cols)
  env.loudRef = percentile95(env.peak)
  return env
}

/** Mixdown pass over columns [from, to): peak + zero-crossing rate. */
function fillColumns(
  buffer: SeratoSourceBuffer,
  env: SeratoEnvelope,
  from: number,
  to: number,
): void {
  const len = buffer.length
  const channels = Math.max(1, buffer.numberOfChannels)
  // Mono mixdown column slice by column slice — reading channel 0 (and 1
  // when stereo) directly, no full mono copy for the preview path.
  for (let c = from; c < to; c++) {
    const start = c * HOP
    const end = Math.min(start + HOP, len)
    let peak = 0
    let crossings = 0
    let prev = 0
    let n = 0
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch)
      const loopEnd = Math.min(end, data.length)
      for (let i = start; i < loopEnd; i++) {
        const x = data[i]
        const abs = x < 0 ? -x : x
        if (abs > peak) peak = abs
        if (n > 0 || ch > 0 || i > start) {
          if ((x >= 0 && prev < 0) || (x < 0 && prev >= 0)) crossings++
        }
        prev = x
        n++
      }
    }
    env.peak[c] = peak
    env.zcr[c] = n > 0 ? crossings / n : 0
  }
}

/** 95th percentile via partial sort — peaks are ≤ a few hundred thousand
 *  entries worst-case, a plain sort stays sub-100 ms even there. */
function percentile95(peaks: Float32Array): number {
  if (peaks.length === 0) return 1
  const copy = Array.from(peaks)
  copy.sort((a, b) => a - b)
  const idx = Math.min(copy.length - 1, Math.floor(copy.length * 0.95))
  const v = copy[idx]
  return v > 1e-4 ? v : 1
}
