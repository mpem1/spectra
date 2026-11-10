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
 */

import { renderFrame } from '../src/lib/visualizer/renderer'
import { drawLyrics } from '../src/lib/visualizer/lyrics'
import { DEFAULT_STUDIO_CONFIG, resolveLayersConfig } from '../src/lib/visualizer/types'
import type { AudioFrame, RenderContext, StudioConfig } from '../src/lib/visualizer/types'

/* ------------------------------ mock canvas ------------------------------ */

interface OpRec {
  kind: 'draw' | 'fill' | 'frect' | 'text'
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
// The grid style batches its dots into a Path2D — a recording stub is all
// the harness needs (the mock ctx's fill() logs regardless of the path).
;(globalThis as { Path2D?: unknown }).Path2D = class {
  moveTo(): void {}
  arc(): void {}
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

/* --------------------------------- verdict -------------------------------- */

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
