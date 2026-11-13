/**
 * Harness — "Layers stay colored" + "Text stays legible" (the layers-vs-
 * filters toggles) + the lyrics layer opacity + the factory kick-dial defaults.
 *
 * Drives the REAL `renderFrame` (the whole pipeline: background → moving
 * layers → text overlays → screen/VHS/film/halftone/glitch/anaglyph) through
 * a permissive mock canvas that records every drawImage/fillRect/fillText op
 * per canvas, asserting:
 *   S1  defaults contract — the factory kick dials + layers + lyrics defaults
 *   S2  resolveLayersConfig migration matrix (old halftone flipColorLayers
 *       → global stayColored, only where the old gate was actually active)
 *   S3  stayColored ON + 3D glasses ON: the moving layers draw into their
 *       own overlay (not the main frame) and the overlay is composited
 *       AFTER the anaglyph pass — the last draw on the frame
 *   S4  stayColored OFF: no overlay exists; the layers draw straight onto
 *       the main frame (the classic behavior, byte-parity fills)
 *   S5  transparent background: the overlay pass never runs (alpha-clean)
 *   S6  textClear ON (stayColored OFF): the words (lyrics, title, watermark)
 *       ride the overlay and composite after the filter chain while the bars
 *       still paint onto the main frame and get filtered; stayColored wins
 *       when both are on; toggling back restores the classic layout
 *   S7  lyrics opacity — the layer alpha scales every text pass uniformly,
 *       0 short-circuits the whole layer, old configs without the field stay
 *       fully opaque
 *   S8  filter alpha — the one dial over the whole filter chain: 100% keeps
 *       the classic path (no snapshot, no extra pass), 50% fades the
 *       pre-filter frame back over the finished chain at 1 − alpha AFTER the
 *       glasses, 0% covers the chain with the unfiltered snapshot, the fade
 *       sits UNDER the textClear overlay, transparent backgrounds skip it,
 *       legacy configs without the field stay full strength
 *   S9  visualizer transparency — the Style tab dial fades the ENTIRE bars
 *       layer uniformly (every fill at exactly 1 − transparency), 100%
 *       short-circuits the layer, the radial inner ring and grid frontier
 *       dots (which pin their own absolute globalAlpha) scale with it, the
 *       text overlays stay untouched, legacy configs without the field stay
 *       fully solid
 *   S10 halftone Print only (poster mode) — the picture is snapshotted as
 *       the screen's source and hidden behind the backdrop: the classic
 *       path still samples the live frame (byte parity), Print only floods
 *       the frame with one full-alpha backdrop fill (white paper by
 *       default, gradient object when dialed) under the ink, the screen
 *       reads the hidden snapshot (dots keep following the picture),
 *       grayscale conditions the snapshot instead of the visible frame,
 *       the print-direction rest shows the bare backdrop, and raw configs
 *       without the new fields stay classic
 *   S11 halftone ink fills — the "Inside the dots" choice: classic ink
 *       stays black in the buffer, Picture fill stamps each dot the source
 *       picture's own cell color (both color families, zero black, the
 *       source-in recolor skipped) and PRINTS POSTER-STYLE ON ITS OWN —
 *       even with Print only off, the fill snapshots the picture, floods
 *       the frame with the backdrop and reads the snapshot (never dots
 *       layered over the image), Picture wins over gradient + inkColor,
 *       gradient ink recolors with both stops and floods the poster
 *       backdrop too, Print only + Picture keeps the paper under colored
 *       dots, and raw configs without imageFill print classic black ink
 */

import { renderFrame } from '../src/lib/visualizer/renderer'
import { bindSeratoSource, buildSeratoEnvelope } from '../src/lib/visualizer/serato'
import { loadBackgroundImage } from '../src/lib/visualizer/image-cache'
import { drawLyrics } from '../src/lib/visualizer/lyrics'
import { DEFAULT_STUDIO_CONFIG, resolveLayersConfig } from '../src/lib/visualizer/types'
import type { AudioFrame, RenderContext, StudioConfig } from '../src/lib/visualizer/types'

/* ------------------------------ mock canvas ------------------------------ */

interface OpRec {
  kind: 'draw' | 'fill' | 'frect' | 'text' | 'pimg' | 'stroke' | 'xform'
  src?: unknown
  x?: number
  y?: number
  w?: number
  h?: number
  rects?: Array<{ x: number; y: number; w: number; h: number }>
  /** Polyline points of the current path at stroke time (moveTo/lineTo
   *  tracking) — lets assertions read wireframe geometry back. */
  pts?: Array<{ x: number; y: number }>
  op: string
  alpha: number
  style?: unknown
}

