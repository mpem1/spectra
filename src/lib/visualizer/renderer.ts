/**
 * Pulse Studio — the central pure render function.
 *
 * renderFrame(rc, frame, config) is DETERMINISTIC: no Math.random, no
 * Date.now, no state kept between calls. Same (rc, frame, config) → same
 * pixels, which is what makes the offline MP4 export frame-exact.
 *
 * All pixel metrics are designed against a 1280×720 canvas and multiplied by
 * S = height / 720 so 1080p / square / portrait exports look identical.
 */
import type {
  AudioFrame,
  BackgroundConfig,
  RenderContext,
  StudioConfig,
  VisualizerConfig,
} from './types'
import { buildGradient, buildRadialGradient, gradientLine, sampleGradient, withAlpha } from './gradients'
import { getBackgroundImage } from './image-cache'
import { getBackgroundVideo, getGifAnimation, gifFrameAt, isGifSrc } from './animated-bg'
import { drawLyrics } from './lyrics'
import { drawTitle } from './title'
import { drawDisc } from './disc'
import { drawWatermark } from './watermark'
import { drawPulseImage } from './pulse-image'
import { drawScreenFilter } from './screen-filter'
import { drawVhsFilter } from './vhs-filter'
import { drawFilmFilter } from './film-filter'
import { drawHalftoneFilter, flipGate } from './halftone-filter'
import { drawGlitchFilter } from './glitch-filter'
import { drawAnaglyphFilter } from './anaglyph-filter'
import { getWork, resetWork } from './filter-utils'

/* --------------------------------- Utilities -------------------------------- */

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

/** Deterministic seeded PRNG (mulberry32) — replaces Math.random everywhere. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function roundRectFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/** Fill a rounded rect using ctx.roundRect when available, else a manual path. */
function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius)
  } else {
    roundRectFallback(ctx, x, y, w, h, radius)
  }
  ctx.fill()
}

/* --------------------------------- renderFrame ------------------------------- */

export function renderFrame(rc: RenderContext, frame: AudioFrame, config: StudioConfig): void {
  const S = rc.height / 720
  rc.ctx.save()
  // Full-frame filter chain gate: transparent backgrounds skip them all so
  // alpha recordings stay clean.
  const transparent = config.background?.mode === 'transparent'
  // "Layers stay colored" — the moving layers (visualizer, pulse image,
  // vinyl disc) AND the text overlays render into their own transparent
  // overlay canvas instead of the main frame, and the overlay is drawn back
  // after the ENTIRE full-frame filter chain. Every filter then only ever
  // textures the background picture — the layers keep their full color on
  // top of screen, VHS, film, halftone print, glitch and 3D glasses alike —
  // and the layer order (text above everything) is preserved because the
  // text rides the same overlay.
  const stayColored = !transparent && !!config.layers?.stayColored
  // "Text stays legible" — the lighter sibling: ONLY the text overlays
  // (lyrics, titles, watermark) skip the filter chain while the moving
  // layers keep riding through it and take the full look. Inert while
  // stayColored is on (that already lifts the text above everything) and on
  // transparent backgrounds (those skip the filters anyway).
  const textClear = !transparent && !stayColored && !!config.layers?.textClear
  let ovCanvas: HTMLCanvasElement | null = null
  let layersRc: RenderContext = rc
  if (stayColored || textClear) {
    ovCanvas = getWork('layers:stayColored', rc.width, rc.height)
    const ovCtx = resetWork(ovCanvas.getContext('2d')!)
    ovCtx.clearRect(0, 0, rc.width, rc.height)
    layersRc = { ...rc, ctx: ovCtx }
  }
  // Where the moving layers draw: into the overlay while stayColored lifts
  // everything, straight onto the frame when only the text is protected (the
  // filters then texture them along with the background) — and onto the
  // frame too when neither bypass is on (the classic path). The text
  // overlays always draw to layersRc: the overlay whenever either bypass is
  // on, the frame itself on the classic path.
  const movingRc = stayColored ? layersRc : rc
  drawBackground(rc, frame, config.background, S)
  // Layer order vs. the album art layer: 'back' tucks the bars behind the
  // vinyl & cover, 'front' (the default, and what very old saves merge to)
  // keeps them on top. Lyrics/title always stay above everything.
  const vizBehind = (config.visualizer as VisualizerConfig | undefined)?.layer === 'back'
  // Pulse image behind everything except the background (pre-disc saves
  // merge layer='front', so this only runs when the user asks for it).
  if (config.pulseImage?.enabled && config.pulseImage.layer === 'back') {
    drawPulseImage(movingRc, frame, config.pulseImage, config.visualizer.gradient, S)
  }
  if (vizBehind) drawVisualizer(movingRc, frame, config.visualizer, S)
  // Album art layer (square cover + spinning vinyl/CD) — above the
  // visualizer, below the text overlays. Optional chaining keeps very old
  // saves (pre-disc) renderable even before the store merge runs.
  if (config.disc?.enabled) {
    drawDisc(movingRc, frame, config.disc)
  }
  if (!vizBehind) drawVisualizer(movingRc, frame, config.visualizer, S)
  // Pulse image in front of the bars & vinyl (the default placement).
  if (config.pulseImage?.enabled && config.pulseImage.layer !== 'back') {
    drawPulseImage(movingRc, frame, config.pulseImage, config.visualizer.gradient, S)
  }
  if (config.lyrics.enabled && config.lyrics.lines.length > 0) {
    drawLyrics(layersRc, frame, config.lyrics, config.visualizer.gradient)
  }
  // Optional chaining: configs from very old saves (pre-title) merge over
  // defaults in setConfig, but stay defensive here anyway.
  if (config.title?.enabled && config.title.text.trim().length > 0) {
    drawTitle(layersRc, frame, config.title, config.visualizer.gradient)
  }
  // Corner watermark — the very top layer, above lyrics/title, so posted
  // videos always carry the credit. Optional chaining: pre-watermark saves.
  if (config.watermark?.enabled) {
    drawWatermark(layersRc, config.watermark, S)
  }
  // "Filter alpha" — a single transparency dial on top of the ENTIRE filter
  // chain. Below 100% the pre-filter frame (background + moving layers +
  // text — exactly what the filters are about to texture) is snapshotted
  // here, and after the chain it is drawn back over the filtered result at
  // (1 − alpha): out = filtered·alpha + unfiltered·(1 − alpha). 100% keeps
  // the classic path byte-identical (no snapshot, no extra draw); 0% hides
  // every filter without touching their switches. Skipped on transparent
  // backgrounds (the filters don't run there anyway).
  const filterAlpha = transparent ? 1 : clamp01(config.layers?.filterAlpha ?? 1)
  let alphaSnapshot: HTMLCanvasElement | null = null
  if (filterAlpha < 1) {
    alphaSnapshot = getWork('layers:filterAlpha', rc.width, rc.height)
    const snapCtx = resetWork(alphaSnapshot.getContext('2d')!)
    snapCtx.clearRect(0, 0, rc.width, rc.height)
    snapCtx.drawImage(rc.ctx.canvas, 0, 0)
  }
  // Full-frame filter chain — the outermost passes, ON TOP of everything
  // above (the watermark included). Fixed order, each filter processes the
  // previous one's output: VHS distorts the picture → CRT displays it →
  // film damage scratches the display → halftone prints the result → glitch
  // corrupts the digital copy of it all → 3D glasses re-project the whole
  // mess for the paper-glasses viewer.
  // Optional chaining keeps very old saves renderable before the merge.
  drawScreenFilter(rc, config.screenFilter, frame, transparent)
  drawVhsFilter(rc, config.vhsFilter, frame, transparent)
  drawFilmFilter(rc, config.filmFilter, frame, transparent)
  drawHalftoneFilter(rc, config.halftoneFilter, frame, transparent)
  drawGlitchFilter(rc, config.glitchFilter, frame, transparent)
  drawAnaglyphFilter(rc, config.anaglyphFilter, frame, transparent)
  // Filter alpha: fade the unfiltered snapshot back over the finished chain
  // BEFORE the layer overlay returns, so the lifted layers/text (stayColored
  // / textClear) still land at full strength above the blend.
  if (alphaSnapshot) {
    rc.ctx.save()
    rc.ctx.globalAlpha = 1 - filterAlpha
    rc.ctx.drawImage(alphaSnapshot, 0, 0)
    rc.ctx.restore()
  }
  // "Layers stay colored" / "Text stays legible": bring the overlay back on
  // top of the finished filter chain — the very last pass, so every filter
  // (screen through 3D glasses) only ever textures whatever stayed below it
  // (the background alone, plus the moving layers when only the text is
  // protected).
  if (ovCanvas) {
    rc.ctx.drawImage(ovCanvas, 0, 0)
  }
  rc.ctx.restore()
}

