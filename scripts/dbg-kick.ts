/** Debug — trace sub values + replicated gate math for S3/S4/S5. */
import { subBandRms } from '../src/lib/audio/subband'

const SR = 48000
const WIN = 2048
const HOP = 800

function alloc(sec: number): Float32Array {
  return new Float32Array(Math.ceil(sec * SR))
}
function add808(tr: Float32Array, t0: number, dur: number, f: number, amp: number, tau = 0.3): void {
  const start = Math.floor(t0 * SR)
  const len = Math.floor(dur * SR)
  let phase = 0
  for (let i = 0; i < len; i++) {
    const x = i / SR
    phase += (2 * Math.PI * f) / SR
    tr[start + i] += amp * Math.min(1, x / 0.005) * Math.exp(-x / tau) * Math.sin(phase)
  }
}
function addKick(tr: Float32Array, t0: number, amp = 1): void {
  const start = Math.floor(t0 * SR)
  const len = Math.floor(0.4 * SR)
  let phase = 0
  for (let i = 0; i < len; i++) {
    const x = i / SR
    const f = x < 0.05 ? 45 + 105 * Math.exp(-x / 0.02) : 45
    phase += (2 * Math.PI * f) / SR
    tr[start + i] += amp * 0.9 * Math.exp(-x / 0.09) * Math.sin(phase)
    if (x < 0.004) tr[start + i] += amp * 0.4 * (Math.random() * 2 - 1) * (1 - x / 0.004)
  }
}

function trace(name: string, tr: Float32Array, marks: number[], tFrom: number, tTo: number): void {
  const frames: Array<{ t: number; sub: number }> = []
  for (let pos = WIN; pos < tr.length; pos += HOP) {
    frames.push({ t: pos / SR, sub: subBandRms(tr.subarray(pos - WIN, pos), SR) })
  }
  // replicate gate math
  const RISE_WINDOW = 0.09
  const hist: number[] = []
  const histT: number[] = []
  const rises: Array<{ t: number; r: number }> = []
  console.log(`\n== ${name} ==`)
  let mi = 0
  for (const f of frames) {
    hist.push(f.sub)
    histT.push(f.t)
    while (histT.length && histT[0] < f.t - RISE_WINDOW) {
      hist.shift()
      histT.shift()
    }
    const min = Math.min(...hist, f.sub)
    const rise = f.sub - min
    rises.push({ t: f.t, r: rise })
    while (rises.length && rises[0].t < f.t - 0.7) rises.shift()
    const sorted = [...rises.map((x) => x.r)].sort((a, b) => a - b)
    const med = sorted.length ? sorted[sorted.length >> 1] : 0
    const relMult = 2.6 - 1.8 * 0.5
    const base = (0.16 - 0.12 * 0.5) * (0.3 + 0.7 * Math.min(1, Math.max(0, med / 0.05)))
    const thr = Math.min(0.5, Math.max(0.035, med * relMult + base))
    while (mi < marks.length && marks[mi] < f.t - 0.2) mi++
    if (f.t >= tFrom && f.t <= tTo) {
      const nearMark = marks.some((m) => f.t >= m - 0.02 && f.t <= m + 0.3)
      if (nearMark || f.t < tFrom + 0.2)
        console.log(
          `t=${f.t.toFixed(3)} sub=${f.sub.toFixed(4)} rise=${rise.toFixed(4)} med=${med.toFixed(4)} thr=${thr.toFixed(4)} ${rise > thr ? 'FIRE?' : '.'}`,
        )
    }
  }
}

// S3 legato roll — first 1.5 s, notes at 0.5, 0.714, 0.929, 1.143, 1.357
{
  const tr = alloc(2)
  add808(tr, 0.5, 0.5, 55, 0.5, 0.3)
  add808(tr, 0.7143, 0.5, 45, 0.5, 0.3)
  add808(tr, 0.9286, 0.5, 55, 0.5, 0.3)
  add808(tr, 1.1429, 0.5, 45, 0.5, 0.3)
  add808(tr, 1.3571, 0.5, 55, 0.5, 0.3)
  trace('S3 legato roll', tr, [0.5, 0.7143, 0.9286, 1.1429, 1.3571], 0.4, 1.6)
}

// S4 sidechain — one kick at 1.0 (bassline 0.5 ducks to 0.075 for 130 ms)
{
  const tr = alloc(3)
  let phase = 0
  for (let i = 0; i < tr.length; i++) {
    const x = i / SR
    phase += (2 * Math.PI * 40) / SR
    const g = x >= 1.0 && x < 1.13 ? 0.15 : 1
    tr[i] = 0.5 * g * Math.sin(phase)
  }
  addKick(tr, 1.0, 0.8)
  trace('S4 sidechain kick @1.0', tr, [1.0], 0.8, 1.6)
}

// S5 breakdown kick at 5.0 (amp 1/6)
{
  const tr = alloc(6)
  let phase = 0
  for (let i = 0; i < tr.length; i++) {
    phase += (2 * Math.PI * 45) / SR
    tr[i] = (0.5 / 6) * Math.sin(phase)
  }
  addKick(tr, 5.0, 1 / 6)
  trace('S5 breakdown kick @5.0', tr, [5.0], 4.7, 5.4)
}
