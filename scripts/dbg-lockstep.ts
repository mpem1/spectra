/** Debug — verbatim copy of flipGate's detection path, lockstep with the real one. */
import { flipGate } from '../src/lib/visualizer/halftone-filter'
import { subBandRms } from '../src/lib/audio/subband'

const SR = 48000
const WIN = 2048
const HOP = 800

const RISE_WINDOW = 0.09
const RISE_CAP = 32
const MEDIAN_WINDOW = 0.7
const MEDIAN_CAP = 64
const REFRACTORY = 0.13
const QUIET_FRAC = 0.35
const REARM_QUIET = 0.12
const NOISE_FLOOR = 0.035
const THR_CAP = 0.5

function medianOf(vals: number[]): number {
  if (!vals.length) return 0
  const s = [...vals].sort((a, b) => a - b)
  return s[s.length >> 1]
}

function alloc(sec: number): Float32Array {
  return new Float32Array(Math.ceil(sec * SR))
}

function trace(name: string, tr: Float32Array, kicks: number[], wFrom: number, wTo: number): void {
  const frames: Array<{ t: number; sub: number }> = []
  for (let pos = WIN; pos < tr.length; pos += HOP) {
    frames.push({ t: pos / SR, sub: subBandRms(tr.subarray(pos - WIN, pos), SR) })
  }
  // my verbatim replication
  const hist: number[] = []
  const histT: number[] = []
  const riseHist: number[] = []
  const riseT: number[] = []
  let lastKickT = -Infinity
  let armed = true
  let peak = 0
  let quietT = -Infinity
  const ctx = { __mock: 1 } as unknown as CanvasRenderingContext2D
  console.log(`\n== ${name} ==`)
  for (const f of frames) {
    const bass = Math.min(1, Math.max(0, f.sub))
    hist.push(bass)
    histT.push(f.t)
    while (histT.length > RISE_CAP || histT[0] < f.t - RISE_WINDOW) {
      hist.shift()
      histT.shift()
    }
    const min = Math.min(...hist)
    const rise = bass - min
    const med = medianOf(riseHist.filter((_, i) => riseT[i] >= f.t - MEDIAN_WINDOW))
    const relMult = 2.6 - 1.8 * 0.5
    const base = (0.16 - 0.12 * 0.5) * (0.3 + 0.7 * Math.min(1, Math.max(0, med / 0.05)))
    const thr = Math.min(THR_CAP, Math.max(NOISE_FLOOR, med * relMult + base))
    riseHist.push(rise)
    riseT.push(f.t)
    while (riseT.length > MEDIAN_CAP) {
      riseHist.shift()
      riseT.shift()
    }
    if (bass > peak) peak = bass
    else if (bass < peak * 0.85) armed = true
    if (rise < thr * QUIET_FRAC) quietT = f.t
    if (!armed && f.t - quietT >= REARM_QUIET) armed = true
    let fired = false
    if (armed && rise > thr && f.t - lastKickT >= REFRACTORY) {
      fired = true
      lastKickT = f.t
      armed = false
      peak = bass
    }
    const env = flipGate(ctx, bass, f.t, 0.5, 0)
    if (fired) console.log(`MINE-FIRE t=${f.t.toFixed(3)} rise=${rise.toFixed(4)} thr=${thr.toFixed(4)}`)
    const prevEnv = (trace as { __prev?: number }).__prev ?? 0
    if (env > prevEnv + 0.4) console.log(`REAL-FIRE t=${f.t.toFixed(3)} env=${env.toFixed(2)}`)
    ;(trace as { __prev?: number }).__prev = env
    if (f.t >= wFrom && f.t <= wTo) {
      const nearKick = kicks.some((k) => f.t >= k - 0.05 && f.t <= k + 0.35)
      if (nearKick && Math.abs(f.t - (kicks.find((k) => f.t >= k - 0.05 && f.t <= k + 0.35) ?? 0)) < 0.26)
        console.log(
          `t=${f.t.toFixed(3)} sub=${bass.toFixed(4)} rise=${rise.toFixed(4)} med=${med.toFixed(4)} thr=${thr.toFixed(4)} armed=${armed ? 1 : 0} mine=${fired ? 'FIRE' : '.'} env=${env.toFixed(2)}`,
        )
    }
  }
}

// S4 single kick, isolated: bassline + one kick at 1.0
{
  const tr = alloc(3)
  let phase = 0
  for (let i = 0; i < tr.length; i++) {
    const x = i / SR
    phase += (2 * Math.PI * 40) / SR
    const g = x >= 1.0 && x < 1.13 ? 0.15 : 1
    tr[i] = 0.5 * g * Math.sin(phase)
  }
  // kick without random click for reproducibility
  {
    const start = Math.floor(1.0 * SR)
    const len = Math.floor(0.4 * SR)
    let phase2 = 0
    for (let i = 0; i < len; i++) {
      const x = i / SR
      const f = x < 0.05 ? 45 + 105 * Math.exp(-x / 0.02) : 45
      phase2 += (2 * Math.PI * f) / SR
      tr[start + i] += 0.8 * 0.9 * Math.exp(-x / 0.09) * Math.sin(phase2)
    }
  }
  trace('S4 kick @1.0 (first 2 kicks window)', tr, [1.0], 0.9, 1.45)
}

// S4 full pattern — why does the real gate fire only once in 8 s?
{
  const tr = alloc(8)
  const kicks: number[] = []
  for (let k = 1.0; k < 7.9; k += 0.5) kicks.push(k)
  let phase = 0
  for (let i = 0; i < tr.length; i++) {
    const x = i / SR
    phase += (2 * Math.PI * 40) / SR
    let g = 1
    for (const k of kicks) if (x >= k && x < k + 0.13) g = 0.15
    tr[i] = 0.5 * g * Math.sin(phase)
  }
  for (const k of kicks) {
    const start = Math.floor(k * SR)
    const len = Math.floor(0.4 * SR)
    let p2 = 0
    for (let i = 0; i < len; i++) {
      const x = i / SR
      const f = x < 0.05 ? 45 + 105 * Math.exp(-x / 0.02) : 45
      p2 += (2 * Math.PI * f) / SR
      tr[start + i] += 0.8 * 0.9 * Math.exp(-x / 0.09) * Math.sin(p2)
    }
  }
  trace('S4 full — kicks @1.0,1.5,2.0', tr, [1.0, 1.5, 2.0], 0.9, 2.45)
}
