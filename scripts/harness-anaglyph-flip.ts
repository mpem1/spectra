/**
 * Harness — 3D glasses Flip on kick (anaglyph beatFlip).
 *
 * Drives the REAL `drawAnaglyphFilter` through a mock canvas and the REAL
 * `flipGate` (the same detector the halftone print's flip uses) over
 * per-frame sub-band values, asserting:
 *   A1  flip OFF renders the exact HEAD offsets (parity)
 *   A2  a sub-band kick snaps the whole stack mirrored, then it swings home
 *   A3  a flat sub channel never flips
 *   A4  a multi-tint tracer stack mirrors coherently (±dx, ±2dx …)
 *   A5  per-filter gate independence: halftone's 2 s hold survives the
 *       anaglyph gate running on the same canvas ('anaglyph' vs 'halftone'
 *       keys) — the pre-key shared state would clobber the hold
 */

import { drawAnaglyphFilter } from '../src/lib/visualizer/anaglyph-filter'
import { flipGate } from '../src/lib/visualizer/halftone-filter'
import type { AnaglyphFilterConfig, RenderContext } from '../src/lib/visualizer/types'

/* ------------------------------ mock canvas ------------------------------ */

interface DrawRec {
  x: number
  op: string
}

function makeCanvas(): HTMLCanvasElement {
  const canv = { width: 0, height: 0 } as unknown as HTMLCanvasElement
  const state = { op: 'source-over', alpha: 1 }
  const log: DrawRec[] = []
  const ctx: Record<string, unknown> = {
    canvas: canv,
    filter: 'none',
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
    drawImage: (_src: unknown, x?: number) => {
      log.push({ x: typeof x === 'number' ? x : 0, op: state.op })
    },
  }
  Object.defineProperty(ctx, 'globalCompositeOperation', {
    get: () => state.op,
    set: (v: string) => {
      state.op = v
    },
  })
  Object.defineProperty(ctx, 'globalAlpha', {
    get: () => state.alpha,
    set: (v: number) => {
      state.alpha = v
    },
  })
  ;(canv as unknown as { getContext: () => unknown }).getContext = () => ctx
  ;(canv as unknown as { __log: DrawRec[] }).__log = log
  return canv
}

/** Every canvas the filter pipeline asks document for, in creation order. */
const created: HTMLCanvasElement[] = []
;(globalThis as { document?: unknown }).document = {
  createElement: () => {
    const c = makeCanvas()
    created.push(c)
    return c
  },
}

/* --------------------------------- setup --------------------------------- */

const W = 160
const H = 90 // S = 90/720 = 0.125 → dx = round(depth * 20 * 0.125 / 2)
const main = makeCanvas()
const mctx = (main as unknown as { getContext: () => CanvasRenderingContext2D }).getContext()
const rc = { ctx: mctx, width: W, height: H } as unknown as RenderContext

/** The additive-recombine ('lighter') offsets drawn this frame. */
function recombineOffsets(): number[] {
  // The 'anaglyph:out' canvas is the only one whose ctx ever uses 'lighter'.
  const out = created.find((c) => (c as unknown as { __log: DrawRec[] }).__log.some((d) => d.op === 'lighter'))
  const log = out ? (out as unknown as { __log: DrawRec[] }).__log : []
  return log.filter((d) => d.op === 'lighter').map((d) => d.x)
}

function baseCfg(): AnaglyphFilterConfig {
  return {
    enabled: true,
    depth: 1, // sep = 20 * 0.125 = 2.5 px → dx = round(1.25) = 1
    reactivity: 0.5,
    beatReactive: false,
    beatFlip: false,
    flipSensitivity: 0.5,
    flipHold: 0,
    strength: 1,
    leftColors: ['#ff0000'],
    rightColors: ['#00ffff'],
  }
}

