/**
 * Polaroid filter — the wall of instant prints (the reference image: a full
 * page of scattered white polaroid cards with empty black photo squares —
 * except here every square is a live window).
 *
 * The frame is rebuilt as a studio table: a paper (or charcoal) backdrop, a
 * scattered field of classic 88×107 mm prints — each with its 79 mm square
 * photo window and chunky chin — tilted off an overlapping grid so they pile
 * exactly like the reference photo, and inside every card's square section
 * the FULL finished picture shows through, squeezed whole into the window
 * (a wall of live prints of the music video). GRID SPLIT (the effect.app
 * look) cuts each square into 3×3 sections that drift apart on their own
 * phase and jump to a fresh shuffle on detected kicks, always staying inside
 * their frame. An optional polaroid-specific photo upload prints the user's
 * own image on every card instead (still music-reactive: it breathes with
 * the low end, and grid split works on it the same).
 *
 * ONE IMAGE ACROSS THE WALL (photoMode 'mosaic'): a second upload lays one
 * image over the whole page — every card's window becomes a live reveal of
 * the piece of the image at that card's own spot (no two cards alike), the
 * image itself doubles as the backdrop layer behind the cards (the 'image'
 * backdrop), and grid split slides its sections over the image the same way.
 * The whole layer breathes with the low end while React to beat is on, and
 * the Image size / Position / Rotation dials punch it in, slide it across
 * the frame at its true size and spin it — the scale only grows as far as
 * the spin itself demands (tilted frame corners must stay covered), never
 * because the picture moved.
 *
 * BACKGROUND SCENE: while the wall covers the page it acts as the page's
 * backdrop — the renderer re-draws the moving layers (the Style tab's
 * visualizer, pulse image, vinyl) and the text overlays ON TOP of the wall,
 * so the style keeps playing in front (the windows still hold their prints
 * of the picture, which already includes the layers drawn before the chain).
 *
 * How it draws (per frame):
 *   1. snapshot the finished picture — the content every window shows;
 *   2. paint the backdrop (paper gradient + soft vignette, or charcoal);
 *   3. for each print, in stack order: squeeze the content into the photo
 *      window (single draw, or 9 shifted cells under the grid split), then
 *      stamp the pre-rendered card sprite (baked soft shadow, window already
 *      cut out with destination-out) plus the window bevel overlay.
 *
 * The card sprite and bevel are rendered ONCE per print size — the per-frame
 * loop is pure drawImage, no gradients, no shadowBlur, no per-pixel work.
 *
 * Determinism: the wall layout comes from mulberry32 seeded by integer
 * hashing of (canvas size, density, scatter) — the exact same print positions
 * every frame and on every machine, preview and export alike. Motion runs on
 * the AudioFrame clocks (styleTime drift, time-gated kicks) and hash01 cell
 * phases, so nothing flickers or reshuffles between frames. Transparent
 * backgrounds skip the pass (alpha must stay clean).
 */
import type { AudioFrame, RenderContext, PolaroidFilterConfig } from './types'
import { getWork, resetWork, clamp01, hash01 } from './filter-utils'
import { flipGate } from './halftone-filter'
import { getBackgroundImage } from './image-cache'

/** Classic polaroid proportions — 88 × 107 mm card, 79 mm square photo,
 *  ~4.5 mm side margins and ~5 mm top margin (the chin gets the rest). */
const FRAME_W_RATIO = 88 / 107
const SIDE_PAD = 4.5 / 88
const TOP_PAD = 5 / 107
const WIN_RATIO = 79 / 88

/** Grid split sections per photo window (3×3 — the effect.app look). */
const SPLIT_N = 3

/** Hard cap on prints per frame — density 1 on a wide canvas would otherwise
 *  spawn ~350 cards; 140 keeps phones smooth while reading as a full wall. */
const MAX_PRINTS = 140

