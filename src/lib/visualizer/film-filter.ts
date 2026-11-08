/**
 * Film filter — old school film reel damage over the whole frame.
 *
 *   1. Scratches — a handful of persistent vertical emulsion scratches: thin
 *      wavy light (or dark) lines running the full height. The scratch layout
 *      is hashed from a "segment" seed that changes every ~2.5 s, so a
 *      scratch stays put for a moment, then the reel moves on.
 *   2. Dust & hairs — specks and short curved hairs re-seeded at 16 fps
 *      (silent-film projection rate), some light, some dark.
 *   3. Flicker — per-film-frame exposure wobble: a hashed ±brightness lift
 *      applied to the whole frame, the uneven projection lamp look.
 *
 * Everything is integer-hashed from song time — no Math.random — so exports
 * are frame-exact. Transparent backgrounds skip the pass.
 */
import type { AudioFrame, FilmFilterConfig, RenderContext } from './types'
import { clamp01, frameSeed, getWork, hash01, resetWork } from './filter-utils'

export function drawFilmFilter(
  rc: RenderContext,
  cfg: FilmFilterConfig | undefined,
  frame: Pick<AudioFrame, 'time'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  const S = H / 720
  const scratches = clamp01(cfg.scratches)
  const dust = clamp01(cfg.dust)
  const flicker = clamp01(cfg.flicker)

  ctx.save()
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0

  const segment = Math.floor(frame.time / 2.5) // scratch layout epoch
  const filmFrame = frameSeed(frame.time, 16)

  /* -------------------------------- scratches -------------------------------- */
  if (scratches > 0.001) {
    const count = Math.round(4 * scratches)
    for (let k = 0; k < count; k++) {
      // Some segments simply have fewer scratches (gaps between damaged reels).
      if (hash01(k + 1, segment) > 0.78) continue
      const x0 = (0.04 + hash01(k * 3 + 1, segment) * 0.92) * W
      const light = hash01(k + 9, segment) > 0.3
      const alpha = (0.07 + hash01(k + 17, segment) * 0.24) * (0.4 + scratches * 0.6)
      ctx.strokeStyle = light ? `rgba(255,252,240,${alpha.toFixed(3)})` : `rgba(24,14,6,${alpha.toFixed(3)})`
      ctx.lineWidth = Math.max(0.6, (0.5 + hash01(k + 29, segment) * 1.3) * S)
      ctx.beginPath()
      // Wavy polyline down the full height — x wobbles a few px per step.
      const steps = Math.max(8, Math.round(H / (26 * S)))
      for (let s = 0; s <= steps; s++) {
        const y = (s / steps) * H
        const x =
          x0 + (hash01(s * 13 + k * 101, segment * 7) - 0.5) * 4.5 * S
        if (s === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }

  /* ------------------------------- dust & hairs ------------------------------- */
  if (dust > 0.001) {
    const specks = Math.round(60 * dust)
    for (let i = 0; i < specks; i++) {
      const x = hash01(i, filmFrame) * W
      const y = hash01(i, filmFrame + 37) * H
      const light = hash01(i, filmFrame + 41) > 0.35
      const a = 0.2 + hash01(i, filmFrame + 43) * 0.55 * dust
      ctx.fillStyle = light ? `rgba(255,252,238,${a.toFixed(3)})` : `rgba(18,10,4,${a.toFixed(3)})`
      if (hash01(i, filmFrame + 47) > 0.72) {
        // A hair — short curved stroke at a random angle.
        const len = (7 + hash01(i, filmFrame + 53) * 22) * S
        const ang = hash01(i, filmFrame + 59) * Math.PI * 2
        const bend = (hash01(i, filmFrame + 61) - 0.5) * len * 0.8
        ctx.strokeStyle = ctx.fillStyle
        ctx.lineWidth = Math.max(0.6, 0.8 * S)
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.quadraticCurveTo(
          x + Math.cos(ang) * len * 0.5 - Math.sin(ang) * bend,
          y + Math.sin(ang) * len * 0.5 + Math.cos(ang) * bend,
          x + Math.cos(ang) * len,
          y + Math.sin(ang) * len,
        )
        ctx.stroke()
      } else {
        // A speck — tiny irregular blob (two overlapping rects).
        const r = (0.7 + hash01(i, filmFrame + 67) * 1.8) * S
        ctx.fillRect(x, y, r, r * (0.6 + hash01(i, filmFrame + 71) * 0.8))
        ctx.fillRect(x + r * 0.4, y + r * 0.5, r * 0.7, r * 0.6)
      }
    }
  }

  /* --------------------------------- flicker --------------------------------- */
  if (flicker > 0.001) {
    const n = hash01(filmFrame, 101) // 0..1 per film frame
    const offset = (n - 0.5) * 0.09 * flicker
    if (offset > 0) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = offset
      ctx.fillStyle = '#fff6e0' // warm lamp lift
      ctx.fillRect(0, 0, W, H)
    } else {
      const v = Math.round(255 * (1 + offset))
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = `rgb(${v},${v},${Math.round(v * 0.97)})`
      ctx.fillRect(0, 0, W, H)
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  ctx.restore()
}