function makeCanvas(): HTMLCanvasElement {
  const canv = { width: 0, height: 0 } as unknown as HTMLCanvasElement
  const state = { op: 'source-over', alpha: 1 }
  const log: OpRec[] = []
  const rec = (r: OpRec) => log.push(r)
  // Path tracking: beginPath clears, roundRect/rect record — so fill()
  // captures the geometry of path-based passes (bars, perspective pills).
  type Rect = { x: number; y: number; w: number; h: number }
  let path: Rect[] = []
  // Polyline tracking for stroke() — the terrain wireframe (and any other
  // stroked pass) records its points so geometry assertions can read them.
  let poly: Array<{ x: number; y: number }> = []
  const pushRect = (x?: number, y?: number, w?: number, h?: number) =>
    path.push({
      x: typeof x === 'number' ? x : 0,
      y: typeof y === 'number' ? y : 0,
      w: typeof w === 'number' ? w : 0,
      h: typeof h === 'number' ? h : 0,
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
    createLinearGradient: () => {
      // Record the stops so assertions can read a gradient's colors back.
      const stops: Array<[number, string]> = []
      return { addColorStop: (offset: number, color: string) => stops.push([offset, color]), stops }
    },
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createConicGradient: () => ({ addColorStop: () => {} }),
    createPattern: () => null,
    drawImage: (src: unknown, x?: number) =>
      rec({ kind: 'draw', src, x: typeof x === 'number' ? x : 0, op: state.op, alpha: state.alpha }),
    // translate ops record their offset — the mock ignores real transforms,
    // but position dials (the image style's Inner X/Y re-anchoring) still
    // need their anchor shifts visible to geometry assertions.
    translate: (x?: number, y?: number) =>
      rec({ kind: 'xform', x: typeof x === 'number' ? x : 0, y: typeof y === 'number' ? y : 0, op: state.op, alpha: state.alpha }),
    fillRect: (x?: number, y?: number, w?: number, h?: number) =>
      rec({
        kind: 'frect',
        x: typeof x === 'number' ? x : 0,
        y: typeof y === 'number' ? y : 0,
        w: typeof w === 'number' ? w : 0,
        h: typeof h === 'number' ? h : 0,
        op: state.op,
        alpha: state.alpha,
        style: base.fillStyle,
      }),
    // putImageData keeps a reference to the ImageData so assertions can read
    // the halftone ink buffer's bytes back (colors + alpha coverage).
    putImageData: (img: unknown) =>
      rec({ kind: 'pimg', op: state.op, alpha: state.alpha, style: img }),
    // fill records carry fillStyle too — Path2D-based passes (grid, blob,
    // ribbon) fill with gradient OBJECTS, and the S12 layer-color assertions
    // read those stops back. The tracked path (or a Path2D argument's
    // recorded rects) rides along so geometry assertions can read pill/bar
    // rectangles back.
    fill: (p?: unknown) =>
      rec({
        kind: 'fill',
        op: state.op,
        alpha: state.alpha,
        style: base.fillStyle,
        rects:
          p && typeof p === 'object' && Array.isArray((p as { __rects?: unknown }).__rects)
            ? (p as { __rects: Rect[] }).__rects.slice()
            : path.slice(),
        // The tracked polyline rides along too — spline/arc geometry
        // (ribbon's curves, the dot styles' arc centers) so mode diffs like
        // Mirror vs Center can see SHAPE, not just op counts.
        pts: poly.slice(),
      }),
    // Text passes (lyrics, titles, watermark, disc labels) — the alpha on
    // each record is what the opacity assertions read.
    fillText: () => rec({ kind: 'text', op: state.op, alpha: state.alpha }),
    strokeText: () => rec({ kind: 'text', op: state.op, alpha: state.alpha }),
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
  // beginPath / roundRect / rect join the table AFTER the proxy so the
  // path tracker captures them (a Proxy `has` trap would also work, but
  // explicit members keep the mock honest).
  ;(base as Record<string, unknown>).beginPath = () => {
    path = []
    poly = []
  }
  ;(base as Record<string, unknown>).moveTo = (x?: number, y?: number) => {
    poly = [{ x: typeof x === 'number' ? x : 0, y: typeof y === 'number' ? y : 0 }]
  }
  ;(base as Record<string, unknown>).lineTo = (x?: number, y?: number) => {
    poly.push({ x: typeof x === 'number' ? x : 0, y: typeof y === 'number' ? y : 0 })
  }
  // Splines and circles join the tracker: both control + end points for the
  // quadratics (blob/ribbon/wave curves), the center for arcs (particles'
  // mirror twins, sphere's dots) — so fill records carry real geometry.
  ;(base as Record<string, unknown>).quadraticCurveTo = (cpx?: number, cpy?: number, x?: number, y?: number) => {
    poly.push({ x: typeof cpx === 'number' ? cpx : 0, y: typeof cpy === 'number' ? cpy : 0 })
    poly.push({ x: typeof x === 'number' ? x : 0, y: typeof y === 'number' ? y : 0 })
  }
  ;(base as Record<string, unknown>).arc = (x?: number, y?: number) => {
    poly.push({ x: typeof x === 'number' ? x : 0, y: typeof y === 'number' ? y : 0 })
  }
  ;(base as Record<string, unknown>).stroke = () => {
    rec({ kind: 'stroke', op: state.op, alpha: state.alpha, style: base.strokeStyle, pts: poly.slice() })
  }
  ;(base as Record<string, unknown>).roundRect = pushRect
  ;(base as Record<string, unknown>).rect = pushRect
  ;(canv as unknown as { getContext: () => unknown }).getContext = () => ctx
  ;(canv as unknown as { __log: OpRec[] }).__log = log
  baseOf.set(canv, base)
  return canv
}

/** Every canvas the pipeline asks document for, in creation order. */
const created: HTMLCanvasElement[] = []
/** canvas → its mock method table (a WeakMap, so probing a canvas's
 *  internals never adds a cycle for the assertion JSON.stringify). */
const baseOf = new WeakMap<object, Record<string, unknown>>()
;(globalThis as { document?: unknown }).document = {
  createElement: () => {
    const c = makeCanvas()
    created.push(c)
    return c
  },
}
// The grid style batches its dots into a Path2D — a recording stub is all
// the harness needs (the mock ctx's fill() logs regardless of the path);
// rect() records so path-argument geometry stays readable too.
;(globalThis as { Path2D?: unknown }).Path2D = class {
  __rects: Array<{ x: number; y: number; w: number; h: number }> = []
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  closePath(): void {}
  quadraticCurveTo(): void {}
  rect(x: number, y: number, w: number, h: number): void {
    this.__rects.push({ x, y, w, h })
  }
}
// The halftone's ink buffer wraps its bytes in an ImageData — bun has no
// ImageData global, so a minimal stand-in is all the harness needs (the
// mock ctx's putImageData is an unrecorded no-op anyway).
;(globalThis as { ImageData?: unknown }).ImageData = class {
  width: number
  height: number
  data: Uint8ClampedArray
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}
// The image-viz style (S18) reads uploaded artwork through the shared image
// cache — bun has no DOM Image, so a minimal stand-in stands in: complete +
// natural size from the start (like an already-decoded data URL).
;(globalThis as { Image?: unknown }).Image = class MockImage {
  complete = true
  naturalWidth = 64
  naturalHeight = 64
  decoding = 'sync'
  onload: unknown = null
  onerror: unknown = null
  src = ''
}

const logOf = (c: HTMLCanvasElement): OpRec[] => (c as unknown as { __log: OpRec[] }).__log
/** Path fills — the visualizer's bars paint this way (the background's grain
 *  is fillRect-only, the filters drawImage-only, so `fill` isolates the bars). */
const fills = (c: HTMLCanvasElement): number => logOf(c).filter((r) => r.kind === 'fill').length
const draws = (c: HTMLCanvasElement): OpRec[] => logOf(c).filter((r) => r.kind === 'draw')
/** Text passes — lyrics/title/watermark glyphs (fillText + strokeText). */
const texts = (c: HTMLCanvasElement): OpRec[] => logOf(c).filter((r) => r.kind === 'text')

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
  check('layers.textClear defaults to off', d.layers.textClear === false, `got ${d.layers.textClear}`)
  check('layers.filterAlpha defaults to full strength', d.layers.filterAlpha === 1, `got ${d.layers.filterAlpha}`)
  check('lyrics opacity defaults to fully opaque', d.lyrics.opacity === 1, `got ${d.lyrics.opacity}`)
  check('background shade defaults to 0% (images show at full brightness)', d.background.shade === 0, `got ${d.background.shade}`)
  check('halftone Print only defaults to off (classic print)', d.halftoneFilter.printOnly === false, `got ${d.halftoneFilter.printOnly}`)
  check('halftone backdrop defaults to white paper', d.halftoneFilter.backdropColor === '#ffffff', `got ${d.halftoneFilter.backdropColor}`)
  check('halftone Picture fill defaults to off (classic ink)', d.halftoneFilter.imageFill === false, `got ${d.halftoneFilter.imageFill}`)
  check('halftone backdrop gradient defaults to off', d.halftoneFilter.backdropGradient === false, `got ${d.halftoneFilter.backdropGradient}`)
  check('halftone config no longer carries flipColorLayers', !('flipColorLayers' in d.halftoneFilter), 'legacy key still present')
  check('visualizer flowSpeed defaults to 0.5 (gentle stream)', d.visualizer.flowSpeed === 0.5, `got ${d.visualizer.flowSpeed}`)
  check('visualizer perspMirrorDrop defaults to 0 (hugging reflection)', d.visualizer.perspMirrorDrop === 0, `got ${d.visualizer.perspMirrorDrop}`)
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
  const explicitFalse = { layers: { stayColored: false, textClear: false }, ...oldActive }
  check('an explicit new value always wins over the legacy flag', resolveLayersConfig(explicitFalse).stayColored === false, 'expected false')
  const explicitTrue = { layers: { stayColored: true, textClear: false } }
  check('explicit true carries through', resolveLayersConfig(explicitTrue).stayColored === true, 'expected true')
  check('legacy migration defaults textClear to off', resolveLayersConfig(oldActive).textClear === false, 'expected false')
  const explicitText = { layers: { stayColored: false, textClear: true } }
  check('an explicit textClear carries through', resolveLayersConfig(explicitText).textClear === true, 'expected true')
  const oldSaveWithoutText = { layers: { stayColored: true, textClear: false } }
  check('a save from before textClear existed resolves it to off', resolveLayersConfig(oldSaveWithoutText).textClear === false, 'expected false')
  check('an explicit filterAlpha carries through', resolveLayersConfig({ layers: { filterAlpha: 0.5 } }).filterAlpha === 0.5, 'expected 0.5')
  check('a save without filterAlpha resolves to full strength', resolveLayersConfig({ layers: { stayColored: false } }).filterAlpha === 1, 'expected 1')
  check(
    'out-of-range filterAlpha values clamp into 0..1',
    resolveLayersConfig({ layers: { filterAlpha: 2 } }).filterAlpha === 1 &&
      resolveLayersConfig({ layers: { filterAlpha: -1 } }).filterAlpha === 0,
    'expected clamp',
  )
  check('non-numeric filterAlpha garbage falls back to 1', resolveLayersConfig({ layers: { filterAlpha: 'half' } }).filterAlpha === 1, 'expected 1')
}

/* -------------------- S3 stayColored ON: overlay last, after anaglyph ------------------- */

console.log('S3 stayColored ON — layers ride their own overlay ABOVE the 3D glasses')
{
  const cfg = baseConfig()
  // Warm-up frame (creates the anaglyph work canvases), then measure both modes.
  renderOne({ ...cfg, layers: { stayColored: false, textClear: false, filterAlpha: 1 } })
  const mainFillsOff = fills(main)
  const ov = renderOne({ ...cfg, layers: { stayColored: true, textClear: false, filterAlpha: 1 } })
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
  const ov = renderOne({ ...cfg, layers: { stayColored: false, textClear: false, filterAlpha: 1 } })
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
  renderOne({ ...cfg, layers: { stayColored: true, textClear: false, filterAlpha: 1 } })
  const mainFillsOn = fills(main)
  renderOne({ ...cfg, layers: { stayColored: false, textClear: false, filterAlpha: 1 } })
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
  const ov = renderOne({ ...cfg, layers: { stayColored: true, textClear: false, filterAlpha: 1 } })
  check('no overlay canvas is created on a transparent background', ov === null, `created=${!!ov}`)
  check(
    'the layers drew straight onto the main frame',
    fills(main) >= 24,
    `main fills=${fills(main)}`,
  )
}

/* ------------- S6 textClear: the words skip the filters, the bars don't ------------- */

console.log('S6 text stays legible — words ride the overlay, the bars stay filtered')
{
  const cfg = baseConfig()
  cfg.disc = { ...cfg.disc, enabled: false }
  cfg.lyrics = {
    ...cfg.lyrics,
    enabled: true,
    lines: [{ time: 0, text: 'kick drum' }],
  }
  cfg.title = { ...cfg.title, enabled: true, text: 'TITLE CARD' }
  cfg.watermark = { ...cfg.watermark, enabled: true, text: '@channel' }

  // Classic path for reference: text paints straight onto the main frame.
  renderOne({ ...cfg, layers: { stayColored: false, textClear: false, filterAlpha: 1 } })
  const classicTextOnMain = texts(main).length
  check(
    'classic path: the words paint straight onto the main frame',
    classicTextOnMain >= 3,
    `main text ops=${classicTextOnMain}`,
  )

  renderOne({ ...cfg, layers: { stayColored: false, textClear: true, filterAlpha: 1 } })
  // getWork REUSES its canvas across frames, so the overlay is identified by
  // what it drew THIS frame (its log), not by creation order.
  const ov = created.find((c) => texts(c).length >= 3) ?? null
  const mainDraws = draws(main)
  check(
    'the words moved onto a work overlay (lyrics + title + watermark glyphs)',
    !!ov && texts(ov).length >= 3,
    `overlay text ops=${ov ? texts(ov).length : 'n/a'}`,
  )
  check(
    'the main frame lost every text op (nothing for the filters to mangle)',
    texts(main).length === 0,
    `main text ops=${texts(main).length}`,
  )
  check(
    'the bars still paint onto the main frame (they take the filtered look)',
    fills(main) >= 24,
    `main fills=${fills(main)}`,
  )
  const last = mainDraws[mainDraws.length - 1]
  check(
    'the overlay draw is the VERY LAST pass on the frame (after the 3D glasses)',
    last && last.src === ov,
    `last=${JSON.stringify(last)}`,
  )
  check(
    'the glasses ran BEFORE the text came back (they texture the background + bars only)',
    mainDraws.some((d) => d.src !== ov) && mainDraws.findIndex((d) => d.src === ov) > 0,
    `main draws=${mainDraws.length}`,
  )

  // stayColored wins when both are on: same all-lifting overlay path.
  renderOne({ ...cfg, layers: { stayColored: true, textClear: true, filterAlpha: 1 } })
  const ovBoth = created.find((c) => fills(c) >= 24 && texts(c).length >= 3) ?? null
  check(
    'stayColored ON ignores textClear (one overlay for everything)',
    !!ovBoth && fills(main) === 0,
    `ov fills=${ovBoth ? fills(ovBoth) : 'n/a'} ov text=${ovBoth ? texts(ovBoth) : 'n/a'} main fills=${fills(main)}`,
  )

  // Toggling textClear back off restores the classic layout exactly.
  renderOne({ ...cfg, layers: { stayColored: false, textClear: false, filterAlpha: 1 } })
  check(
    'turning textClear back off restores the classic layout exactly',
    fills(main) >= 24 && texts(main).length === classicTextOnMain,
    `main fills=${fills(main)} text=${texts(main).length} (was ${classicTextOnMain})`,
  )
}

/* --------------------------- S7 lyrics opacity --------------------------- */

console.log('S7 lyrics opacity — one dial scales the whole text layer')
{
  const lyricsBase = {
    ...structuredClone(DEFAULT_STUDIO_CONFIG.lyrics),
    enabled: true,
    lines: [{ time: 0, text: 'half seen' }],
  }
  // A mid-song frame: the single line sits in its main slot at alpha 1
  // (fade-in done, auto-hide far away), so each recorded alpha IS the
  // layer opacity.
  const t = 0.5
  const lyricsRc = (canvas: HTMLCanvasElement): RenderContext => {
    const ctx = (canvas as unknown as { getContext: () => CanvasRenderingContext2D }).getContext()
    return { ctx, width: W, height: H } as unknown as RenderContext
  }
  const drawWith = (opacity: number | undefined): OpRec[] => {
    const c = makeCanvas()
    // Omit the field entirely for the legacy-config check — the ?? 1
    // fallback is what keeps raw old configs fully opaque.
    const lyr = (
      opacity === undefined
        ? (() => {
            const { opacity: _omit, ...rest } = lyricsBase
            return rest
          })()
        : { ...lyricsBase, opacity }
    ) as typeof lyricsBase
    drawLyrics(lyricsRc(c), frameAt(t), lyr, structuredClone(DEFAULT_STUDIO_CONFIG.visualizer.gradient))
    return texts(c)
  }

  const full = drawWith(1)
  check('opacity 100% draws the line at full alpha', full.length === 1 && full[0].alpha === 1, `n=${full.length} alpha=${full[0]?.alpha}`)
  const half = drawWith(0.5)
  check(
    'opacity 50% scales the glyph pass to exactly half',
    half.length === 1 && half[0].alpha === 0.5,
    `alpha=${half[0]?.alpha}`,
  )
  const quarterGlow = drawWith(0.25)
  check(
    'a quarter-strength layer still draws exactly one glyph pass (no double-dim)',
    quarterGlow.length === 1 && quarterGlow[0].alpha === 0.25,
    `n=${quarterGlow.length} alpha=${quarterGlow[0]?.alpha}`,
  )
  const zero = drawWith(0)
  check('opacity 0 short-circuits the whole layer (no ops at all)', zero.length === 0, `n=${zero.length}`)
  const legacy = drawWith(undefined)
  check('a raw config without the opacity field stays fully opaque', legacy.length === 1 && legacy[0].alpha === 1, `alpha=${legacy[0]?.alpha}`)

  // Through the full pipeline: an invisible lyric layer leaves zero text ops.
  const cfg = baseConfig()
  cfg.lyrics = { ...lyricsBase, opacity: 0 }
  renderOne(cfg)
  check('opacity 0 through renderFrame leaves the frame text-free', texts(main).length === 0, `main text ops=${texts(main).length}`)
}

/* ------------------------- S8 filter alpha (the chain dial) ------------------------- */

console.log('S8 filter alpha — one dial fades the whole filter chain')
{
  const cfg = baseConfig()
  const layersOf = (filterAlpha?: number) =>
    (filterAlpha === undefined
      ? { stayColored: false, textClear: false }
      : { stayColored: false, textClear: false, filterAlpha }) as typeof cfg.layers

  // Baseline: the classic path is exactly one anaglyph composite draw.
  renderOne({ ...cfg, layers: layersOf(1) })
  const classicDraws = draws(main).length

  // Alpha 100%: byte-identical classic path — no snapshot canvas, no extra
  // pass, nothing to identify.
  const ov100 = renderOne({ ...cfg, layers: layersOf(1) })
  check('alpha 100% creates no snapshot canvas', ov100 === null, `created=${!!ov100}`)
  check(
    'alpha 100% draws exactly the classic frame (no fade pass)',
    draws(main).length === classicDraws,
    `draws=${draws(main).length} classic=${classicDraws}`,
  )

  // Alpha 50%: one extra pass, LAST on the frame, at exactly 1 − alpha.
  // (First 0.5 frame warms up the snapshot work canvas; the second measures.)
  renderOne({ ...cfg, layers: layersOf(0.5) })
  renderOne({ ...cfg, layers: layersOf(0.5) })
  const draws50 = draws(main)
  const last50 = draws50[draws50.length - 1]
  check(
    'alpha 50% adds exactly one extra pass to the frame',
    draws50.length === classicDraws + 1,
    `draws=${draws50.length} classic=${classicDraws}`,
  )
  check('the fade pass draws at exactly 1 − alpha', !!last50 && last50.alpha === 0.5, `alpha=${last50?.alpha}`)
  // The fade's source canvas must be the pre-filter snapshot: a canvas whose
  // ENTIRE content this frame is a single draw of the main frame (taken
  // before the chain ran). Filter work canvases draw the frame too, but they
  // log more than one op — only the alpha snapshot is a lone main copy.
  const snap = (last50?.src ?? null) as HTMLCanvasElement | null
  const snapLog = snap ? logOf(snap) : []
  // Cycle-safe op description (op.src canvases reference logs reference ops).
  const srcName = (d?: OpRec): string =>
    !d ? 'none' : d.src === main ? 'main' : d.src === snap ? 'snapshot' : 'other-canvas'
  check(
    'the fade pass carries the pre-filter snapshot of the unfiltered frame',
    !!snap && snapLog.length === 1 && snapLog[0].kind === 'draw' && snapLog[0].src === main,
    `snap ops=${snapLog.length} kind=${snapLog[0]?.kind} srcIsMain=${snapLog[0]?.src === main}`,
  )
  check('the fade pass draws that snapshot back over the chain', !!snap && last50.src === snap, `last=${srcName(last50)} α=${last50?.alpha}`)

  // Alpha 0: the unfiltered snapshot covers the chain at full strength.
  renderOne({ ...cfg, layers: layersOf(0) })
  const draws0 = draws(main)
  check(
    'alpha 0 hides every filter with one full-strength fade pass',
    draws0.length === classicDraws + 1 && draws0[draws0.length - 1].alpha === 1,
    `draws=${draws0.length} last=${srcName(draws0[draws0.length - 1])} α=${draws0[draws0.length - 1]?.alpha}`,
  )

  // With the text overlay up, the fade sits UNDER the words (overlay last).
  renderOne({ ...cfg, layers: { stayColored: false, textClear: true, filterAlpha: 0.5 } })
  const drawsT = draws(main)
  const fadeIdx = drawsT.findIndex((d) => d.alpha === 0.5)
  check(
    'with textClear on, the alpha fade sits under the text overlay',
    fadeIdx >= 0 && fadeIdx < drawsT.length - 1,
    `fadeIdx=${fadeIdx} last=${srcName(drawsT[drawsT.length - 1])} α=${drawsT[drawsT.length - 1]?.alpha}`,
  )

  // Transparent backgrounds: the dial is inert (the filters don't run).
  const cfgT = { ...cfg, background: { ...cfg.background, mode: 'transparent' as const } }
  renderOne({ ...cfgT, layers: layersOf(1) })
  const transparentDraws = draws(main).length
  renderOne({ ...cfgT, layers: layersOf(0.5) })
  check(
    'transparent backgrounds skip the alpha pass entirely',
    draws(main).length === transparentDraws,
    `draws=${draws(main).length} baseline=${transparentDraws}`,
  )

  // A raw config without the field (older save) stays full strength.
  renderOne({ ...cfg, layers: layersOf(undefined) })
  check(
    'a raw config without filterAlpha renders the classic path',
    draws(main).length === classicDraws,
    `draws=${draws(main).length} classic=${classicDraws}`,
  )
}

/* --------------------- S9 visualizer transparency ------------------------- */

console.log('S9 visualizer transparency — one dial fades the whole bars layer')
{
  const cfg = baseConfig()
  const vizOf = (transparency?: number): typeof cfg.visualizer => {
    const base = structuredClone(DEFAULT_STUDIO_CONFIG.visualizer)
    if (transparency === undefined) {
      // Omit the field entirely for the legacy-config check — the ?? fallback
      // is what keeps raw old configs fully solid.
      const { transparency: _omit, ...rest } = base
      return rest as typeof cfg.visualizer
    }
    return { ...base, transparency }
  }
  // 'fill' ops on the main frame = the bars (background grain is frect-only,
  // the filters drawImage-only) — each record carries its globalAlpha.
  const fillAlphas = (): Set<number> =>
    new Set(logOf(main).filter((r) => r.kind === 'fill').map((r) => r.alpha))

  // Factory default: fully solid.
  check(
    'visualizer transparency defaults to 0 (fully solid)',
    DEFAULT_STUDIO_CONFIG.visualizer.transparency === 0,
    `got ${DEFAULT_STUDIO_CONFIG.visualizer.transparency}`,
  )

  // Classic path: every bar pass at alpha 1, path unchanged.
  renderOne({ ...cfg, visualizer: vizOf(0) })
  const classicFills = fills(main)
  const classicAlphas = fillAlphas()
  check(
    'transparency 0 paints the bars at full alpha (classic path)',
    classicFills >= 24 && classicAlphas.size === 1 && classicAlphas.has(1),
    `fills=${classicFills} alphas=${[...classicAlphas].join(',')}`,
  )

  // Half fade: the same passes, every alpha scaled to exactly 0.5.
  renderOne({ ...cfg, visualizer: vizOf(0.5) })
  const halfAlphas = fillAlphas()
  check(
    'transparency 50% scales every bar pass to exactly half',
    fills(main) === classicFills && halfAlphas.size === 1 && halfAlphas.has(0.5),
    `fills=${fills(main)} alphas=${[...halfAlphas].join(',')}`,
  )

  // Fully transparent: the layer short-circuits (zero bar ops).
  renderOne({ ...cfg, visualizer: vizOf(1) })
  check('transparency 100% skips the whole layer (no bar fills)', fills(main) === 0, `fills=${fills(main)}`)

  // The dial only touches the visualizer: the words stay full alpha.
  const cfgL = {
    ...cfg,
    visualizer: vizOf(0.5),
    lyrics: {
      ...structuredClone(DEFAULT_STUDIO_CONFIG.lyrics),
      enabled: true,
      lines: [{ time: 0, text: 'solid words' }],
    },
  }
  renderOne(cfgL)
  const textAlphas = new Set(texts(main).map((r) => r.alpha))
  check(
    'the dial never touches the text overlays (words stay full alpha)',
    texts(main).length >= 1 && textAlphas.size === 1 && textAlphas.has(1),
    `text=${texts(main).length} alphas=${[...textAlphas].join(',')}`,
  )

  // Radial: the inner ring pass pins its OWN globalAlpha — the center dot
  // must fill at exactly the layer alpha (0.5), and keep the classic 1 at 0.
  renderOne({ ...cfg, visualizer: { ...vizOf(0.5), style: 'radial' as const } })
  check(
    'radial center dot fills at exactly the layer alpha (0.5)',
    fillAlphas().has(0.5),
    `alphas=${[...fillAlphas()].join(',')}`,
  )
  renderOne({ ...cfg, visualizer: { ...vizOf(0), style: 'radial' as const } })
  check(
    'radial at transparency 0 keeps the classic alpha (dot at 1)',
    fillAlphas().has(1),
    `alphas=${[...fillAlphas()].join(',')}`,
  )

  // Grid: the frontier-dot fade multiplies ITS OWN coverage alpha by the
  // layer alpha — needs a loud frame (empty columns are skipped).
  const loud = { ...frameAt(0.5), freq: Float32Array.from({ length: 64 }, (_, i) => 0.5 + (i % 8) / 20) }
  for (const c of [main, ...created]) logOf(c).length = 0
  renderFrame(rc, loud, { ...cfg, visualizer: { ...vizOf(0.5), style: 'grid' as const, glow: false } })
  const gridFills = logOf(main).filter((r) => r.kind === 'fill')
  const gridAlphas = gridFills.map((r) => r.alpha)
  check(
    'grid dots compound coverage × layer alpha (full at 0.5, frontier below)',
    gridFills.length > 0 &&
      gridAlphas.every((a) => a <= 0.5 + 1e-9) &&
      gridAlphas.some((a) => a === 0.5) &&
      gridAlphas.some((a) => a < 0.5),
    `n=${gridFills.length} alphas=${[...new Set(gridAlphas)].slice(0, 6).join(',')}`,
  )

  // A raw config without the field (older save) stays fully solid.
  renderOne({ ...cfg, visualizer: vizOf(undefined) })
  const legacyAlphas = fillAlphas()
  check(
    'a raw config without the transparency field renders fully solid',
    fills(main) === classicFills && legacyAlphas.size === 1 && legacyAlphas.has(1),
    `fills=${fills(main)} alphas=${[...legacyAlphas].join(',')}`,
  )
}

/* --------------------- S10 halftone Print only (poster) ------------------- */

console.log('S10 halftone Print only — the picture hides, the print stays')
{
  // Print-only rig: halftone ON, everything else factory. The 3D glasses
  // stay off so the created-canvas scans below only ever see halftone works.
  const cfg10 = baseConfig()
  cfg10.anaglyphFilter = { ...cfg10.anaglyphFilter, enabled: false }
  cfg10.halftoneFilter = { ...cfg10.halftoneFilter, enabled: true, strength: 0.9 }

  const frects = (c: HTMLCanvasElement): OpRec[] => logOf(c).filter((r) => r.kind === 'frect')
  const lastOf = (ops: OpRec[]): OpRec | undefined => ops[ops.length - 1]

  // Classic print (Print only off): the screen samples the LIVE frame and
  // main carries the baseline op counts everything below is measured against.
  const markClassic = created.length
  renderOne({ ...cfg10 })
  const sampleCanvas = created
    .slice(markClassic)
    .find((c) => draws(c).length === 1 && draws(c)[0].src === main)
  const classicFrects = frects(main).length
  const classicDraws = draws(main).length
  check(
    'classic print samples the live frame',
    !!sampleCanvas,
    'no work canvas drew the live frame',
  )
  check(
    'classic print paints no backdrop (baseline counts captured)',
    classicFrects > 0 && classicDraws > 0 && lastOf(draws(main))?.alpha === 0.9,
    `frects=${classicFrects} draws=${classicDraws} lastα=${lastOf(draws(main))?.alpha}`,
  )

  // Print only: the picture is snapshotted BEFORE the backdrop floods the
  // frame, and the screen now reads that snapshot — the dots keep following
  // the hidden picture.
  const markSolo = created.length
  renderOne({ ...cfg10, halftoneFilter: { ...cfg10.halftoneFilter, printOnly: true } })
  const soloCanvas = created
    .slice(markSolo)
    .find((c) => draws(c).length === 1 && draws(c)[0].src === main)
  check(
    'print only snapshots the picture before hiding it',
    !!soloCanvas,
    'no snapshot canvas drew the live frame',
  )
  check(
    'the screen reads the hidden snapshot (dots still follow the picture)',
    !!soloCanvas && !!sampleCanvas && draws(sampleCanvas).length === 1 && draws(sampleCanvas)[0].src === soloCanvas,
    `sample drew ${draws(sampleCanvas ?? main).length} op(s), src=${String(draws(sampleCanvas ?? main)[0]?.src)}`,
  )

  // The backdrop: exactly one extra full-frame fill on main, at full alpha,
  // in the default white paper color — with the ink landing on top of it.
  check(
    'print only floods the frame with one backdrop fill at full alpha',
    frects(main).length === classicFrects + 1 && lastOf(frects(main))?.alpha === 1,
    `frects=${frects(main).length} vs ${classicFrects} lastα=${lastOf(frects(main))?.alpha}`,
  )
  check(
    'the default backdrop fill is the white paper color',
    lastOf(frects(main))?.style === '#ffffff',
    `style=${String(lastOf(frects(main))?.style)}`,
  )
  check(
    'the ink still lands on top of the backdrop',
    draws(main).length === classicDraws && lastOf(draws(main))?.alpha === 0.9,
    `draws=${draws(main).length} vs ${classicDraws} lastα=${lastOf(draws(main))?.alpha}`,
  )

  // Gradient backdrop: the fill's style is a gradient carrying BOTH colors.
  renderOne({
    ...cfg10,
    halftoneFilter: {
      ...cfg10.halftoneFilter,
      printOnly: true,
      backdropGradient: true,
      backdropColor: '#ff0044',
      backdropColor2: '#ffcc00',
    },
  })
  const gradStyle = lastOf(frects(main))?.style as { stops?: Array<[number, string]> } | undefined
  check(
    'the backdrop gradient paints with both dialed colors',
    frects(main).length === classicFrects + 1 &&
      !!gradStyle &&
      typeof gradStyle === 'object' &&
      JSON.stringify(gradStyle.stops) === JSON.stringify([[0, '#ff0044'], [1, '#ffcc00']]),
    `stops=${JSON.stringify(gradStyle?.stops)}`,
  )

  // Grayscale + print only: the conditioning shapes the HIDDEN snapshot
  // (what the screen reads), never the visible backdrop frame.
  const markCond = created.length
  renderOne({
    ...cfg10,
    halftoneFilter: { ...cfg10.halftoneFilter, printOnly: true, grayscale: true },
  })
  const condCanvas = created
    .slice(markCond)
    .find((c) => draws(c).length === 1 && draws(c)[0].src === soloCanvas)
  check(
    'grayscale conditions the hidden snapshot, not the visible frame',
    !!condCanvas &&
      !!soloCanvas &&
      draws(soloCanvas).length === 2 &&
      draws(soloCanvas)[1].src === condCanvas &&
      draws(main).length === classicDraws,
    `cond=${!!condCanvas} soloOps=${soloCanvas ? draws(soloCanvas).length : 'n/a'} mainDraws=${draws(main).length}`,
  )

  // Flip on kick, print direction, at rest (no kick fired): the bare
  // backdrop IS the frame — the print only exists while a kick holds it.
  renderOne({
    ...cfg10,
    halftoneFilter: {
      ...cfg10.halftoneFilter,
      printOnly: true,
      beatFlip: true,
      beatFlipTo: 'print',
    },
  })
  check(
    'print-direction rest shows the bare backdrop (no ink draw)',
    frects(main).length === classicFrects + 1 &&
      lastOf(frects(main))?.style === '#ffffff' &&
      draws(main).length === classicDraws - 1,
    `frects=${frects(main).length} draws=${draws(main).length} vs ${classicFrects}/${classicDraws}`,
  )

  // A raw config from before Print only existed prints over the picture
  // exactly like the classic path (no snapshot, no backdrop, live screen).
  const legacyCfg = structuredClone(cfg10) as StudioConfig
  const lf = legacyCfg.halftoneFilter as unknown as Record<string, unknown>
  delete lf.printOnly
  delete lf.backdropColor
  delete lf.backdropGradient
  delete lf.backdropColor2
  delete lf.backdropMotion
  renderOne(legacyCfg)
  check(
    'a raw config without the printOnly fields prints over the picture (classic)',
    frects(main).length === classicFrects &&
      draws(main).length === classicDraws &&
      lastOf(draws(main))?.alpha === 0.9,
    `frects=${frects(main).length} draws=${draws(main).length}`,
  )
  check(
    'the legacy screen samples the live frame again',
    !!sampleCanvas && draws(sampleCanvas).length === 1 && draws(sampleCanvas)[0].src === main,
    `sample src=${String(draws(sampleCanvas ?? main)[0]?.src)}`,
  )
}

/* ------------------ S11 halftone ink fills (picture / gradient) ------------------ */

console.log('S11 halftone ink fills — the picture or the gradient inside the dots')
{
  const cfg11 = baseConfig()
  cfg11.anaglyphFilter = { ...cfg11.anaglyphFilter, enabled: false }
  cfg11.halftoneFilter = { ...cfg11.halftoneFilter, enabled: true, strength: 0.9 }

  const frects = (c: HTMLCanvasElement): OpRec[] => logOf(c).filter((r) => r.kind === 'frect')
  const pimgs = (c: HTMLCanvasElement): OpRec[] => logOf(c).filter((r) => r.kind === 'pimg')
  const lastOf = (ops: OpRec[]): OpRec | undefined => ops[ops.length - 1]

  // The ink canvas is the one that receives the full-frame putImageData.
  const inkCanvasOf = (): HTMLCanvasElement | undefined =>
    created.find((c) =>
      pimgs(c).some((r) => {
        const img = r.style as { data?: Uint8ClampedArray } | undefined
        return !!img && img.data instanceof Uint8ClampedArray && img.data.length === W * H * 4
      }),
    )
  const inkImgOf = (c: HTMLCanvasElement | undefined): { data: Uint8ClampedArray } | undefined => {
    const rec0 = c && pimgs(c)[0]
    return rec0 ? (rec0.style as { data: Uint8ClampedArray }) : undefined
  }

  // Census over the stamped ink: printed pixels split into the grid's red
  // family, blue family, and pure black (the classic factory ink).
  const census = (img: { data: Uint8ClampedArray } | undefined) => {
    let inked = 0
    let red = 0
    let blue = 0
    let black = 0
    if (!img) return { inked, red, blue, black }
    const d = img.data
    for (let p = 0; p < W * H; p++) {
      if (d[p * 4 + 3] === 0) continue
      inked++
      const r = d[p * 4]
      const b = d[p * 4 + 2]
      if (r === 0 && d[p * 4 + 1] === 0 && b === 0) black++
      else if (r > b) red++
      else if (b > r) blue++
    }
    return { inked, red, blue, black }
  }

  // Feed the sampler a colored grid: left half red, right half blue, every
  // cell fully opaque — matching the default mock's behavior (nothing is
  // skipped), so op counts stay comparable to the earlier blocks.
  const feedGrid = (c: HTMLCanvasElement) => {
    const b = baseOf.get(c)
    if (!b) throw new Error('S11: no method table for the sample canvas')
    b.getImageData = (
      _x: number,
      _y: number,
      w: number,
      h: number,
    ) => {
      const data = new Uint8ClampedArray(w * h * 4)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4
          if (x < w / 2) {
            data[p] = 220
            data[p + 1] = 30
            data[p + 2] = 40
          } else {
            data[p] = 30
            data[p + 1] = 60
            data[p + 2] = 220
          }
          data[p + 3] = 255
        }
      }
      return { data, width: w, height: h }
    }
  }

  // Classic print first: identify the sample canvas (it draws the live
  // frame), then retarget its getImageData for every check below.
  renderOne({ ...cfg11 })
  const sample11 = created.find((c) => draws(c).length === 1 && draws(c)[0].src === main)
  if (!sample11) throw new Error('S11: sample canvas not found')
  feedGrid(sample11)

  // 1) Classic ink: the buffer's printed pixels stay BLACK — no picture
  //    colors leak in, no recolor at the factory black. The frame op
  //    baseline is captured here so the fill blocks can prove the poster
  //    runs (one extra backdrop fill) even with Print only off.
  renderOne({ ...cfg11 })
  const c1 = census(inkImgOf(inkCanvasOf()))
  check(
    'classic ink prints black dots (no picture colors in the buffer)',
    c1.inked > 0 && c1.black === c1.inked && c1.red === 0 && c1.blue === 0,
    `inked=${c1.inked} black=${c1.black} red=${c1.red} blue=${c1.blue}`,
  )
  const classicFrects11 = frects(main).length
  const classicDraws11 = draws(main).length

  // 2) Picture fill: the same dots now carry the grid's own colors — both
  //    color families stamped, zero black, and the recolor pass skipped.
  //    AND the fill prints poster-style ON ITS OWN (Print only off): the
  //    picture is snapshotted, the screen reads that snapshot, and the
  //    frame is flooded with the white backdrop before the ink lands —
  //    never dots layered over the image. ('ht:solo' may already exist
  //    from S10 — the work-canvas cache reuses it — so the snapshot is
  //    identified by what it drew THIS frame, not by creation order.)
  renderOne({ ...cfg11, halftoneFilter: { ...cfg11.halftoneFilter, imageFill: true } })
  const solo11 = created.find((c) => draws(c).length === 1 && draws(c)[0].src === main)
  const inkCanvas2 = inkCanvasOf()
  const c2 = census(inkImgOf(inkCanvas2))
  check(
    'Picture fill stamps the picture colors inside the dots',
    c2.inked > 0 && c2.red > 0 && c2.blue > 0 && c2.black === 0,
    `inked=${c2.inked} red=${c2.red} blue=${c2.blue} black=${c2.black}`,
  )
  check(
    'Picture fill skips the ink recolor pass',
    !!inkCanvas2 && !frects(inkCanvas2).some((r) => r.op === 'source-in'),
    'source-in recolor ran',
  )
  check(
    'Picture fill without Print only hides the picture (snapshot taken)',
    !!solo11,
    'no snapshot canvas drew the live frame',
  )
  check(
    'Picture fill reads the hidden snapshot, not the live frame',
    !!solo11 && draws(sample11).length === 1 && draws(sample11)[0].src === solo11,
    `sample src=${String(draws(sample11 ?? main)[0]?.src)}`,
  )
  check(
    'Picture fill floods the frame with one white backdrop fill (poster)',
    frects(main).length === classicFrects11 + 1 &&
      lastOf(frects(main))?.alpha === 1 &&
      lastOf(frects(main))?.style === '#ffffff',
    `frects=${frects(main).length} vs ${classicFrects11} last=${JSON.stringify(lastOf(frects(main)))}`,
  )
  check(
    'Picture fill still lands the ink on top of the backdrop',
    draws(main).length === classicDraws11 && lastOf(draws(main))?.alpha === 0.9,
    `draws=${draws(main).length} vs ${classicDraws11} lastα=${lastOf(draws(main))?.alpha}`,
  )

  // 3) Picture fill WINS over the gradient + a custom ink color: same
  //    picture colors, still no recolor.
  renderOne({
    ...cfg11,
    halftoneFilter: {
      ...cfg11.halftoneFilter,
      imageFill: true,
      gradient: true,
      inkColor: '#ff8800',
      inkColor2: '#00ff88',
    },
  })
  const c3 = census(inkImgOf(inkCanvasOf()))
  check(
    'Picture fill wins over gradient and ink color (colors still the picture)',
    c3.inked > 0 && c3.red > 0 && c3.blue > 0 && c3.black === 0,
    `inked=${c3.inked} red=${c3.red} blue=${c3.blue} black=${c3.black}`,
  )

  // 4) Gradient fill (Picture fill off): the recolor pass runs with both
  //    dialed stops — AND the gradient is a poster fill too: with Print
  //    only off the backdrop still floods before the ink lands.
  renderOne({
    ...cfg11,
    halftoneFilter: {
      ...cfg11.halftoneFilter,
      imageFill: false,
      gradient: true,
      inkColor: '#114422',
      inkColor2: '#55aa88',
    },
  })
  const inkCanvas4 = inkCanvasOf()
  const gradFrect = inkCanvas4 && frects(inkCanvas4).find((r) => r.op === 'source-in')
  const gradStyle = gradFrect?.style as { stops?: Array<[number, string]> } | undefined
  check(
    'gradient ink still recolors through source-in with both stops',
    !!gradStyle &&
      JSON.stringify(gradStyle.stops) === JSON.stringify([[0, '#114422'], [1, '#55aa88']]),
    `stops=${JSON.stringify(gradStyle?.stops)}`,
  )
  check(
    'Gradient fill without Print only floods the poster backdrop too',
    frects(main).length === classicFrects11 + 1 && lastOf(frects(main))?.style === '#ffffff',
    `frects=${frects(main).length} vs ${classicFrects11} style=${String(lastOf(frects(main))?.style)}`,
  )

  // 5) Print only + Picture fill: the poster keeps its white backdrop AND
  //    the dots carry the hidden picture's colors (the toggle changes
  //    nothing about the fill — it already printed this way on its own).
  renderOne({
    ...cfg11,
    halftoneFilter: { ...cfg11.halftoneFilter, printOnly: true, imageFill: true },
  })
  const c5 = census(inkImgOf(inkCanvasOf()))
  check(
    'Print only + Picture fill = colored dots on the paper backdrop',
    c5.inked > 0 && c5.red > 0 && c5.blue > 0 && c5.black === 0,
    `inked=${c5.inked} red=${c5.red} blue=${c5.blue} black=${c5.black}`,
  )

  // 6) A raw config without imageFill (older save) prints black ink again.
  const legacy11 = structuredClone(cfg11) as StudioConfig
  delete (legacy11.halftoneFilter as unknown as Record<string, unknown>).imageFill
  renderOne(legacy11)
  const c6 = census(inkImgOf(inkCanvasOf()))
  check(
    'a raw config without imageFill prints classic black ink',
    c6.inked > 0 && c6.black === c6.inked && c6.red === 0 && c6.blue === 0,
    `inked=${c6.inked} black=${c6.black} red=${c6.red} blue=${c6.blue}`,
  )
}

