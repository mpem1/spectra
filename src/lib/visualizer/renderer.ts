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
    case 'ribbon':
    case 'perspective':
    case 'terrain': {
      // These styles draw a classic left→right strip (the perspective road
      // included — its vanishing point then sits past the right edge, and
      // the terrain landscape's horizon runs through the middle). Vertical
      // orientation rotates that strip 90° counter-clockwise into a
      // top→bottom column: bass stays at the bottom, bars/wave grow sideways
      // from the layer's right edge (the perspective road points its
      // vanishing point at the bottom edge). The style code keeps drawing in
      // its own left→right space — we hand it a swapped (H×W) canvas and
      // rotate it into place, so every slider (count, mirror, glow, position,
      // size) keeps behaving exactly as in horizontal mode, and the strip
      // always fits the canvas without cropping (a plain rotation of a wide
      // strip would overflow). anchor = 'left' mirrors the rotated strip
      // horizontally: same math, flipped around the canvas' vertical center
      // line, so the bars hang from the LEFT edge and grow rightward instead.
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
      else if (cfg.style === 'perspective') drawPerspective(styleRc, frame, cfg, S)
      else if (cfg.style === 'terrain') drawTerrain(styleRc, frame, cfg, S)
      else drawGrid(styleRc, frame, cfg, S)
      break
    }
    case 'sphere':
      drawSphere(rc, frame, cfg, S)
      break
    case 'radial':
      drawRadial(rc, frame, cfg, S)
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
  if (cfg.mirror === 'mirror') {
    // Mirror: the trace plus its vertical reflection — two mirrored lines
    // sharing the offset axis (a symmetric envelope of strokes).
    tracePath(-1)
    ctx.stroke()
  } else if (cfg.mirror === 'center') {
    // Center: the wave grows BOTH ways from the axis — the band between
    // the up-trace and the down-trace fills solid, one symmetric body
    // around the offset line (the bars' double-sided center look, for the
    // wave). Mirror keeps the two-line look, so the two modes read
    // completely differently.
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1)) * W
      const y = centerY + wave[i] * amp
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    for (let i = count - 1; i >= 0; i--) {
      ctx.lineTo((i / (count - 1)) * W, centerY - wave[i] * amp)
    }
    ctx.closePath()
    ctx.fillStyle = stroke
    ctx.fill()
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
  // Mirror family: 'mirror' gives every particle a left/right twin across
  // the canvas' vertical axis (a two-fold kaleidoscope); 'center' gives it
  // a point-reflected twin through the canvas center (the 180° opposite).
  // Pure math — deterministic in exports.
  const reflect = (cfg.mirror ?? 'none') === 'mirror'
  const pointSym = (cfg.mirror ?? 'none') === 'center'
  // Angle-aware canvas gradient — particle colors follow their position.
  const fill = visualizerFill(rc, frame, cfg)
  const midColor = sampleGradient(g.stops, 0.5, frame.styleTime, g.cycleColors, g.cycleSpeed)
  ctx.fillStyle = fill

  const dot = (dx: number, dy: number, ds: number): void => {
    ctx.shadowColor = midColor
    ctx.shadowBlur = cfg.glow ? 12 * S : 0
    ctx.beginPath()
    ctx.arc(dx, dy, ds, 0, Math.PI * 2)
    ctx.fill()
  }

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

    dot(x, y, size)
    if (reflect) dot(2 * cx - x, y, size)
    else if (pointSym) dot(2 * cx - x, 2 * cy - y, size)
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
 * shading, a specular highlight and a rim light. Mirror family: 'mirror'
 * redraws the whole body flipped across the vertical axis (a two-lobed
 * symmetric form), 'center' grows an inner concentric core inside the body.
 * Fully deterministic — every
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

  /* ---- soft aura behind everything (painted ONCE — it's symmetric, so
   *  the Mirror twin must never double it) ---- */
  const auraR = baseR * 2.1
  const aura = ctx.createRadialGradient(cx, cy, baseR * 0.35, cx, cy, auraR)
  aura.addColorStop(0, withAlpha(cMid, 0.2))
  aura.addColorStop(0.55, withAlpha(cMid, 0.07))
  aura.addColorStop(1, withAlpha(cMid, 0))
  ctx.fillStyle = aura
  ctx.fillRect(cx - auraR, cy - auraR, auraR * 2, auraR * 2)

  // Mirror family: 'mirror' = the blob and its left/right mirror image —
  // the whole body pass redraws flipped across the vertical axis (a
  // two-lobed symmetric form); 'center' = the blob grows from its own
  // middle — an inner concentric core rides inside the body (the family's
  // grow-from-the-axis semantic). Deterministic either way.
  const mirrorMode = cfg.mirror ?? 'none'
  const reflect = mirrorMode === 'mirror'

  /* ---- the body passes: halo echo, palette fill, rim depth, sheen and
   *  rim light. Pure local math, so it can simply run twice for Mirror. ---- */
  const paintBody = (): void => {
    /* ---- single halo echo — clean depth without a blurry mess ---- */
    ctx.fillStyle = withAlpha(cMid, 0.1)
    ctx.fill(buildPath(1.16))

    /* ---- main body: the full palette across the blob — LINEAR sweeps it at
     * the configured angle (gradient line spans the body's bounding square) so
     * the Angle slider rotates the colors; RADIAL radiates from the blob's
     * center out to its rim (stop 0 = core, stop 100 = edge). ---- */
    const bodyPath = buildPath(1)
    const bodySpan = Math.min(baseR * 1.35, H * 0.44)
    if (cfg.glow) {
      ctx.shadowColor = withAlpha(cMid, 0.8)
      ctx.shadowBlur = 30 * S
    } else {
      ctx.shadowBlur = 0
    }
    if (g.shape === 'radial') {
      ctx.fillStyle = buildRadialGradient(ctx, cx, cy, bodySpan, g.stops, t, g.cycleColors, g.cycleSpeed)
    } else {
      const line = gradientLine(g.angle, bodySpan * 2, bodySpan * 2)
      ctx.fillStyle = buildGradient(
        ctx,
        cx - bodySpan + line.x0,
        cy - bodySpan + line.y0,
        cx - bodySpan + line.x1,
        cy - bodySpan + line.y1,
        g.stops,
        t,
        g.cycleColors,
        g.cycleSpeed,
      )
    }
    ctx.fill(bodyPath)
    ctx.shadowBlur = 0

    /* ---- rim shading for sphere-like depth ---- */
    const depth = ctx.createRadialGradient(cx, cy, baseR * 0.2, cx, cy, baseR * 1.02)
    depth.addColorStop(0.6, 'rgba(0, 0, 0, 0)')
    depth.addColorStop(1, withAlpha(cHigh, 0.4))
    ctx.fillStyle = depth
    ctx.fill(bodyPath)

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
    ctx.fill(bodyPath)

    /* ---- rim light ---- */
    ctx.lineWidth = Math.max(1, 1.8 * S)
    ctx.strokeStyle = withAlpha(cHigh, 0.8)
    ctx.stroke(bodyPath)
  }

  paintBody()
  if (reflect) {
    // The mirrored twin: the identical scene under a horizontal flip
    // around the blob's center — gradients and highlights flip with it.
    ctx.save()
    ctx.translate(2 * cx, 0)
    ctx.scale(-1, 1)
    paintBody()
    ctx.restore()
  } else if (mirrorMode === 'center') {
    // The inner core: the same deformation field scaled into the middle,
    // with its own halo, palette fill and rim — a nucleus the body grows
    // around (Center's grow-from-the-middle look).
    const coreScale = 0.55
    const coreSpan = Math.min(baseR * 1.35, H * 0.44) * coreScale
    ctx.fillStyle = withAlpha(cMid, 0.1)
    ctx.fill(buildPath(coreScale * 1.16))
    if (g.shape === 'radial') {
      ctx.fillStyle = buildRadialGradient(ctx, cx, cy, coreSpan, g.stops, t, g.cycleColors, g.cycleSpeed)
    } else {
      const line = gradientLine(g.angle, coreSpan * 2, coreSpan * 2)
      ctx.fillStyle = buildGradient(
        ctx,
        cx - coreSpan + line.x0,
        cy - coreSpan + line.y0,
        cx - coreSpan + line.x1,
        cy - coreSpan + line.y1,
        g.stops,
        t,
        g.cycleColors,
        g.cycleSpeed,
      )
    }
    if (cfg.glow) {
      ctx.shadowColor = withAlpha(cMid, 0.8)
      ctx.shadowBlur = 16 * S
    }
    ctx.fill(buildPath(coreScale))
    ctx.shadowBlur = 0
    ctx.lineWidth = Math.max(1, 1.4 * S)
    ctx.strokeStyle = withAlpha(cHigh, 0.8)
    ctx.stroke(buildPath(coreScale))
  }
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
/* -------------------------------- perspective -------------------------------- */