/* --------------------------------- Background ------------------------------- */

/**
 * Cover-fit draw shared by the image AND video/GIF backgrounds: fills the
 * canvas (cropping overflow), centered, with the user's pan/zoom, mirrors,
 * beat motion (bounce zoom / shake jitter / blur swell) and the static media
 * blur. Blur + shake overscan the draw so softened or shifted edges never
 * reveal the canvas beneath.
 */
function drawMediaCover(
  ctx: CanvasRenderingContext2D,
  media: CanvasImageSource,
  naturalW: number,
  naturalH: number,
  bg: BackgroundConfig,
  W: number,
  H: number,
  S: number,
  /**
   * Beat-motion driver 0..1 — what the With the beat motions ride. Flip on
   * kick off: the live bass envelope, so the motions follow the bass
   * continuously. Flip on kick on: the flip gate's stamp-in envelope, so
   * the motions flip ON on each detected kick and the background rests
   * still between them.
   */
  beat = 0,
  /** Song time — keeps the beat shake's jitter direction deterministic. */
  time = 0,
): void {
  if (naturalW <= 0 || naturalH <= 0) return
  const fit = Math.max(W / naturalW, H / naturalH)
  const zoom = Math.max(0.05, bg.scale ?? 1)
  const beatLevel = clamp01(beat)
  // Beat bounce: the media breathes with the beat driver — at most +8% on
  // a full hit at pulse = 1. It only ever GROWS past the cover-fit base,
  // so the canvas is never left uncovered, and pulse = 0 is an exact no-op.
  const bounce = 1 + clamp01(bg.pulse ?? 0) * beatLevel * 0.08
  // Beat shake: deterministic jitter — a fresh pseudo-random direction every
  // 1/30 s of song time, scaled by strength × the beat driver, so it pulses
  // with the kick and freezes when the driver sits still. The seed is the
  // song clock, not the wall clock, so exported frames stay pixel-exact.
  const shakeAmt = clamp01(bg.shake ?? 0)
  let sx = 0
  let sy = 0
  if (shakeAmt > 0.001 && beatLevel > 0.001) {
    const rnd = mulberry32(Math.floor(time * 30))
    const amp = shakeAmt * beatLevel * Math.min(W, H) * 0.016
    sx = (rnd() * 2 - 1) * amp
    sy = (rnd() * 2 - 1) * amp
  }
  const scale = fit * zoom * bounce
  const dw = naturalW * scale
  const dh = naturalH * scale
  const cx = W / 2 + (bg.x ?? 0) * W + sx
  const cy = H / 2 + (bg.y ?? 0) * H + sy
  // Static blur (the Blur slider) + beat blur (Blur pulse swells with the
  // beat driver on top of it — up to ~30px more on a full hit at strength 1).
  const blurPx =
    'filter' in ctx
      ? clamp01(bg.blur ?? 0) * 40 * S + clamp01(bg.blurPulse ?? 0) * beatLevel * 30 * S
      : 0
  // Overscan so blurred edges AND the shake offsets never reveal the canvas
  // beneath — check both axes, the widest margin wins.
  const marginX = blurPx + Math.abs(sx)
  const marginY = blurPx + Math.abs(sy)
  const grow =
    marginX > 0.01 || marginY > 0.01 ? 1 + 2 * Math.max(marginX / dw, marginY / dh) : 1
  ctx.save()
  if (blurPx > 0.01) ctx.filter = `blur(${blurPx.toFixed(1)}px)`
  ctx.translate(cx, cy)
  ctx.scale(bg.flipX ? -1 : 1, bg.flipY ? -1 : 1)
  ctx.drawImage(media, (-dw * grow) / 2, (-dh * grow) / 2, dw * grow, dh * grow)
  ctx.restore()
}

