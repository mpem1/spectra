/**
 * Harness — 3D glasses Depth pop on kick (anaglyph depthPop).
 *
 * Drives the REAL `drawAnaglyphFilter` through a mock canvas and the REAL
 * `flipGate` (same detector family as the halftone print's flip) over
 * per-frame sub-band values, asserting:
 *   P1  pop OFF renders the exact resting offsets every frame (parity with
 *       the pre-feature renderer)
 *   P2  a sub-band kick snaps the depth to 0% (every copy on the center
 *       line), holds flat, then blooms back out to the resting offsets
 *   P3  a flat sub channel never flattens the picture
 *   P4  a multi-tint tracer stack collapses coherently (all four copies
 *       land on 0 together — clean recomposition, not a partial collapse)
 *   P5  pop + flip together, dialed the same: both fire on the SAME kick,
 *       the picture reads flat while mirrored, and the recovery sweeps the
 *       mirrored side home before resting at the classic offsets
 */

import { drawAnaglyphFilter } from '../src/lib/visualizer/anaglyph-filter'
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
    depth: 2, // sep = 2 * 20 * 0.125 = 5 px → dx = round(2.5) = 2 (room to bloom)
    reactivity: 0.5,
    beatReactive: false,
    beatFlip: false,
    flipSensitivity: 0.5,
    flipHold: 0,
    depthPop: false,
    popSensitivity: 0.5,
    popHold: 0,
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

const DX = 3 // depth 2 at 160×90 → sep = 5 px → dx = round(2.5) = 3

/* -------------------------------- scenarios ------------------------------- */

// kick pulses on odd seconds, quiet between (same drive as the flip harness)
const kicks = (t: number) => (Math.floor(t) % 2 === 1 ? 0.55 : 0.02)

console.log('P1 pop OFF — resting offsets every frame (parity)')
{
  const frames = runFrames(baseCfg(), kicks, 3)
  const ok = frames.every((f) => f.length === 2 && f[0] === -DX && f[1] === DX)
  check(`every frame draws at [${-DX}, +${DX}]`, ok, `sample=${JSON.stringify(frames[0])}`)
}

console.log('P2 pop ON — kick snaps depth to 0%, then blooms back out')
{
  const cfg = { ...baseCfg(), depthPop: true }
  const frames = runFrames(cfg, kicks, 5)
  const flatIdx = frames.map((f, i) => ({ f, i })).filter(({ f }) => f.every((x) => x === 0)).map(({ i }) => i)
  check('depth hits exactly 0% after a kick (all copies on the center line)', flatIdx.length >= 5, `${flatIdx.length} flat frames`)
  const firstKickZone = flatIdx.filter((i) => i < 120)
  check('flattening starts at the first kick (t≈1s, frame ≤66)', firstKickZone.length > 0 && firstKickZone[0] <= 66, `first flat frame ${firstKickZone[0] ?? -1}`)
  // before the first kick the glasses must be at rest
  const preRest = frames.slice(0, 55).every((f) => f[0] === -DX && f[1] === DX)
  check('resting depth before the first kick', preRest, `early=${JSON.stringify(frames.slice(0, 3))}`)
  // by half a second after the kick (but before the next kick at frame 179)
  // the depth must have bloomed all the way back out
  const recovered = frames.slice(96, 179).every((f) => f[0] === -DX && f[1] === DX)
  check('depth back at 100% half a second after the kick', recovered, `late=${JSON.stringify(frames.slice(-3))}`)
  // the recovery must pass THROUGH intermediate depths (a bloom, not a snap)
  const mid = frames.slice(60, 96).map((f) => f[0])
  const hasIntermediate = mid.some((x) => x !== 0 && x !== -DX && x < 0) || mid.some((x) => x > -DX && x < 0)
  check('recovery blooms through intermediate depths', hasIntermediate, `mid=${JSON.stringify(mid)}`)
}

console.log('P3 pop ON, flat sub — depth never flattens')
{
  const cfg = { ...baseCfg(), depthPop: true }
  const frames = runFrames(cfg, () => 0.05, 3)
  const ok = frames.every((f) => f.length === 2 && f[0] === -DX && f[1] === DX)
  check('constant low sub keeps the 3D at full depth', ok, `sample=${JSON.stringify(frames[0])}`)
}

console.log('P4 pop ON — 2×2 tracer stack collapses coherently')
{
  const cfg: AnaglyphFilterConfig = {
    ...baseCfg(),
    depthPop: true,
    leftColors: ['#ff0000', '#ff00ff'],
    rightColors: ['#00ffff', '#ffff00'],
  }
  const frames = runFrames(cfg, kicks, 3)
  const atRest = frames[10]
  const flat = frames.find((f) => f.every((x) => x === 0))
  check(
    'rest stack is [-1,-2,+1,+2]×dx',
    atRest.length === 4 && atRest[0] === -DX && atRest[1] === -2 * DX && atRest[2] === DX && atRest[3] === 2 * DX,
    `rest=${JSON.stringify(atRest)}`,
  )
  check(
    'flat moment lands ALL copies (base + tracers) on 0 — clean recomposition',
    !!flat && flat.length === 4 && flat.every((x) => x === 0),
    `flat=${JSON.stringify(flat)}`,
  )
  // no frame may show a PARTIAL collapse where tracers flattened but the
  // base didn't (the whole stack moves as one)
  const partial = frames.some(
    (f) => f.length === 4 && f[0] === 0 && f[1] !== 0,
  )
  check('no partial collapse (tracer moves with the base)', !partial, `first=${JSON.stringify(frames.find((f) => f.length === 4 && f[0] === 0))}`)
}

console.log('P5 pop + flip together, same dials — same kick, flat-then-home sweep')
{
  const cfg: AnaglyphFilterConfig = { ...baseCfg(), beatFlip: true, depthPop: true }
  const frames = runFrames(cfg, kicks, 5)
  const flatIdx = frames.findIndex((f) => f.every((x) => x === 0))
  const mirroredIdx = frames.findIndex((f) => f[0] > 0 && f[1] < 0)
  // with equal dials both effects engage on the same kick — the stack reads
  // flat first (dx collapses to 0 hides the mirror), then the recovery
  // sweeps through the mirrored side before resting home
  check('both effects fire on the same kick (flat starts with/before mirror)', flatIdx >= 0 && mirroredIdx >= 0 && flatIdx <= mirroredIdx + 1, `flat=${flatIdx} mirrored=${mirroredIdx}`)
  const restAgain = frames.slice(flatIdx + 30, 179).every((f) => f[0] === -DX && f[1] === DX)
  check('glasses back at the classic rest offsets before the next kick', restAgain, `late=${JSON.stringify(frames.slice(-3))}`)
  // during recovery the sweep must pass through the mirrored side (dir < 0
  // while dx is blooming) — at least one frame with left copy right of 0
  const sweepMirrored = frames.slice(flatIdx, flatIdx + 30).some((f) => f[0] > 0)
  check('recovery sweeps through the mirrored side on the way home', sweepMirrored, `recovery=${JSON.stringify(frames.slice(flatIdx, flatIdx + 8))}`)
}

/* --------------------------------- verdict -------------------------------- */

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