/**
 * Perspective equalizer — the "sound waveform, seamlessly looped audio
 * equalizer isolated on black solid, moving red and blue" reference look.
 * A real one-point-perspective road (x, width and height all ∝ 1/depth):
 * bars stream from the vanishing point at the right edge toward the camera,
 * bass owns the near field, treble the far texture, and the flow phase
 * derives purely from frame.styleTime so exports stay frame-exact. The
 * road is tuned LONG — chunky near pills that overflow the frame like the
 * reference, a gentle perspective squeeze (R=18) so the strip reads as one
 * long receding wall, and the Bar count dial feeds it at half weight
 * (perspective spacing eats slots: 64 bars → a 32-slot road) — and it
 * rotates with the shared Orientation switch (vertical = the road running
 * top→bottom, vanishing point at the top edge, near pills at the bottom). Its visual language:
 *
 * - STRICT two-color split at every depth — the up side is always the
 *   Up color (hot red), the down side always the Down color (electric
 *   blue). No palette sweep, no converging middle hue; only a mild depth
 *   dim so the far texture sinks into the black.
 * - Echo trails: a dimmer ghost extends past each pill's cap — filling
 *   exactly where the bar stood a moment ago (up side: vertical rib
 *   combs, down side: a dot matrix, like the reference's LED trails).
 *   Fully deterministic: the ghost's length rides a traveling wave over
 *   (styleTime, depth, slot), so identical inputs still give identical
 *   pixels.
 * - LED segment texture: fine vertical ribs inside the solid pills (near
 *   slots only — the far texture is thinner than a rib pitch), selling the
 *   LED-matrix read of the reference.
 * - Fully-rounded capsules with soft bloom, a faint idle traveling wave in
 *   silence, and a bass swell that pushes the whole road up on a hit.
 *
 * Shared dials: Bar count (road density), Orientation + Side, Gap,
 * Roundness, Glow, Horizon (the up/down meeting line), Flow speed,
 * Sensitivity, Smoothing, Transparency, Position/Size, Layer.
 */
