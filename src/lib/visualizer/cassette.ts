/**
 * Spectra — cassette tape layer.
 *
 * The classic compact cassette drawn on canvas: a rounded plastic shell with
 * corner screws, a bottom trapezoid plate with its access holes, and the
 * center window where two spools of tape sit behind white sprocket hubs that
 * TURN — deterministically on the decorative clock (styleTime), exactly like
 * the vinyl/CD spin, so exports stay frame-exact.
 *
 * Two drawing styles share the same geometry, label options and hub motion:
 * - vector: the clean flat illustration — simple gradients, crisp edges;
 * - realistic: a photoreal render lit from the top-left — high-contrast
 *   diagonal shading with a hotspot, beveled rim lights/shadows, an embossed
 *   recess ring and a soft inner perimeter occlusion, the molded-halves seam
 *   line, see-through reel silhouettes on bare (smoke-plastic) shells,
 *   Phillips metal screws with contact shadows, labels that sit ON the shell
 *   with their own soft shadows, a deep recessed window with a double glass
 *   reflection, brown tape packs, specular-dotted hubs, twin glossy streaks
 *   and a deterministic film grain.
 *
 * The face is configurable:
 * - shell color (clear-ish gray, black, anything from the picker);
 * - label: bare plastic, the uploaded album art (reusing the same art zoom /
 *   pan as the disc face), or the built-in "mixtape" label — a ruled card
 *   with the A badge, three color stripes and a text line, all customizable.
 *
 * Size semantics: the cassette's WIDTH follows Disc size (% of canvas
 * height); the body keeps the real 100 × 63.5 mm proportion. Pulse reuses
 * the title/vinyl energy calibration. Deterministic — pure (rc, frame, disc).
 */
import type { AudioFrame, DiscConfig, RenderContext } from './types'
import { getBackgroundImage } from './image-cache'
import { drawImageCover, paintFaceShadow, shadeHex, roundRectPath } from './cover-fit'

const TWO_PI = Math.PI * 2
/** Real compact cassette proportion: 100 × 63.5 mm. */
const ASPECT = 1.575
const FALLBACK_STRIPES = ['#e5325c', '#2bb3e6', '#f2c722']

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** The three configured stripe colors, defensively normalized. */
function stripeColors(disc: DiscConfig): [string, string, string] {
  const s = disc.stripes
  const ok = s && Array.isArray(s) && s.length >= 3 ? s : FALLBACK_STRIPES
  return [ok[0] ?? FALLBACK_STRIPES[0], ok[1] ?? FALLBACK_STRIPES[1], ok[2] ?? FALLBACK_STRIPES[2]]
}

