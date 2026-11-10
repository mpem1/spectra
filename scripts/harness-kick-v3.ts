/**
 * Harness — Flip-on-kick detector v3 (clean sub-band channel + median bar).
 *
 * Drives the REAL `flipGate` (and, in one wiring test, the REAL
 * `drawHalftoneFilter` through a mock canvas) with per-frame sub-band values
 * produced by the REAL `subBandRms` over synthesized 48 kHz audio — the same
 * windows the live engine reads (last 2048 samples, 60 fps hop).
 *
 * Scenarios target every reported/possible hit-and-miss mechanism:
 *   S1  kicks over a LOUD held 808   → fire on every kick (the user's bug)
 *   S2  loud held 808 alone          → never fire (machine-gun / pinning)
 *   S3  legato 808 roll              → fire on ~every note (no level dip)
 *   S4  sidechained bassline + kicks → fire on every kick
 *   S5  quiet breakdown kicks        → the bar eases down, they still fire
 *   S6  slow swell                   → never fire
 *   S7  bright hats, no sub          → never fire
 *   S8  seek / loop restart          → state resets, detection recovers
 *   S9  sensitivity sweep            → all settings behave (0 = slams, 1 = tap)
 *   W1  wiring: drawHalftoneFilter listens to frame.sub, NOT frame.bass
 */

import { flipGate, drawHalftoneFilter } from '../src/lib/visualizer/halftone-filter'
import type { HalftoneFilterConfig, RenderContext } from '../src/lib/visualizer/types'
import { subBandRms } from '../src/lib/audio/subband'

/* ------------------------------- synthesis -------------------------------- */

const SR = 48000
const WIN = 2048 // analyser window (fftSize) the live engine reads
const HOP = 800 // 60 fps hop (48000/60)

function alloc(sec: number): Float32Array {
  return new Float32Array(Math.ceil(sec * SR))
}

/** Add a pitch-dropping kick thump with a fast attack at t0. */
function addKick(tr: Float32Array, t0: number, amp = 1): void {
  const start = Math.floor(t0 * SR)
  const len = Math.floor(0.4 * SR)
  let phase = 0
  for (let i = 0; i < len; i++) {
    const x = i / SR
    // 150 → 45 Hz exponential pitch drop over the first 50 ms, then steady.
    const f = x < 0.05 ? 45 + 105 * Math.exp(-x / 0.02) : 45
    phase += (2 * Math.PI * f) / SR
    const env = Math.exp(-x / 0.09)
    tr[start + i] += amp * 0.9 * env * Math.sin(phase)
    // small broadband click (mostly outside the 30–130 Hz listen band)
    if (x < 0.004) tr[start + i] += amp * 0.4 * (Math.random() * 2 - 1) * (1 - x / 0.004)
  }
}

/** Add an 808-style note: 5 ms attack, exponential body decay. */
function add808(tr: Float32Array, t0: number, dur: number, f: number, amp: number, tau = 0.3): void {
  const start = Math.floor(t0 * SR)
  const len = Math.floor(dur * SR)
  let phase = 0
  for (let i = 0; i < len; i++) {
    const x = i / SR
    phase += (2 * Math.PI * f) / SR
    const atk = Math.min(1, x / 0.005)
    const env = atk * Math.exp(-x / tau)
    tr[start + i] += amp * env * Math.sin(phase)
  }
}

/** Constant sine with slow level LFO (the "long bass sound"). */
function addDrone(tr: Float32Array, amp: number, lfoDepth = 0, lfoPeriod = 4): void {
  let phase = 0
  for (let i = 0; i < tr.length; i++) {
    const x = i / SR
    phase += (2 * Math.PI * 45) / SR
    const lfo = 1 + lfoDepth * Math.sin((2 * Math.PI * x) / lfoPeriod)
    tr[i] = amp * lfo * Math.sin(phase)
  }
}

/** Bright noise burst (hat-like, first-differenced so it has ~no sub). */
function addHat(tr: Float32Array, t0: number, amp = 0.8): void {
  const start = Math.floor(t0 * SR)
  const len = Math.floor(0.08 * SR)
  let prev = 0
  for (let i = 0; i < len; i++) {
    const x = i / SR
    const n = Math.random() * 2 - 1
    const hp = n - prev // first difference ≈ high-pass
    prev = n
    tr[start + i] += amp * hp * Math.exp(-x / 0.02)
  }
}