function drawPerspective(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const t = frame.styleTime
  const freq = frame.freq
  const len = Math.max(1, freq.length)
  const sens = clamp(cfg.sensitivity, 0, 3)
  const bass = clamp01(frame.bass)
  const la = visualizerLayerAlpha(cfg)
  const cy = H * clamp01(cfg.mirrorOffset ?? 0.5)
  // Mirror family: 'mirror' slides a faded reflection of the up bars out
  // from under the road — a red twin that is the bars' exact 1:1 flip
  // across the water line (the Mirror offset dial moves that line lower;
  // the reflection keeps the bars' true height, so it always matches
  // point for point); 'center' runs a twin road entering from the
  // left edge, so the tunnel converges dead-center, symmetric both ways.
  // 'none' is the untouched classic.
  const mirrorMode = cfg.mirror ?? 'none'
  const centerSym = mirrorMode === 'center'
  const reflect = mirrorMode === 'mirror'
  const drop = clamp01(cfg.perspMirrorDrop ?? 0) * H * 0.2
  const round = clamp01(cfg.roundness)
  const gap = clamp01(cfg.gap)
  // Strict two-color split — flat colors, depth only dims them.
  const upColor = typeof cfg.perspUp === 'string' && cfg.perspUp ? cfg.perspUp : '#ff1f1f'
  const downColor = typeof cfg.perspDown === 'string' && cfg.perspDown ? cfg.perspDown : '#1e6bff'
  const texture = clamp01(cfg.perspTexture ?? 0.45)
  const echo = clamp01(cfg.perspEcho ?? 0.55)

  /* ---- road geometry: real perspective, tuned long like the reference ----
   * Bar count feeds the road at half weight — perspective spacing eats
   * slots (they stretch apart toward the camera), so 64 bars gives the
   * reference's ~32-slot road of chunky near pills. */
  const M = Math.round(clamp(cfg.barCount * 0.5, 16, 128))
  const flow = clamp(cfg.flowSpeed ?? 0.5, 0, 1)
  const d0 = -0.16
  const R = 18 // zFar / zNear — the long read: a gentle, receding squeeze
  const XV = centerSym ? W * 0.5 : W * 1.04 // vanishing point: dead ahead in Center mode
  // x(d) = XV − A·R^(−d). Classic: A·R is sized so x(1) = 0.93W — the road
  // sweeps the whole canvas. Center: the near edge lands just past the
  // right edge and the far end a hair past the middle (the twin road
  // paints the mirrored left half, so the tunnel fills the canvas).
  const A = centerSym ? XV - W * 1.06 : (XV - W * 0.93) * R
  const HNEAR = H * 2.45 // height at depth 0, amp = 1 — the near pills overflow
  const WNEAR = W * 0.34 // width ceiling at depth 0 (spacing usually binds first)
  const phase = (t * flow * 2) % 1

  const depthAt = (p: number): number => d0 + (1 - d0) * p
  const xAt = (d: number): number => XV - A * Math.pow(R, -d)

  const xs = new Float64Array(M)
  const ws = new Float64Array(M)
  const hs = new Float64Array(M)
  const dNs = new Float64Array(M)
  const ps = new Float64Array(M)
  for (let j = 0; j < M; j++) {
    const p = ((((j - phase) % M) + M) % M) / M
    const d = depthAt(p)
    ps[j] = p
    dNs[j] = (d - d0) / (1 - d0)
    xs[j] = xAt(d)
    // Frequency bin — bass near, treble far, slightly log-spaced. An idle
    // traveling wave keeps the road breathing in total silence.
    const bin = Math.min(len - 1, Math.floor(Math.pow(dNs[j], 1.12) * len))
    const amp0 = clamp01((freq[bin] ?? 0) * sens)
    const idle = 0.05 + 0.04 * Math.sin(dNs[j] * 16.5 - t * 1.9) + 0.025 * Math.sin(dNs[j] * 27.3 + t * 1.25)
    const amp = Math.max(amp0, idle)
    hs[j] = HNEAR * Math.pow(R, -d) * (0.085 + 0.915 * amp) * (1 + bass * 0.22)
    const dxFar = xs[(j + 1) % M] - xs[j]
    const dxNear = xs[j] - xs[(j - 1 + M) % M]
    // |·| — the Center road runs A < 0 (x decreases with depth), so the
    // raw deltas are negative there; the gap itself is what matters.
    const spacing = Math.abs(dxFar > 0 ? dxFar : dxNear)
    ws[j] = Math.min(WNEAR * Math.pow(R, -d), spacing * (1 - gap * 0.85))
  }

  /** Solid capsule pass, shared by both sides. */
  const pill = (
    x: number,
    w: number,
    h: number,
    sign: number,
    color: string,
    alpha: number,
    base: number = cy,
  ): void => {
    if (w <= 0.05 || h <= 0.05) return
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    if (cfg.glow) {
      ctx.shadowColor = color
      ctx.shadowBlur = w * 1.1 + 2 * S
    } else {
      ctx.shadowBlur = 0
    }
    const r = (w / 2) * (0.25 + 0.75 * round)
    fillRoundRect(ctx, x - w / 2, sign < 0 ? base - h : base, w, h, r)
    ctx.fill()
    ctx.shadowBlur = 0
  }

  /**
   * Echo ghost — the extension region beyond the pill's cap (up: from the
   * cap upward, down: from the cap downward), i.e. where the bar stood a
   * moment ago. Length rides a deterministic traveling wave, so the trails
   * breathe and slide as the road streams, like the reference's looping
   * history. Up side draws vertical rib combs; down side draws the LED dot
   * matrix. Both fade to nothing at their far end.
   */
  const drawEcho = (x: number, w: number, h: number, j: number, sign: number, color: string, fade: number): void => {
    if (echo <= 0.01 || w < 1.5) return
    // Where the bar "stood a moment ago": 0..1.35× beyond the current cap.
    const wave01 = 0.5 + 0.5 * Math.sin(t * 2.2 + dNs[j] * 13.0 + ps[j] * Math.PI * 4)
    const extra = h * echo * (0.25 + 1.1 * wave01)
    if (extra < 0.5) return
    const alpha = 0.32 * echo * fade
    const capY = sign < 0 ? cy - h : cy + h // pill's outer edge
    const farY = sign < 0 ? capY - extra : capY + extra
    // Clip the trail to what's on screen (near bars can overflow hard).
    const fromY = capY
    const toY = sign < 0 ? Math.max(farY, -2) : Math.min(farY, H + 2)
    if (Math.abs(toY - fromY) < 0.5) return
    if (sign < 0) {
      // Up side — vertical rib combs: 4 thin stripes in the bar color.
      const n = 4
      const sw = (w / n) * 0.55
      const grad = ctx.createLinearGradient(0, fromY, 0, toY)
      grad.addColorStop(0, color)
      grad.addColorStop(1, withAlpha(color, 0))
      ctx.globalAlpha = alpha * la
      ctx.fillStyle = grad
      for (let k = 0; k < n; k++) {
        const xr = x - w / 2 + (w * (k + 0.5)) / n - sw / 2
        ctx.fillRect(xr, Math.min(fromY, toY), sw, Math.abs(toY - fromY))
      }
    } else {
      // Down side — LED dot matrix: chunky cells fading toward the tip.
      const cell = Math.max(2.5 * S, w / 3.2)
      const cols = Math.max(1, Math.floor(w / cell))
      const rows = Math.min(160, Math.ceil(Math.abs(toY - fromY) / cell))
      const x0 = x - (cols * cell) / 2
      const y0 = Math.min(fromY, toY)
      for (let r = 0; r < rows; r++) {
        const ry = y0 + r * cell
        const k = 1 - r / rows // fade toward the tip
        ctx.globalAlpha = alpha * la * (0.35 + 0.65 * k)
        ctx.fillStyle = color
        for (let c = 0; c < cols; c++) {
          ctx.fillRect(x0 + c * cell + cell * 0.2, ry + cell * 0.2, cell * 0.6, cell * 0.6)
        }
      }
    }
  }

  /** LED segment ribs inside a solid pill (near slots only). */
  const drawRibs = (x: number, w: number, h: number, sign: number, base: number = cy): void => {
    if (texture <= 0.03 || w < 5) return
    ctx.globalAlpha = 0.22 * texture * la
    ctx.fillStyle = '#000000'
    const n = 4 // ~4 LED segments across a near pill
    const sw = Math.max(1, w * 0.07)
    for (let k = 1; k < n; k++) {
      const xr = x - w / 2 + (w * k) / n - sw / 2
      const yTop = sign < 0 ? base - h : base
      ctx.fillRect(xr, yTop + h * 0.08, sw, h * 0.84)
    }
  }

  // Painter's order: far first, near last (near pills overlap the far
  // texture, exactly like the reference). Center mode paints the road
  // twice — the twin enters from the left edge, so the tunnel converges
  // dead-center with both halves filled.
  const order = Array.from({ length: M }, (_, j) => j).sort((a, b) => dNs[b] - dNs[a])
  const paintRoad = (flip: boolean): void => {
    for (const j of order) {
      const x = flip ? W - xs[j] : xs[j]
      const w = ws[j]
      if (x + w < -2 || x - w > W + 2) continue
      const h = hs[j]
      const dN = dNs[j]
      const fade = 1 - 0.38 * dN // far texture sinks gently into the black
      // Echo first (it lives behind the solid pill, beyond its cap).
      drawEcho(x, w, h, j, -1, upColor, fade)
      drawEcho(x, w, h, j, 1, downColor, fade)
      pill(x, w, h, -1, upColor, la * fade)
      drawRibs(x, w, h, -1)
      if (reflect) {
        // The reflection: the up bar's TRUE 1:1 mirror across the water
        // line (cy + drop) — a bar spanning [cy − h, cy] flips to
        // [cy + 2·drop, cy + 2·drop + h], gap and all, so the twin always
        // matches its bar exactly. A touch wider than its bar so a red
        // fringe peeks around the blue even at 0, and faded to half
        // strength so it reads as wet pavement.
        pill(x, w * 1.18, h, 1, upColor, la * fade * 0.5, cy + 2 * drop)
      }
      pill(x, w, h, 1, downColor, la * fade)
      drawRibs(x, w, h, 1)
    }
  }
  paintRoad(false)
  if (centerSym) paintRoad(true)
  ctx.shadowBlur = 0
  ctx.globalAlpha = la
}

