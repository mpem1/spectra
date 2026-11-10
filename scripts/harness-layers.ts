/**
 * Harness — "Layers stay colored" (the global layers-vs-filters toggle) +
 * the new factory defaults for the kick dials.
 *
 * Drives the REAL `renderFrame` (the whole pipeline: background → moving
 * layers → screen/VHS/film/halftone/glitch/anaglyph) through a permissive
 * mock canvas that records every drawImage/fillRect op per canvas, asserting:
 *   S1  defaults contract — the factory kick dials + layers default
 *   S2  resolveLayersConfig migration matrix (old halftone flipColorLayers
 *       → global stayColored, only where the old gate was actually active)
 *   S3  stayColored ON + 3D glasses ON: the moving layers draw into their
 *       own overlay (not the main frame) and the overlay is composited
 *       AFTER the anaglyph pass — the last draw on the frame
 *   S4  stayColored OFF: no overlay exists; the layers draw straight onto
 *       the main frame (the classic behavior, byte-parity fills)
 *   S5  transparent background: the overlay pass never runs (alpha-clean)
 */

import { renderFrame } from '../src/lib/visualizer/renderer'
import { DEFAULT_STUDIO_CONFIG, resolveLayersConfig } from '../src/lib/visualizer/types'
import type { AudioFrame, RenderContext, StudioConfig } from '../src/lib/visualizer/types'

/* ------------------------------ mock canvas ------------------------------ */

interface OpRec {
  kind: 'draw' | 'fill' | 'frect'
  src?: unknown
  x?: number
  op: string
  alpha: number
}

function makeCanvas(): HTMLCanvasElement {
  const canv = { width: 0, height: 0 } as unknown as HTMLCanvasElement
  const state = { op: 'source-over', alpha: 1 }
  const log: OpRec[] = []
  const rec = (r: OpRec) => log.push(r)
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
    drawImage: (src: unknown, x?: number) =>
      rec({ kind: 'draw', src, x: typeof x === 'number' ? x : 0, op: state.op, alpha: state.alpha }),
    fillRect: () => rec({ kind: 'frect', op: state.op, alpha: state.alpha }),
    fill: () => rec({ kind: 'fill', op: state.op, alpha: state.alpha }),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  }
  const ctx = new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined
      if (prop === 'globalCompositeOperation') return state.op
      if (prop === 'globalAlpha') return state.alpha
      if (prop in target) return target[prop]
      // Every other canvas method is a graceful no-op.
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

const logOf = (c: HTMLCanvasElement): OpRec[] => (c as unknown as { __log: OpRec[] }).__log
/** Path fills — the visualizer's bars paint this way (the background's grain
 *  is fillRect-only, the filters drawImage-only, so `fill` isolates the bars). */
const fills = (c: HTMLCanvasElement): number => logOf(c).filter((r) => r.kind === 'fill').length
const draws = (c: HTMLCanvasElement): OpRec[] => logOf(c).filter((r) => r.kind === 'draw')

/* --------------------------------- setup --------------------------------- */

const W = 320
const H = 180
const main = makeCanvas()
const mctx = (main as unknown as { getContext: () => CanvasRenderingContext2D }).getContext()
const rc = { ctx: mctx, width: W, height: H } as unknown as RenderContext

function frameAt(t: number): AudioFrame {
  return {
    time: t,
    styleTime: t,
    freq: new Float32Array(64),
    wave: new Float32Array(2048),
    energy: 0.3,
    bass: 0.4,
    treble: 0.1,
    sub: 0.4,
  }
}

function baseConfig(): StudioConfig {
  const cfg = structuredClone(DEFAULT_STUDIO_CONFIG)
  cfg.visualizer.barCount = 24
  cfg.anaglyphFilter = { ...cfg.anaglyphFilter, enabled: true, depth: 1 }
  return cfg
}

/** One measured frame: clear every log, render, return the first canvas
 *  created during THIS frame (null when the frame created none). */