function drawBackground(
  rc: RenderContext,
  frame: AudioFrame,
  bg: BackgroundConfig,
  S: number,
): void {
  const { ctx, width: W, height: H } = rc

  // Flip on kick — the same clean sub-band onset detector the halftone
  // print and the 3D glasses flips use, with its own 'bg' state so the
  // background's dials stay independent of every other card. While it's
  // on, the With the beat motions flip ON on each fired kick: the
  // background rests still between kicks, the bounce/shake/blur swell
  // stamp in at their dialed strength, hold for the hold dial, then ease
  // back to still. OFF (or non-media backgrounds) never touches the gate
  // and the motions keep riding the live bass continuously. The detector
  // listens to frame.sub — the clean 30–130 Hz RMS — falling back to the
  // clipped bass meter for pre-sub frame sources.
  const flipOn = (bg.mode === 'image' || bg.mode === 'video') && !!bg.beatFlip
  const flipT = flipOn
    ? flipGate(
        ctx,
        clamp01(frame.sub ?? frame.bass),
        frame.time,
        clamp01(bg.flipSensitivity ?? 0.1),
        clamp01(bg.flipHold ?? 0.2) * 2,
        'bg',
      )
    : 0
  // The beat-motion driver: with the flip on, the gate's stamp-in envelope
  // (0 at rest → 1 while a kick holds → eases back to still); without it,
  // the live bass meter exactly as before.
  const beat = flipOn ? flipT : frame.bass

  if (bg.mode === 'image') {
    // Zoomed-out / panned images and transparent PNGs don't necessarily
    // repaint the whole canvas. Always lay a dark base first so uncovered
    // areas never keep stale pixels from the previous frame (ghost trails
    // smearing the visualizer + imagery, looking like a broken alpha
    // filter) — in the live preview AND in every export path.
    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, W, H)
    const img = getBackgroundImage(bg.imageSrc)
    if (img) {
      // Cover-fit base scale, then user zoom/pan/flip/blur (shared with the
      // video/GIF background), then the shade fader on top.
      drawMediaCover(ctx, img, img.naturalWidth, img.naturalHeight, bg, W, H, S, beat, frame.time)
      // Shade fader — darkens the photo so the visualizer pops.
      const shade = clamp01(bg.shade ?? 0)
      if (shade > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${shade})`
        ctx.fillRect(0, 0, W, H)
      }
    }
    // Image still decoding — the base fill above is the dark fallback;
    // the next frame picks the image up.
  } else if (bg.mode === 'video') {
    // Animated background — looping muted video, or a GIF decoded into
    // deterministic frames. Both use the same cover-fit media transform as
    // the image background; the shade fader sits on top identically.
    // Same dark base as image mode: a zoomed-out video/GIF must not leave
    // stale pixels outside its drawn rect.
    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, W, H)
    const src = bg.videoSrc
    let drawn = false
    if (src && isGifSrc(src)) {
      const anim = getGifAnimation(src)
      if (anim) {
        const gifFrame = gifFrameAt(anim, frame.styleTime * 1000)
        if (gifFrame) {
          drawMediaCover(ctx, gifFrame, anim.width, anim.height, bg, W, H, S, beat, frame.time)
          drawn = true
        }
      }
    } else if (src) {
      const video = getBackgroundVideo(src)
      if (video) {
        drawMediaCover(ctx, video, video.videoWidth, video.videoHeight, bg, W, H, S, beat, frame.time)
        drawn = true
      }
    }
    if (drawn) {
      const shade = clamp01(bg.shade ?? 0)
      if (shade > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${shade})`
        ctx.fillRect(0, 0, W, H)
      }
    }
    // Still decoding / missing — the base fill above is the dark fallback.
  } else if (bg.mode === 'solid') {
    ctx.fillStyle = bg.color
    ctx.fillRect(0, 0, W, H)
  } else if (bg.mode === 'gradient') {
    const g = bg.gradient
    if (g.shape === 'radial') {
      // Palette radiates from the canvas center out to the farthest corner.
      ctx.fillStyle = buildRadialGradient(
        ctx,
        W / 2,
        H / 2,
        Math.hypot(W, H) / 2,
        g.stops,
        frame.styleTime,
        g.cycleColors,
        g.cycleSpeed,
      )
    } else {
      const line = gradientLine(g.angle, W, H)
      ctx.fillStyle = buildGradient(
        ctx,
        line.x0,
        line.y0,
        line.x1,
        line.y1,
        g.stops,
        frame.styleTime,
        g.cycleColors,
        g.cycleSpeed,
      )
    }
    ctx.fillRect(0, 0, W, H)
  }
  // 'transparent': leave the canvas alpha untouched.

  // Vignette overlay (skip when strength is 0).
  const vignette = clamp01(bg.vignette)
  if (vignette > 0) {
    const cx = W / 2
    const cy = H / 2
    const inner = Math.min(W, H) * 0.35
    const outer = Math.hypot(W, H) * 0.6
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer)
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)')
    grad.addColorStop(0.55, `rgba(0, 0, 0, ${vignette * 0.35})`)
    grad.addColorStop(1, `rgba(0, 0, 0, ${vignette})`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
  }

  // Film grain (skip when 0) — deterministic per frame index.
  const grain = clamp01(bg.grain)
  if (grain > 0) drawGrain(rc, grain, S)
}

function drawGrain(rc: RenderContext, grain: number, S: number): void {
  const { ctx, width: W, height: H, frame } = rc
  const rand = mulberry32(frame)
  const alpha = grain * 0.15
  const count = 2000
  const size = Math.max(1, Math.round(S))
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * W)
    const y = Math.floor(rand() * H)
    ctx.fillRect(x, y, size, size)
  }
}

/* --------------------------------- Visualizer -------------------------------- */

/** Whole-layer alpha for the visualizer: 1 − the Transparency dial, with
 *  missing/garbage values (very old raw configs that skipped the store
 *  merge) reading as 0 transparency — the classic fully-solid look. Shared
 *  by every style draw so the dial scales even the passes that set their
 *  own absolute globalAlpha (radial's inner ring, grid's frontier dots). */
function visualizerLayerAlpha(cfg: VisualizerConfig): number {
  const t = cfg.transparency
  return 1 - (typeof t === 'number' && Number.isFinite(t) ? clamp01(t) : 0)
}

function drawVisualizer(
  rc: RenderContext,
  frame: AudioFrame,
  cfg: VisualizerConfig,
  S: number,
): void {
  const { ctx, width: W, height: H } = rc
  // Layer transparency — the Style tab's Transparency dial fades the ENTIRE
  // visualizer (every style pass, the glow backdrop included) into whatever
  // sits behind it. Invisible layers skip all the work, like the lyrics
  // layer does at opacity 0. Setting globalAlpha here (inside save/restore)
  // also pins the baseline at 1 for the fully-solid path, so every pass
  // below inherits exactly the layer alpha.
  const layerAlpha = visualizerLayerAlpha(cfg)
  if (layerAlpha <= 0.002) return
  ctx.save()
  ctx.globalAlpha = layerAlpha
  // Layer layout (move + resize): the canvas-center point of the visualizer
  // layer is re-anchored at (positionX%, positionY%) and everything scales
  // away from that anchor — resize in place, then slide. At the defaults
  // (50 / 50 / 1) the transform is the identity, so classic layouts render
  // pixel-identical to before. Pure math → deterministic in exports.
  const zoom = clamp(cfg.scale ?? 1, 0.05, 4)
  const posX = (clamp(cfg.positionX ?? 50, 0, 100) / 100) * W
  const posY = (clamp(cfg.positionY ?? 50, 0, 100) / 100) * H
  if (zoom !== 1 || posX !== W / 2 || posY !== H / 2) {
    ctx.translate(posX, posY)
    ctx.scale(zoom, zoom)
    ctx.translate(-W / 2, -H / 2)
  }
  switch (cfg.style) {
    case 'bars':
    case 'wave':
    case 'grid':
    case 'ribbon': {
      // These three draw a classic left→right strip. Vertical orientation
      // rotates that strip 90° counter-clockwise into a top→bottom column:
      // bass stays at the bottom, bars/wave grow sideways from the layer's
      // right edge. The style code keeps drawing in its own left→right
      // space — we hand it a swapped (H×W) canvas and rotate it into place,
      // so every slider (count, mirror, glow, position, size) keeps behaving
      // exactly as in horizontal mode, and the strip always fits the canvas
      // without cropping (a plain rotation of a wide strip would overflow).
      // anchor = 'left' mirrors the rotated strip horizontally: same math,
      // flipped around the canvas' vertical center line, so the bars hang
      // from the LEFT edge and grow rightward instead.
      const vertical = (cfg.orientation ?? 'horizontal') === 'vertical'
      if (vertical) {
        ctx.translate(0, H)
        ctx.rotate(-Math.PI / 2)
        if ((cfg.anchor ?? 'right') === 'left') {
          // In the strip's own space the canvas mirror is a vertical flip:
          // shape (x, y) → (W − y, H − x) on the canvas.
          ctx.translate(0, W)
          ctx.scale(1, -1)
        }
      }
      const styleRc: RenderContext = vertical ? { ...rc, width: H, height: W } : rc
      if (cfg.style === 'bars') drawBars(styleRc, frame, cfg, S)
      else if (cfg.style === 'wave') drawWave(styleRc, frame, cfg, S)
      else if (cfg.style === 'ribbon') drawRibbon(styleRc, frame, cfg, S)
      else drawGrid(styleRc, frame, cfg, S)
      break
    }
    case 'radial':
      drawRadial(rc, frame, cfg, S)
      break
    case 'horizon':
      drawHorizon(rc, frame, cfg, S)
      break
    case 'particles':
      drawParticles(rc, frame, cfg, S)
      break
    case 'blob':
      drawBlob(rc, frame, cfg, S)
      break
    default:
      break
  }
  ctx.restore()
}