/* ---------------------------------- Terrain ---------------------------------- */

/**
 * Terrain — the 3D wireframe landscape. A perspective ground-plane mesh of
 * spectrum ridges rolling toward the camera: real pinhole projection with
 * geometric depth steps (u = focal / z, so the rows bunch at the horizon
 * exactly like a receding ground plane), columns converging on the
 * vanishing point, and row heights riding the music with bass near the
 * camera and treble far — the same bin mapping the road uses. The whole
 * surface streams toward the viewer with the Flow speed dial, the palette
 * sweeps left→right across the columns, and depth fog sinks the far rows
 * into the black. Deterministic: every height is a pure function of
 * (column, depth-row, styleTime) — smooth value noise + traveling phases,
 * no stored history — so exports render frame-exact pixels.
 *
 * Visual language:
 * - Solid earth: each depth row fills the band between its ridge line and
 *   the flat ground below it (the Fill dial; 0 = the pure wireframe).
 *   Painter's order far → near makes the fills double as the occlusion.
 * - Glow underlay: the near rows get one soft shadowed stroke behind the
 *   crisp lines (a single stroke per row — cheap, unlike per-segment blur).
 * - Wireframe: ridge lines stroked with the per-column palette color; faint
 *   column curtains run into the depth and sell the 3D grid.
 * - Idle: in total silence a slow rolling-hills wave keeps it alive.
 *
 * Shared dials: Bar count (feeds the columns at 3/4 weight), Orientation +
 * Side, Horizon (the vanishing line), Flow speed, Glow, Sensitivity,
 * Smoothing, Transparency, Position/Size, Layer — plus the full Gradient
 * palette (this style sweeps it across the columns, unlike the road's
 * strict two-color split).
 */
