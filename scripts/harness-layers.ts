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
import { drawLyrics } from '../src/lib/visualizer/lyrics'
import { DEFAULT_STUDIO_CONFIG, resolveLayersConfig } from '../src/lib/visualizer/types'
import type { AudioFrame, RenderContext, StudioConfig } from '../src/lib/visualizer/types'

/* ------------------------------ mock canvas ------------------------------ */

interface OpRec {
  kind: 'draw' | 'fill' | 'frect' | 'text' | 'pimg'
  src?: unknown
  x?: number
  y?: number
  w?: number
  h?: number
  rects?: Array<{ x: number; y: number; w: number; h: number }>
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
  // captures the geometry of path-based passes (bars, horizon pills).
  type Rect = { x: number; y: number; w: number; h: number }
  let path: Rect[] = []
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
  arc(): void {}
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

/* --------------------- S13 horizon visualizer ------------------------------- */

console.log('S13 horizon — the perspective equalizer road')
{
  const frects = (c: HTMLCanvasElement): OpRec[] => logOf(c).filter((r) => r.kind === 'frect')
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

  // A clean config: factory defaults, horizon selected, glow off so the
  // fill census stays pure.
  const cfgH = structuredClone(DEFAULT_STUDIO_CONFIG)
  cfgH.visualizer = {
    ...structuredClone(DEFAULT_STUDIO_CONFIG.visualizer),
    style: 'horizon' as const,
    glow: false,
    barCount: 48,
  }

  // Warm-up: settle the recording stub's alpha state (same reason as S12;
  // drawHorizon pins globalAlpha back to la at its end).
  renderOne(structuredClone(cfgH), 1.25)

  // 1) Deterministic: the same frozen frame renders the identical op stream.
  renderOne(structuredClone(cfgH), 1.25)
  const logA = JSON.stringify(logOf(main))
  renderOne(structuredClone(cfgH), 1.25)
  const logB = JSON.stringify(logOf(main))
  check(
    'horizon renders deterministically (same frame → identical op stream)',
    logA === logB,
    `match=${logA === logB} lenA=${logA.length} lenB=${logB.length}`,
  )

  // 2) Two-sided pills at full layer alpha, plus trail ghosts at 0.15.
  const roadFills = logOf(main).filter((r) => r.kind === 'fill')
  const roadAlphas = new Set(roadFills.map((r) => r.alpha))
  const solid = roadFills.filter((r) => r.alpha === 1).length
  check(
    'the road paints two-sided pills plus faint trail ghosts',
    solid >= 24 && roadAlphas.size === 2 && roadAlphas.has(1) && roadAlphas.has(0.15),
    `solid=${solid} alphas=${[...roadAlphas].join(',')}`,
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
  const silentSolid = logOf(main).filter((r) => r.kind === 'fill' && r.alpha === 1).length
  check('a silent frame still paints the full road (idle wave)', silentSolid >= 24, `solid=${silentSolid}`)

  // 6) The flow dial moves the road: same frozen frame, flow 0.5 vs 0 —
  //    the phase shift lands the pills somewhere else entirely.
  renderOne({ ...structuredClone(cfgH), visualizer: { ...cfgH.visualizer, flowSpeed: 0.5 } }, 0.5)
  const flowing = JSON.stringify(logOf(main))
  renderOne({ ...structuredClone(cfgH), visualizer: { ...cfgH.visualizer, flowSpeed: 0 } }, 0.5)
  const still = JSON.stringify(logOf(main))
  check('flow speed moves the pills along the road', flowing !== still, `moved=${flowing !== still}`)

  // 7) The Transparency dial scales every pass exactly (main 1 → 0.5,
  //    ghost 0.15 → 0.075) — the S9 contract extends to the road.
  renderOne({ ...structuredClone(cfgH), visualizer: { ...cfgH.visualizer, transparency: 0.5 } })
  const half = fillAlphas()
  check(
    'transparency 50% scales every road pass to exactly half',
    half.size === 2 && half.has(0.5) && half.has(0.075),
    `alphas=${[...half].join(',')}`,
  )

  // 8) Bar count densifies the road.
  renderOne({ ...structuredClone(cfgH), visualizer: { ...cfgH.visualizer, barCount: 16 } })
  const few = logOf(main).filter((r) => r.kind === 'fill' && r.alpha === 1).length
  renderOne({ ...structuredClone(cfgH), visualizer: { ...cfgH.visualizer, barCount: 96 } })
  const many = logOf(main).filter((r) => r.kind === 'fill' && r.alpha === 1).length
  check('bar count densifies the road', many > few && few >= 8, `few=${few} many=${many}`)

  // 9) The other styles stay untouched: bars still paints its classic
  //    24-bar fill stack at alpha 1.
  const cfgBars = structuredClone(DEFAULT_STUDIO_CONFIG)
  cfgBars.visualizer = { ...structuredClone(DEFAULT_STUDIO_CONFIG.visualizer), style: 'bars' as const, glow: false }
  cfgBars.visualizer.barCount = 24
  renderOne(structuredClone(cfgBars))
  check('bars render unchanged after the horizon addition (24 fills at full alpha)', fills(main) === 24 && fillAlphas().size === 1 && fillAlphas().has(1), `fills=${fills(main)} alphas=${[...fillAlphas()].join(',')}`)
}

/* --------------------------------- verdict -------------------------------- */

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
