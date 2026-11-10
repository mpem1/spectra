/**
 * Harness — Background "Flip on kick" (Style tab → Background → With the beat).
 *
 * Drives the REAL `renderFrame` (background → layers → filter chain) against
 * a permissive mock canvas that records every op per context — each drawImage
 * carries the alpha it painted with and the NET horizontal scale accumulated
 * since its save block, so the mirrored kick pass is detectable op-by-op.
 * A fake global `Image` decodes instantly so the image-background path runs.
 * Asserting:
 *   S1  defaults contract — beatFlip off, Kick sensitivity 10%, Flip hold 0.2
 *   S2  flip OFF parity — exactly one media draw, alpha 1, unmirrored
 *   S3  flip ON at rest (no onset) — still exactly one media draw
 *   S4  a sub-band onset fires — the mirrored pass dissolves IN (alpha 1 at
 *       full hold, net scale −1) while the resting draw stays underneath
 *   S5  hold — the mirrored side stays fully on for the hold dial (0.4 s)
 *   S6  release — the mirrored pass dissolves back out (0 < alpha < 1), then
 *       the frame returns to the single resting draw
 *   S7  old saves without the new fields still fire (render-level ?? fallbacks)
 *   S8  solid (non-media) background with the toggle on — renders clean, no gate
 *   S9  the user's own Flip horizontal composes with the kick mirror (net +1)
 */

import { renderFrame } from '../src/lib/visualizer/renderer'
import { DEFAULT_STUDIO_CONFIG } from '../src/lib/visualizer/types'
import type { AudioFrame, BackgroundConfig, RenderContext, StudioConfig } from '../src/lib/visualizer/types'

/* ------------------------------ mock canvas ------------------------------ */

interface OpRec {
  m: string
  args: number[]
  alpha: number
  /** net horizontal scale from the save block this op ran in */
  netX: number
  src?: unknown
}

function makeCanvas(): HTMLCanvasElement {
  const canv = { width: 0, height: 0 } as unknown as HTMLCanvasElement
  const state = { op: 'source-over', alpha: 1 }
  const log: OpRec[] = []
  // scaleX accumulator — save pushes, restore pops, scale multiplies.
  const stack: number[] = []
  let netX = 1
  const rec = (m: string, args: number[], src?: unknown) =>
    log.push({ m, args, alpha: state.alpha, netX, src })
  const base: Record<string, unknown> = {
    canvas: canv,
    filter: 'none',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    fillStyle: '#000',
    strokeStyle: '#000',
    shadowBlur: 0,
    shadowColor: 'transparent',
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineWidth: 1,
    lineJoin: 'round',
    lineCap: 'round',
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createConicGradient: () => ({ addColorStop: () => {} }),
    createPattern: () => null,
    save: () => {
      stack.push(netX)
      rec('save', [])
    },
    restore: () => {
      netX = stack.pop() ?? 1
      rec('restore', [])
    },
    translate: (...a: number[]) => rec('translate', a),
    scale: (...a: number[]) => {
      netX *= a[0]
      rec('scale', a)
    },
    drawImage: (src: unknown, ...a: number[]) => rec('drawImage', a as number[], src),
    fillRect: (...a: number[]) => rec('fillRect', a),
    fill: () => rec('fill', []),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  }
  const ctx = new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined
      if (prop === 'globalCompositeOperation') return state.op
      if (prop === 'globalAlpha') return state.alpha
      if (prop in target) return target[prop]
      return () => undefined
    },
    set(target, prop, value) {
      if (typeof prop === 'symbol') return true
      if (prop === 'globalCompositeOperation') {
        state.op = String(value)
        return true
      }
      if (prop === 'globalAlpha') {
        state.alpha = Number(value)
        return true
      }
      target[prop] = value
      return true
    },
  })
  ;(canv as unknown as { getContext: () => unknown }).getContext = () => ctx
  ;(canv as unknown as { __log: OpRec[] }).__log = log
  return canv
}

/** Every canvas the pipeline asks document for, in creation order. */
const created: HTMLCanvasElement[] = []
;(globalThis as { document?: unknown }).document = {
  createElement: () => {
    const c = makeCanvas()
    created.push(c)
    return c
  },
}