/* --------------------- S12 ribbon visualizer ------------------------------- */

console.log('S12 ribbon — the layered glow-wave visualizer')
{
  const fillAlphas = (): Set<number> =>
    new Set(logOf(main).filter((r) => r.kind === 'fill').map((r) => r.alpha))
  const frects = (c: HTMLCanvasElement): OpRec[] => logOf(c).filter((r) => r.kind === 'frect')

  // A clean config: factory defaults, ribbon selected, no filters distorting
  // the op census.
  const cfgR = structuredClone(DEFAULT_STUDIO_CONFIG)
  cfgR.visualizer = { ...structuredClone(DEFAULT_STUDIO_CONFIG.visualizer), style: 'ribbon' as const, glow: false }

  // Warm-up: the recording stub's save/restore are no-ops, so a leftover
  // globalAlpha from an earlier section leaks into the next render's
  // un-alphaed passes (real canvases restore through save/restore). One
  // throwaway render settles the stub state (drawRibbon pins alpha back to 1
  // at its end) before anything is measured.
  renderOne(structuredClone(cfgR), 1.25)

  // 1) Deterministic: the same frozen frame renders the identical op stream.
  const first = renderOne(structuredClone(cfgR), 1.25)
  const logA = JSON.stringify(logOf(main))
  renderOne(structuredClone(cfgR), 1.25)
  const logB = JSON.stringify(logOf(main))
  check(
    'ribbon renders deterministically (same frame → identical op stream)',
    first === null && logA === logB,
    `match=${logA === logB} lenA=${logA.length} lenB=${logB.length}`,
  )

  // 2) The layer stack paints: 4 wave-layer fills (the filament strokes, and
  //    strokes are not recorded) + nothing else on a solid background.
  const ribbonFills = fills(main)
  const ribbonAlphas = fillAlphas()
  check(
    'ribbon paints the 4 translucent wave layers',
    ribbonFills === 4 && ribbonAlphas.size === 4,
    `fills=${ribbonFills} alphas=${[...ribbonAlphas].join(',')}`,
  )
  const expected = [0.42, 0.55, 0.7, 0.88]
  check(
    'the layer alphas match the factory stack exactly',
    expected.every((a) => ribbonAlphas.has(a)),
    `alphas=${[...ribbonAlphas].join(',')}`,
  )

  // 3) Each layer carries its own drifting color sweep — the gradient
   //    sampling windows differ, so the fills never share one color set.
  const gradStops = logOf(main)
    .filter((r) => r.kind === 'fill')
    .map((r) => JSON.stringify((r.style as { stops?: Array<[number, string]> }).stops ?? []))
  const distinct = new Set(gradStops).size
  check(
    'every layer sweeps its own phase-shifted gradient',
    distinct === 4,
    `distinct=${distinct} of ${gradStops.length}`,
  )

  // 4) Alive in silence: a fully silent frame still paints the full stack
  //    (the idle triple-sine keeps the ribbon dancing).
  const silent = { ...frameAt(0.5), freq: new Float32Array(64), energy: 0, bass: 0, treble: 0, sub: 0 }
  for (const c of [main, ...created]) logOf(c).length = 0
  renderFrame(rc, silent, structuredClone(cfgR))
  check('a silent frame still paints the full ribbon (idle life)', fills(main) === 4, `fills=${fills(main)}`)

  // 5) Glow: the aura arrives as one extra full-band fillRect wash.
  renderOne({ ...structuredClone(cfgR), visualizer: { ...cfgR.visualizer, glow: true } })
  const glowFrects = frects(main).length
  renderOne({ ...structuredClone(cfgR), visualizer: { ...cfgR.visualizer, glow: false } })
  const plainFrects = frects(main).length
  check(
    'glow adds the ambient aura wash (one fillRect), off adds none',
    glowFrects === plainFrects + 1,
    `glow=${glowFrects} plain=${plainFrects}`,
  )

  // 6) The Transparency dial scales every layer uniformly (0.5 → half of
  //    each stack alpha) — the S9 contract extends to the ribbon.
  renderOne({ ...structuredClone(cfgR), visualizer: { ...cfgR.visualizer, transparency: 0.5 } })
  const halfAlphas = fillAlphas()
  check(
    'transparency 50% scales every ribbon layer to exactly half',
    ribbonFills === fills(main) &&
      expected.every((a) => [...halfAlphas].some((b) => Math.abs(b - a * 0.5) < 1e-9)),
    `alphas=${[...halfAlphas].join(',')}`,
  )

  // 7) Mirror variants all render, all deterministic, all full stacks.
  for (const mirror of ['mirror', 'center'] as const) {
    const cfgM = { ...structuredClone(cfgR), visualizer: { ...cfgR.visualizer, mirror } }
    renderOne(cfgM, 0.75)
    const mA = JSON.stringify(logOf(main))
    renderOne(cfgM, 0.75)
    check(
      `mirror ${mirror} renders a full deterministic stack`,
      fills(main) === 4 && mA === JSON.stringify(logOf(main)),
      `fills=${fills(main)} deterministic=${mA === JSON.stringify(logOf(main))}`,
    )
  }

  // 8) Vertical orientation rides the shared strip transform.
  renderOne({ ...structuredClone(cfgR), visualizer: { ...cfgR.visualizer, orientation: 'vertical' } })
  check('vertical orientation renders the full stack', fills(main) === 4, `fills=${fills(main)}`)

  // 9) The other styles are untouched: bars still paints its classic bar
  //    fills (24 bars at alpha 1) — the ribbon dispatch added no drift.
  const cfgBars = structuredClone(DEFAULT_STUDIO_CONFIG)
  cfgBars.visualizer = { ...structuredClone(DEFAULT_STUDIO_CONFIG.visualizer), style: 'bars' as const, glow: false }
  cfgBars.visualizer.barCount = 24
  renderOne(structuredClone(cfgBars))
  check('bars render unchanged (24 fills at full alpha)', fills(main) === 24 && fillAlphas().size === 1 && fillAlphas().has(1), `fills=${fills(main)} alphas=${[...fillAlphas()].join(',')}`)
}