/** Shared bar-color sampler: gradient sampled at a canvas point (glow tints).
 *  Radial shape: the point's distance from the canvas center picks the palette
 *  position (concentric color rings). Linear shape: the point is PROJECTED
 *  onto the gradient line, so glow tints sweep at the same angle as the fill —
 *  without this, glows always swept left→right and at 180° the "top" palette
 *  color leaked into the bottom glow. Falls back to index-based sampling when
 *  no point is given. */
function barColorAt(
  cfg: VisualizerConfig,
  frame: AudioFrame,
  index: number,
  count: number,
  at?: { x: number; y: number; W: number; H: number },
): string {
  const g = cfg.gradient
  let t = count > 1 ? index / (count - 1) : 0
  if (at) {
    if (g.shape === 'radial') {
      const maxR = Math.hypot(at.W, at.H) / 2
      t = clamp01(Math.hypot(at.x - at.W / 2, at.y - at.H / 2) / maxR)
    } else {
      // Same direction + length math as gradientLine, evaluated as a scalar
      // projection: t = 0 at the gradient line's start, 1 at its end.
      const rad = (g.angle * Math.PI) / 180
      const dx = Math.sin(rad)
      const dy = -Math.cos(rad)
      const len = Math.abs(at.W * dx) + Math.abs(at.H * dy)
      const proj = (at.x - at.W / 2) * dx + (at.y - at.H / 2) * dy
      t = clamp01(proj / len + 0.5)
    }
  }
  return sampleGradient(g.stops, t, frame.styleTime, g.cycleColors, g.cycleSpeed)
}

/**
 * Gradient fill across the whole canvas for every visualizer style: LINEAR
 * sweeps at the configured angle, RADIAL radiates from the canvas center —
 * which is what makes the Shape switch visibly restyle the coloring.
 */
function visualizerFill(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig): CanvasGradient {
  const { ctx, width: W, height: H } = rc
  const g = cfg.gradient
  if (g.shape === 'radial') {
    return buildRadialGradient(
      ctx,
      W / 2,
      H / 2,
      Math.hypot(W, H) / 2,
      g.stops,
      frame.styleTime,
      g.cycleColors,
      g.cycleSpeed,
    )
  }
  const line = gradientLine(g.angle, W, H)
  return buildGradient(
    ctx,
    line.x0,
    line.y0,
    line.x1,
    line.y1,
    g.stops,
    frame.styleTime,
    g.cycleColors,
    g.cycleSpeed,
  )
}

/* ------------------------------------ bars ---------------------------------- */

function drawBars(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const n = Math.max(1, Math.floor(cfg.barCount))
  const freq = frame.freq
  const gap = clamp01(cfg.gap)
  const slot = W / n
  const barW = Math.max(1, slot * (1 - gap))
  const maxH = H * 0.72
  const minH = 3 * S
  const radius = clamp01(cfg.roundness) * (barW / 2)
  const sens = clamp(cfg.sensitivity, 0, 3)
  // Mirror/center anchor: H * mirrorOffset (0 = top edge, 0.5 = middle, 1 = bottom).
  const anchor = H * clamp01(cfg.mirrorOffset ?? 0.5)
  // One canvas-space gradient for all bars → the Angle slider rotates the
  // coloring across the whole visualizer (fill is continuous in canvas space).
  const fill = visualizerFill(rc, frame, cfg)
  ctx.fillStyle = fill

  for (let i = 0; i < n; i++) {
    const v = clamp01((i < freq.length ? freq[i] : 0) * sens)
    const h = Math.max(minH, v * maxH)
    const x = i * slot + (slot - barW) / 2
    const color = barColorAt(cfg, frame, i, n, {
      x: x + barW / 2,
      y: cfg.mirror === 'center' ? anchor : H - h / 2,
      W,
      H,
    })

    if (cfg.glow) {
      ctx.shadowColor = color
      ctx.shadowBlur = 18 * S
    } else {
      ctx.shadowBlur = 0
    }

    if (cfg.mirror === 'center') {
      // Bars grow from the anchor line both ways.
      fillRoundRect(ctx, x, anchor - h, barW, h * 2, radius)
    } else {
      // Bottom bars grow up from the floor.
      fillRoundRect(ctx, x, H - h, barW, h, radius)
      if (cfg.mirror === 'mirror') {
        // Flipped copy = the floor bars reflected across the offset axis
        // (at the default 0.5 axis this is the ceiling copy).
        const refY = 2 * anchor - H
        if (refY < H && refY + h > 0) fillRoundRect(ctx, x, refY, barW, h, radius)
      }
    }
  }
  ctx.shadowBlur = 0
}

/* ------------------------------------ wave ---------------------------------- */

function drawWave(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const wave = frame.wave
  const count = wave.length
  if (count < 2) return
  // Mirror/center anchor: the waveform folds around H * mirrorOffset
  // (plain 'none' waves stay canvas-centered).
  const centerY =
    cfg.mirror !== 'none' ? H * clamp01(cfg.mirrorOffset ?? 0.5) : H / 2
  const amp = Math.min(H * 0.22 * clamp(cfg.sensitivity, 0, 3), H * 0.42)
  const g = cfg.gradient
  const stroke = visualizerFill(rc, frame, cfg)

  const tracePath = (sign: number): void => {
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1)) * W
      const y = centerY + wave[i] * amp * sign
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
  }

  ctx.lineWidth = 3 * S
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = stroke
  if (cfg.glow) {
    ctx.shadowColor = sampleGradient(g.stops, 0.5, frame.styleTime, g.cycleColors, g.cycleSpeed)
    ctx.shadowBlur = 18 * S
  } else {
    ctx.shadowBlur = 0
  }

  tracePath(1)
  ctx.stroke()
  if (cfg.mirror !== 'none') {
    // Vertically mirrored copy for a symmetric envelope.
    tracePath(-1)
    ctx.stroke()
  }
  ctx.shadowBlur = 0
}

/* ----------------------------------- radial ---------------------------------- */