/* Fake Image — "decodes" instantly so the image-background path runs. */
const fakeImages: {
  complete: boolean
  naturalWidth: number
  naturalHeight: number
  src: string
}[] = []
;(globalThis as { Image?: unknown }).Image = class {
  complete = true
  naturalWidth = 640
  naturalHeight = 360
  decoding = 'sync'
  src = ''
  constructor() {
    fakeImages.push(this)
  }
}

const logOf = (c: HTMLCanvasElement): OpRec[] => (c as unknown as { __log: OpRec[] }).__log
/** The background media draws on a canvas (drawImage of the fake image). */
const mediaDraws = (c: HTMLCanvasElement, img: unknown): OpRec[] =>
  logOf(c).filter((r) => r.m === 'drawImage' && r.src === img)

/* --------------------------------- setup --------------------------------- */

const W = 320
const H = 180

function fresh(): { main: HTMLCanvasElement; rc: RenderContext } {
  const main = makeCanvas()
  const mctx = (main as unknown as { getContext: () => CanvasRenderingContext2D }).getContext()
  return { main, rc: { ctx: mctx, width: W, height: H } as unknown as RenderContext }
}

function frameAt(t: number, sub: number): AudioFrame {
  return {
    time: t,
    styleTime: t,
    freq: new Float32Array(64),
    wave: new Float32Array(2048),
    energy: 0.3,
    bass: sub,
    treble: 0.1,
    sub,
  }
}

function bgConfig(partial: Partial<BackgroundConfig>): StudioConfig {
  const cfg = structuredClone(DEFAULT_STUDIO_CONFIG)
  cfg.visualizer.barCount = 8
  cfg.background = { ...cfg.background, mode: 'image', imageSrc: 'fake://bg', shade: 0, ...partial }
  return cfg
}

const DT = 1 / 60

/** Clear the main canvas' op log, render one frame, leave the log holding
 *  just that frame's ops. */
