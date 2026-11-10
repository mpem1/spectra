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
  check('lyrics opacity defaults to fully opaque', d.lyrics.opacity === 1, `got ${d.lyrics.opacity}`)
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
}

/* -------------------- S3 stayColored ON: overlay last, after anaglyph ------------------- */

console.log('S3 stayColored ON — layers ride their own overlay ABOVE the 3D glasses')
{
  const cfg = baseConfig()
  // Warm-up frame (creates the anaglyph work canvases), then measure both modes.
  renderOne({ ...cfg, layers: { stayColored: false, textClear: false } })
  const mainFillsOff = fills(main)
  const ov = renderOne({ ...cfg, layers: { stayColored: true, textClear: false } })
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
  const ov = renderOne({ ...cfg, layers: { stayColored: false, textClear: false } })
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
  renderOne({ ...cfg, layers: { stayColored: true, textClear: false } })
  const mainFillsOn = fills(main)
  renderOne({ ...cfg, layers: { stayColored: false, textClear: false } })
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
  const ov = renderOne({ ...cfg, layers: { stayColored: true, textClear: false } })
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
  renderOne({ ...cfg, layers: { stayColored: false, textClear: false } })
  const classicTextOnMain = texts(main).length
  check(
    'classic path: the words paint straight onto the main frame',
    classicTextOnMain >= 3,
    `main text ops=${classicTextOnMain}`,
  )

  renderOne({ ...cfg, layers: { stayColored: false, textClear: true } })
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
  renderOne({ ...cfg, layers: { stayColored: true, textClear: true } })
  const ovBoth = created.find((c) => fills(c) >= 24 && texts(c).length >= 3) ?? null
  check(
    'stayColored ON ignores textClear (one overlay for everything)',
    !!ovBoth && fills(main) === 0,
    `ov fills=${ovBoth ? fills(ovBoth) : 'n/a'} ov text=${ovBoth ? texts(ovBoth) : 'n/a'} main fills=${fills(main)}`,
  )

  // Toggling textClear back off restores the classic layout exactly.
  renderOne({ ...cfg, layers: { stayColored: false, textClear: false } })
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

/* --------------------------------- verdict -------------------------------- */

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