/** Minimum pan travel per axis, as a fraction of the frame. The wall image
 *  always slides at its true size — even when its cover fit leaves no
 *  overflow (a square or portrait image on a wide page binds the width axis
 *  at Image size 100%, which used to leave Position X dead). Past the
 *  image's own edge the bare table tone simply shows; more Image size means
 *  more sliding room. The scale never reacts to the pan — a pan-driven
 *  auto-zoom used to read as the dials zooming in and out. */
const PAN_SLACK = 0.25

interface PolaroidPrint {
  /** Card center, canvas px */
  cx: number
  cy: number
  /** Tilt, radians */
  rot: number
  /** Size jitter multiplier */
  scale: number
  /** Stable per-print id for the cell phases */
  seed: number
}

interface PolaroidLayout {
  prints: PolaroidPrint[]
  /** Card size in canvas px (shared by every print) */
  fw: number
  fh: number
}

/** Deterministic PRNG (mulberry32) — pure integer mixing, identical on every
 *  browser and every run. */
function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------- wall layout -------------------------------- */

let layoutKey = ''
let layoutCache: PolaroidLayout = { prints: [], fw: 0, fh: 0 }

/**
 * The print wall: a jittered grid of overlapping cards. Slots sit on an
 * overlapping 0.8-pitch lattice extended one ring past every edge (so the
 * wall always covers the whole frame even at full scatter), each print
 * wander-tilted by the Scatter dial, row-major so the pile stacks downward.
 * Cached per (canvas size, quantized dials) — same inputs, same wall.
 */
function getLayout(W: number, H: number, density: number, scatter: number): PolaroidLayout {
  const dQ = Math.round(density * 50)
  const sQ = Math.round(scatter * 50)
  const key = `${W}x${H}|${dQ}|${sQ}`
  if (key === layoutKey) return layoutCache
  layoutKey = key

  // Base card height from the density dial, then capped by MAX_PRINTS (print
  // count scales ~1/fh², so a sqrt correction lands close to the cap).
  let fh = H / (2.4 + density * 7.2)
  const countAt = (fhh: number): number => {
    const fw2 = fhh * FRAME_W_RATIO
    const cols = Math.ceil(W / (fw2 * 0.8)) + 2
    const rows = Math.ceil(H / (fhh * 0.8)) + 2
    return cols * rows
  }
  const est = countAt(fh)
  if (est > MAX_PRINTS) fh *= Math.sqrt(est / MAX_PRINTS)
  const fw = fh * FRAME_W_RATIO

  const seed =
    (Math.imul(W, 0x9e3779b1) ^
      Math.imul(H, 0x85ebca6b) ^
      Math.imul(dQ, 0xc2b2ae35) ^
      Math.imul(sQ, 0x27d4eb2f)) |
    0
  const rnd = mulberry32(seed)
  const pitchW = fw * 0.8
  const pitchH = fh * 0.8
  const cols = Math.ceil(W / pitchW) + 2
  const rows = Math.ceil(H / pitchH) + 2
  const prints: PolaroidPrint[] = []
  for (let gy = -1; gy < rows; gy++) {
    for (let gx = -1; gx < cols; gx++) {
      const jx = (rnd() - 0.5) * 2 * pitchW * 0.42 * scatter
      const jy = (rnd() - 0.5) * 2 * pitchH * 0.42 * scatter
      const rot = (rnd() - 0.5) * 2 * 0.52 * scatter
      const scale = 1 + (rnd() - 0.5) * 0.34 * scatter
      const cx = (gx + 0.5) * pitchW + jx
      const cy = (gy + 0.5) * pitchH + jy
      // Skip cards fully off-frame (the extended ring only exists to keep
      // the edges covered under scatter).
      if (cx < -fw || cx > W + fw || cy < -fh || cy > H + fh) continue
      prints.push({ cx, cy, rot, scale, seed: prints.length })
    }
  }
  layoutCache = { prints, fw, fh }
  return layoutCache
}

/* ------------------------------- card sprites ------------------------------- */

let spriteKey = ''
let spriteCard: HTMLCanvasElement | null = null
let spriteBevel: HTMLCanvasElement | null = null
let spriteMargin = 0

