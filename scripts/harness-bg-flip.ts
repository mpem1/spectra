/**
 * Harness — Background "Flip on kick" (Style tab → Background → With the beat).
 *
 * Drives the REAL `renderFrame` (background → layers → filter chain) against
 * a permissive mock canvas that records every op per context — each drawImage
 * carries the alpha it painted with, the NET horizontal scale accumulated
 * since its save block, the block's translate and the active ctx.filter, so
 * the background's motion is detectable op-by-op. A fake global `Image`
 * decodes instantly so the image-background path runs.
 *
 * The behavior under test (Flip on kick = the kick flips the With-the-beat
 * motion ON, like the halftone print / 3D glasses "the print stamps in on
 * the kick" — NOT a mirror):
 *   S1  defaults contract — beatFlip off, Kick sensitivity 10%, Flip hold 0.2
 *   S2  flip OFF — the motions follow the bass continuously (classic path)
 *   S3  flip ON at rest — even a LOUD bass meter moves nothing: the
 *       background rests still (no bounce, no shake, no blur swell)
 *   S4  a sub-band onset fires — the motions stamp in at their dialed
 *       strength (bounce zoom + shake jitter + blur swell) as exactly ONE
 *       unmirrored media draw
 *   S5  hold — the motion stays fully on for the hold dial (0.4 s)
 *   S6  release — the motion eases back down through intermediates, then
 *       the background rests still again
 *   S7  zeroed motion dials — a fired kick flips the switch on, but with
 *       nothing dialed there is nothing to stamp (width stays base)
 *   S8  old saves without the dials still fire (render-level ?? fallbacks)
 *   S9  solid (non-media) background with the toggle on — renders clean
 *   S10 the user's Flip horizontal is untouched by kicks — one draw,
 *       net-mirrored by the user flip alone, never a second pass
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
  /** the owning save block's latest translate */
  tx: number
  ty: number
  /** ctx.filter active when the op ran */
  filter: string
  src?: unknown
}

function makeCanvas(): HTMLCanvasElement {
  const canv = { width: 0, height: 0 } as unknown as HTMLCanvasElement
  const state = { op: 'source-over', alpha: 1 }
  const log: OpRec[] = []
  // scaleX accumulator — save pushes, restore pops, scale multiplies.
  const stack: number[] = []
  // translate per save block — save clones the parent, restore pops.
  const tstack: { tx: number; ty: number }[] = [{ tx: 0, ty: 0 }]
  let netX = 1
  const rec = (m: string, args: number[], src?: unknown) =>
    log.push({
      m,
      args,
      alpha: state.alpha,
      netX,
      tx: tstack[tstack.length - 1].tx,
      ty: tstack[tstack.length - 1].ty,
      filter: String((base as { filter?: unknown }).filter ?? 'none'),
      src,
    })
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
      tstack.push({ ...tstack[tstack.length - 1] })
      rec('save', [])
    },
    restore: () => {
      netX = stack.pop() ?? 1
      tstack.pop()
      rec('restore', [])
    },
    translate: (...a: number[]) => {
      const t = tstack[tstack.length - 1]
      t.tx = a[0]
      t.ty = a[1]
      rec('translate', a)
    },
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
const CX = W / 2
/** Cover-fit base draw width: 640 × max(320/640, 180/360) = 320. */
const BASE_W = 320

function fresh(): { main: HTMLCanvasElement; rc: RenderContext } {
  const main = makeCanvas()
  const mctx = (main as unknown as { getContext: () => CanvasRenderingContext2D }).getContext()
  return { main, rc: { ctx: mctx, width: W, height: H } as unknown as RenderContext }
}

