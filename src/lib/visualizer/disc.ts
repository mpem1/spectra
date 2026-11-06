/**
 * Spectra — album art layer: square cover + spinning disc.
 *
 * The "record out of its sleeve" look: a square cover image with a black
 * vinyl disc slid out from behind it (or a CD with the art across its whole
 * face). One image powers both elements. The disc:
 *
 * - spins deterministically on the decorative clock (styleTime) at a set RPM
 *   — free-running in the live preview (keeps spinning while paused), locked
 *   to song time in exports so video stays frame-exact;
 * - optionally pulses its size with the track's loudness (same energy
 *   calibration as the title pulse);
 * - in vinyl mode carries the art on the center label with grooved black
 *   vinyl around it and a spindle hole; in CD mode the art covers the whole
 *   face with a real punched center hole (evenodd clip) and an iridescent
 *   sheen.
 *
 * The square cover is drawn AFTER the disc so the sleeve overlaps the record.
 * Deterministic — a pure function of (rc, frame, disc).
 */
import type { AudioFrame, DiscConfig, RenderContext } from './types'
import { getBackgroundImage } from './image-cache'
import { drawImageCover } from './cover-fit'
import { drawCassette } from './cassette'

const TWO_PI = Math.PI * 2

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function drawDisc(rc: RenderContext, frame: AudioFrame, disc: DiscConfig): void {
  if (!disc.enabled || (!disc.showCover && !disc.showDisc)) return
  const { ctx, width: W, height: H } = rc
  const S = H / 720
  const img = disc.imageSrc ? getBackgroundImage(disc.imageSrc) : null

  // Shared pulse calibration with the title card: real-music RMS lands
  // ~0.1–0.4, stretched to full scale by 0.5 so the slider feels alive.
  const pulseScale = 1 + clamp01(disc.pulse) * clamp01(frame.energy * 2)

  /* ------------------------------- The disc ------------------------------- */
  if (disc.showDisc && disc.mode === 'cassette') {
    // A whole cassette tape — turning sprocket hubs instead of a spinning
    // circle. The square cover below still composes with it like the vinyl.
    drawCassette(rc, frame, disc)
  } else if (disc.showDisc) {
    const cx = (disc.discX / 100) * W
    const cy = (disc.discY / 100) * H
    const R = ((disc.discSize / 100) * H / 2) * pulseScale
    if (R > 1) {
      // Spin angle — deterministic from the decorative clock. In exports
      // styleTime === song time, so every frame lands on the same pixels.
      const angle = disc.direction * TWO_PI * (disc.rpm / 60) * frame.styleTime

      // Drop shadow for depth against the cover.
      ctx.save()
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
      ctx.shadowBlur = 20 * S
      ctx.shadowOffsetY = 8 * S
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, TWO_PI)
      ctx.fillStyle = '#0b0b0b'
      ctx.fill()
      ctx.restore()

      if (disc.mode === 'label') {
        drawVinylFace(ctx, disc, img, cx, cy, R, angle, S)
      } else {
        drawCdFace(ctx, disc, img, cx, cy, R, angle, S)
      }

      // Static light sheen — fixed to the viewer (the light source doesn't
      // spin with the record).
      if (disc.sheen > 0.01) {
        ctx.save()
        ctx.beginPath()
        ctx.arc(cx, cy, R, 0, TWO_PI)
        ctx.clip()
        const sheen = ctx.createLinearGradient(cx - R, cy - R, cx + R * 0.4, cy + R)
        const a = 0.16 * clamp01(disc.sheen)
        sheen.addColorStop(0, `rgba(255, 255, 255, ${a})`)
        sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0)')
        sheen.addColorStop(1, 'rgba(255, 255, 255, 0)')
        ctx.fillStyle = sheen
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
        ctx.restore()
      }

      // Crisp rim so the disc reads on any background.
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, TWO_PI)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
      ctx.lineWidth = 1 * S
      ctx.stroke()
      ctx.restore()
    }
  }

  /* --------------------------- The square cover --------------------------- */
  if (disc.showCover) {
    const side = (disc.coverSize / 100) * H
    if (side > 2) {
      const x = (disc.coverX / 100) * W - side / 2
      const y = (disc.coverY / 100) * H - side / 2
      const r = 6 * S

      ctx.save()
      // Sleeve shadow (drawn before the art so it hugs the square).
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
      ctx.shadowBlur = 24 * S
      ctx.shadowOffsetY = 10 * S
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, side, side, r)
      else ctx.rect(x, y, side, side)
      ctx.fillStyle = '#101010'
      ctx.fill()
      ctx.restore()

      if (img) {
        ctx.save()
        ctx.beginPath()
        if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, side, side, r)
        else ctx.rect(x, y, side, side)
        ctx.clip()
        drawImageCover(
          ctx,
          img,
          x,
          y,
          side,
          side,
          disc.coverArtZoom ?? 1,
          (disc.coverArtX ?? 50) / 100,
          (disc.coverArtY ?? 50) / 100,
        )
        ctx.restore()
      }
    }
  }
}