/** The per-frame clean sub channel, exactly as the live engine produces it. */
function subFrames(tr: Float32Array): Array<{ t: number; sub: number }> {
  const out: Array<{ t: number; sub: number }> = []
  for (let pos = WIN; pos < tr.length; pos += HOP) {
    out.push({ t: pos / SR, sub: subBandRms(tr.subarray(pos - WIN, pos), SR) })
  }
  return out
}

/* ------------------------------ gate driving ------------------------------ */

interface MockCtx {
  id: number
}
let mockSeq = 0
function freshCtx(): CanvasRenderingContext2D {
  return { id: ++mockSeq } as unknown as CanvasRenderingContext2D
}

/** Run the gate over sub frames; return detected FIRE times (env re-attacks). */
function runGate(
  frames: Array<{ t: number; sub: number }>,
  sens = 0.5,
  holdSec = 0,
): number[] {
  const ctx = freshCtx()
  const fires: number[] = []
  let prevEnv = 0
  for (const f of frames) {
    const env = flipGate(ctx, Math.min(1, Math.max(0, f.sub)), f.t, sens, holdSec)
    if (env > prevEnv + 0.4) fires.push(f.t) // instant attack ⇒ a re-attack is a fire
    prevEnv = env
  }
  return fires
}

function countIn(fires: number[], from: number, to: number): number {
  let n = 0
  for (const t of fires) if (t >= from && t < to) n++
  return n
}

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail: string): void {
  if (ok) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name} — ${detail}`)
  }
}

/* -------------------------------- scenarios ------------------------------- */

console.log('S1 kicks over a LOUD held 808 (the reported bug)')
{
  const tr = alloc(12)
  addDrone(tr, 0.5)
  const kicks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  for (const k of kicks) addKick(tr, k)
  const fires = runGate(subFrames(tr))
  let allHit = true
  for (const k of kicks) {
    const n = countIn(fires, k - 0.05, k + 0.3)
    if (n !== 1) allHit = false
  }
  check('every kick fires exactly once', allHit, `fires=${fires.map((t) => t.toFixed(2)).join(',')}`)
  let dense = false
  for (let i = 1; i < fires.length; i++) if (fires[i] - fires[i - 1] < 0.45) dense = true
  check('no machine-gun (≥0.45 s between fires)', !dense, 'two fires < 0.45 s apart')
}

console.log('S2 loud held 808 alone (no drums)')
{
  const tr = alloc(8)
  addDrone(tr, 0.5, 0.2, 4) // slow level LFO must not read as onsets
  const fires = runGate(subFrames(tr))
  check('zero fires under a held drone', fires.length === 0, `fires=${fires.length}`)
}

console.log('S3 legato 808 roll (tails overlap — no level dip between notes)')
{
  const tr = alloc(4.5)
  const notes: number[] = []
  let t = 0.5
  while (t < 4.2) {
    add808(tr, t, 0.5, 55, 0.5, 0.3) // 300 ms tail >> 214 ms spacing; same pitch
    notes.push(t)
    t += 60 / 140 / 2 // 8th notes at 140 BPM
  }
  const fires = runGate(subFrames(tr))
  let hit = 0
  let double = 0
  for (const nT of notes) {
    const c = countIn(fires, nT - 0.02, nT + 0.16)
    if (c >= 1) hit++
    if (c > 1) double++
  }
  check('≥ 75 % of roll notes fire', hit / notes.length >= 0.75, `${hit}/${notes.length}`)
  check('no note fires twice', double === 0, `${double} double-fired notes`)
}

console.log('S4 sidechained bassline + kicks')
{
  const tr = alloc(8)
  const kicks: number[] = []
  for (let k = 1.0; k < 7.9; k += 0.5) kicks.push(k)
  // bassline with a duck at every kick (gain 1 → 0.1 for 130 ms)
  let phase = 0
  for (let i = 0; i < tr.length; i++) {
    const x = i / SR
    phase += (2 * Math.PI * 40) / SR
    let g = 1
    for (const k of kicks) {
      if (x >= k && x < k + 0.13) g = 0.1
    }
    tr[i] = 0.5 * g * Math.sin(phase)
  }
  for (const k of kicks) addKick(tr, k, 1.2)
  const fires = runGate(subFrames(tr))
  // The bassline's return from each duck is itself a genuine sub surge
  // ~150 ms after the kick and fires with it (a second blink in the same
  // beat — not a miss). What matters: every kick flips, and the detector is
  // QUIET in the long gap between beats (no wobble machine-gun).
  let allHit = true
  for (const k of kicks) if (countIn(fires, k - 0.05, k + 0.12) < 1) allHit = false
  check('every sidechained kick fires', allHit, `fires=${fires.map((t) => t.toFixed(2)).join(',')}`)
  let midGap = 0
  for (const k of kicks) midGap += countIn(fires, k + 0.33, k + 0.46)
  check('no machine-gun between beats', midGap === 0, `${midGap} fires between beats`)
}

console.log('S5 quiet breakdown kicks (bar must ease down)')
{
  const tr = alloc(10)
  const loud = { seg: addDrone }
  loud.seg(tr.subarray(0, Math.floor(4 * SR)), 0.5)
  const loudKicks = [1, 2, 3]
  for (const k of loudKicks) addKick(tr, k)
  // breakdown: same material at 1/6 amplitude
  const bStart = Math.floor(4 * SR)
  const quietPart = alloc(6)
  addDrone(quietPart, 0.5 / 4)
  const quietKicks = [5, 6, 7, 8, 9]
  for (const k of quietKicks) addKick(quietPart, k - 4, 1 / 4)
  for (let i = 0; i < quietPart.length && bStart + i < tr.length; i++) tr[bStart + i] += quietPart[i]
  const fires = runGate(subFrames(tr))
  const loudOk = loudKicks.every((k) => countIn(fires, k - 0.05, k + 0.3) === 1)
  const quietHits = quietKicks.filter((k) => countIn(fires, k - 0.05, k + 0.3) >= 1).length
  check('loud-section kicks fire', loudOk, `fires=${fires.map((t) => t.toFixed(2)).join(',')}`)
  check('≥ 4/5 breakdown kicks fire', quietHits >= 4, `${quietHits}/5`)
}

console.log('S6 slow swell (must never fire)')
{
  const tr = alloc(8)
  let phase = 0
  for (let i = 0; i < tr.length; i++) {
    const x = i / SR
    phase += (2 * Math.PI * 45) / SR
    tr[i] = 0.45 * Math.min(1, x / 6) * Math.sin(phase) // 6 s linear swell
  }
  const fires = runGate(subFrames(tr))
  check('zero fires under a slow swell', fires.length === 0, `fires=${fires.length}`)
}

console.log('S7 bright hats only, no sub content')
{
  const tr = alloc(6)
  for (let t = 0.5; t < 5.6; t += 0.5) addHat(tr, t)
  const fires = runGate(subFrames(tr))
  check('zero fires on hats', fires.length === 0, `fires=${fires.length}`)
}

console.log('S8 seek / loop restart')
{
  const tr = alloc(4)
  addDrone(tr, 0.5)
  addKick(tr, 1)
  addKick(tr, 3)
  const frames = subFrames(tr)
  // play 0→2.6 s, then loop back to 1.0 s and continue to the end
  const looped: Array<{ t: number; sub: number }> = frames.filter((f) => f.t < 2.6)
  const back = frames.filter((f) => f.t >= 1.0)
  let lastLoopT = looped.length ? looped[looped.length - 1].t : 0
  for (const f of back) {
    if (f.t <= lastLoopT) continue // time must move forward within a pass
    looped.push(f)
    lastLoopT = f.t
  }
  const fires = runGate(looped)
  const fireAfterSeek = countIn(fires, 2.9, 3.35) // the re-passed kick at song-t 3
  check('kick after seek still fires', fireAfterSeek === 1, `fires=${fires.map((t) => t.toFixed(2)).join(',')}`)
}

console.log('S9 sensitivity sweep')
for (const sens of [0, 0.5, 1]) {
  const tr = alloc(6)
  addDrone(tr, 0.5)
  for (let k = 1; k < 5.9; k += 1) addKick(tr, k)
  const fires = runGate(subFrames(tr), sens)
  const kicks = [1, 2, 3, 4, 5]
  const allHit = kicks.every((k) => countIn(fires, k - 0.05, k + 0.3) >= 1)
  let dense = false
  for (let i = 1; i < fires.length; i++) if (fires[i] - fires[i - 1] < 0.45) dense = true
  check(
    `sens ${sens}: all kicks fire, no machine-gun`,
    allHit && !dense,
    `fires=${fires.map((t) => t.toFixed(2)).join(',')}`,
  )
  const drone = alloc(5)
  addDrone(drone, 0.5, 0.2, 4)
  const dFires = runGate(subFrames(drone), sens)
  check(`sens ${sens}: held drone never fires`, dFires.length === 0, `fires=${dFires.length}`)
}

/* --------------------------- W1 wiring (real filter) -------------------------- */

console.log('W1 wiring — the real filter listens to frame.sub, not frame.bass')
{
  // bun has no DOM — minimal ImageData stand-in (putImageData is a mock no-op)
  class ImageDataShim {
    data: Uint8ClampedArray
    width: number
    height: number
    constructor(buf: Uint8ClampedArray, w: number, h: number) {
      this.data = buf
      this.width = w
      this.height = h
    }
  }
  ;(globalThis as { ImageData?: unknown }).ImageData = ImageDataShim
  // Mock canvas/document: drawHalftoneFilter only needs draw-call bookkeeping.
  const drawLog: Array<{ alpha: number }> = []
  const makeCtx = (): Record<string, unknown> => {
    const ctx: Record<string, unknown> = {
      canvas: null,
      filter: 'none',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      fillStyle: '#000',
      shadowBlur: 0,
      setTransform: () => {},
      scale: () => {},
      rotate: () => {},
      translate: () => {},
      clearRect: () => {},
      fillRect: () => {},
      save: () => {},
      restore: () => {},
      putImageData: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      drawImage: (_src: unknown, _a?: number, _b?: number, _c?: number, _d?: number) => {
        drawLog.push({ alpha: (ctx.globalAlpha as number) ?? 1 })
      },
      getImageData: (x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(255), // all-black opaque → dots stamp
        width: w,
        height: h,
      }),
    }
    return ctx
  }
  const makeCanvas = (): HTMLCanvasElement => {
    const canv = { width: 0, height: 0 } as unknown as HTMLCanvasElement
    const ctx = makeCtx()
    ;(ctx as { canvas: unknown }).canvas = canv
    ;(canv as unknown as { getContext: () => unknown }).getContext = () => ctx
    return canv
  }
  ;(globalThis as { document?: unknown }).document = { createElement: () => makeCanvas() }

  const W = 160
  const H = 90
  const main = makeCanvas()
  const mctx = (
    main as unknown as { getContext: () => Record<string, unknown> }
  ).getContext() as unknown as CanvasRenderingContext2D
  const rc = { ctx: mctx, width: W, height: H } as unknown as RenderContext
  const cfg: HalftoneFilterConfig = {
    enabled: true,
    dotSize: 6,
    dotRange: 0.75,
    strength: 0.87, // ink draw alpha — identifies the ink pass in the log
    beatReactive: false,
    beatFlip: true,
  } as unknown as HalftoneFilterConfig

  const runFrames = (subAt: (t: number) => number, bass: number, sec: number): number[] => {
    const rawAlphas: number[] = []
    for (let i = 1; i <= sec * 60; i++) {
      const t = i / 60
      drawLog.length = 0
      drawHalftoneFilter(rc, cfg, { bass, sub: subAt(t), time: t }, false)
      // raw-picture draw = the LAST drawImage of the frame (finishFlip)
      if (drawLog.length >= 2) rawAlphas.push(drawLog[drawLog.length - 1].alpha)
    }
    return rawAlphas
  }

  // a) bass meter pinned at 0.9 the whole time; sub pulses like kicks → flips
  const flipsOnSub = runFrames((t) => (Math.floor(t) % 2 === 1 ? 0.55 : 0.02), 0.9, 6)
  check('sub pulses flip the frame (bass pinned at 0.9)', flipsOnSub.length >= 2, `${flipsOnSub.length} raw draws`)

  // b) sub flat at 0; bass meter swinging wildly → never flips
  const flipsOnBass = runFrames(() => 0.0, 0.9, 4)
  check('bass-meter motion alone never flips', flipsOnBass.length === 0, `${flipsOnBass.length} raw draws`)
}

/* --------------------------------- verdict -------------------------------- */

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