function drawRadial(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  // The Transparency dial's layer alpha — scales the inner ring pass below,
  // which otherwise pins its own absolute globalAlpha.
  const la = visualizerLayerAlpha(cfg)
  const n = Math.max(1, Math.floor(cfg.barCount))
  const freq = frame.freq
  const cx = W / 2
  const cy = H / 2
  const baseRadius = H * 0.18
  const maxLen = H * 0.48 - baseRadius
  const rotation = frame.styleTime * 0.15
  const sens = clamp(cfg.sensitivity, 0, 3)
  const lineWidth = Math.max(2, 3 * S)

  const drawSpoke = (angle: number, len: number): void => {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    ctx.beginPath()
    ctx.moveTo(cx + cos * baseRadius, cy + sin * baseRadius)
    ctx.lineTo(cx + cos * (baseRadius + len), cy + sin * (baseRadius + len))
    ctx.stroke()
  }

  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  // Angle-aware gradient across the canvas (rotates with the Angle slider).
  ctx.strokeStyle = visualizerFill(rc, frame, cfg)

  for (let i = 0; i < n; i++) {
    const t = i / n
    const angle = rotation + t * Math.PI * 2
    const v = clamp01((i < freq.length ? freq[i] : 0) * sens)
    const len = Math.min(4 * S + v * H * 0.22, maxLen)
    const color = barColorAt(cfg, frame, i, n, {
      x: cx + Math.cos(angle) * (baseRadius + len / 2),
      y: cy + Math.sin(angle) * (baseRadius + len / 2),
      W,
      H,
    })

    if (cfg.glow) {
      ctx.shadowColor = color
      ctx.shadowBlur = 18 * S
    } else {
      ctx.shadowBlur = 0
    }

    drawSpoke(angle, len)
    if (cfg.mirror === 'mirror') {
      // Reflected across the vertical axis for left/right symmetry.
      drawSpoke(Math.PI - angle, len)
    } else if (cfg.mirror === 'center') {
      // Inward copy of the same spoke.
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      ctx.beginPath()
      ctx.moveTo(cx + cos * baseRadius, cy + sin * baseRadius)
      ctx.lineTo(cx + cos * (baseRadius - len), cy + sin * (baseRadius - len))
      ctx.stroke()
    }
  }
  ctx.shadowBlur = 0

  // Thin inner ring + center dot (signature radial look).
  const midColor = sampleGradient(
    cfg.gradient.stops,
    0.5,
    frame.styleTime,
    cfg.gradient.cycleColors,
    cfg.gradient.cycleSpeed,
  )
  ctx.globalAlpha = 0.85 * la
  ctx.lineWidth = Math.max(1, 1.5 * S)
  ctx.strokeStyle = midColor
  ctx.beginPath()
  ctx.arc(cx, cy, baseRadius * 0.82, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = la
  ctx.fillStyle = midColor
  ctx.beginPath()
  ctx.arc(cx, cy, Math.max(2, 3.5 * S), 0, Math.PI * 2)
  ctx.fill()
}

const PARTICLE_COUNT = 90

function drawParticles(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const cx = W / 2
  const cy = H / 2
  const g = cfg.gradient
  const sens = clamp(cfg.sensitivity, 0, 3)
  const energy = clamp01(frame.energy)
  const bass = clamp01(frame.bass)
  // Angle-aware canvas gradient — particle colors follow their position.
  const fill = visualizerFill(rc, frame, cfg)
  const midColor = sampleGradient(g.stops, 0.5, frame.styleTime, g.cycleColors, g.cycleSpeed)
  ctx.fillStyle = fill

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Seeded constants per particle — identical every frame.
    const rnd = mulberry32(i * 1013 + 7)
    const baseAngle = rnd() * Math.PI * 2
    const baseR = (0.2 + rnd() * 0.28) * H
    const speed = (rnd() - 0.5) * 0.9
    const size = (1.5 + rnd() * 2.5) * S

    const angle = baseAngle + frame.styleTime * speed * (0.2 + energy * 1.5)
    const r = baseR * (1 + bass * 0.25 * sens)
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r

    ctx.shadowColor = midColor
    ctx.shadowBlur = cfg.glow ? 12 * S : 0
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()
  }

  // Soft center glow reacting to overall energy.
  ctx.shadowBlur = 0
  const glowRadius = Math.max(1, H * (0.06 + energy * 0.12 * sens))
  const glowColor = midColor
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius)
  glow.addColorStop(0, withAlpha(glowColor, 0.5))
  glow.addColorStop(1, withAlpha(glowColor, 0))
  ctx.fillStyle = glow
  ctx.fillRect(cx - glowRadius, cy - glowRadius, glowRadius * 2, glowRadius * 2)
}

/* ------------------------------------ blob ----------------------------------- */

/**
 * Organic audio blob — a liquid, breathing form. The spectrum is folded into
 * six zones, each driving one LOW-order harmonic (k = 2..7) around the
 * outline, which keeps the silhouette smooth and elegant instead of spiky.
 * Harmonic phases drift slowly so the deformation travels around the body,
 * an idle wobble keeps it alive in silence, and the whole shape rotates
 * gently. The body carries the full palette as a linear sweep (angle-aware)
 * or a radial center-out fade, finished with a soft aura, one halo echo, rim
 * shading, a specular highlight and a rim light. Fully deterministic — every
 * phase derives from frame.styleTime (song time in exports, wall clock in
 * preview).
 */
function drawBlob(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const cx = W / 2
  const cy = H / 2
  const sens = clamp(cfg.sensitivity, 0, 3)
  const bass = clamp01(frame.bass)
  const energy = clamp01(frame.energy)
  const g = cfg.gradient
  const t = frame.styleTime

  /* ---- fold the (log) spectrum into six zones → harmonic amplitudes ---- */
  const freq = frame.freq
  const len = Math.max(1, freq.length)
  const HARMONICS = [
    { k: 2, drift: 0.55, amp: 0.5 }, // bass zone — the biggest, slowest swell
    { k: 3, drift: -0.75, amp: 0.42 },
    { k: 4, drift: 0.95, amp: 0.34 },
    { k: 5, drift: -1.15, amp: 0.26 },
    { k: 6, drift: 1.3, amp: 0.18 },
    { k: 7, drift: -1.5, amp: 0.12 }, // treble zone — fine shimmer
  ]
  const zones = new Float32Array(HARMONICS.length)
  for (let z = 0; z < HARMONICS.length; z++) {
    const a = Math.floor((z / HARMONICS.length) * len)
    const b = Math.max(a + 1, Math.floor(((z + 1) / HARMONICS.length) * len))
    let sum = 0
    for (let i = a; i < b; i++) sum += freq[i] ?? 0
    zones[z] = clamp01((sum / (b - a)) * sens)
  }

  /* ---- radial deformation at angle a: harmonics + idle breathing ---- */
  const sampleDef = (a: number): number => {
    let def = 0
    for (let z = 0; z < HARMONICS.length; z++) {
      const h = HARMONICS[z]
      def += zones[z] * h.amp * Math.cos(h.k * a + t * h.drift)
    }
    // The blob stays alive even in total silence.
    def += 0.045 * Math.sin(2 * a + t * 0.8)
    def += 0.03 * Math.sin(3 * a - t * 0.5)
    def += 0.018 * Math.sin(5 * a + t * 0.33)
    return clamp(def, -0.35, 0.6)
  }

  const baseR = H * (0.185 + bass * 0.05 * sens + energy * 0.025)
  const rot = t * 0.1

  /* ---- smooth closed spline through K samples (quadratic midpoints) ---- */
  const K = 140
  const buildPath = (scale: number): Path2D => {
    const pts: Array<[number, number]> = []
    for (let i = 0; i < K; i++) {
      const a = (i / K) * Math.PI * 2
      const r = Math.min(baseR * (1 + sampleDef(a)), H * 0.44) * scale
      const ang = a + rot
      pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r])
    }
    const p = new Path2D()
    const mx = (pts[K - 1][0] + pts[0][0]) / 2
    const my = (pts[K - 1][1] + pts[0][1]) / 2
    p.moveTo(mx, my)
    for (let i = 0; i < K; i++) {
      const cur = pts[i]
      const nxt = pts[(i + 1) % K]
      p.quadraticCurveTo(cur[0], cur[1], (cur[0] + nxt[0]) / 2, (cur[1] + nxt[1]) / 2)
    }
    p.closePath()
    return p
  }

  const cMid = sampleGradient(g.stops, 0.5, t, g.cycleColors, g.cycleSpeed)
  const cHigh = sampleGradient(g.stops, 0.9, t, g.cycleColors, g.cycleSpeed)

  /* ---- soft aura behind everything ---- */
  const auraR = baseR * 2.1
  const aura = ctx.createRadialGradient(cx, cy, baseR * 0.35, cx, cy, auraR)
  aura.addColorStop(0, withAlpha(cMid, 0.2))
  aura.addColorStop(0.55, withAlpha(cMid, 0.07))
  aura.addColorStop(1, withAlpha(cMid, 0))
  ctx.fillStyle = aura
  ctx.fillRect(cx - auraR, cy - auraR, auraR * 2, auraR * 2)

  /* ---- single halo echo — clean depth without a blurry mess ---- */
  ctx.fillStyle = withAlpha(cMid, 0.1)
  ctx.fill(buildPath(1.16))

  /* ---- main body: the full palette across the blob — LINEAR sweeps it at
   * the configured angle (gradient line spans the body's bounding square) so
   * the Angle slider rotates the colors; RADIAL radiates from the blob's
   * center out to its rim (stop 0 = core, stop 100 = edge). ---- */
  const mainPath = buildPath(1)
  const span = Math.min(baseR * 1.35, H * 0.44)
  if (cfg.glow) {
    ctx.shadowColor = withAlpha(cMid, 0.8)
    ctx.shadowBlur = 30 * S
  } else {
    ctx.shadowBlur = 0
  }
  if (g.shape === 'radial') {
    ctx.fillStyle = buildRadialGradient(ctx, cx, cy, span, g.stops, t, g.cycleColors, g.cycleSpeed)
  } else {
    const line = gradientLine(g.angle, span * 2, span * 2)
    ctx.fillStyle = buildGradient(
      ctx,
      cx - span + line.x0,
      cy - span + line.y0,
      cx - span + line.x1,
      cy - span + line.y1,
      g.stops,
      t,
      g.cycleColors,
      g.cycleSpeed,
    )
  }
  ctx.fill(mainPath)
  ctx.shadowBlur = 0

  /* ---- rim shading for sphere-like depth ---- */
  const depth = ctx.createRadialGradient(cx, cy, baseR * 0.2, cx, cy, baseR * 1.02)
  depth.addColorStop(0.6, 'rgba(0, 0, 0, 0)')
  depth.addColorStop(1, withAlpha(cHigh, 0.4))
  ctx.fillStyle = depth
  ctx.fill(mainPath)

  /* ---- specular highlight ---- */
  const sheen = ctx.createRadialGradient(
    cx - baseR * 0.22,
    cy - baseR * 0.28,
    0,
    cx,
    cy,
    baseR * 1.1,
  )
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.26)')
  sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0.07)')
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = sheen
  ctx.fill(mainPath)

  /* ---- rim light ---- */
  ctx.lineWidth = Math.max(1, 1.8 * S)
  ctx.strokeStyle = withAlpha(cHigh, 0.8)
  ctx.stroke(mainPath)
}

