/**
 * Glitch filter — digital corruption bursts over the finished frame.
 *
 * The picture plays clean most of the time; every so often a BURST hits —
 * a few frames of broken-signal chaos — then the image snaps back. Inside a
 * burst, at 15 glitch-fps:
 *
 *   1. Slices — horizontal strips of the picture shoved sideways (the torn
 *      datamosh look) plus raw saturated color bars (magenta/cyan/yellow…)
 *      stamped over the frame: the broken-video-signal signature.
 *   2. Blocks — corrupted macroblocks: square patches pixelated in place
 *      (nearest-neighbor magnification), patches COPIED from the wrong spot
 *      (mis-referenced data) and a few tinted with raw palette colors.
 *
 * `rate` is the burst cadence — its own dial (how often bursts fire and how
 * long they last), so intensity (`blocks` / `slices`) never has to be traded
 * for frequency: a rare burst is exactly as violent as a frequent one.
 *
 * RANDOMIZE: Slices and Burst rate can stop being fixed settings and wander
 * in a random walk — every Step time each value jumps a random distance
 * between the Min/Max step dials (3–20% by default) in a random direction,
 * lands there, and starts its next jump from there; hitting 0% or 100%
 * forces the next TWO jumps back toward the dial (the walk's home), so the
 * walk can bounce off the edges but can never get pinned oscillating
 * against one. Blocks stays dialed. Both walks are pure functions of the
 * song clock with fixed dice seeds — the same song second walks the exact
 * same chaos in the live preview, the MP4 export and the PNG sequence.
 *
 * No Math.random / Date.now anywhere: the burst schedule comes from the song
 * clock (time modulo a period), every block/slice/bar position comes from
 * integer hashes of (index, quantized time), and the randomize walks are
 * seeded PRNG streams stepped by the song clock — so the live preview, the
 * MP4 export and the PNG sequence render identical pixels for the same song
 * second. Transparent backgrounds skip the pass (alpha must stay clean).
 */
import type { AudioFrame, RenderContext, GlitchFilterConfig } from './types'
import { beatBoost, clamp01, frameSeed, getWork, hash01, resetWork } from './filter-utils'

/** Raw "broken signal" palette for color bars and tinted blocks. */
const PALETTE = ['#ff00ff', '#00ffff', '#ffff00', '#ff0000', '#00ff00', '#0000ff', '#ffffff']

/* ------------------------------ random walks ------------------------------ */

/** mulberry32 — a tiny seeded PRNG. The walks need a random sequence that
 *  stays CONSISTENT across frames: step i's direction and size must be the
 *  same every time the walk is read (including reads that land mid-step),
 *  so a shared Math.random() call per extension won't do — the seed makes
 *  step i a fixed draw. The seeds are FIXED constants, so every canvas
 *  (preview, MP4 export, PNG sequence) walks the same dice stream and the
 *  same song second lands the same values everywhere. */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Distinct dice per walk — slices and rate must not move in lockstep. */
const SLICES_WALK_SEED = 0x6c078965
const RATE_WALK_SEED = 0x9e3779b9

/** One parameter's random walk. `home` is the dial the walk starts from —
 *  and the position the edge rule steers back toward; `seed` is the walk's
 *  fixed dice stream, re-used when a dial move re-anchors the walk. */
interface GlitchWalkState {
  rng: () => number
  seed: number
  /** Cached positions: pos[i] = the value after i steps; pos[0] = home. */
  pos: number[]
  /** How many of the next steps are forced back toward home (the edge rule). */
  forced: number
  /** The dialed value the walk is anchored to (re-anchored on dial moves). */
  home: number
}

/** Both walks per canvas, so preview and export each evolve the same
 *  sequences (the dice are fixed — the clock is what differs). */
const glitchWalks = new Map<CanvasRenderingContext2D, { slices: GlitchWalkState; rate: GlitchWalkState }>()

/** Edge-anchored homes (dial at exactly 0% or 100%) pre-arm ONE forced
 *  step so the very first jump is guaranteed interior — the walk can never
 *  open with a clamp no-op sitting on the edge. */
function edgeAnchorForced(home: number): number {
  return home <= 0 || home >= 1 ? 1 : 0
}

function glitchWalksFor(ctx: CanvasRenderingContext2D, homeSlices: number, homeRate: number) {
  let w = glitchWalks.get(ctx)
  if (!w) {
    w = {
      slices: { rng: mulberry32(SLICES_WALK_SEED), seed: SLICES_WALK_SEED, pos: [homeSlices], forced: edgeAnchorForced(homeSlices), home: homeSlices },
      rate: { rng: mulberry32(RATE_WALK_SEED), seed: RATE_WALK_SEED, pos: [homeRate], forced: edgeAnchorForced(homeRate), home: homeRate },
    }
    glitchWalks.set(ctx, w)
  }
  return w
}