function roundRectPath(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

/**
 * The polaroid card, rendered once per print size: an off-white card with a
 * soft baked drop shadow and the photo window CUT OUT (destination-out), so
 * stamping it over the window content leaves exactly the square showing.
 * The bevel overlay is the finish drawn ON TOP of the content: a hairline
 * inner edge and gentle top/bottom shading so the photo sits IN the card.
 * The margin around the card carries the shadow spread.
 */
function getCardSprites(
  fw: number,
  fh: number,
): { card: HTMLCanvasElement; bevel: HTMLCanvasElement; margin: number } {
  const mfw = Math.max(8, Math.round(fw))
  const mfh = Math.max(8, Math.round(fh))
  const m = Math.ceil(mfh * 0.16)
  const key = `${mfw}x${mfh}`
  const card = getWork('polaroid:card', mfw + 2 * m, mfh + 2 * m)
  const bevel = getWork('polaroid:bevel', mfw + 2 * m, mfh + 2 * m)
  if (key === spriteKey && spriteCard && spriteBevel) {
    return { card: spriteCard, bevel: spriteBevel, margin: spriteMargin }
  }
  spriteKey = key
  spriteCard = card
  spriteBevel = bevel
  spriteMargin = m

  /* ---- the card ---- */
  const c = resetWork(card.getContext('2d')!)
  c.clearRect(0, 0, card.width, card.height)
  // Baked soft shadow (offset down — prints resting on the table).
  c.save()
  c.shadowColor = 'rgba(12,12,18,0.4)'
  c.shadowBlur = mfh * 0.085
  c.shadowOffsetY = mfh * 0.03
  roundRectPath(c, m, m, mfw, mfh, mfh * 0.016)
  c.fillStyle = '#fdfdfb'
  c.fill()
  c.restore()
  // Dimension: faint top sheen and bottom shading, clipped to the card.
  c.save()
  roundRectPath(c, m, m, mfw, mfh, mfh * 0.016)
  c.clip()
  const tone = c.createLinearGradient(0, m, 0, m + mfh)
  tone.addColorStop(0, 'rgba(255,255,255,0.55)')
  tone.addColorStop(0.35, 'rgba(255,255,255,0)')
  tone.addColorStop(1, 'rgba(92,86,78,0.10)')
  c.fillStyle = tone
  c.fillRect(m, m, mfw, mfh)
  c.restore()
  // Hairline edge so cards read against each other where they overlap.
  roundRectPath(c, m + 0.5, m + 0.5, mfw - 1, mfh - 1, mfh * 0.016)
  c.strokeStyle = 'rgba(24,22,20,0.10)'
  c.lineWidth = 1
  c.stroke()
  // Cut the photo window out — the square shows whatever is beneath.
  c.globalCompositeOperation = 'destination-out'
  c.fillRect(m + SIDE_PAD * mfw, m + TOP_PAD * mfh, WIN_RATIO * mfw, WIN_RATIO * mfw)
  c.globalCompositeOperation = 'source-over'

  /* ---- the bevel overlay ---- */
  const b = resetWork(bevel.getContext('2d')!)
  b.clearRect(0, 0, bevel.width, bevel.height)
  const wx = m + SIDE_PAD * mfw
  const wy = m + TOP_PAD * mfh
  const ws = WIN_RATIO * mfw
  // Inner hairline just inside the window edge (the photo's recess).
  const lw = Math.max(1, mfh * 0.006)
  b.strokeStyle = 'rgba(0,0,0,0.20)'
  b.lineWidth = lw
  b.strokeRect(wx + lw / 2, wy + lw / 2, ws - lw, ws - lw)
  // Gentle depth shading at the window's top and bottom edges.
  const top = b.createLinearGradient(0, wy, 0, wy + mfh * 0.07)
  top.addColorStop(0, 'rgba(0,0,0,0.12)')
  top.addColorStop(1, 'rgba(0,0,0,0)')
  b.fillStyle = top
  b.fillRect(wx, wy, ws, mfh * 0.07)
  const bot = b.createLinearGradient(0, wy + ws - mfh * 0.05, 0, wy + ws)
  bot.addColorStop(0, 'rgba(0,0,0,0)')
  bot.addColorStop(1, 'rgba(0,0,0,0.07)')
  b.fillStyle = bot
  b.fillRect(wx, wy + ws - mfh * 0.05, ws, mfh * 0.05)
  return { card, bevel, margin: m }
}

/* --------------------------------- backdrop --------------------------------- */

function fillBackdrop(ctx: CanvasRenderingContext2D, W: number, H: number, charcoal: boolean): void {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  if (charcoal) {
    g.addColorStop(0, '#2b2b31')
    g.addColorStop(1, '#151518')
  } else {
    g.addColorStop(0, '#f4f2ee')
    g.addColorStop(1, '#dedbd4')
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  const diag = Math.hypot(W, H) * 0.6
  const v = ctx.createRadialGradient(W / 2, H / 2, diag * 0.45, W / 2, H / 2, diag * 1.05)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, charcoal ? 'rgba(0,0,0,0.42)' : 'rgba(35,28,22,0.14)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, W, H)
}

/* ------------------------------- image layer -------------------------------- */

let layerImg: HTMLImageElement | null = null
let layerSig = ''
let layerCanvas: HTMLCanvasElement | null = null

/**
 * The wall image cover-fit over the whole frame — ONE canvas that serves as
 * both the backdrop layer and the content every card's window reveals (the
 * windows see the exact piece of the image at their own spot, so the wall
 * reads as prints of the picture it sits on). The beat zoom is baked in so
 * the backdrop and the windows stay glued together while breathing.
 *
 * Position + Rotation dials (all canvas-space, around the frame center):
 * the image slides by (panX, panY) and spins by rotDeg. Sliding happens at
 * the picture's true size — the scale never reacts to the pan, so past the
 * image's own edge the table tone simply shows. Rotation is the one dial
 * that still grows the scale, and only as far as the spin demands: tilted
 * frame corners must stay covered. When the image deliberately doesn't
 * cover (Image size below 100%) the solve steps aside — the filler around
 * it is already the look. Cached per (image, size, zoom, pan, rotation) —
 * rebuilt only when something changes.
 */
function getImageLayer(
  img: HTMLImageElement,
  W: number,
  H: number,
  zoom: number,
  panX: number,
  panY: number,
  rotDeg: number,
  dark: boolean,
): HTMLCanvasElement {
  const rot = Math.min(180, Math.max(-180, rotDeg)) * (Math.PI / 180)
  const sig = `${W}x${H}|${Math.round(zoom * 400)}|${Math.round(panX * 200)}|${Math.round(panY * 200)}|${Math.round(Math.min(180, Math.max(-180, rotDeg)))}|${dark ? 'd' : 'l'}`
  if (layerImg === img && layerSig === sig && layerCanvas) return layerCanvas
  const layer = getWork('polaroid:layer', W, H)
  const c = resetWork(layer.getContext('2d')!)
  c.clearRect(0, 0, W, H)
  c.fillStyle = dark ? '#1d1d22' : '#c9c5bd'
  c.fillRect(0, 0, W, H)
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  const s0 = Math.max(W / iw, H / ih) * zoom
  const covering = s0 * iw >= W - 0.5 && s0 * ih >= H - 0.5
  // Pan targets: the dial's own cover overflow first (0 = centered, ±1 = the
  // image's edge pulls up to the frame's edge), with a guaranteed minimum
  // room per axis so the dials always do something at Image size 100%.
  const overX0 = Math.max(0, (s0 * iw - W) / 2)
  const overY0 = Math.max(0, (s0 * ih - H) / 2)
  const dx = panX * Math.max(overX0, PAN_SLACK * W)
  const dy = panY * Math.max(overY0, PAN_SLACK * H)
  // Coverage solve — ROTATION ONLY: the tilted frame corners must stay
  // inside the image rect — |(x_rel·cos + y_rel·sin)| ≤ dw/2 etc. for all
  // four corners, which peaks at W/2·c + H/2·s per axis. Closed form. The
  // pan is deliberately left out — Position slides at true size (at rot 0
  // this reduces exactly to s0, so a straight pan can never zoom). A
  // rotated+panned frame may uncover an edge past the image — that reads
  // as the picture sliding off the table, the same honest behavior as a
  // straight pan past the edge.
  const ca = Math.abs(Math.cos(rot))
  const sa = Math.abs(Math.sin(rot))
  let s = s0
  if (covering) {
    const sx = (W * ca + H * sa) / iw
    const sy = (W * sa + H * ca) / ih
    s = Math.max(s0, sx, sy)
  }
  const dw = iw * s
  const dh = ih * s
  c.translate(W / 2 + dx, H / 2 + dy)
  c.rotate(rot)
  c.drawImage(img, -dw / 2, -dh / 2, dw, dh)
  c.setTransform(1, 0, 0, 1, 0, 0)
  // A gentle vignette so the white prints keep their depth on the photo.
  const diag = Math.hypot(W, H) * 0.6
  const v = c.createRadialGradient(W / 2, H / 2, diag * 0.5, W / 2, H / 2, diag * 1.05)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.20)')
  c.fillStyle = v
  c.fillRect(0, 0, W, H)
  layerImg = img
  layerSig = sig
  layerCanvas = layer
  return layer
}

/* ---------------------------------- filter ---------------------------------- */

export function drawPolaroidFilter(
  rc: RenderContext,
  cfg: PolaroidFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass' | 'sub' | 'time' | 'styleTime'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  const strength = clamp01(cfg.strength ?? 1)
  if (strength <= 0.001) return
  const density = clamp01(cfg.density ?? 0.5)
  const scatter = clamp01(cfg.scatter ?? 0.45)
  const charcoal = cfg.backdrop === 'charcoal'
  const splitAmount = clamp01(cfg.splitAmount ?? 0.5)

  // Snapshot the finished picture — the content every photo window shows.
  const snap = getWork('polaroid:snap', W, H)
  const sc = resetWork(snap.getContext('2d')!)
  sc.clearRect(0, 0, W, H)
  sc.drawImage(ctx.canvas, 0, 0)

  // Content: the picture, or the polaroid's own uploaded photo cover-fit
  // (breathing with the low end while React to beat is on). While the photo
  // is still decoding the picture stands in — the same graceful fallback the
  // background image uses.
  let content: HTMLCanvasElement = snap
  const photo = cfg.photoMode === 'photo' ? getBackgroundImage(cfg.photoSrc ?? '') : null
  if (photo) {
    const pc = getWork('polaroid:photo', W, H)
    const p = resetWork(pc.getContext('2d')!)
    p.clearRect(0, 0, W, H)
    p.fillStyle = charcoal ? '#1d1d22' : '#c9c5bd'
    p.fillRect(0, 0, W, H)
    const zoom = Math.min(2.2, Math.max(0.6, cfg.photoZoom ?? 1))
    const pulse = cfg.beatReactive
      ? 1 + clamp01(cfg.beatStrength ?? 0.5) * clamp01(frame.bass) * 0.07
      : 1
    const cover = Math.max(W / photo.naturalWidth, H / photo.naturalHeight) * zoom * pulse
    const dw = photo.naturalWidth * cover
    const dh = photo.naturalHeight * cover
    p.drawImage(photo, (W - dw) / 2, (H - dh) / 2, dw, dh)
    content = pc
  }

  // ONE image across the wall: the mosaic upload cover-fits the whole page
  // and every window reveals the piece of it at its own spot (while the
  // image is still decoding the picture stands in — the same graceful
  // fallback the photo uses). The 'image' backdrop draws the same layer,
  // falling back to the polaroid photo when no wall image exists.
  const mosaicImg = cfg.photoMode === 'mosaic' ? getBackgroundImage(cfg.mosaicSrc ?? '') : null
  // The user's size + position dials for the layer — Image size / Position
  // for the wall image, the Photo zoom slider for the photo-as-table
  // fallback — multiplied by the beat pulse and baked into the cached layer,
  // so the backdrop and every window stay glued together while breathing.
  const pulse = cfg.beatReactive
    ? 1 + clamp01(cfg.beatStrength ?? 0.5) * clamp01(frame.bass) * 0.07
    : 1
  const layerZoom =
    (mosaicImg
      ? Math.min(2.2, Math.max(0.6, cfg.mosaicZoom ?? 1))
      : Math.min(2.2, Math.max(0.6, cfg.photoZoom ?? 1))) * pulse
  const panX = Math.min(1, Math.max(-1, cfg.mosaicPanX ?? 0))
  const panY = Math.min(1, Math.max(-1, cfg.mosaicPanY ?? 0))
  const mosaicRot = Math.min(180, Math.max(-180, cfg.mosaicRot ?? 0))
  const wallLayer = mosaicImg
    ? getImageLayer(mosaicImg, W, H, layerZoom, panX, panY, mosaicRot, charcoal)
    : null
  // The 'image' backdrop: the wall image when the mosaic mode is live, the
  // polaroid photo otherwise (at the Photo zoom dial, centered) — cover-fit
  // behind the cards as the background layer. Paper/charcoal keep their
  // studio-table look in every mode (the mosaic windows still reveal the
  // image; only the table around them is the user's choice).
  let tableLayer: HTMLCanvasElement | null = null
  if (cfg.backdrop === 'image') {
    if (wallLayer) {
      tableLayer = wallLayer
    } else {
      const img = getBackgroundImage(cfg.photoSrc ?? '')
      if (img) tableLayer = getImageLayer(img, W, H, layerZoom, 0, 0, 0, charcoal)
    }
  }

  // Backdrop, wall, sprites. The image layer IS the background table when
  // the user picked the 'image' backdrop.
  if (tableLayer) {
    ctx.drawImage(tableLayer, 0, 0)
  } else {
    fillBackdrop(ctx, W, H, charcoal)
  }
  const { prints, fw, fh } = getLayout(W, H, density, scatter)
  const { card, bevel, margin: m } = getCardSprites(fw, fh)

  // Beat: the whole pile pulses on the low end; on a detected kick the split
  // sections jump to a fresh shuffle, hold, and drift back (the same clean
  // sub-band onset detector the other filters use — its own detector state).
  const pop = cfg.beatReactive
    ? 1 + clamp01(cfg.beatStrength ?? 0.5) * clamp01(frame.bass) * 0.055
    : 1
  const kick =
    cfg.gridSplit && cfg.beatReactive
      ? flipGate(ctx, clamp01(frame.sub ?? frame.bass), frame.time, 0.12, 0.2, 'polaroid:split')
      : 0

  const wsize = WIN_RATIO * fw
  const wx = SIDE_PAD * fw
  const wy = TOP_PAD * fh
  const drift = cfg.gridSplit ? splitAmount * 0.16 * wsize : 0
  const jump = kick * drift * 2
  // With zero drift and zero kick the cells would all sit identical — fall
  // back to the single-draw path (identical pixels, a ninth of the draws).
  const effectiveSplit = cfg.gridSplit && (splitAmount > 0.004 || kick > 0.004)
  const bleed = effectiveSplit ? Math.ceil(drift * 3.1 + jump + 2) : 0
  // Window space → content space (the full frame is squeezed into the square).
  const sxr = W / wsize
  const syr = H / wsize

  for (const pr of prints) {
    ctx.save()
    ctx.translate(pr.cx, pr.cy)
    ctx.rotate(pr.rot)
    const s = pr.scale * pop
    ctx.scale(s, s)
    ctx.translate(-fw / 2, -fh / 2)
    if (wallLayer) {
      // One image across the wall: the window clips in card space and the
      // layer paints in canvas space (the inverse transform glues them), so
      // every card reveals the piece of the image at its own spot — and the
      // split sections slide over the image inside the frame.
      const paint = (x: number, y: number, w: number, h: number): void => {
        ctx.save()
        ctx.beginPath()
        ctx.rect(x, y, w, h)
        ctx.clip()
        ctx.translate(fw / 2, fh / 2)
        ctx.scale(1 / s, 1 / s)
        ctx.rotate(-pr.rot)
        ctx.translate(-pr.cx, -pr.cy)
        ctx.drawImage(wallLayer, 0, 0)
        ctx.restore()
      }
      if (effectiveSplit) {
        const cell = wsize / SPLIT_N
        for (let i = 0; i < SPLIT_N; i++) {
          for (let j = 0; j < SPLIT_N; j++) {
            const cellSeed = pr.seed * SPLIT_N * SPLIT_N + i * SPLIT_N + j
            const phase = hash01(cellSeed, 17) * Math.PI * 2
            const spd = 1.1 + hash01(cellSeed, 31) * 1.5
            let ox = Math.sin(frame.styleTime * spd + phase) * drift
            let oy = Math.cos(frame.styleTime * spd * 0.83 + phase * 1.618) * drift
            if (jump > 0.5) {
              ox += (hash01(cellSeed, 91) - 0.5) * 2 * jump
              oy += (hash01(cellSeed, 92) - 0.5) * 2 * jump
            }
            paint(
              wx + j * cell + ox - bleed,
              wy + i * cell + oy - bleed,
              cell + bleed * 2,
              cell + bleed * 2,
            )
          }
        }
      } else {
        paint(wx, wy, wsize, wsize)
      }
    } else if (effectiveSplit) {
      // Grid split: each window shows the picture as 3×3 sections, every
      // section drifting on its own phase (and jumping on kicks) INSIDE the
      // frame. Each section draws oversized by the bleed so shifted cells
      // never leave a gap at the window edge — the clip trims the spill.
      ctx.save()
      ctx.beginPath()
      ctx.rect(wx, wy, wsize, wsize)
      ctx.clip()
      const cell = wsize / SPLIT_N
      for (let i = 0; i < SPLIT_N; i++) {
        for (let j = 0; j < SPLIT_N; j++) {
          const cellSeed = pr.seed * SPLIT_N * SPLIT_N + i * SPLIT_N + j
          const phase = hash01(cellSeed, 17) * Math.PI * 2
          const spd = 1.1 + hash01(cellSeed, 31) * 1.5
          let ox = Math.sin(frame.styleTime * spd + phase) * drift
          let oy = Math.cos(frame.styleTime * spd * 0.83 + phase * 1.618) * drift
          if (jump > 0.5) {
            ox += (hash01(cellSeed, 91) - 0.5) * 2 * jump
            oy += (hash01(cellSeed, 92) - 0.5) * 2 * jump
          }
          const dx = wx + j * cell + ox - bleed
          const dy = wy + i * cell + oy - bleed
          const dsize = cell + bleed * 2
          ctx.drawImage(
            content,
            (dx - wx) * sxr,
            (dy - wy) * syr,
            dsize * sxr,
            dsize * syr,
            dx,
            dy,
            dsize,
            dsize,
          )
        }
      }
      ctx.restore()
    } else {
      // The whole picture squeezed into the square window — the full frame
      // lives inside every print.
      ctx.drawImage(content, 0, 0, W, H, wx, wy, wsize, wsize)
    }
    ctx.drawImage(card, -m, -m)
    ctx.drawImage(bevel, -m, -m)
    ctx.restore()
  }

  // Mix — blend the untouched picture back over the wall (1 = full wall).
  if (strength < 0.999) {
    ctx.globalAlpha = 1 - strength
    ctx.drawImage(snap, 0, 0)
    ctx.globalAlpha = 1
  }
}