/* ---------------------------------- ribbon ----------------------------------- */

/**
 * Liquid neon ribbon — the layered glow-wave poster look: a horizontal band
 * of translucent wave envelopes stacked around the canvas center, each layer
 * carrying the palette as its own drifting color sweep, finished with a
 * white-hot filament tracing the middle. The spectrum folds into a heavily
 * smoothed envelope (slightly log-spaced bins + two binomial smoothing
 * passes + quadratic midpoints), slow per-layer phase drift keeps the lobes
 * traveling like liquid, an idle triple-sine keeps it alive in total
 * silence, and the bass swells the whole band. Every number derives from
 * frame.styleTime / frame.freq — no randomness, fully deterministic in
 * exports. Mirror: 'none' = the classic symmetric ribbon (the reference
 * look), 'mirror' = additionally folded around the canvas' vertical center
 * line, 'center' = the lower half carries the phase-inverted envelope
 * (organic asymmetry). The strip joins the bars/wave/grid vertical-
 * orientation transform, so it can also run as a full-height column.
 */
const RIBBON_POINTS = 64
const RIBBON_CURVE = 96
const RIBBON_LAYERS = 4
/** Outer→inner amplitude scales — the wide soft bands sit behind, the tight
 *  saturated lobes ride in front, and the filament hugs the center. */
const RIBBON_AMP = [1.0, 0.8, 0.62, 0.45]
/** Outer→inner fill alphas — translucent bands stacking into a hot core. */
const RIBBON_ALPHA = [0.42, 0.55, 0.7, 0.88]

/** One binomial [1 4 6 4 1]/16 smoothing pass with edge clamping. */
function ribbonSmooth(src: Float32Array, dst: Float32Array): void {
  const n = src.length
  for (let i = 0; i < n; i++) {
    const a = src[Math.max(0, i - 2)] ?? 0
    const b = src[Math.max(0, i - 1)] ?? 0
    const c = src[i] ?? 0
    const d = src[Math.min(n - 1, i + 1)] ?? 0
    const e = src[Math.min(n - 1, i + 2)] ?? 0
    dst[i] = (a + 4 * b + 6 * c + 4 * d + e) / 16
  }
}