function drawTerrain(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const t = frame.styleTime
  const freq = frame.freq
  const len = Math.max(1, freq.length)
  const sens = clamp(cfg.sensitivity, 0, 3)
  const bass = clamp01(frame.bass)
  const la = visualizerLayerAlpha(cfg)
  const hy = H * clamp01(cfg.mirrorOffset ?? 0.5) // the vanishing line (Horizon dial)
  const flow = clamp(cfg.flowSpeed ?? 0.5, 0, 1)
  const fill = clamp01(cfg.terrainFill ?? 0.4)
  // Mirror family: 'mirror' pulls the range up onto a shore and lays a true
  // lake below it — the whole landscape flipped across ONE water line, and
  // the dial SLIDES the whole mirrored world (range above the line, its
  // exact 1:1 reflection below) up or down the canvas — the flip never
  // distorts and nothing ever leaves the screen; 'center' keeps the
  // full-height range and grows it symmetrically around each row's ground
  // line with its OWN hills below (a phase-shifted noise field), so the two
  // modes read completely differently.
  const mirrorMode = cfg.mirror ?? 'none'
  const centerSym = mirrorMode === 'center'
  const reflect = mirrorMode === 'mirror'

  // Mesh density — columns ride Bar count at 3/4 weight (a near edge denser
  // than ~128 lines turns to mush); rows are fixed at a good depth read.
  const COLS = Math.round(clamp(cfg.barCount * 0.75, 24, 128))
  const ROWS = 22

  /* ---- pinhole projection ----
   * u = focal / z with GEOMETRIC depth steps (each row sits a constant
   * world-ratio deeper: the road's spacing family). u decays from 1 at the
   * near edge to uFar at the horizon, so screen gaps shrink toward the
   * horizon — real receding-ground bunching. The camera rides at world
   * height CAM above the ground so the near edge lands just past the bottom
   * edge; world peaks reach HPEAK (screen height at u = 1). */
  const uFar = 1 / 9
  const uAt = (r: number): number => Math.pow(uFar, 1 - r / ROWS) // r: 0 far → ROWS near
  const CAM = H * 1.12 - hy
  const XW = W * 0.78 // world half-width — the near edge overflows the sides
  const HPEAK = H * 0.3

  // Smooth value noise over a hashed integer lattice — pure, so identical
  // (column, v) always yields the same hill. Two octaves for ridge character.
  const hash2 = (ix: number, iy: number): number => {
    const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453
    return s - Math.floor(s)
  }
  const noise2 = (x: number, y: number): number => {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const fx = x - ix
    const fy = y - iy
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const a = hash2(ix, iy)
    const b = hash2(ix + 1, iy)
    const c = hash2(ix, iy + 1)
    const d = hash2(ix + 1, iy + 1)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
  }

  // Palette swept left→right across the columns (the Gradient section shows
  // for this style — same sampler the bars use).
  const colColor = (c: number): string => barColorAt(cfg, frame, c, COLS)

  // Per-row audio: bass near the camera, treble far (the road's bin map).
  // The idle wave varies with column AND depth so silent hills still roll.
  const rowAmp = (r: number, c: number): number => {
    const dN = 1 - r / ROWS
    const bin = Math.min(len - 1, Math.floor(Math.pow(dN, 1.12) * len))
    const amp0 = clamp01((freq[bin] ?? 0) * sens)
    const idle =
      0.06 +
      0.05 * Math.sin(c * 0.31 + (ROWS - r) * 0.42 - t * 1.35) +
      0.03 * Math.sin(c * 0.13 - (ROWS - r) * 0.71 + t * 0.85)
    return Math.max(amp0, idle)
  }

  /** World-space elevation at (depth row, column). The noise field flows:
   *  v = distance-from-camera minus a flow phase, so as t advances the same
   *  hill lands on nearer rows — the terrain streams toward the viewer. */
  const worldH = (r: number, c: number): number => {
    const v = (ROWS - r) * 0.42 - t * flow * 2.2
    const n = noise2(c * 0.33, v) * 0.72 + noise2(c * 0.71 + 37.2, v * 1.9 + 11.4) * 0.28
    return HPEAK * (0.12 + 0.88 * rowAmp(r, c)) * (0.22 + 0.78 * n) * (1 + bass * 0.25)
  }

  /** The Center mode's underside elevation: the SAME amplitude envelope
   *  (rowAmp drives both halves with the same band energy) over a
   *  phase-shifted noise field, so the lower hills are the terrain's own —
   *  an organic inverted range, not the mirror's copy. */
  const worldHLow = (r: number, c: number): number => {
    const v = (ROWS - r) * 0.42 - t * flow * 2.2
    const n = noise2(c * 0.33 + 137.1, v + 71.3) * 0.72 + noise2(c * 0.71 + 91.2, v * 1.9 + 5.8) * 0.28
    return HPEAK * (0.12 + 0.88 * rowAmp(r, c)) * (0.22 + 0.78 * n) * (1 + bass * 0.25)
  }

  // Precompute the mesh's screen positions (world height × u = screen rise).
  const px = new Float64Array((ROWS + 1) * COLS)
  const py = new Float64Array((ROWS + 1) * COLS)
  const gy = new Float64Array(ROWS + 1)
  for (let r = 0; r <= ROWS; r++) {
    const u = uAt(r)
    gy[r] = hy + CAM * u
    for (let c = 0; c < COLS; c++) {
      const xw = (c / (COLS - 1) - 0.5) * 2 * XW
      const idx = r * COLS + c
      px[idx] = W / 2 + xw * u
      py[idx] = gy[r] - worldH(r, c) * u
    }
  }

  /* ---- Mirror mode: a true lake on its own axis ----
   * The classic landscape fills every row down past the bottom edge, so
   * folding each row across its own ground line interleaves ghost ridges
   * with the hills — the reflection reads as strokes laid ON TOP of the
   * terrain (and the near rows — the tallest peaks — reflect off screen).
   * A lake needs room: in Mirror mode the whole range is pulled up onto a
   * shore (a vertical compression about the horizon that ends the near
   * edge ~72% down the canvas) and PINNED there — the dial then slides
   * ONLY the water line, the mirror's own axis. The range never moves
   * with the dial; the reflection is ALWAYS the exact 1:1 flip of what
   * sits above the line (never squashed, never slid), so a Horizon change
   * re-matches land and lake point for point. Positive sinks the line
   * toward the bottom edge — the lake detaches from the shore and can
   * outgrow the frame (the flipped peaks run past the bottom edge, like a
   * real lake shot from shore). Negative raises the line INTO the range —
   * high water: the submerged foothills dim under the surface and the
   * lake reflects the peaks still above the line, with the travel
   * spanning the range's full height (stopping just short of the highest
   * ridge so something dry always remains to reflect). Center mode keeps
   * the full-height range and pins its fold to the ground line; its dial
   * (Spread) scales how deep the range's own underside grows. Pure math
   * → deterministic. */
  const dropV = clamp(cfg.terrainMirrorDrop ?? 0, -1, 1)
  const spread = centerSym ? 1 + dropV : 1
  let rpy: Float64Array | null = null
  let waterY = 0
  let flood = false
  if (reflect) {
    const gyNear = gy[ROWS] // the near edge — past the canvas bottom
    const k = clamp((H * 0.72 - hy) / Math.max(1e-6, gyNear - hy), 0.12, 1)
    for (let r = 0; r <= ROWS; r++) gy[r] = hy + (gy[r] - hy) * k
    for (let i = 0; i < py.length; i++) py[i] = hy + (py[i] - hy) * k
    // The water line: the shore plus the signed dial. Positive sinks it up
    // to 85% of the free space below the shore; negative raises it the
    // range's full height — always strictly below the highest ridge, so
    // something dry remains to reflect.
    let topY = Infinity
    for (let i = 0; i < py.length; i++) topY = Math.min(topY, py[i])
    const span = Math.max(1e-6, gy[ROWS] - topY)
    waterY =
      dropV >= 0
        ? gy[ROWS] + dropV * (H - gy[ROWS]) * 0.85
        : Math.max(gy[ROWS] + dropV * Math.max(H * 0.02, span - H * 0.02), topY + H * 0.01)
    flood = waterY < gy[ROWS]
    // The exact 1:1 flip across the water line; points below the line
    // (submerged at high water) fold flat onto it, so the lake never
    // paints over the range that shelters it.
    rpy = new Float64Array(py.length)
    for (let i = 0; i < py.length; i++) rpy[i] = 2 * waterY - Math.min(py[i], waterY)
  }

  /** The lower half's screen Y at (row, col): the lake reflection in Mirror
   *  mode (the whole range flipped across the single water line), the
   *  organic underside in Center mode at the Spread dial's depth. */
  const lowY = (r: number, c: number): number => {
    if (centerSym) return gy[r] + worldHLow(r, c) * uAt(r) * spread
    return rpy ? rpy[r * COLS + c] : py[r * COLS + c]
  }

  const rowPath = (r: number): void => {
    ctx.beginPath()
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c
      if (c === 0) ctx.moveTo(px[idx], py[idx])
      else ctx.lineTo(px[idx], py[idx])
    }
  }

  // Pass 1 — solid earth: each row fills its ridge-to-ground band, far →
  // near, so nearer bands overlap farther ones like real hills. Center
  // mode fills the symmetric band between the ridge and its mirror below
  // the ground line instead.
  if (fill > 0.01) {
    for (let r = 0; r <= ROWS; r++) {
      const dN = 1 - r / ROWS
      const fade = 1 - 0.68 * dN
      rowPath(r)
      if (centerSym) {
        for (let c = COLS - 1; c >= 0; c--) {
          ctx.lineTo(px[r * COLS + c], lowY(r, c))
        }
      } else {
        ctx.lineTo(px[r * COLS + COLS - 1], gy[r])
        ctx.lineTo(px[r * COLS], gy[r])
      }
      ctx.closePath()
      // High water: a row whose ground line sits below the water line is
      // under the surface — dim the whole band so the submerged foothills
      // sink into the lake.
      ctx.globalAlpha = la * fill * fade * (flood && gy[r] > waterY ? 0.35 : 1)
      ctx.fillStyle = withAlpha(colColor(COLS >> 1), 0.24)
      ctx.fill()
      if (reflect) {
        // The lake: the same band flipped across the water line, faded so
        // it reads as water. Far rows sit highest above the shore, so
        // their inverted bands land deepest — an upside-down range.
        ctx.beginPath()
        for (let c = 0; c < COLS; c++) {
          const idx = r * COLS + c
          if (c === 0) ctx.moveTo(px[idx], lowY(r, c))
          else ctx.lineTo(px[idx], lowY(r, c))
        }
        // The row's ground edge flips too — clamped at the line for
        // submerged rows, so the lake never paints above its own surface.
        const flipGy = 2 * waterY - Math.min(gy[r], waterY)
        ctx.lineTo(px[r * COLS + COLS - 1], flipGy)
        ctx.lineTo(px[r * COLS], flipGy)
        ctx.closePath()
        ctx.globalAlpha = la * fill * fade * 0.55
        ctx.fill()
      }
    }
  }

  // Pass 2 — column curtains: faint lines running into the depth at every
  // few columns; they converge on the vanishing point and sell the grid.
  const colStep = Math.max(1, Math.round(COLS / 18))
  ctx.lineWidth = Math.max(1, 1.05 * S)
  ctx.globalAlpha = la * 0.15
  for (let c = 0; c < COLS; c += colStep) {
    ctx.beginPath()
    for (let r = 0; r <= ROWS; r++) {
      const idx = r * COLS + c
      if (r === 0) ctx.moveTo(px[idx], py[idx])
      else ctx.lineTo(px[idx], py[idx])
    }
    ctx.strokeStyle = colColor(c)
    ctx.stroke()
    if (centerSym || reflect) {
      // The lower copy: Center's own hills below the ground line, or the
      // lake's inverted range below the water line.
      ctx.beginPath()
      for (let r = 0; r <= ROWS; r++) {
        const idx = r * COLS + c
        if (r === 0) ctx.moveTo(px[idx], lowY(r, c))
        else ctx.lineTo(px[idx], lowY(r, c))
      }
      ctx.stroke()
    }
  }

  // Pass 3 — glow underlay: one soft shadowed stroke per near row (cheap —
  // ~14 shadowed strokes), sitting behind the crisp ridge lines.
  if (cfg.glow) {
    const mid = colColor(COLS >> 1)
    ctx.strokeStyle = mid
    ctx.shadowColor = mid
    ctx.shadowBlur = 13 * S
    ctx.lineWidth = 3 * S
    ctx.globalAlpha = la * 0.42
    for (let r = Math.floor(ROWS * 0.35); r <= ROWS; r++) {
      rowPath(r)
      ctx.stroke()
    }
    ctx.shadowBlur = 0
  }

  // Pass 4 — the crisp ridge lines: per-segment palette colors, fog-dimmed
  // with depth, thinner as they recede. Center/mirror modes add the lower
  // copy: the symmetric range's underside, or the lake reflection.
  for (let r = 0; r <= ROWS; r++) {
    const dN = 1 - r / ROWS
    const fade = 1 - 0.62 * dN
    ctx.lineWidth = Math.max(1, (1.7 - 0.95 * dN) * S)
    ctx.globalAlpha = la * fade
    for (let c = 0; c < COLS - 1; c++) {
      const i0 = r * COLS + c
      ctx.beginPath()
      ctx.moveTo(px[i0], py[i0])
      ctx.lineTo(px[i0 + 1], py[i0 + 1])
      ctx.strokeStyle = colColor(c)
      // High water: a segment fully below the water line is under the
      // surface — dim it so the submerged foothills sink into the lake.
      if (flood && py[i0] > waterY && py[i0 + 1] > waterY) ctx.globalAlpha = la * fade * 0.35
      ctx.stroke()
      if (centerSym || reflect) {
        // Center: the underside's own segment at full strength. Mirror: the
        // lake reflection, faded to half strength so it reads as water.
        ctx.globalAlpha = la * fade * (reflect ? 0.55 : 1)
        ctx.beginPath()
        ctx.moveTo(px[i0], lowY(r, c))
        ctx.lineTo(px[i0 + 1], lowY(r, c + 1))
        ctx.stroke()
        ctx.globalAlpha = la * fade
      }
    }
  }
}