/** Extend the cached prefix to `target` steps, consuming the RNG exactly
 *  once per new step — reads that land mid-step re-read the same target,
 *  and seeks backward just read a shorter prefix (no state ever goes
 *  stale). Each step jumps a uniform random distance in [minStep, maxStep]
 *  in a random direction; the landed value is clamped into 0..1 and an
 *  EDGE HIT (0% or 100%) arms the next TWO jumps back toward home, so the
 *  walk can bounce off the edges but can never get stuck pinned against
 *  one (a walk anchored AT an edge — dial 0% or 100% — recovers through
 *  the center fallback in the forced direction). */
function extendGlitchWalk(st: GlitchWalkState, target: number, minStep: number, maxStep: number): void {
  while (st.pos.length <= target) {
    const prev = st.pos[st.pos.length - 1]
    const mag = minStep + (maxStep - minStep) * st.rng()
    let sign: number
    if (st.forced > 0) {
      // The edge rule: this jump heads home, whatever the dice say.
      sign = prev < st.home ? 1 : prev > st.home ? -1 : prev < 0.5 ? 1 : -1
      st.forced -= 1
    } else {
      sign = st.rng() < 0.5 ? -1 : 1
    }
    let p = prev + sign * mag
    if (p >= 1) {
      p = 1 // hit 100% — the next two jumps walk back toward the dial
      st.forced = 2
    } else if (p <= 0) {
      p = 0 // hit 0% — same recovery
      st.forced = 2
    }
    st.pos.push(p)
  }
}

/** The walked value at song `time`: iteration i = floor(time / stepTime)
 *  is a pure function of the song clock, so the walk never goes stale and
 *  every render of the same second reads the same value. Each landing
 *  eases in over 150 ms so the values roll to their new spot instead of
 *  strobing. Moving the home dial mid-play re-anchors the walk (fresh
 *  dice, restart from the dial) — the dial stays live, not a one-time
 *  seed. */
const WALK_EASE = 0.15

function glitchWalkValue(
  st: GlitchWalkState,
  time: number,
  stepTime: number,
  minStep: number,
  maxStep: number,
  home: number,
): number {
  if (Math.abs(home - st.home) > 1e-6) {
    st.home = home
    st.pos = [home]
    st.forced = edgeAnchorForced(home)
    st.rng = mulberry32(st.seed)
  }
  const i = Math.max(0, Math.floor(time / stepTime))
  extendGlitchWalk(st, i, Math.min(minStep, maxStep), Math.max(minStep, maxStep))
  const target = st.pos[i]
  if (i === 0) return target
  const tIn = time - i * stepTime
  if (tIn >= WALK_EASE) return target
  const from = st.pos[i - 1]
  const k = Math.max(0, Math.min(1, tIn / WALK_EASE))
  const g = k * k * (3 - 2 * k)
  return from + (target - from) * g
}