function drawRibbon(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const t = frame.styleTime
  const g = cfg.gradient
  const sens = clamp(cfg.sensitivity, 0, 3)
  const energy = clamp01(frame.energy)
  const bass = clamp01(frame.bass)
  // The whole-layer alpha (Transparency dial) — every pass multiplies it,
  // exactly like the radial inner ring does.
  const la = visualizerLayerAlpha(cfg)
  const cy = cfg.mirror !== 'none' ? H * clamp01(cfg.mirrorOffset ?? 0.5) : H / 2
  const maxAmp = Math.min(H * 0.21 * sens * (1 + bass * 0.3), H * 0.3)
  const minAmp = 1.2 * S

  /* ---- spectrum → twice-smoothed envelope control points ---- */
  const freq = frame.freq
  const len = Math.max(1, freq.length)
  const raw = new Float32Array(RIBBON_POINTS)
  for (let i = 0; i < RIBBON_POINTS; i++) {
    // Slightly log-spaced bins — the bass owns less of the ribbon than a
    // plain linear map would give it.
    const bin = Math.min(len - 1, Math.floor(((i + 0.5) / RIBBON_POINTS) ** 1.25 * len))
    raw[i] = clamp01((freq[bin] ?? 0) * sens)
  }
  const pass1 = new Float32Array(RIBBON_POINTS)
  const env = new Float32Array(RIBBON_POINTS)
  ribbonSmooth(raw, pass1)
  ribbonSmooth(pass1, env)

  /** Envelope at x (0..1) — interpolated control points + the idle
   *  triple-sine that keeps the ribbon dancing in total silence. */
  const envAt = (x01: number): number => {
    const f = clamp01(x01) * (RIBBON_POINTS - 1)
    const i = Math.floor(f)
    const fr = f - i
    const a = env[i] ?? 0
    const b = env[Math.min(RIBBON_POINTS - 1, i + 1)] ?? 0
    const base = a + (b - a) * fr
    const idle =
      0.1 * (0.5 + 0.5 * Math.sin(x01 * 3.4 + t * 0.55)) +
      0.05 * (0.5 + 0.5 * Math.sin(x01 * 5.1 - t * 0.4))
    return base + idle
  }

  /** Horizontal fold for Mirror = 'mirror' — continuous, smooth at the seam. */
  const fold = (x01: number): number => (cfg.mirror === 'mirror' ? 1 - Math.abs(1 - 2 * x01) : x01)

  /** Layer i's amplitude at x — envelope × traveling wobble. `flip`
   *  phase-inverts the wobble (Mirror = 'center' organic bottom half). */
  const layerAmp = (x01: number, i: number, flip: boolean): number => {
    const wobble =
      0.82 +
      0.18 * Math.sin(fold(x01) * (2.2 + i * 1.7) + t * (0.5 + i * 0.23) + (i + (flip ? 0.5 : 0)) * 1.9)
    return Math.max(minAmp, envAt(fold(x01)) * wobble * RIBBON_AMP[i] * maxAmp)
  }

  /** Smooth open spline through pts (quadratic midpoints, blob's technique). */
  const traceSpline = (pts: Array<[number, number]>): void => {
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let k = 1; k < pts.length - 1; k++) {
      const mx = (pts[k][0] + pts[k + 1][0]) / 2
      const my = (pts[k][1] + pts[k + 1][1]) / 2
      ctx.quadraticCurveTo(pts[k][0], pts[k][1], mx, my)
    }
    const last = pts[pts.length - 1]
    ctx.lineTo(last[0], last[1])
  }

  const buildCurve = (i: number, sign: number, flip: boolean): Array<[number, number]> => {
    const pts: Array<[number, number]> = []
    for (let k = 0; k <= RIBBON_CURVE; k++) {
      const x01 = k / RIBBON_CURVE
      pts.push([x01 * W, cy + sign * layerAmp(x01, i, flip)])
    }
    return pts
  }

  /** Layer i's fill: the palette swept along the configured gradient angle,
   *  with the sampling window rotated by the layer's slow phase drift — the
   *  hues travel through the band like the reference's liquid color wash. */
  const layerFill = (i: number): CanvasGradient => {
    const phase = (i / (RIBBON_LAYERS + 1) + t * 0.035 * (i % 2 === 0 ? 1 : -1) + 1) % 1
    const line = gradientLine(g.angle, W, H)
    const gr = ctx.createLinearGradient(line.x0, line.y0, line.x1, line.y1)
    const K = 6
    for (let j = 0; j <= K; j++) {
      const p = j / K
      gr.addColorStop(p, sampleGradient(g.stops, (p + phase) % 1, t, g.cycleColors, g.cycleSpeed))
    }
    return gr
  }

  const midColor = sampleGradient(g.stops, 0.5, t, g.cycleColors, g.cycleSpeed)

  /* ---- ambient aura — the soft color wash the band glows into ---- */
  if (cfg.glow) {
    const auraR = H * 0.8
    const aura = ctx.createRadialGradient(W / 2, cy, 0, W / 2, cy, auraR)
    aura.addColorStop(0, withAlpha(midColor, 0.12 * la))
    aura.addColorStop(0.5, withAlpha(midColor, 0.05 * la))
    aura.addColorStop(1, withAlpha(midColor, 0))
    ctx.fillStyle = aura
    ctx.fillRect(W / 2 - auraR, cy - auraR, auraR * 2, auraR * 2)
  }

  /* ---- the stacked wave layers, outermost first ---- */
  for (let i = 0; i < RIBBON_LAYERS; i++) {
    const top = buildCurve(i, -1, false)
    const bottom = buildCurve(i, 1, cfg.mirror === 'center')
    const closed: Array<[number, number]> = [...top, ...bottom.slice().reverse()]
    ctx.globalAlpha = RIBBON_ALPHA[i] * la
    ctx.fillStyle = layerFill(i)
    if (cfg.glow) {
      ctx.shadowColor = withAlpha(midColor, 0.85)
      ctx.shadowBlur = 24 * S
    } else {
      ctx.shadowBlur = 0
    }
    traceSpline(closed)
    ctx.closePath()
    ctx.fill()
    ctx.shadowBlur = 0
  }

  /* ---- white-hot filament along the middle of the band ---- */
  const filament = buildCurve(RIBBON_LAYERS - 1, -1, false).map(([x, y]) => [x, cy - (cy - y) * 0.45] as [number, number])
  ctx.globalAlpha = la
  ctx.lineWidth = Math.max(1.5, 2.6 * S)
  ctx.lineCap = 'round'
  ctx.strokeStyle = `rgba(255, 255, 255, ${(0.42 + 0.4 * energy).toFixed(3)})`
  if (cfg.glow) {
    ctx.shadowColor = 'rgba(255, 255, 255, 0.9)'
    ctx.shadowBlur = 14 * S
  } else {
    ctx.shadowBlur = 0
  }
  traceSpline(filament)
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.globalAlpha = 1
}

/* ------------------------------------ grid ----------------------------------- */

/**
 * Dot-matrix equalizer (the original "Matrix" look): small round dots in a
 * square grid, one column per spectrum band. Columns light bottom-up — or
 * outward from the vertical center when Mirror = center (as in the
 * reference screenshot). Dot colors come from the angle-based canvas
 * gradient; unlit cells are skipped entirely so the background shows through.
 */