/* --------------------- S13 perspective visualizer --------------------------- */

console.log('S13 perspective — the 3D equalizer road')
{
  const fillAlphas = (): Set<number> =>
    new Set(logOf(main).filter((r) => r.kind === 'fill').map((r) => r.alpha))
  /** Pills are path fills (fillRoundRect → one roundRect each), so the
   *  geometry lives in the fill records' tracked rects. */
  const pillRects = (): Array<{ x: number; y: number; w: number; h: number }> => {
    const out: Array<{ x: number; y: number; w: number; h: number }> = []
    for (const r of logOf(main)) {
      if (r.kind !== 'fill') continue
      for (const q of r.rects ?? []) out.push(q)
    }
    return out
  }

  // A clean config: factory defaults, perspective selected, glow + LED
  // texture + echo off so the fill census stays pure solid pills.
  const cfgH = structuredClone(DEFAULT_STUDIO_CONFIG)
  cfgH.visualizer = {
    ...structuredClone(DEFAULT_STUDIO_CONFIG.visualizer),
    style: 'perspective' as const,
    glow: false,
    barCount: 96, // the road eats slots at half weight → a 48-slot road
    perspEcho: 0,
    perspTexture: 0,
  }

  // Warm-up: settle the recording stub's alpha state (same reason as S12;
  // drawPerspective pins globalAlpha back to la at its end).
  renderOne(structuredClone(cfgH), 1.25)

  // 1) Deterministic: the same frozen frame renders the identical op stream.
  renderOne(structuredClone(cfgH), 1.25)
  const logA = JSON.stringify(logOf(main))
  renderOne(structuredClone(cfgH), 1.25)
  const logB = JSON.stringify(logOf(main))
  check(
    'perspective renders deterministically (same frame → identical op stream)',
    logA === logB,
    `match=${logA === logB} lenA=${logA.length} lenB=${logB.length}`,
  )

  // 2) The road paints a deep stack of pills, every alpha inside (0,1]:
  //    the near field close to full layer alpha, the far texture dimmed by
  //    the perspective depth fade — and plenty of both ends.
  const roadFills = logOf(main).filter((r) => r.kind === 'fill')
  const roadAlphas = [...new Set(roadFills.map((r) => r.alpha))]
  const bright = roadFills.filter((r) => r.alpha >= 0.8).length
  const dim = roadFills.filter((r) => r.alpha <= 0.68).length
  check(
    'the road paints near pills bright and far pills depth-dimmed',
    bright >= 8 && dim >= 8 && roadAlphas.every((a) => a > 0 && a <= 1),
    `bright=${bright} dim=${dim} distinct=${roadAlphas.length}`,
  )

  // 3) Real perspective: the widest visible pill dwarfs the thinnest.
  const widths = pillRects()
    .filter((q) => q.w > 0.5)
    .map((q) => q.w)
  const wMax = widths.length ? Math.max(...widths) : 0
  const wMin = widths.length ? Math.min(...widths) : 0
  check(
    'near pills are an order of magnitude wider than far ones',
    widths.length > 8 && wMax > 8 * wMin,
    `max=${wMax.toFixed(1)} min=${wMin.toFixed(1)} n=${widths.length}`,
  )

  // 4) Both halves anchor on the horizon line (default 50% of 180 = 90).
  const rects = pillRects().filter((q) => q.w > 0.5 && q.h > 1)
  const upAnchored = rects.some((r) => Math.abs(r.y + r.h - 90) < 1e-6)
  const downAnchored = rects.some((r) => Math.abs(r.y - 90) < 1e-6)
  check('up pills stand on the horizon and down pills hang from it', upAnchored && downAnchored, `up=${upAnchored} down=${downAnchored}`)

  // 5) Alive in silence: the idle traveling wave keeps the road breathing.
  const silent = { ...frameAt(0.5), freq: new Float32Array(64), energy: 0, bass: 0, treble: 0, sub: 0 }
  for (const c of [main, ...created]) logOf(c).length = 0
  renderFrame(rc, silent, structuredClone(cfgH))
  const silentBright = logOf(main).filter((r) => r.kind === 'fill' && r.alpha >= 0.8).length
  check('a silent frame still paints the near road (idle wave)', silentBright >= 8, `bright=${silentBright}`)

  // 6) The flow dial moves the road: same frozen frame, flow 0.5 vs 0 —
  //    the phase shift lands the pills somewhere else entirely.
  renderOne({ ...structuredClone(cfgH), visualizer: { ...cfgH.visualizer, flowSpeed: 0.5 } }, 0.5)
  const flowing = JSON.stringify(logOf(main))
  renderOne({ ...structuredClone(cfgH), visualizer: { ...cfgH.visualizer, flowSpeed: 0 } }, 0.5)
  const still = JSON.stringify(logOf(main))
  check('flow speed moves the pills along the road', flowing !== still, `moved=${flowing !== still}`)

  // 7) The Transparency dial scales every pill pass to exactly half — the
  //    S9 contract extends to the road's depth-faded alpha stack.
  renderOne(structuredClone(cfgH), 0.5)
  const baseAlphas = fillAlphas()
  renderOne({ ...structuredClone(cfgH), visualizer: { ...cfgH.visualizer, transparency: 0.5 } })
  const half = fillAlphas()
  check(
    'transparency 50% scales every road pass to exactly half',
    half.size === baseAlphas.size && [...half].every((a) => baseAlphas.has(a * 2)),
    `base=${baseAlphas.size} half=${half.size}`,
  )

  // 8) Bar count densifies the road (the dial feeds it at half weight).
  renderOne({ ...structuredClone(cfgH), visualizer: { ...cfgH.visualizer, barCount: 64 } })
  const few = logOf(main).filter((r) => r.kind === 'fill' && r.alpha >= 0.8).length
  renderOne({ ...structuredClone(cfgH), visualizer: { ...cfgH.visualizer, barCount: 192 } })
  const many = logOf(main).filter((r) => r.kind === 'fill' && r.alpha >= 0.8).length
  check('bar count densifies the road', many > few && few >= 8, `few=${few} many=${many}`)

  // 9) The other styles stay untouched: bars still paints its classic
  //    24-bar fill stack at alpha 1.
  const cfgBars = structuredClone(DEFAULT_STUDIO_CONFIG)
  cfgBars.visualizer = { ...structuredClone(DEFAULT_STUDIO_CONFIG.visualizer), style: 'bars' as const, glow: false }
  cfgBars.visualizer.barCount = 24
  renderOne(structuredClone(cfgBars))
  check('bars render unchanged after the perspective retune (24 fills at full alpha)', fills(main) === 24 && fillAlphas().size === 1 && fillAlphas().has(1), `fills=${fills(main)} alphas=${[...fillAlphas()].join(',')}`)
}