/** Drive N seconds at 60 fps; returns the recombine offsets of each frame. */
function runFrames(
  cfg: AnaglyphFilterConfig,
  subAt: (t: number) => number,
  sec: number,
): number[][] {
  const frames: number[][] = []
  for (let i = 1; i <= sec * 60; i++) {
    const t = i / 60
    for (const c of created) ((c as unknown as { __log: DrawRec[] }).__log as DrawRec[]).length = 0
    drawAnaglyphFilter(rc, cfg, { bass: 0.9, sub: subAt(t), time: t }, false)
    frames.push(recombineOffsets())
  }
  return frames
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

const DX = 1 // depth 1 at 160×90 → dx = 1

/* -------------------------------- scenarios ------------------------------- */

console.log('A1 flip OFF — exact HEAD offsets (parity)')
{
  const frames = runFrames(baseCfg(), (t) => (Math.floor(t) % 2 === 1 ? 0.55 : 0.02), 3)
  const ok = frames.every((f) => f.length === 2 && f[0] === -DX && f[1] === DX)
  check(`every frame draws at [${-DX}, +${DX}]`, ok, `sample=${JSON.stringify(frames[0])}`)
}

console.log('A2 flip ON — kick snaps mirrored, release swings home')
{
  const cfg = { ...baseCfg(), beatFlip: true }
  // kick pulses on odd seconds (same drive as the halftone harness W1)
  const frames = runFrames(cfg, (t) => (Math.floor(t) % 2 === 1 ? 0.55 : 0.02), 5)
  const mirroredIdx = frames.map((f, i) => ({ f, i })).filter(({ f }) => f[0] > 0 && f[1] < 0).map(({ i }) => i)
  check('stack mirrors after a kick (left copy lands right of 0)', mirroredIdx.length >= 5, `${mirroredIdx.length} mirrored frames`)
  const fireIdx = mirroredIdx.length ? mirroredIdx[0] : -1
  check('mirror starts at the kick (no pre-kick flips)', fireIdx >= 0 && fireIdx <= 64, `first mirrored frame ${fireIdx}`)
  // 0.25 s release → by 0.5 s after the fire (but before the next kick at
  // t = 3.0 s, frame 179) the stack must be back at the rest offsets.
  const restAgain = frames.slice(fireIdx + 30, 179).every((f) => f[0] === -DX && f[1] === DX)
  check('stack back at rest half a second after the kick', restAgain, `late frames=${JSON.stringify(frames.slice(-3))}`)
}

console.log('A3 flip ON, flat sub — never flips')
{
  const cfg = { ...baseCfg(), beatFlip: true }
  const frames = runFrames(cfg, () => 0.05, 3)
  const ok = frames.every((f) => f.length === 2 && f[0] === -DX && f[1] === DX)
  check('constant low sub keeps the glasses at rest', ok, `sample=${JSON.stringify(frames[0])}`)
}

console.log('A4 flip ON — 2×2 tracer stack mirrors coherently')
{
  const cfg: AnaglyphFilterConfig = {
    ...baseCfg(),
    beatFlip: true,
    leftColors: ['#ff0000', '#ff00ff'],
    rightColors: ['#00ffff', '#ffff00'],
  }
  const frames = runFrames(cfg, (t) => (Math.floor(t) % 2 === 1 ? 0.55 : 0.02), 3)
  const atRest = frames[10]
  const mirrored = frames.find((f) => f[0] > 0)
  check(
    'rest stack is [-1,-2,+1,+2]',
    atRest.length === 4 && atRest[0] === -1 && atRest[1] === -2 && atRest[2] === 1 && atRest[3] === 2,
    `rest=${JSON.stringify(atRest)}`,
  )
  check(
    'mirrored stack is [+1,+2,-1,-2] (every tracer step flips)',
    !!mirrored && mirrored.length === 4 && mirrored[0] === 1 && mirrored[1] === 2 && mirrored[2] === -1 && mirrored[3] === -2,
    `mirrored=${JSON.stringify(mirrored)}`,
  )
}

console.log('A5 per-filter gate independence on one canvas')
{
  const shared: CanvasRenderingContext2D = {} as CanvasRenderingContext2D
  // one kick-style rise at t = 1.0 s; quiet either side
  const sub = (t: number) => (t >= 1.0 && t < 1.05 ? 0.6 : 0.02)
  let ehAt2 = -1
  let eaAt2 = -1
  let ehPeak = 0
  for (let i = 1; i <= 3 * 60; i++) {
    const t = i / 60
    const s = Math.min(1, Math.max(0, sub(t)))
    const eh = flipGate(shared, s, t, 0.5, 2.0, 'halftone') // 2 s hold
    const ea = flipGate(shared, s, t, 0.5, 0.0, 'anaglyph') // quick flash
    ehPeak = Math.max(ehPeak, eh)
    if (t === 2.0) {
      ehAt2 = eh
      eaAt2 = ea
    }
  }
  check('both gates fired on the same kick', ehPeak >= 1, `halftone peak env=${ehPeak}`)
  check('halftone hold (2 s) still open at t+1 s', ehAt2 === 1, `env=${ehAt2}`)
  check('anaglyph quick flash released by t+1 s', eaAt2 === 0, `env=${eaAt2}`)
}

/* --------------------------------- verdict -------------------------------- */

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