/** Shrink a canvas font size until the text fits maxWidth. */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  px: number,
): number {
  let size = px
  for (let i = 0; i < 40 && size > 7; i++) {
    ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`
    if (ctx.measureText(text).width <= maxWidth) break
    size *= 0.92
  }
  return size
}

/* --------------------------- deterministic grain --------------------------- */

/** Seeded PRNG (mulberry32) — the same grain pattern every frame and export. */
function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let grainSource: HTMLCanvasElement | null = null
const grainPatterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern | null>()

/** Mid-gray noise tile for the plastic grain (built once, cached per ctx). */
function getGrainPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (!grainSource) {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')
    if (!g) return null
    const id = g.createImageData(128, 128)
    const rnd = mulberry32(0xc0ffeee)
    for (let i = 0; i < id.data.length; i += 4) {
      const v = 84 + Math.floor(rnd() * 88) // 84..172, contrasty around overlay-neutral 128
      id.data[i] = v
      id.data[i + 1] = v
      id.data[i + 2] = v
      id.data[i + 3] = 255
    }
    g.putImageData(id, 0, 0)
    grainSource = c
  }
  if (!grainPatterns.has(ctx)) {
    grainPatterns.set(ctx, ctx.createPattern(grainSource, 'repeat'))
  }
  return grainPatterns.get(ctx) ?? null
}

export function drawCassette(rc: RenderContext, frame: AudioFrame, disc: DiscConfig): void {
  const { ctx, width: W, height: H } = rc
  const S = H / 720

  // Shared pulse calibration with the vinyl/title (real-music RMS 0.1–0.4).
  const pulseScale = 1 + clamp01(disc.pulse) * clamp01(frame.energy * 2)
  const CW = ((disc.discSize / 100) * H) * pulseScale
  const CH = CW / ASPECT
  if (CW < 8) return

  const cx = (disc.discX / 100) * W
  const cy = (disc.discY / 100) * H
  const shell = disc.shellColor || '#2f2f34'
  const labelMode = disc.cassetteLabel ?? 'default'
  const real = (disc.cassetteStyle ?? 'vector') === 'realistic'
  const sheen = clamp01(disc.sheen ?? 0.35)
  // The cassette label uses the separate disc face image when one is set,
  // falling back to the shared album art (same rule as the vinyl/CD face).
  const faceSrc = disc.discImageSrc ?? ''
  const artSrc = faceSrc || disc.imageSrc
  const img = labelMode === 'art' && artSrc ? getBackgroundImage(artSrc) : null
  // Art label with no art uploaded degrades to bare plastic, like share links.
  const mode: 'none' | 'art' | 'default' = labelMode === 'art' && !img ? 'none' : labelMode

  // Hub spin — deterministic from the decorative clock (song time in exports).
  const angle = disc.direction * TWO_PI * (disc.rpm / 60) * frame.styleTime

  ctx.save()
  ctx.translate(cx, cy)

  /* ------------------------------- The shell ------------------------------- */
  const hw = CW / 2
  const hh = CH / 2
  const shellR = 0.055 * CW

  // Two-layer drop shadow behind the whole cassette (depth/angle/color from
  // the panel) — contact layer + main throw so it reads on any background.
  paintFaceShadow(
    ctx,
    () => roundRectPath(ctx, -hw, -hh, CW, CH, shellR),
    shell,
    disc.shadowColor ?? '#000000',
    disc.shadowDepth ?? 55,
    disc.shadowAngle ?? 90,
    S,
  )

  // Body: vector gets the gentle top-lit 3-stop gradient; realistic gets a
  // high-contrast DIAGONAL light — bright top-left, deep fall-off bottom-right.
  if (real) {
    const body = ctx.createLinearGradient(-hw, -hh, hw, hh)
    body.addColorStop(0, shadeHex(shell, 0.55))
    body.addColorStop(0.28, shadeHex(shell, 0.18))
    body.addColorStop(0.6, shell)
    body.addColorStop(1, shadeHex(shell, -0.58))
    roundRectPath(ctx, -hw, -hh, CW, CH, shellR)
    ctx.fillStyle = body
    ctx.fill()
  } else {
    const body = ctx.createLinearGradient(0, -hh, 0, hh)
    body.addColorStop(0, shadeHex(shell, 0.16))
    body.addColorStop(0.5, shell)
    body.addColorStop(1, shadeHex(shell, -0.16))
    roundRectPath(ctx, -hw, -hh, CW, CH, shellR)
    ctx.fillStyle = body
    ctx.fill()
  }
  if (real) {
    // Realistic: a soft dark contour instead of the crisp vector outline.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.lineWidth = 2 * S
  } else {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)'
    ctx.lineWidth = 1 * S
  }
  ctx.stroke()

  if (real) {
    // Light hotspot near the top-left corner (the lamp side).
    ctx.save()
    roundRectPath(ctx, -hw, -hh, CW, CH, shellR)
    ctx.clip()
    const hotspot = ctx.createRadialGradient(-hw * 0.5, -hh * 0.55, 0, -hw * 0.5, -hh * 0.55, CW * 0.95)
    hotspot.addColorStop(0, 'rgba(255, 255, 255, 0.32)')
    hotspot.addColorStop(0.55, 'rgba(255, 255, 255, 0.10)')
    hotspot.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = hotspot
    ctx.fillRect(-hw, -hh, CW, CH)

    // Photo-style falloff: the far corner falls into darkness — the
    // high-contrast directionality that separates a render from a drawing.
    const fall = ctx.createLinearGradient(-hw * 0.2, -hh * 0.2, hw, hh)
    fall.addColorStop(0.4, 'rgba(0, 0, 0, 0)')
    fall.addColorStop(1, 'rgba(0, 0, 0, 0.34)')
    ctx.fillStyle = fall
    ctx.fillRect(-hw, -hh, CW, CH)

    // Soft occlusion hugging the whole inner perimeter (molded edge depth).
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.32)'
    ctx.lineWidth = 7 * S
    roundRectPath(ctx, -hw, -hh, CW, CH, shellR)
    ctx.stroke()
    ctx.restore()

    // Rim lights, split along the light diagonal: bright top-left edge,
    // dark bottom-right edge — the bevel that makes it read as 3D plastic.
    const rim = (dark: boolean): void => {
      ctx.save()
      roundRectPath(ctx, -hw, -hh, CW, CH, shellR)
      ctx.clip()
      ctx.beginPath()
      if (!dark) {
        ctx.moveTo(-hw, -hh)
        ctx.lineTo(hw, -hh)
        ctx.lineTo(-hw, hh)
      } else {
        ctx.moveTo(hw, -hh)
        ctx.lineTo(hw, hh)
        ctx.lineTo(-hw, hh)
      }
      ctx.closePath()
      ctx.clip()
      ctx.strokeStyle = dark ? 'rgba(0, 0, 0, 0.62)' : 'rgba(255, 255, 255, 0.52)'
      ctx.lineWidth = 5 * S
      roundRectPath(ctx, -hw, -hh, CW, CH, shellR)
      ctx.stroke()
      ctx.restore()
    }
    rim(false)
    rim(true)

    // Embossed recess ring just inside the rim (where the two halves meet).
    roundRectPath(ctx, -hw + 2.6 * S, -hh + 2.6 * S, CW - 5.2 * S, CH - 5.2 * S, shellR * 0.82)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.lineWidth = 1.6 * S
    ctx.stroke()
    roundRectPath(ctx, -hw + 3.8 * S, -hh + 3.8 * S, CW - 7.6 * S, CH - 7.6 * S, shellR * 0.74)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)'
    ctx.lineWidth = 1 * S
    ctx.stroke()

    // Seam of the molded halves — visible on bare shell beside the window.
    ctx.save()
    roundRectPath(ctx, -hw, -hh, CW, CH, shellR)
    ctx.clip()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.34)'
    ctx.lineWidth = Math.max(1, 1.2 * S)
    ctx.beginPath()
    ctx.moveTo(-hw + 0.055 * CW, 0)
    ctx.lineTo(hw - 0.055 * CW, 0)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
    ctx.beginPath()
    ctx.moveTo(-hw + 0.055 * CW, 1.6 * S)
    ctx.lineTo(hw - 0.055 * CW, 1.6 * S)
    ctx.stroke()
    ctx.restore()

    // See-through reel silhouettes — the smoke-plastic cue, on bare shells
    // only (a paper or art label wraps the outside and hides the insides).
    if (mode === 'none') {
      const silY = -0.04 * CH
      const silR = 0.155 * CW
      for (const sx of [-1, 1]) {
        const x = sx * 0.155 * CW
        ctx.beginPath()
        ctx.arc(x, silY, silR, 0, TWO_PI)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.13)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)'
        ctx.lineWidth = Math.max(1, 1.5 * S)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(x, silY, 0.066 * CW, 0, TWO_PI)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.10)'
        ctx.fill()
      }
    }
  }

  // Corner screws — flat in vector, turned metal with contact shadow in real.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const x = sx * 0.415 * CW
      const y = sy * 0.40 * CH
      const sr = 0.021 * CW
      if (real) {
        // Soft contact shadow the screw head casts on the shell.
        const ao = ctx.createRadialGradient(x, y, sr * 0.6, x, y, sr * 2.8)
        ao.addColorStop(0, 'rgba(0, 0, 0, 0.50)')
        ao.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = ao
        ctx.beginPath()
        ctx.arc(x, y, sr * 2.8, 0, TWO_PI)
        ctx.fill()
      }
      ctx.beginPath()
      ctx.arc(x, y, sr, 0, TWO_PI)
      if (real) {
        const metal = ctx.createRadialGradient(x - sr * 0.4, y - sr * 0.4, sr * 0.15, x, y, sr)
        metal.addColorStop(0, shadeHex(shell, 0.68))
        metal.addColorStop(0.55, shadeHex(shell, 0.06))
        metal.addColorStop(1, shadeHex(shell, -0.68))
        ctx.fillStyle = metal
      } else {
        ctx.fillStyle = shadeHex(shell, -0.35)
      }
      ctx.fill()
      ctx.strokeStyle = real ? 'rgba(0, 0, 0, 0.5)' : shadeHex(shell, 0.22)
      ctx.lineWidth = 1 * S
      ctx.stroke()
      // The slot: one line in vector, a Phillips cross in realistic.
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(Math.PI / 4)
      ctx.strokeStyle = real ? 'rgba(0, 0, 0, 0.65)' : 'rgba(255, 255, 255, 0.28)'
      ctx.lineWidth = real ? Math.max(1, 1.4 * S) : 1 * S
      ctx.beginPath()
      ctx.moveTo(-0.014 * CW, 0)
      ctx.lineTo(0.014 * CW, 0)
      ctx.stroke()
      if (real) {
        ctx.beginPath()
        ctx.moveTo(0, -0.014 * CW)
        ctx.lineTo(0, 0.014 * CW)
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  /* --------------------------- Bottom plate -------------------------------- */
  // The trapezoid base with its playback access holes (all shells have it).
  const plate = ctx.createLinearGradient(0, hh - 0.34 * CH, 0, hh)
  plate.addColorStop(0, shadeHex(shell, real ? -0.22 : -0.10))
  plate.addColorStop(1, shadeHex(shell, real ? -0.44 : -0.24))
  ctx.beginPath()
  ctx.moveTo(-0.30 * CW, 0.20 * CH)
  ctx.lineTo(0.30 * CW, 0.20 * CH)
  ctx.lineTo(0.43 * CW, 0.455 * CH)
  ctx.lineTo(-0.43 * CW, 0.455 * CH)
  ctx.closePath()
  ctx.fillStyle = plate
  ctx.fill()
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.30)'
  ctx.stroke()
  if (real) {
    // Light catches the plate's lower edge.
    ctx.beginPath()
    ctx.moveTo(-0.43 * CW, 0.455 * CH)
    ctx.lineTo(0.43 * CW, 0.455 * CH)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.26)'
    ctx.lineWidth = 1.4 * S
    ctx.stroke()
  }
  // Access holes: capstan circles + rectangular keyholes, like the real shell.
  ctx.fillStyle = shadeHex(shell, -0.5)
  for (const hx of [-0.155, 0.155]) {
    ctx.beginPath()
    ctx.arc(hx * CW, 0.345 * CH, 0.021 * CW, 0, TWO_PI)
    ctx.fill()
    if (real) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
      ctx.lineWidth = 1 * S
      ctx.stroke()
    }
  }
  for (const rx of [-0.075, 0.075]) {
    roundRectPath(ctx, rx * CW - 0.017 * CW, 0.315 * CH, 0.034 * CW, 0.075 * CH, 0.008 * CW)
    ctx.fill()
    if (real) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
      ctx.lineWidth = 1 * S
      ctx.stroke()
    }
  }
  ctx.beginPath()
  ctx.arc(0, 0.275 * CH, 0.012 * CW, 0, TWO_PI)
  ctx.fill()

  if (real) {
    // Ambient occlusion where the shell bottom curves away from the light.
    ctx.save()
    roundRectPath(ctx, -hw, -hh, CW, CH, shellR)
    ctx.clip()
    const ao = ctx.createLinearGradient(0, hh - 0.16 * CH, 0, hh)
    ao.addColorStop(0, 'rgba(0, 0, 0, 0)')
    ao.addColorStop(1, 'rgba(0, 0, 0, 0.42)')
    ctx.fillStyle = ao
    ctx.fillRect(-hw, hh - 0.16 * CH, CW, 0.16 * CH)
    ctx.restore()
  }

  /* -------------------------------- Label ---------------------------------- */
  if (mode === 'art') {
    // Album art across the label area (window punches through later).
    const lx = -0.47 * CW
    const ly = -hh + 0.075 * CH
    const lw = 0.94 * CW
    const lh = CH - 0.075 * CH - 0.32 * CH
    if (real) {
      // The printed label sits ON the shell — give it a contact shadow.
      ctx.save()
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
      ctx.shadowBlur = 14 * S
      ctx.shadowOffsetY = 4 * S
      roundRectPath(ctx, lx, ly, lw, lh, 0.035 * CW)
      ctx.fillStyle = '#000'
      ctx.fill()
      ctx.restore()
    }
    ctx.save()
    roundRectPath(ctx, lx, ly, lw, lh, 0.035 * CW)
    ctx.clip()
    drawImageCover(
      ctx,
      img!,
      lx,
      ly,
      lw,
      lh,
      disc.discArtZoom ?? 1,
      (disc.discArtX ?? 50) / 100,
      (disc.discArtY ?? 50) / 100,
    )
    if (real) {
      // Print gloss sweeping the label + a pressed-in edge shade.
      const gloss = ctx.createLinearGradient(lx, ly, lx + lw, ly + lh)
      const a = 0.10 + 0.42 * sheen
      gloss.addColorStop(0, 'rgba(255, 255, 255, 0)')
      gloss.addColorStop(0.45, `rgba(255, 255, 255, ${a.toFixed(3)})`)
      gloss.addColorStop(0.55, 'rgba(255, 255, 255, 0)')
      gloss.addColorStop(1, 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = gloss
      ctx.fillRect(lx, ly, lw, lh)
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.lineWidth = 2.8 * S
      roundRectPath(ctx, lx, ly, lw, lh, 0.035 * CW)
      ctx.stroke()
    }
    ctx.restore()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)'
    roundRectPath(ctx, lx, ly, lw, lh, 0.035 * CW)
    ctx.stroke()
  } else if (mode === 'default') {
    const [c1, c2, c3] = stripeColors(disc)
    // Three color stripes run edge-to-edge across the middle (window cuts
    // through them, like the reference label).
    const stripeH = 0.085 * CH
    const top = -0.16 * CH
    for (const [i, color] of [c1, c2, c3].entries()) {
      ctx.fillStyle = color
      ctx.fillRect(-hw, top + i * stripeH, CW, stripeH)
      if (real && i > 0) {
        // Screen-print edge between stripes.
        ctx.fillStyle = 'rgba(0, 0, 0, 0.10)'
        ctx.fillRect(-hw, top + i * stripeH, CW, Math.max(1, 0.7 * S))
      }
    }

    // Ruled label card at the top with the A badge.
    const cardX = -0.455 * CW
    const cardY = -hh + 0.07 * CH
    const cardW = 0.91 * CW
    const cardH = 0.36 * CH
    if (real) {
      // The card sits ON the shell — soft contact shadow underneath.
      ctx.save()
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
      ctx.shadowBlur = 13 * S
      ctx.shadowOffsetY = 4 * S
      roundRectPath(ctx, cardX, cardY, cardW, cardH, 0.045 * CW)
      ctx.fillStyle = '#000'
      ctx.fill()
      ctx.restore()
    }
    roundRectPath(ctx, cardX, cardY, cardW, cardH, 0.045 * CW)
    if (real) {
      // Paper roll-off instead of a flat fill, plus a lit top edge.
      const paper = ctx.createLinearGradient(0, cardY, 0, cardY + cardH)
      paper.addColorStop(0, shadeHex(disc.labelColor || '#f7f4ec', 0.14))
      paper.addColorStop(0.55, disc.labelColor || '#f7f4ec')
      paper.addColorStop(1, shadeHex(disc.labelColor || '#f7f4ec', -0.10))
      ctx.fillStyle = paper
    } else {
      ctx.fillStyle = disc.labelColor || '#f7f4ec'
    }
    ctx.fill()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)'
    ctx.stroke()
    if (real) {
      // Inner shadow so the card reads slightly pressed into the shell.
      ctx.save()
      roundRectPath(ctx, cardX, cardY, cardW, cardH, 0.045 * CW)
      ctx.clip()
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)'
      ctx.lineWidth = 4.5 * S
      roundRectPath(ctx, cardX, cardY, cardW, cardH, 0.045 * CW)
      ctx.stroke()
      ctx.restore()
    }

    // "A" side badge.
    const badge = 0.085 * CW
    const badgeX = cardX + 0.022 * CW
    const badgeY = cardY + 0.045 * CH
    roundRectPath(ctx, badgeX, badgeY, badge, badge, 0.016 * CW)
    ctx.fillStyle = shadeHex(disc.labelColor || '#f7f4ec', -0.72)
    ctx.fill()
    ctx.fillStyle = disc.labelColor || '#f7f4ec'
    ctx.font = `700 ${0.058 * CW}px ui-sans-serif, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('A', badgeX + badge / 2, badgeY + badge / 2 + 0.002 * CW)

    // Ruled lines to the right of the badge (three, evenly spaced).
    const ruleX0 = badgeX + badge + 0.018 * CW
    const ruleX1 = cardX + cardW - 0.022 * CW
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)'
    ctx.lineWidth = Math.max(1, 0.008 * CH)
    const ruleYs: number[] = []
    for (let i = 0; i < 3; i++) {
      const y = badgeY + badge * 0.18 + (i + 1) * 0.058 * CH
      ruleYs.push(y)
      ctx.beginPath()
      ctx.moveTo(ruleX0, y)
      ctx.lineTo(ruleX1, y)
      ctx.stroke()
    }

    // The user's text, written on the rules (stacked by \n, auto-shrunk).
    const text = (disc.labelText ?? '').trim()
    if (text) {
      const lines = text.split('\n').slice(0, 3)
      const textX = ruleX0 + 0.008 * CW
      const maxW = ruleX1 - textX - 0.01 * CW
      const px = Math.min(0.105 * CH, 0.052 * CW)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = disc.labelTextColor || '#1c1c1e'
      lines.forEach((line, i) => {
        const y = ruleYs[Math.min(i, ruleYs.length - 1)] - 0.014 * CH
        fitFont(ctx, line, maxW, px)
        if (real) {
          // Ink emboss: a light offset under the dark stroke.
          ctx.save()
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
          ctx.fillText(line, textX + 0.8 * S, y + 1 * S)
          ctx.restore()
          ctx.fillStyle = disc.labelTextColor || '#1c1c1e'
        }
        ctx.fillText(line, textX, y)
      })
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
    }
  }

  /* ------------------------- The tape window ------------------------------- */
  // Stadium window slightly above center — the cassette's signature cutout.
  const winW = 0.56 * CW
  const winH = 0.34 * CH
  const winY = -0.04 * CH - winH / 2
  const winR = winH / 2
  const winX = -winW / 2

  if (real) {
    // Recessed bezel: deep black where light enters, catch-light below.
    const bezel = ctx.createLinearGradient(0, winY - 3.5 * S, 0, winY + winH + 3.5 * S)
    bezel.addColorStop(0, 'rgba(0, 0, 0, 0.85)')
    bezel.addColorStop(0.5, 'rgba(0, 0, 0, 0.30)')
    bezel.addColorStop(1, 'rgba(255, 255, 255, 0.32)')
    ctx.lineWidth = 3.5 * S
    ctx.strokeStyle = bezel
    roundRectPath(ctx, winX - 3.5 * S, winY - 3.5 * S, winW + 7 * S, winH + 7 * S, winR + 3.5 * S)
    ctx.stroke()
  }

  // Backing: near-black interior with a soft top shadow.
  const back = ctx.createLinearGradient(0, winY, 0, winY + winH)
  back.addColorStop(0, real ? '#0c0c0e' : '#101013')
  back.addColorStop(1, real ? '#030304' : '#050506')
  roundRectPath(ctx, winX, winY, winW, winH, winR)
  ctx.fillStyle = back
  ctx.fill()
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
  ctx.lineWidth = 1.5 * S
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)'
  ctx.lineWidth = 1 * S
  roundRectPath(ctx, winX + 1.5 * S, winY + 1.5 * S, winW - 3 * S, winH - 3 * S, winR)
  ctx.stroke()
  if (real) {
    // Interior depth — the top of the cavity falls into shadow…
    ctx.save()
    roundRectPath(ctx, winX, winY, winW, winH, winR)
    ctx.clip()
    const depth = ctx.createLinearGradient(0, winY, 0, winY + winH * 0.6)
    depth.addColorStop(0, 'rgba(0, 0, 0, 0.80)')
    depth.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = depth
    ctx.fillRect(winX, winY, winW, winH * 0.6)
    // …and the bottom wall catches a bounce-light.
    const bounce = ctx.createLinearGradient(0, winY + winH * 0.7, 0, winY + winH)
    bounce.addColorStop(0, 'rgba(255, 255, 255, 0)')
    bounce.addColorStop(1, 'rgba(255, 255, 255, 0.16)')
    ctx.fillStyle = bounce
    ctx.fillRect(winX, winY + winH * 0.7, winW, winH * 0.3)
    ctx.restore()
  }

  // Tape ribbon running between the two spools along the lower window.
  ctx.fillStyle = '#131315'
  ctx.fillRect(-0.31 * CW, winY + winH * 0.62, 0.62 * CW, winH * 0.3)
  if (real) {
    // The ribbon's top edge catches a hair of light.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.09)'
    ctx.fillRect(-0.31 * CW, winY + winH * 0.62, 0.62 * CW, Math.max(1, 1.2 * S))
  }

  // The two spools + sprocket hubs.
  const hubX = 0.155 * CW
  const hubY = winY + winH / 2
  const spoolR = Math.min(0.098 * CW, winH * 0.46)
  const hubR = 0.062 * CW
  for (const sx of [-1, 1]) {
    const x = sx * hubX
    // Tape wind — a dark donut with faint winding rings that rotate, so the
    // whole spool visibly turns with the hub.
    ctx.beginPath()
    ctx.arc(x, hubY, spoolR, 0, TWO_PI)
    if (real) {
      // Wound brown tape with a soft roll-off toward the rim.
      const pack = ctx.createRadialGradient(x, hubY, hubR * 0.7, x, hubY, spoolR)
      pack.addColorStop(0, '#261c12')
      pack.addColorStop(0.7, '#171009')
      pack.addColorStop(1, '#0b0705')
      ctx.fillStyle = pack
    } else {
      ctx.fillStyle = '#161618'
    }
    ctx.fill()
    if (real) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'
      ctx.lineWidth = Math.max(0.75, 1.2 * S)
      ctx.stroke()
    }
    ctx.save()
    ctx.translate(x, hubY)
    ctx.rotate(angle)
    ctx.strokeStyle = real ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.07)'
    ctx.lineWidth = Math.max(0.75, 0.006 * CW)
    for (let k = 0; k < 4; k++) {
      const r = hubR * 1.15 + ((spoolR - hubR * 1.15) * (k + 0.6)) / 4.4
      ctx.beginPath()
      ctx.arc(0, 0, r, k * 1.1, k * 1.1 + 1.9 + k * 0.5)
      ctx.stroke()
    }
    ctx.restore()

    // White sprocket hub with six inward teeth, rotating.
    ctx.save()
    ctx.translate(x, hubY)
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.arc(0, 0, hubR, 0, TWO_PI)
    if (real) {
      const hubMetal = ctx.createRadialGradient(-hubR * 0.35, -hubR * 0.35, hubR * 0.1, 0, 0, hubR)
      hubMetal.addColorStop(0, '#ffffff')
      hubMetal.addColorStop(0.55, '#dadade')
      hubMetal.addColorStop(1, '#9c9ca4')
      ctx.fillStyle = hubMetal
    } else {
      ctx.fillStyle = '#dcdcdf'
    }
    ctx.fill()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.lineWidth = Math.max(0.75, 1 * S)
    ctx.stroke()
    if (real) {
      // Specular dot — the glossy plastic glint.
      ctx.beginPath()
      ctx.arc(-hubR * 0.38, -hubR * 0.38, hubR * 0.18, 0, TWO_PI)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.fill()
    }
    ctx.fillStyle = '#0a0a0b'
    ctx.beginPath()
    ctx.arc(0, 0, 0.028 * CW, 0, TWO_PI)
    ctx.fill()
    if (real) {
      // Bored hole with a catch-light ring.
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.30)'
      ctx.lineWidth = Math.max(0.75, 0.8 * S)
      ctx.beginPath()
      ctx.arc(0, 0, 0.034 * CW, 0, TWO_PI)
      ctx.stroke()
    }
    // Notch gaps → the teeth read as a real cassette hub.
    ctx.fillStyle = '#0a0a0b'
    for (let k = 0; k < 6; k++) {
      ctx.save()
      ctx.rotate((k * TWO_PI) / 6)
      ctx.fillRect(-0.008 * CW, -hubR, 0.016 * CW, hubR - 0.03 * CW)
      ctx.restore()
    }
    ctx.restore()
  }

  if (real) {
    // Glass reflections across the window — viewer-anchored, over the tape.
    // A main diagonal band, a thinner counter-reflection, and one crisp
    // bright streak — the hard specular edge real window glass gives you.
    ctx.save()
    roundRectPath(ctx, winX, winY, winW, winH, winR)
    ctx.clip()
    const glass = ctx.createLinearGradient(winX, winY, winX + winW, winY + winH)
    glass.addColorStop(0, 'rgba(255, 255, 255, 0)')
    glass.addColorStop(0.32, `rgba(255, 255, 255, ${(0.06 + 0.24 * sheen).toFixed(3)})`)
    glass.addColorStop(0.46, `rgba(255, 255, 255, ${(0.14 + 0.50 * sheen).toFixed(3)})`)
    glass.addColorStop(0.6, `rgba(255, 255, 255, ${(0.06 + 0.24 * sheen).toFixed(3)})`)
    glass.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = glass
    ctx.fillRect(winX, winY, winW, winH)
    const counter = ctx.createLinearGradient(winX + winW, winY, winX, winY + winH)
    counter.addColorStop(0, 'rgba(255, 255, 255, 0)')
    counter.addColorStop(0.5, `rgba(255, 255, 255, ${(0.04 + 0.20 * sheen).toFixed(3)})`)
    counter.addColorStop(0.58, 'rgba(255, 255, 255, 0)')
    counter.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = counter
    ctx.fillRect(winX, winY, winW, winH)
    const spark = ctx.createLinearGradient(winX + winW * 0.05, winY, winX + winW * 0.32, winY + winH)
    spark.addColorStop(0.3, 'rgba(255, 255, 255, 0)')
    spark.addColorStop(0.5, `rgba(255, 255, 255, ${(0.20 + 0.42 * sheen).toFixed(3)})`)
    spark.addColorStop(0.7, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = spark
    ctx.fillRect(winX, winY, winW, winH)
    ctx.restore()
  }

  /* ------------------------------- Sheen ----------------------------------- */
  // Fixed light sheen (viewer-anchored, doesn't spin with the hubs).
  if (sheen > 0.01) {
    ctx.save()
    roundRectPath(ctx, -hw, -hh, CW, CH, shellR)
    ctx.clip()
    const g = ctx.createLinearGradient(-hw, -hh, hw * 0.4, hh)
    const a = 0.16 * sheen
    g.addColorStop(0, `rgba(255, 255, 255, ${a})`)
    g.addColorStop(0.45, 'rgba(255, 255, 255, 0)')
    g.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = g
    ctx.fillRect(-hw, -hh, CW, CH)
    if (real) {
      // Twin specular bands — the glossy streaks that sell molded plastic.
      const streak = ctx.createLinearGradient(-hw, -hh, hw * 0.55, hh)
      streak.addColorStop(0, 'rgba(255, 255, 255, 0)')
      streak.addColorStop(0.46, `rgba(255, 255, 255, ${(0.12 + 0.55 * sheen).toFixed(3)})`)
      streak.addColorStop(0.56, 'rgba(255, 255, 255, 0)')
      streak.addColorStop(1, 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = streak
      ctx.fillRect(-hw, -hh, CW, CH)
      const counter = ctx.createLinearGradient(hw * 0.2, hh, -hw * 0.6, -hh * 0.2)
      counter.addColorStop(0, 'rgba(255, 255, 255, 0)')
      counter.addColorStop(0.5, `rgba(255, 255, 255, ${(0.05 + 0.24 * sheen).toFixed(3)})`)
      counter.addColorStop(0.62, 'rgba(255, 255, 255, 0)')
      counter.addColorStop(1, 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = counter
      ctx.fillRect(-hw, -hh, CW, CH)
    }
    ctx.restore()
  }

  if (real) {
    // Molded-plastic grain — deterministic seeded noise, overlay-blended.
    const grain = getGrainPattern(ctx)
    if (grain) {
      ctx.save()
      roundRectPath(ctx, -hw, -hh, CW, CH, shellR)
      ctx.clip()
      ctx.globalCompositeOperation = 'overlay'
      ctx.globalAlpha = 0.36
      ctx.fillStyle = grain
      ctx.fillRect(-hw, -hh, CW, CH)
      ctx.restore()
    }
  }

  ctx.restore()
}
