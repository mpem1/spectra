/**
 * Color grade filter — the classic tone grades over the whole finished
 * picture: Black & white (luminance mono + contrast) and Sepia (the warm
 * brown archive print + contrast + warmth). The color stage of the filter
 * chain: it runs directly after Neon Split and tones whatever is beneath
 * it, so the two stack (a sepia grade over the neon look, a mono grade
 * under the glow, etc.).
 *
 * Math (deterministic per-pixel, like every full-frame filter):
 *   grade       B&W maps each pixel to Rec.709 luminance (the same weights
 *               the neon chain uses); Sepia runs the canonical sepia matrix
 *               (0.393/0.769/0.189 … the classic photo-print tone).
 *   contrast    a gain around mid-gray on the graded tone — gain = 1 +
 *               (dial − 0.5) · 4, so 0.5 is neutral, 0 is flat and 1 is a
 *               hard 3× S-curve. Applied by scaling the graded color about
 *               its own luminance, which keeps the sepia hue intact.
 *   warmth      sepia only — how deeply the brown sits in: dial 0.5 is the
 *               classic full matrix, lower blends back toward plain mono,
 *               higher deepens the amber (red up, blue down).
 *   strength    the grade blended back over the original colors.
 *
 * Skipped on transparent backgrounds (alpha must stay clean), like every
 * full-frame filter.
 */
import type { AudioFrame, ColorGradeFilterConfig, RenderContext } from './types'
import { clamp01, getWork, resetWork } from './filter-utils'

/** Contrast gain from the dial: 0.5 → 1 (neutral), 0 → 0 (flat), 1 → 3. */
function contrastGain(contrast: number): number {
  return Math.min(3, Math.max(0, 1 + (clamp01(contrast) - 0.5) * 4))
}

export function drawColorGradeFilter(
  rc: RenderContext,
  cfg: ColorGradeFilterConfig | undefined,
  _frame: Pick<AudioFrame, 'bass' | 'time' | 'styleTime'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 8 || H < 8) return

  const strength = clamp01(cfg.strength ?? 1)
  if (strength <= 0.001) return
  const look = cfg.look === 'sepia' ? 'sepia' : 'bw'
  const gain = contrastGain(cfg.contrast ?? 0.5)
  // sepia warmth: dial 0.5 = the classic full matrix; below → plain mono,
  // above → deeper amber
  const warmth = Math.min(1, Math.max(0, cfg.warmth ?? 0.5))
  const sepiaMix = Math.min(1, warmth * 2)
  const amberR = 1 + Math.max(0, warmth - 0.5) * 0.6
  const amberB = 1 - Math.max(0, warmth - 0.5) * 1.2

  // snapshot the frame, grade per-pixel, draw back
  const work = getWork('grade:base', W, H)
  const wctx = resetWork(work.getContext('2d', { willReadFrequently: true })!)
  wctx.drawImage(ctx.canvas, 0, 0)
  const img = wctx.getImageData(0, 0, W, H)
  const d = img.data

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255
    const g = d[i + 1] / 255
    const b = d[i + 2] / 255
    // Rec.709 luminance — the same weights the neon chain maps by
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    let or: number
    let og: number
    let ob: number
    if (look === 'bw') {
      // contrast about mid-gray: shape the luma, keep it neutral
      const v = Math.min(1, Math.max(0, (luma - 0.5) * gain + 0.5))
      or = v
      og = v
      ob = v
    } else {
      // canonical sepia matrix, then the same mid-gray contrast — applied by
      // scaling about the graded tone's own luminance so the brown hue stays
      let sr = 0.393 * r + 0.769 * g + 0.189 * b
      let sg = 0.349 * r + 0.686 * g + 0.168 * b
      let sb = 0.272 * r + 0.534 * g + 0.131 * b
      if (sepiaMix < 0.999) {
        sr = luma * (1 - sepiaMix) + sr * sepiaMix
        sg = luma * (1 - sepiaMix) + sg * sepiaMix
        sb = luma * (1 - sepiaMix) + sb * sepiaMix
      }
      if (amberR !== 1 || amberB !== 1) {
        sr *= amberR
        sb *= amberB
      }
      const sl = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb
      const shaped = Math.min(1, Math.max(0, (sl - 0.5) * gain + 0.5))
      const k = sl > 1e-6 ? shaped / sl : 0
      or = Math.min(1, Math.max(0, sr * k))
      og = Math.min(1, Math.max(0, sg * k))
      ob = Math.min(1, Math.max(0, sb * k))
    }
    if (strength < 0.999) {
      or = r * (1 - strength) + or * strength
      og = g * (1 - strength) + og * strength
      ob = b * (1 - strength) + ob * strength
    }
    d[i] = Math.round(or * 255)
    d[i + 1] = Math.round(og * 255)
    d[i + 2] = Math.round(ob * 255)
  }
  wctx.putImageData(img, 0, 0)
  ctx.drawImage(work, 0, 0)
}