function drawGrid(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const cols = Math.round(clamp(cfg.barCount, 8, 256))
  const marginX = W * 0.045
  const cell = (W - marginX * 2) / cols
  const rows = Math.max(4, Math.floor((H * 0.9) / cell))
  const gridW = cols * cell
  const gridH = rows * cell
  const x0 = (W - gridW) / 2
  const y0 = (H - gridH) / 2
  const sens = clamp(cfg.sensitivity, 0, 3)
  const radius = cell * (0.1 + 0.18 * clamp01(cfg.roundness)) * (1 - 0.5 * clamp01(cfg.gap))
  const freq = frame.freq
  // Mirror/center axis row: (rows-1) * mirrorOffset (0 = top row, 0.5 = middle).
  const axisRow = (rows - 1) * clamp01(cfg.mirrorOffset ?? 0.5)
  const fill = visualizerFill(rc, frame, cfg)
  // The Transparency dial's layer alpha — scales the frontier-dot fade
  // below, which otherwise pins its own absolute globalAlpha.
  const la = visualizerLayerAlpha(cfg)

  ctx.fillStyle = fill

  for (let c = 0; c < cols; c++) {
    const bin = Math.min(freq.length - 1, Math.floor((c / cols) * freq.length))
    const v = clamp01((freq[bin] ?? 0) * sens)
    if (v <= 0.001) continue
    const level = v * rows

    if (cfg.glow) {
      // Sample the glow tint at the center of this column's LIT extent (not
      // the canvas middle) so it matches the dots that are actually showing —
      // e.g. at 180° the bottom-lit columns glow with their own fill color.
      let midRow: number
      if (cfg.mirror === 'none') {
        midRow = (Math.max(0, rows - 1 - level) + (rows - 1)) / 2
      } else {
        // Lit extent is symmetric around the axis for center/mirror modes.
        midRow = clamp(axisRow, 0, rows - 1)
      }
      ctx.shadowColor = barColorAt(cfg, frame, c, cols, {
        x: x0 + c * cell + cell / 2,
        y: y0 + midRow * cell + cell / 2,
        W,
        H,
      })
      ctx.shadowBlur = 7 * S
    } else {
      ctx.shadowBlur = 0
    }

    // Batch all fully-lit dots of this column into one path; the frontier
    // dot(s) fade in smoothly via globalAlpha.
    const path = new Path2D()
    const frontier: Array<{ x: number; y: number; alpha: number }> = []

    for (let r = 0; r < rows; r++) {
      // coverage: ≥1 fully lit · 0..1 frontier fade · ≤0 dark
      let coverage: number
      if (cfg.mirror === 'center') {
        coverage = level / 2 - Math.abs(r - axisRow)
      } else if (cfg.mirror === 'mirror') {
        // Bottom-up growth plus its reflection across the offset axis
        // (at the default 0.5 axis this is the top-down copy).
        coverage = Math.max(level - (rows - 1 - r), level - rows + 1 + 2 * axisRow - r)
      } else {
        coverage = level - (rows - 1 - r)
      }
      if (coverage <= 0) continue
      const x = x0 + c * cell + cell / 2
      const y = y0 + r * cell + cell / 2
      if (coverage >= 1) {
        path.moveTo(x + radius, y)
        path.arc(x, y, radius, 0, Math.PI * 2)
      } else {
        frontier.push({ x, y, alpha: coverage })
      }
    }

    ctx.fill(path)
    for (const f of frontier) {
      ctx.globalAlpha = clamp01(f.alpha) * la
      ctx.beginPath()
      ctx.arc(f.x, f.y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = la
  }
  ctx.shadowBlur = 0
}

/* ---------------------------------- horizon ---------------------------------- */

/**
 * Perspective equalizer road — the "sound waveform flying past on black"
 * reference look: rounded neon pills standing on a horizon line, the up
 * side and its mirror pointing down, the whole row receding into a
 * vanishing point just past the right edge (giant near bars at the left, a
 * fine dense waveform texture far away) while the road streams past the
 * camera. Each bar tracks its own frequency bin — bass owns the near
 * field, treble the far texture — and the flow phase derives purely from
 * frame.styleTime, so exports stay frame-exact. An idle traveling wave
 * keeps the road alive in silence, the bass swells the whole road on a
 * hit, and each bar drags a translucent trail ghost where it stood a
 * moment ago. Palette: the up side sweeps the palette's first half (near =
 * first stop, fading into the middle hue at the vanishing point) and the
 * down side sweeps the second half mirrored (near = last stop) — the
 * dominant near field reads two-tone like the reference, and a red→blue
 * palette reproduces it exactly. Geometry is real perspective
 * (x, height and width all ∝ 1/depth), so bars crowd toward the vanishing
 * point with constant width-to-spacing ratio; the Gap dial thins the
 * pills, Roundness rounds their caps, and the horizon line itself rides
 * the Mirror offset value (labeled "Horizon" on this style's tab).
 */
function drawHorizon(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const t = frame.styleTime
  const freq = frame.freq
  const len = Math.max(1, freq.length)
  const sens = clamp(cfg.sensitivity, 0, 3)
  const bass = clamp01(frame.bass)
  const la = visualizerLayerAlpha(cfg)
  const g = cfg.gradient
  const cy = H * clamp01(cfg.mirrorOffset ?? 0.5)
  const round = clamp01(cfg.roundness)
  const gap = clamp01(cfg.gap)

  /* ---- road geometry: real perspective over the slot range ---- */
  const M = Math.round(clamp(cfg.barCount, 16, 192))
  const flow = clamp(cfg.flowSpeed ?? 0.5, 0, 1)
  const d0 = -0.16 // near cutoff — depth 0 sits just off the left edge
  const R = 24 // zFar / zNear — how hard the perspective squeezes the far end
  const XV = W * 1.04 // vanishing point, just past the right edge
  const A = (XV - W * 0.93) * R // x(d) = XV − A·R^(−d), chosen so x(1) = 0.93W
  const HNEAR = H * 2.05 // height at depth 0, amp = 1 — the near bars overflow
  const WNEAR = W * 0.16 // width ceiling at depth 0 (spacing usually binds first)
  const TRAIL_SLOTS = 0.85 // the trail ghost sits this many slots behind
  const phase = (t * flow * 2) % 1 // slots streamed past per second = flow × 2

  /** Depth parameter and screen x for slot progress p ∈ [0,1) (0 = nearest). */
  const depthAt = (p: number): number => d0 + (1 - d0) * p
  const xAt = (d: number): number => XV - A * Math.pow(R, -d)

  const xs = new Float64Array(M)
  const ws = new Float64Array(M)
  const hs = new Float64Array(M)
  const amps = new Float64Array(M)
  const dNs = new Float64Array(M)
  const ps = new Float64Array(M)
  for (let j = 0; j < M; j++) {
    const p = (((j - phase) % M) + M) % M / M
    const d = depthAt(p)
    ps[j] = p
    dNs[j] = (d - d0) / (1 - d0) // 0 near .. 1 far, for bins + palette
    xs[j] = xAt(d)
    // Frequency bin — bass near, treble far, slightly log-spaced. An idle
    // traveling wave keeps the road breathing in total silence.
    const bin = Math.min(len - 1, Math.floor(Math.pow(dNs[j], 1.12) * len))
    const amp0 = clamp01((freq[bin] ?? 0) * sens)
    const idle = 0.05 + 0.04 * Math.sin(dNs[j] * 16.5 - t * 1.9) + 0.025 * Math.sin(dNs[j] * 27.3 + t * 1.25)
    amps[j] = Math.max(amp0, idle)
    hs[j] = HNEAR * Math.pow(R, -d) * (0.085 + 0.915 * amps[j]) * (1 + bass * 0.22)
    // Width: the slot's on-screen room (constant ratio along the road),
    // thinned by the Gap dial, capped so the nearest off-screen slots
    // can't blob together.
    const dxFar = xs[(j + 1) % M] - xs[j]
    const dxNear = xs[j] - xs[(j - 1 + M) % M]
    const spacing = dxFar > 0 ? dxFar : dxNear
    ws[j] = Math.min(WNEAR * Math.pow(R, -d), spacing * (1 - gap * 0.85))
  }

  /** One pill pass — up (sign −1) and down (sign +1) share everything. */
  const pill = (x: number, w: number, h: number, sign: number, color: string, alpha: number, blur: number): void => {
    if (w <= 0.05 || h <= 0.05) return
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    if (cfg.glow) {
      ctx.shadowColor = color
      ctx.shadowBlur = blur
    } else {
      ctx.shadowBlur = 0
    }
    const r = (w / 2) * (0.25 + 0.75 * round)
    fillRoundRect(ctx, x - w / 2, sign < 0 ? cy - h : cy, w, h, r)
    ctx.fill()
  }

  // Painter's order: far first, near last (near pills overlap the far
  // texture, exactly like the reference). Slot index order IS progress
  // order except at the single wrap slot, so sort by depth once.
  const order = Array.from({ length: M }, (_, j) => j).sort((a, b) => dNs[b] - dNs[a])
  for (const j of order) {
    const x = xs[j]
    const w = ws[j]
    if (x + w < -2 || x - w > W + 2) continue
    const h = hs[j]
    const dN = dNs[j]
    // Two-tone near field: the up side owns the palette's first half, the
    // down side the second (mirrored) — both converge on the middle hue
    // toward the vanishing point, like the reference's red/blue road.
    const up = sampleGradient(g.stops, 0.5 * dN, t, g.cycleColors, g.cycleSpeed)
    const down = sampleGradient(g.stops, 1 - 0.5 * dN, t, g.cycleColors, g.cycleSpeed)
    // Trail ghost — the same pill where it stood TRAIL_SLOTS ago (farther
    // down the road), faint and slightly thinner.
    const pG = ps[j] + TRAIL_SLOTS / M
    const dG = depthAt(pG)
    const xG = xAt(dG)
    const hG = HNEAR * Math.pow(R, -dG) * (0.085 + 0.915 * amps[j]) * (1 + bass * 0.28)
    const wG = w * 0.9
    if (xG + wG >= -2 && xG - wG <= W + 2) {
      const blurG = wG * 1.1 + 2 * S
      pill(xG, wG, hG, -1, up, 0.15 * la, blurG)
      pill(xG, wG, hG, 1, down, 0.15 * la, blurG)
    }
    const blur = w * 1.1 + 2 * S
    pill(x, w, h, -1, up, la, blur)
    pill(x, w, h, 1, down, la, blur)
  }
  ctx.shadowBlur = 0
  ctx.globalAlpha = la
}