function renderOne(config: StudioConfig, t = 0.5): HTMLCanvasElement | null {
  for (const c of [main, ...created]) logOf(c).length = 0
  const mark = created.length
  renderFrame(rc, frameAt(t), config)
  return created.length > mark ? created[mark] : null
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

console.log('S1 factory defaults — kick dials + layers')
{
  const d = DEFAULT_STUDIO_CONFIG
  check('halftone Flip hold defaults to 0.2 (0.4 s)', d.halftoneFilter.flipHold === 0.2, `got ${d.halftoneFilter.flipHold}`)
  check('halftone Kick sensitivity keeps its balanced 0.5', d.halftoneFilter.flipSensitivity === 0.5, `got ${d.halftoneFilter.flipSensitivity}`)
  check('3D glasses Flip hold defaults to 0.2', d.anaglyphFilter.flipHold === 0.2, `got ${d.anaglyphFilter.flipHold}`)
  check('3D glasses Kick sensitivity defaults to 0.1 (10%)', d.anaglyphFilter.flipSensitivity === 0.1, `got ${d.anaglyphFilter.flipSensitivity}`)
  check('3D glasses Flat hold defaults to 0.2', d.anaglyphFilter.popHold === 0.2, `got ${d.anaglyphFilter.popHold}`)
  check('3D glasses pop sensitivity defaults to 0.1 (same kicks as the flip)', d.anaglyphFilter.popSensitivity === 0.1, `got ${d.anaglyphFilter.popSensitivity}`)
  check('layers.stayColored defaults to off', d.layers.stayColored === false, `got ${d.layers.stayColored}`)
  check('halftone config no longer carries flipColorLayers', !('flipColorLayers' in d.halftoneFilter), 'legacy key still present')
}

/* ------------------------- S2 migration matrix (pure) ----------------------- */

console.log('S2 resolveLayersConfig — old halftone toggle graduates to the global one')
{
  check('no saved layers + no legacy flag → off', resolveLayersConfig(undefined).stayColored === false, 'expected false')
  const oldActive = { halftoneFilter: { enabled: true, beatFlip: true, flipColorLayers: true } }
  check('legacy flag with halftone + flip ON → stays colored', resolveLayersConfig(oldActive).stayColored === true, 'expected true')
  const oldDormantFlipOff = { halftoneFilter: { enabled: true, beatFlip: false, flipColorLayers: true } }
  check('legacy flag with flip OFF (was inert) → off', resolveLayersConfig(oldDormantFlipOff).stayColored === false, 'expected false')
  const oldDormantFilterOff = { halftoneFilter: { enabled: false, beatFlip: true, flipColorLayers: true } }
  check('legacy flag with halftone OFF (was inert) → off', resolveLayersConfig(oldDormantFilterOff).stayColored === false, 'expected false')
  const explicitFalse = { layers: { stayColored: false }, ...oldActive }
  check('an explicit new value always wins over the legacy flag', resolveLayersConfig(explicitFalse).stayColored === false, 'expected false')
  const explicitTrue = { layers: { stayColored: true } }
  check('explicit true carries through', resolveLayersConfig(explicitTrue).stayColored === true, 'expected true')
}

/* -------------------- S3 stayColored ON: overlay last, after anaglyph ------------------- */

console.log('S3 stayColored ON — layers ride their own overlay ABOVE the 3D glasses')
{
  const cfg = baseConfig()
  // Warm-up frame (creates the anaglyph work canvases), then measure both modes.
  renderOne({ ...cfg, layers: { stayColored: false } })
  const mainFillsOff = fills(main)
  const ov = renderOne({ ...cfg, layers: { stayColored: true } })
  const mainFillsOn = fills(main)
  const ovDrawn = draws(main)
  const last = ovDrawn[ovDrawn.length - 1]
  check('the overlay canvas was created for this frame', !!ov, 'no canvas was created')
  check(
    'the moving layers drew onto the overlay (the 24 bars live there)',
    !!ov && fills(ov) >= 24,
    `overlay fills=${ov ? fills(ov) : 'n/a'}`,
  )
  check(
    'the main frame lost the layer fills (they moved to the overlay)',
    mainFillsOff >= 24 && mainFillsOn === 0,
    `bars off=${mainFillsOff} on=${mainFillsOn}`,
  )
  check(
    'the overlay is composited back onto the main frame',
    ovDrawn.some((d) => d.src === ov),
    `main draws=${ovDrawn.length}`,
  )
  check(
    'the overlay draw is the VERY LAST pass on the frame (after the 3D glasses)',
    last && last.src === ov,
    `last=${JSON.stringify(last)}`,
  )
  const anaglyphIdx = ovDrawn.findIndex((d) => d.src !== ov)
  const ovIdx = ovDrawn.findIndex((d) => d.src === ov)
  check(
    'the glasses ran BEFORE the overlay came back (filter textured the background only)',
    anaglyphIdx >= 0 && ovIdx > anaglyphIdx,
    `anaglyphIdx=${anaglyphIdx} ovIdx=${ovIdx}`,
  )
}

/* ---------------------- S4 stayColored OFF: classic path ---------------------- */

console.log('S4 stayColored OFF — layers draw straight onto the frame')
{
  const cfg = baseConfig()
  const ov = renderOne({ ...cfg, layers: { stayColored: false } })
  const mainDraws = draws(main)
  check('no new canvas is created (no overlay detour)', ov === null, `created=${!!ov}`)
  check(
    'the bars paint straight onto the main frame',
    fills(main) >= 24,
    `main fills=${fills(main)}`,
  )
  check(
    'the main composite is the anaglyph output alone (no overlay draw)',
    mainDraws.length === 1,
    `main draws=${mainDraws.length}`,
  )
  const mainFillsOff = fills(main)
  renderOne({ ...cfg, layers: { stayColored: true } })
  const mainFillsOn = fills(main)
  renderOne({ ...cfg, layers: { stayColored: false } })
  check(
    'turning it back off restores the classic fill layout exactly',
    fills(main) === mainFillsOff && mainFillsOn === 0,
    `off=${mainFillsOff} on=${mainFillsOn} restored=${fills(main)}`,
  )
}

/* ----------------- S5 transparent background: overlay never runs ------------------ */

console.log('S5 transparent background — the overlay pass is skipped (alpha stays clean)')
{
  const cfg = baseConfig()
  cfg.background = { ...cfg.background, mode: 'transparent' }
  const ov = renderOne({ ...cfg, layers: { stayColored: true } })
  check('no overlay canvas is created on a transparent background', ov === null, `created=${!!ov}`)
  check(
    'the layers drew straight onto the main frame',
    fills(main) >= 24,
    `main fills=${fills(main)}`,
  )
}

/* --------------------------------- verdict -------------------------------- */

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