function frameAt(t: number, sub: number, bass = sub): AudioFrame {
  return {
    time: t,
    styleTime: t,
    freq: new Float32Array(64),
    wave: new Float32Array(2048),
    energy: 0.3,
    bass,
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

/* ------------------- S2 flip OFF — the classic continuous path ------------------- */

console.log('S2 flip OFF — the motions follow the bass continuously')
{
  const { main, rc } = fresh()
  const img = (() => {
    oneFrame(rc, main, frameAt(0, 0.4), bgConfig({ beatFlip: false, pulse: 0.5 }))
    return fakeImages[fakeImages.length - 1]
  })()
  oneFrame(rc, main, frameAt(1 / 60, 0.4), bgConfig({ beatFlip: false, pulse: 0.5 }))
  const draws = mediaDraws(main, img)
  check(
    'exactly one media draw, full alpha, unmirrored',
    draws.length === 1 && draws[0].alpha === 1 && draws[0].netX === 1,
    `draws=${draws.length} alpha=${draws[0]?.alpha} netX=${draws[0]?.netX}`,
  )
  const w = draws[0]?.args[2] ?? 0
  check(
    'the bounce zoom rides the live bass (wider than the cover base)',
    w > BASE_W + 1 && w < BASE_W + 12,
    `w=${w.toFixed(2)} base=${BASE_W}`,
  )
}

/* ------------- S3 flip ON at rest — a loud bass meter moves nothing ------------- */

console.log('S3 flip ON at rest — the background rests still between kicks')
{
  const { main, rc } = fresh()
  // Motion dials dialed in; the sub line stays FLAT (no onset) while the
  // bass meter runs loud — with the flip on, continuous bass moves nothing.
  const cfg = bgConfig({ beatFlip: true, pulse: 0.5, shake: 0.4, blurPulse: 0.5 })
  oneFrame(rc, main, frameAt(0, 0.4, 0.9), cfg)
  const img = fakeImages[fakeImages.length - 1]
  let oneDraw = true
  let still = true
  let noBlur = true
  for (let i = 1; i <= 30; i++) {
    oneFrame(rc, main, frameAt(i * DT, 0.4, 0.9), cfg)
    const draws = mediaDraws(main, img)
    if (draws.length !== 1) oneDraw = false
    const d = draws[0]
    if (!d) continue
    if (Math.abs(d.args[2] - BASE_W) > 0.02) still = false // no bounce zoom
    if (Math.abs(d.tx - CX) > 1e-6) still = false // no shake jitter
    if (d.filter !== 'none') noBlur = false // no blur swell
  }
  check('a flat sub line never fires (still exactly one draw)', oneDraw, 'draw count wavered')
  check('a loud bass meter alone moves nothing (width + position stay base)', still, 'the background moved without a kick')
  check('no blur swell without a kick (filter stays none)', noBlur, 'blurPulse leaked at rest')
}

/* ------------- S4–S6 one continuous kick scenario (bounce+shake+blur) ------------- */

const KICK_CFG = bgConfig({ beatFlip: true, pulse: 0.5, shake: 0.4, blurPulse: 0.5 })

/** Rest ~0.3 s on a flat sub, then slam it — leaves the canvas holding the
 *  first held kick frame. Returns the fake bg image. */
function fireKick(
  rc: RenderContext,
  main: HTMLCanvasElement,
  cfg: StudioConfig,
): { img: unknown; tKick: number; fireT: number } {
  oneFrame(rc, main, frameAt(0, 0.4, 0.4), cfg)
  const img = fakeImages[fakeImages.length - 1]
  for (let i = 1; i <= 18; i++) oneFrame(rc, main, frameAt(i * DT, 0.4, 0.4), cfg)
  const tKick = 18 * DT + DT
  oneFrame(rc, main, frameAt(tKick, 1, 1), cfg) // rise starts (persist frame)
  oneFrame(rc, main, frameAt(tKick + DT, 1, 1), cfg) // fires here
  return { img, tKick, fireT: tKick + DT }
}

console.log('S4 kick fires — the motion stamps in as one unmirrored draw')
let holdEndTime = 0
{
  const { main, rc } = fresh()
  const { img, fireT } = fireKick(rc, main, KICK_CFG)
  const d = mediaDraws(main, img)[0]
  const w = d?.args[2] ?? 0
  check(
    'exactly ONE media draw on the kick — no mirrored second pass',
    mediaDraws(main, img).length === 1 && d?.netX === 1,
    `draws=${mediaDraws(main, img).length} netX=${d?.netX}`,
  )
  check(
    'the bounce zoom stamps in past the cover base',
    w > BASE_W + 12,
    `w=${w.toFixed(2)} base=${BASE_W}`,
  )
  check(
    'the blur swell stamps in (filter engages)',
    !!d && d.filter.startsWith('blur('),
    `filter=${d?.filter}`,
  )
  // The shake jitters in a fresh random direction every 1/30 s — across the
  // hold several ticks land, at least one must sit off-center.
  let shook = Math.abs((d?.tx ?? CX) - CX) > 0.05
  for (let t = fireT + DT; t < fireT + 0.3; t += DT) {
    oneFrame(rc, main, frameAt(t, 1, 1), KICK_CFG)
    const dd = mediaDraws(main, img)[0]
    if (dd && Math.abs(dd.tx - CX) > 0.05) shook = true
  }
  check('the shake jitter stamps in (draw slides off-center)', shook, 'draw never left center')
  holdEndTime = fireT + 0.4 // fire time + the 0.4 s factory hold
}

console.log('S5 hold — the motion stays fully on for the dial')
{
  const { main, rc } = fresh()
  const { img, fireT } = fireKick(rc, main, KICK_CFG)
  let held = true
  for (let t = fireT + DT; t < holdEndTime - DT / 2; t += DT) {
    oneFrame(rc, main, frameAt(t, 1, 1), KICK_CFG)
    const d = mediaDraws(main, img)[0]
    if (!d || d.args[2] <= BASE_W + 12 || !d.filter.startsWith('blur(')) held = false
  }
  check('bounce + blur stay at full dialed strength for the whole 0.4 s', held, 'motion dipped before the hold ended')
}

console.log('S6 release — the motion eases back down, then the background rests')
{
  const { main, rc } = fresh()
  const { img, fireT } = fireKick(rc, main, KICK_CFG)
  let midSeen = false
  let t = fireT + DT
  // Ride the hold out and the FULL 0.25 s release; the width only dips
  // below the full-strength plateau in the later part of the sweep.
  for (; t < holdEndTime + 0.3; t += DT) {
    oneFrame(rc, main, frameAt(t, 0.4, 0.4), KICK_CFG)
    const d = mediaDraws(main, img)[0]
    const w = d?.args[2] ?? BASE_W
    if (w > BASE_W + 0.5 && w < BASE_W + 12) midSeen = true
  }
  check('the release sweeps the motion back down through intermediates', midSeen, 'no partial-strength frame seen')
  for (; t < holdEndTime + 0.4; t += DT) oneFrame(rc, main, frameAt(t, 0.4, 0.4), KICK_CFG)
  oneFrame(rc, main, frameAt(t, 0.4, 0.4), KICK_CFG)
  const d = mediaDraws(main, img)[0]
  check(
    'after the release the background rests still again (base width, one draw)',
    mediaDraws(main, img).length === 1 && !!d && Math.abs(d.args[2] - BASE_W) < 0.06,
    `draws=${mediaDraws(main, img).length} w=${d?.args[2]}`,
  )
}

/* ---------------- S7 zeroed motion dials — the switch flips, nothing stamps ---------------- */

console.log('S7 zeroed dials — a fired kick with nothing dialed moves nothing')
{
  const { main, rc } = fresh()
  const cfg = bgConfig({ beatFlip: true, pulse: 0, shake: 0, blurPulse: 0 })
  const { img, fireT } = fireKick(rc, main, cfg)
  const d = mediaDraws(main, img)[0]
  check(
    'one draw, base width, no blur — the flip respects the dials',
    mediaDraws(main, img).length === 1 &&
      !!d &&
      Math.abs(d.args[2] - BASE_W) < 0.02 &&
      d.filter === 'none',
    `draws=${mediaDraws(main, img).length} w=${d?.args[2]} filter=${d?.filter}`,
  )
  void fireT
}

/* ------------------- S8 old saves: missing fields still fire ------------------- */

console.log('S8 old saves without the dials — render-level fallbacks carry them')
{
  const { main, rc } = fresh()
  // A pre-feature save: the background carries no flip dials at all.
  const { flipSensitivity: _s, flipHold: _h, ...legacyBg } = structuredClone(
    DEFAULT_STUDIO_CONFIG.background,
  )
  const partial = {
    ...structuredClone(DEFAULT_STUDIO_CONFIG),
    background: {
      ...legacyBg,
      mode: 'image' as const,
      imageSrc: 'fake://bg',
      shade: 0,
      beatFlip: true,
      pulse: 0.5,
      blurPulse: 0.5,
    },
  } as StudioConfig
  const { img, fireT } = fireKick(rc, main, partial)
  const d = mediaDraws(main, img)[0]
  check(
    'missing dials fall back to 10% / 0.4 s and the motion still stamps in',
    !!d && d.args[2] > BASE_W + 12 && d.filter.startsWith('blur('),
    `w=${d?.args[2]} filter=${d?.filter}`,
  )
  void fireT
}

/* --------------- S9 solid (non-media) background — no gate, no crash --------------- */

console.log('S9 solid background with the toggle on — renders clean')
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

/* --------------- S10 the user's Flip horizontal is untouched by kicks --------------- */

console.log('S10 Flip horizontal + kick — the user flip stands alone')
{
  const { main, rc } = fresh()
  const cfg = bgConfig({ beatFlip: true, flipX: true, pulse: 0.5 })
  const { img } = fireKick(rc, main, cfg)
  const draws = mediaDraws(main, img)
  check(
    'one draw, net-mirrored by the user flip only — the kick adds no mirror pass',
    draws.length === 1 && draws[0].netX === -1,
    `draws=${draws.length} netX=${draws[0]?.netX}`,
  )
}

/* --------------------------------- verdict -------------------------------- */

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