function oneFrame(rc: RenderContext, main: HTMLCanvasElement, frame: AudioFrame, cfg: StudioConfig): void {
  logOf(main).length = 0
  renderFrame(rc, frame, cfg)
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

/* --------------------------- S1 defaults contract -------------------------- */

console.log('S1 factory defaults — the background flip dials')
{
  const d = DEFAULT_STUDIO_CONFIG.background
  check('Flip on kick defaults to off', d.beatFlip === false, `got ${d.beatFlip}`)
  check('Kick sensitivity defaults to 0.1 (10%)', d.flipSensitivity === 0.1, `got ${d.flipSensitivity}`)
  check('Flip hold defaults to 0.2 (0.4 s)', d.flipHold === 0.2, `got ${d.flipHold}`)
}

/* ----------------- S2–S6 one continuous image-background scenario ----------------- */

console.log('S2 flip OFF — the classic single media draw')
{
  const { main, rc } = fresh()
  const img = (() => {
    oneFrame(rc, main, frameAt(0, 0.4), bgConfig({ beatFlip: false }))
    return fakeImages[fakeImages.length - 1]
  })()
  oneFrame(rc, main, frameAt(0.016 + 1 / 60, 0.4), bgConfig({ beatFlip: false }))
  const draws = mediaDraws(main, img)
  check(
    'flip off → exactly one media draw per frame',
    draws.length === 1,
    `draws=${draws.length}`,
  )
  check(
    'it paints at full alpha, unmirrored',
    draws.length === 1 && draws[0].alpha === 1 && draws[0].netX === 1,
    `alpha=${draws[0]?.alpha} netX=${draws[0]?.netX}`,
  )
}

console.log('S3 flip ON at rest — no onset, no mirror pass')
{
  const { main, rc } = fresh()
  oneFrame(rc, main, frameAt(0, 0.4), bgConfig({ beatFlip: true }))
  const img = fakeImages[fakeImages.length - 1]
  let maxDraws = 0
  for (let i = 1; i <= 30; i++) {
    oneFrame(rc, main, frameAt(i * DT, 0.4), bgConfig({ beatFlip: true }))
    maxDraws = Math.max(maxDraws, mediaDraws(main, img).length)
  }
  check(
    'a flat sub line never fires the flip (still one draw)',
    maxDraws === 1,
    `maxDraws=${maxDraws}`,
  )
}

console.log('S4 kick fires — the mirrored pass stamps in at full strength')
let holdEndTime = 0
{
  const { main, rc } = fresh()
  oneFrame(rc, main, frameAt(0, 0.4), bgConfig({ beatFlip: true }))
  const img = fakeImages[fakeImages.length - 1]
  // Rest ~0.3 s, then slam the sub band.
  for (let i = 1; i <= 18; i++) oneFrame(rc, main, frameAt(i * DT, 0.4), bgConfig({ beatFlip: true }))
  const tKick = 18 * DT + DT
  oneFrame(rc, main, frameAt(tKick, 1), bgConfig({ beatFlip: true })) // rise starts (persist frame)
  oneFrame(rc, main, frameAt(tKick + DT, 1), bgConfig({ beatFlip: true })) // fires here
  const during = mediaDraws(main, img)
  check(
    'on a fired kick the mirrored pass dissolves in (two draws)',
    during.length === 2,
    `draws=${during.length}`,
  )
  const mirrorPass = during[during.length - 1]
  check(
    'the mirror pass paints at full strength, net-mirrored',
    !!mirrorPass && mirrorPass.alpha === 1 && mirrorPass.netX === -1,
    `alpha=${mirrorPass?.alpha} netX=${mirrorPass?.netX}`,
  )
  const restPass = during[0]
  check(
    'the resting draw stays underneath at alpha 1',
    !!restPass && restPass.alpha === 1 && restPass.netX === 1,
    `alpha=${restPass?.alpha} netX=${restPass?.netX}`,
  )
  holdEndTime = tKick + DT + 0.4 // fire time + the 0.4 s factory hold
}

console.log('S5 hold — the mirrored side stays fully on for the dial')
{
  const { main, rc } = fresh()
  oneFrame(rc, main, frameAt(0, 0.4), bgConfig({ beatFlip: true }))
  const img = fakeImages[fakeImages.length - 1]
  for (let i = 1; i <= 18; i++) oneFrame(rc, main, frameAt(i * DT, 0.4), bgConfig({ beatFlip: true }))
  const tKick = 18 * DT + DT
  oneFrame(rc, main, frameAt(tKick, 1), bgConfig({ beatFlip: true }))
  oneFrame(rc, main, frameAt(tKick + DT, 1), bgConfig({ beatFlip: true }))
  let held = true
  for (let t = tKick + 2 * DT; t < holdEndTime - DT / 2; t += DT) {
    oneFrame(rc, main, frameAt(t, 1), bgConfig({ beatFlip: true }))
    const draws = mediaDraws(main, img)
    const mirrorPass = draws[draws.length - 1]
    if (draws.length !== 2 || !mirrorPass || mirrorPass.alpha !== 1) held = false
  }
  check('the mirror holds at alpha 1 for the whole 0.4 s', held, 'mirror dipped before the hold ended')
}

console.log('S6 release — the mirror dissolves back out, then rest')
{
  const { main, rc } = fresh()
  oneFrame(rc, main, frameAt(0, 0.4), bgConfig({ beatFlip: true }))
  const img = fakeImages[fakeImages.length - 1]
  for (let i = 1; i <= 18; i++) oneFrame(rc, main, frameAt(i * DT, 0.4), bgConfig({ beatFlip: true }))
  const tKick = 18 * DT + DT
  oneFrame(rc, main, frameAt(tKick, 1), bgConfig({ beatFlip: true }))
  oneFrame(rc, main, frameAt(tKick + DT, 1), bgConfig({ beatFlip: true }))
  // Ride the hold out, then step into the release window.
  let midSeen = false
  let t = tKick + 2 * DT
  for (; t < holdEndTime + 0.125; t += DT) {
    oneFrame(rc, main, frameAt(t, 0.4), bgConfig({ beatFlip: true }))
    const draws = mediaDraws(main, img)
    if (draws.length === 2) {
      const a = draws[draws.length - 1].alpha
      if (a > 0.05 && a < 0.95) midSeen = true
    }
  }
  check('the release sweeps the mirror back out through partial alphas', midSeen, 'no partial-alpha frame seen')
  for (; t < holdEndTime + 0.4; t += DT) oneFrame(rc, main, frameAt(t, 0.4), bgConfig({ beatFlip: true }))
  oneFrame(rc, main, frameAt(t, 0.4), bgConfig({ beatFlip: true }))
  check(
    'after the release the frame rests as the single unmirrored draw again',
    mediaDraws(main, img).length === 1,
    `draws=${mediaDraws(main, img).length}`,
  )
}

/* ------------------- S7 old saves: missing fields still fire ------------------- */

console.log('S7 old saves without the new fields — render-level fallbacks carry them')
{
  const { main, rc } = fresh()
  // A pre-feature save: the background carries no flip dials at all.
  const { flipSensitivity: _s, flipHold: _h, ...legacyBg } = structuredClone(
    DEFAULT_STUDIO_CONFIG.background,
  )
  const partial = {
    ...structuredClone(DEFAULT_STUDIO_CONFIG),
    background: { ...legacyBg, mode: 'image' as const, imageSrc: 'fake://bg', shade: 0, beatFlip: true },
  } as StudioConfig
  oneFrame(rc, main, frameAt(0, 0.4), partial)
  const img = fakeImages[fakeImages.length - 1]
  for (let i = 1; i <= 18; i++) oneFrame(rc, main, frameAt(i * DT, 0.4), partial)
  const tKick = 18 * DT + DT
  oneFrame(rc, main, frameAt(tKick, 1), partial)
  oneFrame(rc, main, frameAt(tKick + DT, 1), partial)
  check(
    'missing dials fall back to 10% / 0.4 s and the kick still fires',
    mediaDraws(main, img).length === 2,
    `draws=${mediaDraws(main, img).length}`,
  )
}

/* --------------- S8 solid (non-media) background — no gate, no crash --------------- */

console.log('S8 solid background with the toggle on — renders clean')
{
  const { main, rc } = fresh()
  const cfg = bgConfig({ beatFlip: true })
  cfg.background.mode = 'solid'
  cfg.background.imageSrc = ''
  renderFrame(rc, frameAt(0, 0.4), cfg)
  renderFrame(rc, frameAt(1 / 60, 1), cfg)
  check(
    'no drawImage ops exist on a solid background (no gate, no crash)',
    !logOf(main).some((r) => r.m === 'drawImage'),
    `drawImages=${logOf(main).filter((r) => r.m === 'drawImage').length}`,
  )
}

/* --------------- S9 the user's Flip horizontal composes with the kick --------------- */

console.log('S9 Flip horizontal + kick mirror — the two flips compose')
{
  const { main, rc } = fresh()
  oneFrame(rc, main, frameAt(0, 0.4), bgConfig({ beatFlip: true, flipX: true }))
  const img = fakeImages[fakeImages.length - 1]
  for (let i = 1; i <= 18; i++)
    oneFrame(rc, main, frameAt(i * DT, 0.4), bgConfig({ beatFlip: true, flipX: true }))
  const tKick = 18 * DT + DT
  oneFrame(rc, main, frameAt(tKick, 1), bgConfig({ beatFlip: true, flipX: true }))
  oneFrame(rc, main, frameAt(tKick + DT, 1), bgConfig({ beatFlip: true, flipX: true }))
  const draws = mediaDraws(main, img)
  const rest = draws[0]
  const mirrorPass = draws[draws.length - 1]
  check(
    'the resting draw carries the user flip (net −1), the kick pass unwinds it (net +1)',
    draws.length === 2 && rest?.netX === -1 && mirrorPass?.netX === 1,
    `draws=${draws.length} rest=${rest?.netX} mirror=${mirrorPass?.netX}`,
  )
}

/* --------------------------------- verdict -------------------------------- */

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