/* ------------------------------ Vinyl (label) ------------------------------ */

/**
 * Grooved black vinyl with the art on the center label. Grooves and the
 * body are rotation-symmetric (drawn unrotated); only the label art rotates.
 */
function drawVinylFace(
  ctx: CanvasRenderingContext2D,
  disc: DiscConfig,
  img: HTMLImageElement | null,
  cx: number,
  cy: number,
  R: number,
  angle: number,
  S: number,
): void {
  const labelR = R * 0.37

  // Vinyl body — dark with a gentle radial lift so it isn't a flat circle.
  ctx.save()
  const body = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.35, R * 0.1, cx, cy, R)
  body.addColorStop(0, '#2c2c2e')
  body.addColorStop(0.55, '#161617')
  body.addColorStop(1, '#0a0a0b')
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, TWO_PI)
  ctx.fillStyle = body
  ctx.fill()
  ctx.restore()

  // Groove rings (rotation-symmetric — no transform needed).
  if (disc.grooves) {
    ctx.save()
    ctx.lineWidth = Math.max(0.75, 1 * S)
    const inner = labelR * 1.12
    const rings = 22
    for (let i = 0; i < rings; i++) {
      const r = inner + ((R * 0.965 - inner) * i) / (rings - 1)
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, TWO_PI)
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.055)' : 'rgba(255, 255, 255, 0.025)'
      ctx.stroke()
    }
    // A couple of track separators — slightly darker gaps.
    for (const fr of [0.45, 0.68]) {
      ctx.beginPath()
      ctx.arc(cx, cy, labelR + (R * 0.965 - labelR) * fr, 0, TWO_PI)
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'
      ctx.stroke()
    }
    ctx.restore()
  }

  // Center label — the art, rotating with the record.
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, labelR, 0, TWO_PI)
  ctx.clip()
  if (img) {
    ctx.translate(cx, cy)
    ctx.rotate(angle)
    drawImageCover(
      ctx,
      img,
      -labelR,
      -labelR,
      labelR * 2,
      labelR * 2,
      disc.discArtZoom ?? 1,
      (disc.discArtX ?? 50) / 100,
      (disc.discArtY ?? 50) / 100,
    )
  } else {
    // No art yet — a plain paper label so the record still reads.
    ctx.fillStyle = '#202021'
    ctx.fillRect(cx - labelR, cy - labelR, labelR * 2, labelR * 2)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
    ctx.lineWidth = 1 * S
    ctx.beginPath()
    ctx.arc(cx, cy, labelR * 0.82, 0, TWO_PI)
    ctx.stroke()
  }
  ctx.restore()

  // Spindle hole.
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.024, 0, TWO_PI)
  ctx.fillStyle = '#050505'
  ctx.fill()
  ctx.restore()
}

/* -------------------------------- CD (full) -------------------------------- */

/**
 * The art across the whole face with a real punched center hole (evenodd
 * clip — the background shows through), plus a faint iridescent edge.
 */
function drawCdFace(
  ctx: CanvasRenderingContext2D,
  disc: DiscConfig,
  img: HTMLImageElement | null,
  cx: number,
  cy: number,
  R: number,
  angle: number,
  S: number,
): void {
  const holeR = R * 0.13

  // Face clip: outer disc minus the hole.
  ctx.save()
  const face = new Path2D()
  face.arc(cx, cy, R * 0.995, 0, TWO_PI)
  face.arc(cx, cy, holeR, 0, TWO_PI)
  ctx.clip(face, 'evenodd')

  ctx.translate(cx, cy)
  ctx.rotate(angle)
  if (img) {
    drawImageCover(
      ctx,
      img,
      -R,
      -R,
      R * 2,
      R * 2,
      disc.discArtZoom ?? 1,
      (disc.discArtX ?? 50) / 100,
      (disc.discArtY ?? 50) / 100,
    )
  } else {
    // No art yet — silver disc so it still reads as a CD.
    const silver = ctx.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R)
    silver.addColorStop(0, '#e2e2ea')
    silver.addColorStop(0.6, '#b9b9c4')
    silver.addColorStop(1, '#8f8f9c')
    ctx.fillStyle = silver
    ctx.fillRect(-R, -R, R * 2, R * 2)
  }
  ctx.restore()

  // Hole ring + inner mirror ring for that CD look.
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'
  ctx.lineWidth = Math.max(0.75, 1 * S)
  ctx.beginPath()
  ctx.arc(cx, cy, holeR, 0, TWO_PI)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.2, 0, TWO_PI)
  ctx.stroke()
  ctx.restore()
}