/* ----------------------- S14 terrain visualizer ----------------------------- */

console.log('S14 terrain — the 3D wireframe landscape')
{
  const strokesOf = (): OpRec[] => logOf(main).filter((r) => r.kind === 'stroke')
  const fillsOf = (): OpRec[] => logOf(main).filter((r) => r.kind === 'fill')
  const fillAlphaSet = (): Set<number> => new Set(fillsOf().map((r) => r.alpha))
  /** Full-row polylines: the glow underlays span COLS points, the column
   *  curtains ROWS+1; the crisp ridge lines stroke per 2-point segment. */
  const rowStrokes = (n: number): OpRec[] => strokesOf().filter((r) => (r.pts?.length ?? 0) === n)
  const meanY = (r: OpRec): number => {
    const pts = r.pts ?? []
    return pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length)
  }

  const cfgT = structuredClone(DEFAULT_STUDIO_CONFIG)
  cfgT.visualizer = {
    ...structuredClone(DEFAULT_STUDIO_CONFIG.visualizer),
    style: 'terrain' as const,
    barCount: 64, // the mesh eats slots at 3/4 weight → a 48-column near edge
  }
  const COLS = 48
  const ROWS = 22

  // Warm-up: settle the recording stub's alpha state (same reason as S12/
  // S13; drawTerrain pins globalAlpha back to la at its end).
  renderOne(structuredClone(cfgT), 1.25)

  // 1) Deterministic: the same frozen frame renders the identical op stream
  //    (fills AND stroke polylines — the value-noise field is pure).
  renderOne(structuredClone(cfgT), 1.25)
  const logA = JSON.stringify(logOf(main))
  renderOne(structuredClone(cfgT), 1.25)
  const logB = JSON.stringify(logOf(main))
  check(
    'terrain renders deterministically (same frame → identical op stream)',
    logA === logB,
    `match=${logA === logB} lenA=${logA.length} lenB=${logB.length}`,
  )

  // 2) The solid earth: a deep stack of depth bands, every alpha inside
  //    (0,1], the far bands fog-dimmed to well under the near alpha.
  const bandFills = fillsOf()
  const bandAlphas = bandFills.map((r) => r.alpha)
  check(
    'the earth paints a deep stack of depth bands, fog dims the far ones',
    bandFills.length >= ROWS + 1 &&
      bandAlphas.every((a) => a > 0 && a <= 1) &&
      Math.min(...bandAlphas) < 0.6 * Math.max(...bandAlphas),
    `fills=${bandFills.length} min=${Math.min(...bandAlphas).toFixed(2)} max=${Math.max(...bandAlphas).toFixed(2)}`,
  )

  // 3) True perspective: the curtains' near endpoints overflow the canvas
  //    edges while their far endpoints hug the vanishing corridor.
  const curtains = rowStrokes(ROWS + 1)
  const nearX = curtains.map((r) => Math.abs((r.pts ?? [])[(r.pts?.length ?? 1) - 1].x - W / 2))
  const farX = curtains.map((r) => Math.abs((r.pts ?? [])[0].x - W / 2))
  const converge = Math.max(...nearX) / Math.max(0.5, Math.max(...farX))
  check(
    'columns converge on the vanishing point (near edge dwarfs the far corridor)',
    curtains.length >= 12 && converge > 6,
    `curtains=${curtains.length} converge=${converge.toFixed(1)}`,
  )

  // 4) The rows bunch at the horizon: the last depth step on a curtain is
  //    many times the first one (geometric u steps).
  const bunches = curtains.map((r) => {
    const pts = r.pts ?? []
    const farGap = Math.abs(pts[1].y - pts[0].y)
    const nearGap = Math.abs(pts[pts.length - 1].y - pts[pts.length - 2].y)
    return nearGap / Math.max(0.05, farGap)
  })
  check(
    'depth rows bunch at the horizon (near gaps dwarf the far ones)',
    bunches.length >= 12 && Math.min(...bunches) > 4,
    `curtains=${bunches.length} minBunch=${Math.min(...bunches).toFixed(1)}`,
  )

  // 5) Alive in silence: the idle rolling wave keeps the wireframe drawing.
  const silent = { ...frameAt(0.5), freq: new Float32Array(64), energy: 0, bass: 0, treble: 0, sub: 0 }
  for (const c of [main, ...created]) logOf(c).length = 0
  renderFrame(rc, silent, structuredClone(cfgT))
  const silentRows = rowStrokes(COLS).length
  check('a silent frame still paints the near ridges (idle wave)', silentRows >= 10, `rowStrokes=${silentRows}`)

  // 6) Bass lifts the near hills: the nearest ridge row sits measurably
  //    higher with a loud low end than in silence (same frozen t).
  const loud = {
    ...frameAt(0.5),
    freq: Float32Array.from({ length: 64 }, (_, i) => (i < 8 ? 1 : 0.1)),
    bass: 0.9,
  }
  const silentNear = Math.max(...rowStrokes(COLS).map(meanY))
  for (const c of [main, ...created]) logOf(c).length = 0
  renderFrame(rc, loud, structuredClone(cfgT))
  const loudNear = Math.max(...rowStrokes(COLS).map(meanY))
  check(
    'a loud bass frame lifts the near ridge well above the silent one',
    loudNear < silentNear - 15,
    `loud=${loudNear.toFixed(1)} silent=${silentNear.toFixed(1)}`,
  )

  // 7) The flow dial rolls the terrain: same frozen frame, flow 0.8 vs 0 —
  //    the ridges land somewhere else entirely.
  renderOne({ ...structuredClone(cfgT), visualizer: { ...cfgT.visualizer, flowSpeed: 0.8 } }, 0.5)
  const flowing = JSON.stringify(strokesOf())
  renderOne({ ...structuredClone(cfgT), visualizer: { ...cfgT.visualizer, flowSpeed: 0 } }, 0.5)
  const still = JSON.stringify(strokesOf())
  check('flow speed rolls the hills toward the camera', flowing !== still, `moved=${flowing !== still}`)

  // 8) The Fill dial: 0 = pure wireframe (no earth bands at all), the
  //    default 0.4 paints the full depth stack.
  renderOne({ ...structuredClone(cfgT), visualizer: { ...cfgT.visualizer, terrainFill: 0 } }, 0.5)
  const wireframe = fillsOf().length
  renderOne(structuredClone(cfgT), 0.5)
  const earth = fillsOf().length
  check(
    'fill 0 is the pure wireframe; the default paints the earth bands',
    wireframe === 0 && earth >= ROWS + 1,
    `wireframe=${wireframe} earth=${earth}`,
  )

  // 9) The Transparency dial scales every terrain pass to exactly half —
  //    the S9 contract extends to fills, curtains, glow and ridges alike.
  renderOne(structuredClone(cfgT), 0.5)
  const baseAlphas = new Set([...fillsOf(), ...strokesOf()].map((r) => r.alpha))
  renderOne({ ...structuredClone(cfgT), visualizer: { ...cfgT.visualizer, transparency: 0.5 } }, 0.5)
  const halfSet = new Set([...fillsOf(), ...strokesOf()].map((r) => r.alpha))
  check(
    'transparency 50% scales every terrain pass to exactly half',
    halfSet.size === baseAlphas.size && [...halfSet].every((a) => baseAlphas.has(a * 2)),
    `base=${baseAlphas.size} half=${halfSet.size}`,
  )

  // 10) Bar count densifies the mesh (the dial feeds the columns at 3/4
  //     weight — the ridge segment count scales with it).
  renderOne({ ...structuredClone(cfgT), visualizer: { ...cfgT.visualizer, barCount: 64 } }, 0.5)
  const few = strokesOf().length
  renderOne({ ...structuredClone(cfgT), visualizer: { ...cfgT.visualizer, barCount: 192 } }, 0.5)
  const many = strokesOf().length
  check('bar count densifies the wireframe', many > few && few > 500, `few=${few} many=${many}`)

  // 11) The palette sweeps across the columns: the ridge segments carry the
  //     gradient's colors (sunset: orange → pink → violet).
  renderOne(structuredClone(cfgT), 0.5)
  const ridgeColors = new Set(
    strokesOf()
      .filter((r) => (r.pts?.length ?? 0) === 2)
      .map((r) => String(r.style)),
  )
  check('the palette sweeps across the ridge columns', ridgeColors.size >= 3, `colors=${ridgeColors.size}`)

  // 12) Vertical orientation: the whole landscape rotates into a column —
  //     same op count, every point finite (no NaN leaks from the rotation).
  renderOne(
    { ...structuredClone(cfgT), visualizer: { ...cfgT.visualizer, orientation: 'vertical' as const } },
    0.5,
  )
  const vStrokes = strokesOf()
  const finite = vStrokes.every((r) => (r.pts ?? []).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
  check(
    'vertical orientation rotates the landscape cleanly',
    vStrokes.length > 500 && finite,
    `strokes=${vStrokes.length} finite=${finite}`,
  )

  // 13) The other styles stay untouched: bars still paints its classic
  //     24-bar fill stack at alpha 1 (the stub now logs strokes too, so
  //     this also guards the shared mock against regressions).
  const cfgBars = structuredClone(DEFAULT_STUDIO_CONFIG)
  cfgBars.visualizer = { ...structuredClone(DEFAULT_STUDIO_CONFIG.visualizer), style: 'bars' as const, glow: false }
  cfgBars.visualizer.barCount = 24
  renderOne(structuredClone(cfgBars))
  check(
    'bars render unchanged after adding terrain (24 fills at full alpha)',
    fills(main) === 24 && fillAlphaSet().size === 1 && fillAlphaSet().has(1),
    `fills=${fills(main)} alphas=${[...fillAlphaSet()].join(',')}`,
  )

  // 14) The Mirror family: 'mirror' pulls the range onto a shore and adds
  //     its lake (the 2-pt ridge segments double, the ROWS+1-pt curtain
  //     polylines double into the water too), 'center' grows the symmetric
  //     range (the curtains double there as well).
  renderOne(structuredClone(cfgT), 0.5)
  const segs2 = (): OpRec[] => strokesOf().filter((r) => (r.pts?.length ?? 0) === 2)
  const curtainStrokes = (): OpRec[] => strokesOf().filter((r) => (r.pts?.length ?? 0) === ROWS + 1)
  const baseSegs = segs2().length
  const baseCurtains = curtainStrokes().length
  renderOne({ ...structuredClone(cfgT), visualizer: { ...cfgT.visualizer, mirror: 'mirror' as const } }, 0.5)
  const mirrorSegs = segs2().length
  const mirrorCurtains = curtainStrokes().length
  renderOne({ ...structuredClone(cfgT), visualizer: { ...cfgT.visualizer, mirror: 'center' as const } }, 0.5)
  const centerSegs = segs2().length
  const centerCurtains = curtainStrokes().length
  check(
    'mirror lays the lake (ridge segments and curtains both double)',
    mirrorSegs >= baseSegs * 2 && mirrorCurtains === baseCurtains * 2,
    `segs ${baseSegs}→${mirrorSegs} curtains ${baseCurtains}→${mirrorCurtains}`,
  )
  check(
    'center grows the range both ways (curtains double)',
    centerSegs >= baseSegs * 2 && centerCurtains === baseCurtains * 2,
    `segs ${baseSegs}→${centerSegs} curtains ${baseCurtains}→${centerCurtains}`,
  )

  // 15) Mirror mode is a true lake on its OWN axis: the range is pulled up
  //     onto a shore (a vertical compression about the horizon that ends
  //     the near edge ~72% down the canvas — above the bottom edge, unlike
  //     None mode where the near rows overflow past it) and PINNED there —
  //     the dial slides ONLY the water line. Four invariants are pinned
  //     here: (a) the land NEVER moves with the dial (segment-for-segment
  //     identical at −1, 0 and +1 — the mirror moves on its own axis, the
  //     old rigid world-slide is gone), (b) the reflection is the EXACT
  //     1:1 flip of the land above the line (refl.y + orig.y is one
  //     constant per dial at 0 and +1 — no squash) and the line travels
  //     decisively DOWN at +1, (c) at −1 the line cuts INTO the range —
  //     high water that stops within 5% of the canvas of the highest
  //     ridge, so something dry always remains to reflect — and (d) at 0
  //     the whole flipped lake stays on the canvas (the positive dial may
  //     honestly run the flipped peaks past the bottom edge — a lake
  //     bigger than the frame, like a real shore shot).
  renderOne(
    { ...structuredClone(cfgT), visualizer: { ...cfgT.visualizer, mirror: 'mirror' as const } },
    0.5,
  )
  const orig0 = segs2().filter((_, i) => i % 2 === 0)
  const refl0 = segs2().filter((_, i) => i % 2 === 1)
  const ysOf = (rs: OpRec[]): number[] => rs.flatMap((r) => (r.pts ?? []).map((p) => p.y))
  const samePts = (a: OpRec[], b: OpRec[]): boolean =>
    a.length === b.length &&
    a.every((r, i) => {
      const p = r.pts ?? []
      const q = b[i]?.pts ?? []
      return (
        p.length === q.length &&
        p.every(
          (pt, j) =>
            Math.abs(pt.x - (q[j]?.x ?? 1e9)) < 0.5 && Math.abs(pt.y - (q[j]?.y ?? 1e9)) < 0.5,
        )
      )
    })
  const sumConst = (orig: OpRec[], refl: OpRec[]): number | null => {
    if (orig.length !== refl.length || orig.length === 0) return null
    const sums = orig.map((r, i) => r.pts![0].y + refl[i].pts![0].y)
    return sums.every((s) => Math.abs(s - sums[0]) < 0.5) ? sums[0] : null
  }
  renderOne(
    {
      ...structuredClone(cfgT),
      visualizer: { ...cfgT.visualizer, mirror: 'mirror' as const, terrainMirrorDrop: 1 },
    },
    0.5,
  )
  const orig1 = segs2().filter((_, i) => i % 2 === 0)
  const refl1 = segs2().filter((_, i) => i % 2 === 1)
  renderOne(
    {
      ...structuredClone(cfgT),
      visualizer: { ...cfgT.visualizer, mirror: 'mirror' as const, terrainMirrorDrop: -1 },
    },
    0.5,
  )
  const origFlood = segs2().filter((_, i) => i % 2 === 0)
  const reflFlood = segs2().filter((_, i) => i % 2 === 1)
  const landFixed = samePts(orig0, orig1) && samePts(orig0, origFlood)
  const c0 = sumConst(orig0, refl0)
  const c1 = sumConst(orig1, refl1)
  const landMinY = Math.min(...ysOf(orig0))
  const landMaxY = Math.max(...ysOf(orig0))
  // At −1 the submerged ridges fold flat ON the water line, so the
  // reflection's minimum y IS the raised line.
  const floodMinY = Math.min(...ysOf(reflFlood))
  const refl0MaxY = Math.max(...ysOf(refl0))
  const reflAllMinY = Math.min(...ysOf(refl0), ...ysOf(refl1), ...ysOf(reflFlood))
  check(
    'mirror lake on its own axis: land fixed, exact 1:1 flip, line slides both ways, high water at -1',
    orig0.length > 200 &&
      orig0.length === orig1.length &&
      landFixed &&
      c0 !== null &&
      c1 !== null &&
      Math.abs(c0 / 2 - H * 0.72) < H * 0.01 &&
      c1 > c0 + H * 0.1 &&
      floodMinY > landMinY + 1 &&
      floodMinY < landMaxY &&
      floodMinY - landMinY < H * 0.05 &&
      reflAllMinY > 0 &&
      refl0MaxY <= H + 1 &&
      JSON.stringify(refl0) !== JSON.stringify(refl1),
    `n=${orig0.length} fixed=${landFixed} c0=${c0?.toFixed(1)} c1=${c1?.toFixed(1)} land=[${landMinY.toFixed(1)}..${landMaxY.toFixed(1)}] floodMin=${floodMinY.toFixed(1)} refl0Max=${refl0MaxY.toFixed(1)} H=${H}`,
  )

  // 16) Center mode's dial (Spread) scales the depth of the range's OWN
  //     underside: 0 = the factory blot, negative pulls it shallower,
  //     positive pushes it deeper — monotonic in the underside's mean Y —
  //     and the underside stays the terrain's own hills: different geometry
  //     from the mirror's flipped copy (points compared).
  const centerCfg = { ...structuredClone(cfgT), visualizer: { ...cfgT.visualizer, mirror: 'center' as const } }
  const meanYOf = (rs: OpRec[]): number =>
    rs.reduce((s, r) => s + meanY(r), 0) / Math.max(1, rs.length)
  renderOne(structuredClone(centerCfg), 0.5)
  const cLow0 = segs2().filter((_, i) => i % 2 === 1)
  const cMean0 = meanYOf(cLow0)
  renderOne(
    { ...structuredClone(centerCfg), visualizer: { ...centerCfg.visualizer, terrainMirrorDrop: -1 } },
    0.5,
  )
  const cMeanShallow = meanYOf(segs2().filter((_, i) => i % 2 === 1))
  renderOne(
    { ...structuredClone(centerCfg), visualizer: { ...centerCfg.visualizer, terrainMirrorDrop: 1 } },
    0.5,
  )
  const cLowDeep = segs2().filter((_, i) => i % 2 === 1)
  const cMeanDeep = meanYOf(cLowDeep)
  check(
    'center spread: shallower ← dial → deeper (monotonic underside)',
    cLow0.length > 200 &&
      cLowDeep.length === cLow0.length &&
      cMeanShallow < cMean0 &&
      cMean0 < cMeanDeep,
    `meanY shallow=${cMeanShallow.toFixed(1)} < factory=${cMean0.toFixed(1)} < deep=${cMeanDeep.toFixed(1)}`,
  )
  const ptsOf = (rs: OpRec[]): string => JSON.stringify(rs.map((r) => r.pts))
  renderOne(structuredClone(centerCfg), 0.5)
  const cLowPts = ptsOf(segs2().filter((_, i) => i % 2 === 1))
  renderOne({ ...structuredClone(cfgT), visualizer: { ...cfgT.visualizer, mirror: 'mirror' as const } }, 0.5)
  const mLowPts = ptsOf(segs2().filter((_, i) => i % 2 === 1))
  check(
    'center grows its own underside, not the mirror copy',
    cLowPts !== mLowPts,
    `distinct=${cLowPts !== mLowPts}`,
  )
}