/* ---------------------------------- sphere ----------------------------------- */

/**
 * Sphere — a 3D dot-matrix planet. A latitude/longitude grid of dots on a
 * sphere that spins around a tilted axis; every latitude ring rides its own
 * frequency band (bass at the equator, treble toward the poles), and each
 * dot grows an audio "quill" outward with its band's energy. A pinhole
 * projection plus depth shading (the back hemisphere prints dimmer, smaller
 * and behind the front dots) sells the 3D; a palette halo breathes with the
 * bass behind it. Pure styleTime math → deterministic exports.
 */
function drawSphere(rc: RenderContext, frame: AudioFrame, cfg: VisualizerConfig, S: number): void {
  const { ctx, width: W, height: H } = rc
  const t = frame.styleTime
  const freq = frame.freq
  const len = Math.max(1, freq.length)
  const sens = clamp(cfg.sensitivity, 0, 3)
  const bass = clamp01(frame.bass)
  const la = visualizerLayerAlpha(cfg)
  const spin = clamp01(cfg.sphereSpin ?? 0.35)
  const quills = clamp01(cfg.sphereQuills ?? 0.6)

  // Mesh density — rings ride Bar count at 1/5 weight (poles would mush
  // past ~26 rings), dots-per-ring at 4/5. Bar count 64 → a 13 × 54 planet.
  const LAT = Math.round(clamp(cfg.barCount * 0.2, 10, 26))
  const LON = Math.round(clamp(cfg.barCount * 0.85, 24, 88))

  const cx = W / 2
  const cy = H / 2
  const R = Math.min(W, H) * 0.3
  const CAM = R * 3.4 // pinhole distance — p = CAM / (CAM + z), z ∈ [-1.6R .. R]

  // Spin around the Y axis + a gentle axial wobble, both pure styleTime.
  // The fixed tilt leans the north pole toward the camera so the top of the
  // planet reads as a ball, not a flat disc.
  const ang = t * (0.2 + spin * 1.3)
  const ca = Math.cos(ang)
  const sa = Math.sin(ang)
  const tilt = -0.42 + 0.05 * Math.sin(t * 0.45)
  const ct = Math.cos(tilt)
  const st = Math.sin(tilt)

  // Orientation: 'vertical' quarter-rolls the whole planet about the view
  // axis (the same CCW turn the strip styles use) — the pole-to-pole axis
  // swings from screen-vertical to screen-horizontal. Exact 0/1 constants
  // keep the roll deterministic.
  const vertical = (cfg.orientation ?? 'horizontal') === 'vertical'
  const crz = vertical ? 0 : 1
  const srz = vertical ? 1 : 0
  // (The Mirror family was reverted here on purpose: a mirrored twin just
  // doubled the dot shell into mush — the planet reads best as one clean
  // orb, so the sphere ignores the Mirror dropdown entirely.)

  const shell = 1 + bass * 0.16 // the whole planet breathes with the low end

  // Per-ring constants: trig, the ring's frequency bin (equator = bass,
  // poles = treble) and its palette color (swept south pole → north pole).
  const sinT = new Float64Array(LAT)
  const cosT = new Float64Array(LAT)
  const bins = new Int32Array(LAT)
  const colors: string[] = new Array(LAT)
  for (let i = 0; i < LAT; i++) {
    const theta = (Math.PI * (i + 0.5)) / LAT // mid-ring, avoids the exact poles
    sinT[i] = Math.sin(theta)
    cosT[i] = Math.cos(theta)
    const latN = Math.abs(theta / Math.PI - 0.5) * 2
    bins[i] = Math.min(len - 1, Math.floor(Math.pow(latN, 1.15) * len))
    colors[i] = barColorAt(cfg, frame, i, LAT)
  }

  const total = LAT * LON
  // Screen-space point records — collected unsorted, painted far → near.
  const px = new Float64Array(total) // dot (quill tip) position
  const py = new Float64Array(total)
  const pa = new Float64Array(total) // depth-shaded alpha
  const pr = new Float64Array(total) // dot radius (px)
  const qx0 = new Float64Array(total) // quill root, on the shell
  const qy0 = new Float64Array(total)
  const qx1 = new Float64Array(total) // quill tip
  const qy1 = new Float64Array(total)
  const pc: string[] = new Array(total)
  const zs = new Float64Array(total) // view depth for the painter's sort

  let n = 0
  for (let i = 0; i < LAT; i++) {
    const ringPhase = i * 0.35 // stagger rings so longitude columns don't line up
    for (let j = 0; j < LON; j++, n++) {
      const phi = (2 * Math.PI * j) / LON + ringPhase
      // This dot's band energy + the idle shimmer (alive in silence).
      const amp0 = clamp01((freq[bins[i]] ?? 0) * sens)
      const idle = 0.05 + 0.05 * Math.sin(phi * 3 + t * 1.2 + i * 0.7)
      const amp = Math.max(amp0, idle)

      // Unit-sphere point → spin → tilt. Rotation preserves the length, so
      // (x1, y2, z2) is still the radial direction for the displacement.
      const x0 = sinT[i] * Math.cos(phi)
      const y0 = cosT[i]
      const z0 = sinT[i] * Math.sin(phi)
      const x1 = x0 * ca + z0 * sa
      const z1 = -x0 * sa + z0 * ca
      const y2 = y0 * ct - z1 * st
      const z2 = y0 * st + z1 * ct
      // Orientation quarter-roll about the view axis (depth is untouched).
      const xr = x1 * crz - y2 * srz
      const yr = x1 * srz + y2 * crz

      const surface = R * shell
      const tip = surface * (1 + amp * 0.5 * quills)

      // Pinhole projection of the quill root (on the shell) and tip.
      const pR = CAM / (CAM + z2 * surface)
      const pT = CAM / (CAM + z2 * tip)
      qx0[n] = cx + xr * surface * pR
      qy0[n] = cy - yr * surface * pR
      qx1[n] = cx + xr * tip * pT
      qy1[n] = cy - yr * tip * pT
      px[n] = qx1[n]
      py[n] = qy1[n]

      // Depth shading: 1 at the near pole, fading to a dim print on the
      // back hemisphere — the see-through far side is the 3D read.
      const front = clamp01((R - z2 * surface) / (2 * R))
      pa[n] = 0.2 + 0.8 * Math.pow(front, 1.35)
      pr[n] = (0.9 + 1.5 * front + amp * 1.2) * S
      pc[n] = colors[i]
      zs[n] = z2 * surface
    }
  }

  // Painter's order: the far hemisphere first, the near hemisphere last, so
  // front dots overlap the dim back print. Stable sort → deterministic.
  const order = Array.from({ length: total }, (_, k) => k)
  order.sort((a, b) => zs[b] - zs[a])

  // Pass 1 — the atmosphere: a soft palette halo that swells with the bass
  // (the Glow switch) + a faint core disc so the planet has body behind the
  // dot shell even where the far side thins out.
  const mid = colors[LAT >> 1]
  ctx.globalAlpha = la
  const halo = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 1.55)
  halo.addColorStop(0, withAlpha(mid, 0))
  halo.addColorStop(0.55, withAlpha(mid, 0.02 + bass * 0.05))
  halo.addColorStop(0.8, withAlpha(mid, 0.1 + bass * 0.13))
  halo.addColorStop(1, withAlpha(mid, 0))
  if (cfg.glow) {
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(cx, cy, R * 1.55, 0, Math.PI * 2)
    ctx.fill()
  }
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.02)
  core.addColorStop(0, withAlpha(mid, 0.14 + bass * 0.1))
  core.addColorStop(1, withAlpha(mid, 0))
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2)
  ctx.fill()

  // Pass 2 — the dot shell: quill stroke (root → tip) + the tip dot, far →
  // near. Quills skip when they'd be sub-pixel (quills at 0 / a still shell).
  ctx.lineWidth = Math.max(0.75, 1.1 * S)
  for (let k = 0; k < total; k++) {
    const idx = order[k]
    const dx = qx1[idx] - qx0[idx]
    const dy = qy1[idx] - qy0[idx]
    if (dx * dx + dy * dy > 0.64) {
      ctx.globalAlpha = la * pa[idx] * 0.85
      ctx.strokeStyle = pc[idx]
      ctx.beginPath()
      ctx.moveTo(qx0[idx], qy0[idx])
      ctx.lineTo(qx1[idx], qy1[idx])
      ctx.stroke()
    }
    ctx.globalAlpha = la * pa[idx]
    ctx.fillStyle = pc[idx]
    ctx.beginPath()
    ctx.arc(px[idx], py[idx], pr[idx], 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = la
}