export function drawGlitchFilter(
  rc: RenderContext,
  cfg: GlitchFilterConfig | undefined,
  frame: Pick<AudioFrame, 'time' | 'bass'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  const S = H / 720
  // Beat reactive: every kick FORCES a burst (even mid clean-stretch) and
  // punches the corruption harder; between beats the schedule and the
  // intensity rest exactly at the dialed-in values. `rate` still owns the
  // ambient cadence underneath the beat hits — they stack, not replace.
  // The hit gate is punch · bass² (not a linear cliff): the engine's
  // smoothed bass rarely tops ~0.65 even on hard kicks, and a linear gate
  // at 0.28 only opens at full strength — bass² keeps the response on the
  // kicks while still firing at lower Beat punch settings.
  const beatOn = !!cfg.beatReactive
  const punch = clamp01(cfg.beatStrength ?? 0.5)
  const bass = clamp01(frame.bass)
  const boost = beatBoost(cfg, bass, 1.3)
  const beatHit = beatOn && punch * bass * bass > 0.08

  // The raw intensities: the dials — or, with RANDOMIZE on, the walks (the
  // dials become the walks' homes, and moving one re-anchors its walk).
  // Read BEFORE any early return so the walks keep stepping every frame
  // the filter runs.
  const slicesDialed = clamp01(cfg.slices)
  const rateDialed = clamp01(cfg.rate ?? 0.5)
  let slicesBase = slicesDialed
  let rate = rateDialed
  if (cfg.randomize) {
    const walk = glitchWalksFor(ctx, slicesDialed, rateDialed)
    const stepT = Math.max(0.1, cfg.randomStepTime ?? 1)
    const minS = Math.min(0.5, Math.max(0.01, cfg.randomStepMin ?? 0.03))
    const maxS = Math.min(0.5, Math.max(0.01, cfg.randomStepMax ?? 0.2))
    slicesBase = glitchWalkValue(walk.slices, frame.time, stepT, minS, maxS, slicesDialed)
    rate = glitchWalkValue(walk.rate, frame.time, stepT, minS, maxS, rateDialed)
  }

  const blocks = Math.min(1, clamp01(cfg.blocks) * boost)
  const slices = Math.min(1, slicesBase * boost)
  if (blocks <= 0.001 && slices <= 0.001) return

  // Burst schedule — cadence lives here and ONLY here (Task 71's lesson
  // applied from day one). duty = share of time a burst occupies; burstDur =
  // seconds of corruption per burst. rate 1 → duty 1 → continuous corruption;
  // lower rates park the picture clean between bursts.
  const duty = 0.05 + 0.95 * rate ** 2 // 0.05..1
  const burstDur = 0.25 + 0.45 * rate // 0.25..0.7 s
  const period = burstDur / duty
  const local = frame.time % period
  if (local >= burstDur && !beatHit) return // clean stretch, no kick — nothing to draw

  // One snapshot; every artifact samples the finished frame from it.
  const snap = getWork('glitch:snap', W, H)
  const sc = resetWork(snap.getContext('2d')!)
  sc.clearRect(0, 0, W, H)
  sc.drawImage(ctx.canvas, 0, 0)

  // Artifacts stutter at 15 glitch-fps — they hold for ~66ms then re-hash.
  const seed = frameSeed(frame.time, 15)

  /* --------------------------------- slices --------------------------------- */
  if (slices > 0.001) {
    const count = Math.round(2 + 6 * slices)
    for (let i = 0; i < count; i++) {
      const h = Math.max(2, Math.round((3 + hash01(i, seed + 43) * 26) * S))
      const y = Math.round(hash01(i, seed + 47) * Math.max(1, H - h))
      if (hash01(i, seed + 53) < 0.62) {
        // Displaced slice — the picture torn sideways. Drawing over the
        // intact frame leaves a ghosted edge, which reads as authentic
        // datamosh doubling.
        const dx = Math.round((hash01(i, seed + 59) - 0.5) * 2 * 70 * S * slices)
        if (dx !== 0) ctx.drawImage(snap, 0, y, W, h, dx, y, W, h)
      } else {
        // Raw color bar — a strip of pure signal corruption streaking off
        // one edge: half run off the RIGHT (hashed start in the left half),
        // half MIRROR off the LEFT (hashed end in the right half), so bursts
        // sit balanced instead of piling every bar onto the right side.
        const alpha = (0.35 + hash01(i, seed + 61) * 0.5) * (0.3 + 0.7 * slices)
        ctx.globalAlpha = alpha
        ctx.fillStyle = PALETTE[Math.floor(hash01(i, seed + 67) * PALETTE.length)]
        const off = Math.round(hash01(i, seed + 71) * W * 0.5)
        if (hash01(i, seed + 73) < 0.5) {
          // Anchored at `off`, running off the RIGHT edge.
          ctx.fillRect(off, y, W - off, h)
        } else {
          // Mirrored: runs off the LEFT edge, ending at W - off.
          ctx.fillRect(0, y, W - off, h)
        }
        ctx.globalAlpha = 1
      }
    }
  }

  /* --------------------------------- blocks --------------------------------- */
  if (blocks > 0.001) {
    const count = Math.round(3 + 9 * blocks)
    ctx.imageSmoothingEnabled = false // chunky nearest-neighbor pixels
    for (let i = 0; i < count; i++) {
      const size = Math.round((10 + hash01(i, seed) * (18 + 30 * blocks)) * S)
      if (size < 2) continue
      const x = Math.round(hash01(i, seed + 5) * Math.max(1, W - size))
      const y = Math.round(hash01(i, seed + 9) * Math.max(1, H - size))
      if (hash01(i, seed + 13) < 0.45) {
        // Wrong-macroblock copy — content teleported from elsewhere.
        const sx = Math.round(hash01(i, seed + 17) * Math.max(1, W - size))
        const sy = Math.round(hash01(i, seed + 23) * Math.max(1, H - size))
        ctx.drawImage(snap, sx, sy, size, size, x, y, size, size)
      } else {
        // Pixelate in place — magnify a small centered sub-region.
        const m = 3 + Math.floor(hash01(i, seed + 29) * 4) // 3..6× chunk
        const src = Math.max(1, Math.round(size / m))
        const off = Math.round((size - src) / 2)
        ctx.drawImage(snap, x + off, y + off, src, src, x, y, size, size)
      }
      if (hash01(i, seed + 31) < 0.3) {
        // Raw palette tint on some blocks — data painted the wrong color.
        ctx.globalAlpha = 0.2 + hash01(i, seed + 37) * 0.35
        ctx.fillStyle = PALETTE[Math.floor(hash01(i, seed + 41) * PALETTE.length)]
        ctx.fillRect(x, y, size, size)
        ctx.globalAlpha = 1
      }
    }
    ctx.imageSmoothingEnabled = true
  }
}