/* ----------------------- S15 sphere visualizer ------------------------------ */

console.log('S15 sphere — the 3D dot-matrix planet')
{
  const strokesOf = (): OpRec[] => logOf(main).filter((r) => r.kind === 'stroke')
  const fillsOf = (): OpRec[] => logOf(main).filter((r) => r.kind === 'fill')
  /** Dot fills carry string fillStyles; the two atmosphere passes fill with
   *  gradient objects, so filtering on the style type isolates the shell. */
  const dotsOf = (): OpRec[] => fillsOf().filter((r) => typeof r.style === 'string')
  const gradientFills = (): OpRec[] => fillsOf().filter((r) => typeof r.style !== 'string')
  const quillsOf = (): OpRec[] => strokesOf().filter((r) => (r.pts?.length ?? 0) === 2)
  const meanDist = (recs: OpRec[]): number => {
    let s = 0
    let c = 0
    for (const r of recs) for (const p of r.pts ?? []) { s += Math.hypot(p.x - W / 2, p.y - H / 2); c++ }
    return c > 0 ? s / c : 0
  }

  const cfgS = structuredClone(DEFAULT_STUDIO_CONFIG)
  cfgS.visualizer = {
    ...structuredClone(DEFAULT_STUDIO_CONFIG.visualizer),
    style: 'sphere' as const,
    barCount: 64, // → a 13-ring × 54-dot planet (812 dots)
  }
  const LAT = 13
  const LON = 54

  // Warm-up: settle the recording stub's alpha state (same reason as S12–
  // S14; drawSphere pins globalAlpha back to la at its end).
  renderOne(structuredClone(cfgS), 1.25)

  // 1) Deterministic: the same frozen frame renders the identical op stream
  //    (the spin, tilt wobble, shimmer and painter's sort are all pure).
  renderOne(structuredClone(cfgS), 1.25)
  const logA = JSON.stringify(logOf(main))
  renderOne(structuredClone(cfgS), 1.25)
  const logB = JSON.stringify(logOf(main))
  check(
    'sphere renders deterministically (same frame → identical op stream)',
    logA === logB,
    `match=${logA === logB} lenA=${logA.length} lenB=${logB.length}`,
  )

  // 2) The full dot shell: every ring × longitude dot paints its quill +
  //    tip dot when the band is loud (a singing frame, all bins hot).
  const singing = { ...frameAt(0.5), freq: Float32Array.from({ length: 64 }, () => 0.8), bass: 0.4 }
  for (const c of [main, ...created]) logOf(c).length = 0
  renderFrame(rc, singing, structuredClone(cfgS))
  check(
    'the planet paints its full lat/lon dot shell + quills',
    dotsOf().length >= LAT * LON && quillsOf().length >= LAT * LON * 0.95,
    `dots=${dotsOf().length} expect>=${LAT * LON} quills=${quillsOf().length}`,
  )

  // 3) Depth shading: the back hemisphere prints well dimmer than the front.
  const dotAlphas = dotsOf().map((r) => r.alpha)
  check(
    'the back hemisphere prints dimmer than the front (depth shading)',
    dotAlphas.every((a) => a > 0 && a <= 1) &&
      Math.min(...dotAlphas) < 0.45 * Math.max(...dotAlphas),
    `min=${Math.min(...dotAlphas).toFixed(2)} max=${Math.max(...dotAlphas).toFixed(2)}`,
  )

  // 4) The palette sweeps pole to pole: the dots carry the gradient's colors
  //    (sunset: orange → pink → violet across the latitude rings).
  const dotColors = new Set(dotsOf().map((r) => String(r.style)))
  check('the palette sweeps across the latitude rings', dotColors.size >= 3, `colors=${dotColors.size}`)

  // 5) Alive in silence: the idle shimmer keeps the shell drawn and quilled.
  const silent = { ...frameAt(0.5), freq: new Float32Array(64), energy: 0, bass: 0, treble: 0, sub: 0 }
  for (const c of [main, ...created]) logOf(c).length = 0
  renderFrame(rc, silent, structuredClone(cfgS))
  check(
    'a silent frame still paints the dot shell + idle quills',
    dotsOf().length >= LAT * LON && quillsOf().length > 100,
    `dots=${dotsOf().length} quills=${quillsOf().length}`,
  )

  // 6) Bass swells the whole shell: the quill geometry rides a measurably
  //    bigger radius with a loud low end than in silence (same frozen t).
  const loud = {
    ...frameAt(0.5),
    freq: Float32Array.from({ length: 64 }, (_, i) => (i < 8 ? 1 : 0.1)),
    bass: 0.9,
  }
  const quietDist = meanDist(quillsOf())
  for (const c of [main, ...created]) logOf(c).length = 0
  renderFrame(rc, loud, structuredClone(cfgS))
  const loudDist = meanDist(quillsOf())
  check(
    'a loud bass frame swells the shell well past the silent one',
    loudDist > quietDist + 2,
    `loud=${loudDist.toFixed(1)} quiet=${quietDist.toFixed(1)}`,
  )

  // 7) The Spin dial turns the planet: same frozen frame, spin 0.9 vs 0 —
  //    the dots (and their quills) land somewhere else entirely.
  renderOne({ ...structuredClone(cfgS), visualizer: { ...cfgS.visualizer, sphereSpin: 0.9 } }, 0.5)
  const spinning = JSON.stringify(quillsOf())
  renderOne({ ...structuredClone(cfgS), visualizer: { ...cfgS.visualizer, sphereSpin: 0 } }, 0.5)
  const still = JSON.stringify(quillsOf())
  check('spin speed turns the planet', spinning !== still, `moved=${spinning !== still}`)

  // 8) The Quills dial: 0 = the smooth shell (no quill strokes at all),
  //    the default 0.6 grows the audio spikes across the shell.
  renderOne({ ...structuredClone(cfgS), visualizer: { ...cfgS.visualizer, sphereQuills: 0 } }, 0.5)
  const smooth = quillsOf().length
  renderOne(structuredClone(cfgS), 0.5)
  check(
    'quills 0 is the smooth shell; the default grows the spikes',
    smooth === 0 && quillsOf().length > 300,
    `smooth=${smooth} quilled=${quillsOf().length}`,
  )

  // 9) The Glow switch: off kills the atmosphere halo, the faint core disc
  //    stays (the planet keeps its body behind the shell either way).
  renderOne({ ...structuredClone(cfgS), visualizer: { ...cfgS.visualizer, glow: false } }, 0.5)
  const offHalo = gradientFills().length
  renderOne(structuredClone(cfgS), 0.5)
  const onHalo = gradientFills().length
  check('glow off drops the atmosphere halo (core disc stays)', offHalo === 1 && onHalo === 2, `off=${offHalo} on=${onHalo}`)

  // 10) The Transparency dial scales every sphere pass to exactly half —
  //     dots AND quills alike (the S9 contract extends to the planet).
  renderOne(structuredClone(cfgS), 0.5)
  const baseAlphas = new Set([...dotsOf(), ...quillsOf()].map((r) => r.alpha))
  renderOne({ ...structuredClone(cfgS), visualizer: { ...cfgS.visualizer, transparency: 0.5 } }, 0.5)
  const halfSet = new Set([...dotsOf(), ...quillsOf()].map((r) => r.alpha))
  check(
    'transparency 50% scales every sphere pass to exactly half',
    halfSet.size === baseAlphas.size && [...halfSet].every((a) => baseAlphas.has(a * 2)),
    `base=${baseAlphas.size} half=${halfSet.size}`,
  )

  // 11) Bar count densifies the planet (rings at 1/5 weight, dots-per-ring
  //     at 4/5 — 24 → a 10 × 24 planet, 192 → 26 × 88).
  renderOne({ ...structuredClone(cfgS), visualizer: { ...cfgS.visualizer, barCount: 24 } }, 0.5)
  const few = dotsOf().length
  renderOne({ ...structuredClone(cfgS), visualizer: { ...cfgS.visualizer, barCount: 192 } }, 0.5)
  const many = dotsOf().length
  check('bar count densifies the dot shell', many > few && few >= 240, `few=${few} many=${many}`)

  // 12) The other styles stay untouched: bars still paints its classic
  //     24-bar fill stack at alpha 1.
  const cfgBars = structuredClone(DEFAULT_STUDIO_CONFIG)
  cfgBars.visualizer = { ...structuredClone(DEFAULT_STUDIO_CONFIG.visualizer), style: 'bars' as const, glow: false }
  cfgBars.visualizer.barCount = 24
  renderOne(structuredClone(cfgBars))
  const barFillAlphas = new Set(fillsOf().map((r) => r.alpha))
  check(
    'bars render unchanged after adding sphere (24 fills at full alpha)',
    fills(main) === 24 && barFillAlphas.size === 1 && barFillAlphas.has(1),
    `fills=${fills(main)} alphas=${[...barFillAlphas].join(',')}`,
  )

  // 13) The Mirror revert: the planet reads best as one clean orb — the
  //     mirrored twin just doubled the dots into mush — so the sphere now
  //     ignores the Mirror dropdown entirely: 'mirror' and 'center' must
  //     render EXACTLY the classic 'none' frame (bit-identical op streams).
  const planetJSON = (mirror: 'none' | 'mirror' | 'center'): string => {
    const cfg = structuredClone(cfgS)
    cfg.visualizer.mirror = mirror
    renderOne(cfg, 0.5)
    return JSON.stringify(logOf(main))
  }
  const noneOps = planetJSON('none')
  const mirrorOps = planetJSON('mirror')
  const centerOps = planetJSON('center')
  check(
    'mirror settings render the classic planet (reverted)',
    mirrorOps === noneOps && centerOps === noneOps,
    `mirror=${mirrorOps === noneOps} center=${centerOps === noneOps}`,
  )

  // 14) Vertical orientation quarter-rolls the planet: the same op count,
  //     every point finite, and the quill geometry lands somewhere else.
  renderOne(structuredClone(cfgS), 0.5)
  const hOps = dotsOf().length + quillsOf().length
  const hQuills = JSON.stringify(quillsOf())
  renderOne(
    { ...structuredClone(cfgS), visualizer: { ...cfgS.visualizer, orientation: 'vertical' as const } },
    0.5,
  )
  const vOps = dotsOf().length + quillsOf().length
  const vFinite = quillsOf().every((r) => (r.pts ?? []).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
  check(
    'vertical orientation rolls the planet cleanly',
    vOps === hOps && vFinite && JSON.stringify(quillsOf()) !== hQuills,
    `hOps=${hOps} vOps=${vOps} finite=${vFinite} moved=${JSON.stringify(quillsOf()) !== hQuills}`,
  )
}

/* ------------------- S17 the Serato turntable strip ------------------- */

console.log('S17 serato — the whole-song strip scrolls under a fixed needle')
{
  // A deterministic 8 s fake track: a bassy 82 Hz passage (low ZCR → green),
  // a crisp alternating square (high ZCR → magenta) and a silent gap —
  // exactly the content spread the rainbow map needs to prove itself.
  const RATE = 8000
  const SECONDS = 8
  const data = new Float32Array(RATE * SECONDS)
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    if (t >= 3 && t < 4.5) {
      data[i] = 0 // the silent gap — the strip must print nothing there
    } else if (t >= 4.5) {
      data[i] = (i % 2 === 0 ? 0.7 : -0.7) * 0.6 // crisp: one crossing/sample
    } else {
      data[i] = Math.sin((2 * Math.PI * 82 * t)) * 0.8 // bassy
    }
  }
  const fakeBuffer = {
    sampleRate: RATE,
    length: data.length,
    numberOfChannels: 1,
    getChannelData: () => data,
  }

  const env = buildSeratoEnvelope(fakeBuffer)
  check('envelope columns track the hop rate (8000/512)', Math.abs(env.columnsPerSec - RATE / 512) < 1e-6, `got ${env.columnsPerSec}`)
  check('envelope covers the whole track', Math.abs(env.seconds - SECONDS) < 1e-6, `got ${env.seconds}`)
  const midCol = Math.floor(1.0 * env.columnsPerSec)
  const crispCol = Math.floor(5.0 * env.columnsPerSec)
  const gapCol = Math.floor(3.5 * env.columnsPerSec)
  check('bassy passage reads quiet-on-crossings (green territory)', env.zcr[midCol] < 0.1, `zcr=${env.zcr[midCol].toFixed(3)}`)
  check('crisp passage reads bright (pink territory)', env.zcr[crispCol] > 0.4, `zcr=${env.zcr[crispCol].toFixed(3)}`)
  check('silent gap reads zero peak', env.peak[gapCol] === 0, `peak=${env.peak[gapCol]}`)
  check('loudRef sits near the loudest passage', env.loudRef > 0.5, `loudRef=${env.loudRef.toFixed(2)}`)

  const cfgSer = (over: Partial<StudioConfig['visualizer']> = {}): StudioConfig => {
    const cfg = structuredClone(DEFAULT_STUDIO_CONFIG)
    cfg.visualizer = { ...structuredClone(DEFAULT_STUDIO_CONFIG.visualizer), style: 'serato' as const, glow: false, ...over }
    return cfg
  }
  bindSeratoSource(fakeBuffer)

  // 1) The strip scrolls: different song times paint different fills.
  renderOne(cfgSer(), 2.0)
  const fillsAt2 = JSON.stringify(logOf(main).filter((r) => r.kind === 'fill').map((r) => [r.x, r.style]))
  renderOne(cfgSer(), 2.5)
  const fillsAt25 = JSON.stringify(logOf(main).filter((r) => r.kind === 'fill').map((r) => [r.x, r.style]))
  check('the strip scrolls with song time (2.0s ≠ 2.5s)', fillsAt2 !== fillsAt25, 'same op stream at two times')

  // 2) Determinism: the same time twice → byte-identical op stream.
  renderOne(cfgSer(), 2.0)
  const again = JSON.stringify(logOf(main))
  renderOne(cfgSer(), 2.0)
  check('serato renders deterministically (same frame → identical ops)', again === JSON.stringify(logOf(main)), 'op streams differ')

  // 3) The needle exists and sits dead center in every frame.
  renderOne(cfgSer(), 1.0)
  const needle = logOf(main).filter((r) => r.kind === 'frect' && r.style === 'rgba(255, 255, 255, 0.92)')
  const W = 320
  check(
    'the white needle paints dead center',
    needle.length === 1 && Math.abs((needle[0].x ?? 0) + (needle[0].w ?? 0) / 2 - W / 2) < 2,
    `count=${needle.length} x=${needle[0]?.x}`,
  )

  // 4) Color modes diverge (rainbow hsl vs palette rgba vs solid).
  const styles = new Set<string>()
  renderOne(cfgSer(), 2.0)
  for (const r of logOf(main)) if (r.kind === 'fill' && typeof r.style === 'string' && r.style.startsWith('hsl')) styles.add('rainbow')
  renderOne(cfgSer({ seratoColors: 'palette' as const }), 2.0)
  for (const r of logOf(main)) if (r.kind === 'fill' && typeof r.style === 'string' && r.style.startsWith('rgba')) styles.add('palette')
  renderOne(cfgSer({ seratoColors: 'solid' as const }), 2.0)
  const solidStyles = new Set(logOf(main).filter((r) => r.kind === 'fill' && typeof r.style === 'string' && (r.style as string).startsWith('rgba')).map((r) => r.style))
  check('rainbow mode paints hsl columns', styles.has('rainbow'), `styles=${[...styles].join()}`)
  check('palette mode paints rgba columns', styles.has('palette'), `styles=${[...styles].join()}`)
  check('solid mode paints ONE color', solidStyles.size === 1, `solidStyles=${[...solidStyles].join()}`)
  check('the three color modes all differ', styles.has('rainbow') && styles.has('palette') && solidStyles.size === 1, 'modes collapsed together')

  // 5) Zoom changes which slice of the song lands in the window. At t=5 the
  //    4 s window sits on the crisp passage (pink slots dominate — its left
  //    edge just grazes the silence boundary); the 30 s window reaches back
  //    into the bass passage (green slots appear).
  renderOne(cfgSer({ seratoWindow: 4 }), 5.0)
  const zoomedIn = logOf(main)
    .filter((r) => r.kind === 'fill' && typeof r.style === 'string' && r.style.startsWith('hsl'))
    .map((r) => Number((r.style as string).match(/hsl\((\d+)/)?.[1]))
  renderOne(cfgSer({ seratoWindow: 30 }), 5.0)
  const zoomedOut = logOf(main)
    .filter((r) => r.kind === 'fill' && typeof r.style === 'string' && r.style.startsWith('hsl'))
    .map((r) => Number((r.style as string).match(/hsl\((\d+)/)?.[1]))
  const greenCount = (hues: number[]): number => hues.filter((h) => h < 150).length
  const pinkCount = (hues: number[]): number => hues.filter((h) => h > 250).length
  check(
    'the Zoom dial changes the visible slice (zoomed-in = crisp pink, zoomed-out brings the green bass in)',
    pinkCount(zoomedIn) > 0 &&
      greenCount(zoomedIn) < pinkCount(zoomedIn) &&
      greenCount(zoomedOut) > greenCount(zoomedIn),
    `in: green=${greenCount(zoomedIn)} pink=${pinkCount(zoomedIn)} · out: green=${greenCount(zoomedOut)} pink=${pinkCount(zoomedOut)}`,
  )

  // 6) Strip height dial scales the bars (bars paint as path fills at the
  //    factory roundness — geometry rides the fill record's rects).
  renderOne(cfgSer({ seratoHeight: 0.3 }), 2.0)
  const shortBars = logOf(main)
    .filter((r) => r.kind === 'fill' && typeof r.style === 'string' && r.style.startsWith('hsl'))
    .flatMap((r) => r.rects ?? [])
  renderOne(cfgSer({ seratoHeight: 1 }), 2.0)
  const tallBars = logOf(main)
    .filter((r) => r.kind === 'fill' && typeof r.style === 'string' && r.style.startsWith('hsl'))
    .flatMap((r) => r.rects ?? [])
  const maxShort = Math.max(...shortBars.map((rc) => rc.h), 0)
  const maxTall = Math.max(...tallBars.map((rc) => rc.h), 0)
  check('strip height scales the bars', maxTall > maxShort * 2, `short=${maxShort} tall=${maxTall}`)

  // 7) Vertical orientation rolls the strip cleanly.
  renderOne(cfgSer({ orientation: 'vertical' as const }), 2.0)
  check('vertical orientation renders the strip', logOf(main).some((r) => r.kind === 'frect' || r.kind === 'fill'), 'no strip ops')

  // 8) Placeholder: no bound source → the needle-only placeholder, still
  //    deterministic (this is what shows before a track is loaded). Only the
  //    needle fills are compared — the background's grain is time-seeded and
  //    legitimately differs between song times.
  bindSeratoSource(null)
  renderOne(cfgSer(), 2.0)
  const placeholderFrects = (): string =>
    JSON.stringify(
      logOf(main).filter((r) => r.kind === 'frect' && r.style === 'rgba(255, 255, 255, 0.55)'),
    )
  renderOne(cfgSer(), 9.9)
  const at99 = JSON.parse(placeholderFrects())
  check('placeholder keeps the needle when no envelope is ready', at99.length === 1, `count=${at99.length}`)
  const at2 = placeholderFrects()
  renderOne(cfgSer(), 9.9)
  check('placeholder renders identically at any time', placeholderFrects() === at2, 'placeholder moved')
}

/* ------------------- S18 the Image (PNG) visualizer ------------------- */

console.log('S18 image-viz — the custom PNG style: inner spectrum, glowing edges, electricity')
{
  const cfgImg = (over: Partial<StudioConfig['visualizer']> = {}): StudioConfig => {
    const cfg = structuredClone(DEFAULT_STUDIO_CONFIG)
    cfg.visualizer = { ...structuredClone(DEFAULT_STUDIO_CONFIG.visualizer), style: 'imgviz' as const, ...over }
    return cfg
  }
  /** One measured frame from an explicit AudioFrame (the drive powers the
   *  glow and the bolts, so these modes only diverge with real audio). */
  const renderWith = (frame: AudioFrame, config: StudioConfig): void => {
    for (const c of [main, ...created]) logOf(c).length = 0
    renderFrame(rc, frame, config)
  }
  /** Canvas-identity-free op stream — safe to stringify (canvas srcs tag
   *  as 'canvas', the artwork as 'artwork', other images as 'img') and
   *  stable across identical renders (fresh scratch canvases tag alike). */
  const streamFor = (c: HTMLCanvasElement): string =>
    JSON.stringify(
      logOf(c).map((r) => {
        const srcTag =
          r.src === artwork ? 'artwork'
          : r.src && typeof r.src === 'object' && '__log' in (r.src as object) ? 'canvas'
          : (r.src as { src?: string } | null)?.src?.startsWith('data:') ? 'img'
          : r.src ?? null
        return [r.kind, r.op, Number(r.alpha.toFixed(4)), srcTag, r.style ?? null, r.rects ?? null]
      }),
    )
  const canvasDraws = (c: HTMLCanvasElement): OpRec[] =>
    logOf(c).filter((r) => r.kind === 'draw' && r.src && typeof r.src === 'object' && '__log' in (r.src as object))
  const maskScratch = (): HTMLCanvasElement | undefined =>
    created.find((c) => logOf(c).some((r) => r.kind === 'draw' && r.op === 'destination-in'))

  // A loud frame — the drive (bass/energy) powers glow + bolts; a silent
  // frame for the gating checks.
  const loud = {
    ...frameAt(0.5),
    freq: Float32Array.from({ length: 64 }, (_, i) => 0.2 + 0.8 * Math.exp(-i / 14)),
    wave: Float32Array.from({ length: 2048 }, (_, i) => Math.sin(i / 11) * 0.8),
    bass: 0.8,
    energy: 0.7,
    treble: 0.2,
  }
  const quiet = {
    ...frameAt(0.5),
    freq: new Float32Array(64),
    wave: new Float32Array(2048),
    bass: 0,
    energy: 0,
    treble: 0,
    sub: 0,
  }

  // 1) Placeholder: no artwork → the dashed hint, deterministic in shape.
  renderWith(frameAt(0.5), cfgImg())
  check('placeholder hints for a PNG (text op recorded)', logOf(main).some((r) => r.kind === 'text'), 'no text op')
  const hintA = JSON.stringify(logOf(main).filter((r) => r.kind === 'text'))
  renderWith(frameAt(9.9), cfgImg())
  check('placeholder renders identically at any time', JSON.stringify(logOf(main).filter((r) => r.kind === 'text')) === hintA, 'placeholder moved')

  // Load the fake artwork into the shared image cache (the Image stub is
  // born decoded: complete + natural size from the start).
  const fakeSrc = 'data:image/png;base64,FAKEIMGVIZ'
  const artwork = await loadBackgroundImage(fakeSrc)

  // 2) The artwork paints + the inner spectrum gets masked to its shape.
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc }))
  const drawSrcs = draws(main).map((r) => r.src)
  check('the artwork paints onto the frame', drawSrcs.includes(artwork), 'no artwork draw')
  const maskCanvas = maskScratch()
  check('the inner spectrum is clipped to the silhouette (destination-in mask)', !!maskCanvas, 'no masked scratch canvas')
  check('the masked spectrum composites onto the frame', !!maskCanvas && drawSrcs.includes(maskCanvas), 'mask result not drawn')

  // 3) Determinism: the same frame twice → identical canvas-free streams.
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc }))
  const again = streamFor(main)
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc }))
  check('image-viz renders deterministically (same frame → identical ops)', again === streamFor(main), 'op streams differ')

  // 4) Electricity: bolts stroke the FRAME (they live outside the mask),
  //    vanish at silence, and the density dial scales the storm.
  const boltStrokes = logOf(main).filter((r) => r.kind === 'stroke')
  check('electricity sparks bolts off the artwork (stroke passes on the frame)', boltStrokes.length >= 2, `strokes=${boltStrokes.length}`)
  renderWith(quiet, cfgImg({ imgvizSrc: fakeSrc }))
  check('silence grounds the electricity (no bolts)', logOf(main).every((r) => r.kind !== 'stroke'), 'bolts at silence')
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBoltDensity: 0.1 }))
  const fewBolts = logOf(main).filter((r) => r.kind === 'stroke').length
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBoltDensity: 1 }))
  const manyBolts = logOf(main).filter((r) => r.kind === 'stroke').length
  check('bolt density scales the electric storm', manyBolts > fewBolts, `few=${fewBolts} many=${manyBolts}`)

  // 5) Glowing edges: the halo rides the drive (loud breathes harder than
  //    silence) and strength 0 skips the pass entirely.
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false }))
  const loudGlow = canvasDraws(main).map((r) => r.alpha)
  renderWith(quiet, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false }))
  const quietGlow = canvasDraws(main).map((r) => r.alpha)
  check(
    'glow breathes with the music (halo alpha rides the drive)',
    loudGlow.length > 0 && quietGlow.length > 0 && loudGlow[0] > quietGlow[0],
    `loud=${loudGlow[0]} quiet=${quietGlow[0]}`,
  )
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizGlow: false }))
  check('glow off skips the halo/rim passes', canvasDraws(main).length === 1, `canvas draws=${canvasDraws(main).length}`)

  // 6) The inner visualizer modes paint different geometry into the mask.
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizInner: 'bars' }))
  const barsScratch = maskScratch()
  const barFills = barsScratch ? logOf(barsScratch).filter((r) => r.kind === 'fill').length : 0
  check('bars mode paints fills into the mask scratch', barFills > 0, `fills=${barFills}`)
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizInner: 'wave' }))
  check('wave mode strokes a line into the mask scratch', created.some((c) => logOf(c).some((r) => r.kind === 'stroke')), 'no wave stroke')
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizInner: 'radial' }))
  check('radial mode strokes spokes into the mask scratch', created.some((c) => logOf(c).some((r) => r.kind === 'stroke')), 'no radial strokes')

  // 7) Sensitivity drives the inner bars; the size dial scales the box.
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizInner: 'bars', sensitivity: 0.4 }))
  const shortH = Math.max(...(maskScratch() ? logOf(maskScratch()!).filter((r) => r.kind === 'fill').flatMap((r) => r.rects ?? []).map((rc) => rc.h) : [0]))
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizInner: 'bars', sensitivity: 2.4 }))
  const tallH = Math.max(...(maskScratch() ? logOf(maskScratch()!).filter((r) => r.kind === 'fill').flatMap((r) => r.rects ?? []).map((rc) => rc.h) : [0]))
  check('sensitivity drives the inner spectrum', tallH > shortH * 2, `short=${shortH.toFixed(1)} tall=${tallH.toFixed(1)}`)
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizInner: 'bars', imgvizSize: 20 }))
  const smallW = maskScratch()?.width ?? 0
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizInner: 'bars', imgvizSize: 80 }))
  const bigW = maskScratch()?.width ?? 0
  check('artwork size scales the box', bigW > smallW * 2, `small=${smallW} big=${bigW}`)

  // 8) Artwork dim: 0 keeps the picture full strength, 0.5 halves it.
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizGlow: false, imgvizDim: 0 }))
  const fullAlpha = logOf(main).find((r) => r.kind === 'draw' && r.src === artwork)?.alpha
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizGlow: false, imgvizDim: 0.5 }))
  const halfAlpha = logOf(main).find((r) => r.kind === 'draw' && r.src === artwork)?.alpha
  check('artwork dim fades the picture (1 - dim)', fullAlpha === 1 && halfAlpha === 0.5, `full=${fullAlpha} half=${halfAlpha}`)

  // 9) Motion: the React-to-music toggle gates the swell — loud swells the
  //    box, silence and toggle-off both pin it at rest size.
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizGlow: false, imgvizMotion: true }))
  const swellH = maskScratch()?.height ?? 0
  renderWith(quiet, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizGlow: false, imgvizMotion: true }))
  const swellQuietH = maskScratch()?.height ?? 0
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizGlow: false, imgvizMotion: false }))
  const stillH = maskScratch()?.height ?? 0
  check('motion swells the artwork with the drive', swellH > stillH, `swell=${swellH} still=${stillH}`)
  check('motion off pins the artwork at rest (loud = quiet)', stillH === swellQuietH, `loud=${stillH} quiet=${swellQuietH}`)

  // 10) The contour-band glow: wide bloom + inner spectrum + tight bloom +
  //     crisp rim = 4 masked/canvas draws on the frame (artwork excluded).
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false }))
  check(
    'glow draws the contour band passes (wide bloom, tight bloom, crisp rim)',
    canvasDraws(main).length === 4,
    `layers=${canvasDraws(main).length}`,
  )

  // 11) Every inner mode paints into the mask scratch (the real style
  //     renderers reused: particles, blob, grid, ribbon join bars/wave/radial).
  for (const mode of ['particles', 'blob', 'grid', 'ribbon'] as const) {
    renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizGlow: false, imgvizInner: mode }))
    const sc = maskScratch()
    check(
      `inner ${mode} paints into the mask`,
      !!sc && logOf(sc).some((r) => r.kind === 'fill' || r.kind === 'stroke'),
      `${mode} left the scratch empty`,
    )
  }

  // 12) Bolt reach: the length multiplier stretches the fractal channel —
  //     same seed and count, different geometry (stroke points recorded).
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizGlow: false, imgvizBoltDensity: 1, imgvizBoltLength: 2 }))
  const longBolts = streamFor(main)
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizGlow: false, imgvizBoltDensity: 1, imgvizBoltLength: 0.3 }))
  check('bolt reach stretches the lightning (same storm, longer channels)', streamFor(main) !== longBolts, 'geometry unchanged')

  // 13) Inner position: the Inner X / Inner Y dials re-anchor the inner
  //     renderer's center across the artwork's box (same anchor math as the
  //     main layer's Position X/Y). The mock records translate ops, so the
  //     anchor shift lands in the mask scratch's log — and the centered
  //     default (50/50) must issue NO shift at all.
  check(
    'inner position defaults to centered (50/50)',
    DEFAULT_STUDIO_CONFIG.visualizer.imgvizInnerX === 50 && DEFAULT_STUDIO_CONFIG.visualizer.imgvizInnerY === 50,
    `defaults=${DEFAULT_STUDIO_CONFIG.visualizer.imgvizInnerX}/${DEFAULT_STUDIO_CONFIG.visualizer.imgvizInnerY}`,
  )
  const xformsOf = (sc: HTMLCanvasElement | undefined): Array<{ x: number; y: number }> =>
    sc ? logOf(sc).filter((r) => r.kind === 'xform').map((r) => ({ x: r.x ?? 0, y: r.y ?? 0 })) : []
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizGlow: false, imgvizInner: 'bars' }))
  const centeredXf = xformsOf(maskScratch())
  check('centered inner (50/50) issues no anchor translate', centeredXf.length === 0, `xlates=${centeredXf.length}`)
  renderWith(
    loud,
    cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizGlow: false, imgvizInner: 'bars', imgvizInnerX: 15, imgvizInnerY: 85 }),
  )
  const movedSc = maskScratch()
  const movedXf = xformsOf(movedSc)
  check(
    'inner X/Y re-anchor the spectrum (exact 35%-of-box shift toward the dials)',
    movedSc !== undefined &&
      movedXf.length === 1 &&
      Math.abs(movedXf[0].x + 0.35 * movedSc.width) < 0.5 &&
      Math.abs(movedXf[0].y - 0.35 * movedSc.height) < 0.5,
    `xlates=${movedXf.length} dx=${movedXf[0]?.x?.toFixed(1)} dy=${movedXf[0]?.y?.toFixed(1)}`,
  )

  // 14) Inner orientation: the strip styles (bars / wave / grid / ribbon)
  //     rotate 90° counter-clockwise when Inner orientation = vertical —
  //     the same wrap the main drawVisualizer applies, visible in the mock
  //     as a translate(0, boxH) op on the mask scratch. Horizontal (the
  //     default) adds no rotation op.
  check(
    'inner orientation defaults to horizontal',
    DEFAULT_STUDIO_CONFIG.visualizer.imgvizInnerOrient === 'horizontal',
    `default=${DEFAULT_STUDIO_CONFIG.visualizer.imgvizInnerOrient}`,
  )
  renderWith(
    loud,
    cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizGlow: false, imgvizInner: 'bars', imgvizInnerOrient: 'vertical' }),
  )
  const vSc = maskScratch()
  const vXf = xformsOf(vSc)
  check(
    'vertical inner rotates the strip (translate(0, boxH) recorded on the mask scratch)',
    vSc !== undefined && vXf.length === 1 && vXf[0].x === 0 && Math.abs(vXf[0].y - vSc.height) < 0.5,
    `xlates=${vXf.length} tx=${vXf[0]?.x} ty=${vXf[0]?.y} bh=${vSc?.height}`,
  )
  renderWith(
    loud,
    cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizGlow: false, imgvizInner: 'bars', imgvizInnerOrient: 'vertical', imgvizInnerX: 20 }),
  )
  const vxSc = maskScratch()
  const vXf2 = xformsOf(vxSc)
  check(
    'vertical inner composes position before rotation (anchor shift + rotate wrap recorded)',
    vxSc !== undefined && vXf2.length === 2 && Math.abs(vXf2[0].x + 0.3 * vxSc.width) < 0.5 && vXf2[1].x === 0,
    `xlates=${vXf2.length} tx0=${vXf2[0]?.x?.toFixed(1)} tx1=${vXf2[1]?.x}`,
  )
  renderWith(loud, cfgImg({ imgvizSrc: fakeSrc, imgvizBolt: false, imgvizGlow: false, imgvizInner: 'radial', imgvizInnerOrient: 'vertical' }))
  check(
    'round inner styles ignore orientation (no rotation op)',
    xformsOf(maskScratch()).length === 0,
    `xlates=${xformsOf(maskScratch()).length}`,
  )
}

/* ----------------- S16 the Mirror family across every style ----------------- */

console.log('S16 the Mirror family — every style answers Mirror and Center differently')
{
  // A loud frame so every style has something to draw (silence would hide
  // the wave's envelope and the grid's lit columns).
  const loud = {
    ...frameAt(0.5),
    freq: Float32Array.from({ length: 64 }, (_, i) => 0.15 + 0.85 * Math.exp(-i / 14)),
    wave: Float32Array.from(
      { length: 2048 },
      (_, i) => Math.sin(i / 9) * Math.exp(-((i % 512) / 512) * 2) * 0.9,
    ),
    bass: 0.7,
    energy: 0.6,
  }
  const styleWithMirror = (style: string, mirror: 'none' | 'mirror' | 'center'): StudioConfig => {
    const cfg = structuredClone(DEFAULT_STUDIO_CONFIG)
    cfg.visualizer = { ...structuredClone(DEFAULT_STUDIO_CONFIG.visualizer), glow: false, barCount: 48 }
    cfg.visualizer.style = style as typeof cfg.visualizer.style
    cfg.visualizer.mirror = mirror
    return cfg
  }
  /** One measured frame from an explicit AudioFrame (renderOne pins its own
   *  silent frame, and these modes only diverge when there's audio to show). */
  const opsJSON = (frame: AudioFrame, cfg: StudioConfig): string => {
    for (const c of [main, ...created]) logOf(c).length = 0
    renderFrame(rc, frame, cfg)
    return JSON.stringify(logOf(main))
  }
  for (const style of ['bars', 'wave', 'radial', 'particles', 'blob', 'grid', 'ribbon', 'terrain', 'perspective']) {
    const noneOps = opsJSON(loud, styleWithMirror(style, 'none'))
    const mirrorOps = opsJSON(loud, styleWithMirror(style, 'mirror'))
    const centerOps = opsJSON(loud, styleWithMirror(style, 'center'))
    check(
      `${style}: Mirror and Center paint different frames (both differ from None)`,
      mirrorOps !== centerOps && mirrorOps !== noneOps && centerOps !== noneOps,
      `mirror≠center=${mirrorOps !== centerOps} mirror≠none=${mirrorOps !== noneOps} center≠none=${centerOps !== noneOps}`,
    )
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
