/**
 * Kaleidoscope filter — the whole picture mirrored through a radial array
 * of wedge slices around a center point.
 *
 * Geometry: the frame is redrawn once per wedge — each wedge clips a slice
 * of angle 2π/segments around the picked center, and draws the SOURCE
 * picture (snapshotted offscreen) translated so its center point sits on
 * the wedge's apex, scaled so the slice always covers the full frame (the
 * auto-cover factor: the distance from the center to the nearest frame
 * edge is stretched out to the corner radius, so no wedge can ever show a
 * gap, whatever the center or zoom). The SEGMENT STYLE picks how each wedge
 * treats the slice: 'alternate' is the classic tiling (odd wedges mirrored
 * about their own center axis, so every boundary reads as a clean
 * reflection); 'mandala' mirrors EVERY wedge (a ring of self-symmetric
 * butterflies — twice the symmetry axes, each wedge its own twin);
 * 'direct' never mirrors (the slice repeats rotationally — a pinwheel fan
 * whose seams show the slice's own start and end). The whole array rotates
 * with the Spin dial (negative = the other way). Mix below 1 fades the
 * untouched frame back through.
 *
 * SOURCE MOTION — what turns a stationary mirror print into a working
 * kaleidoscope. A still source (a background image, a paused scene) used
 * to freeze into one mirrored picture; now the sampled picture can move
 * under the mirrors, so the wedges keep re-slicing a moving image:
 * - Wander: the source drifts around its center on a Lissajous path (two
 *   incommensurate sines, so the walk never repeats), amplitude as a share
 *   of the frame, speed in cycles per second. Mirrored wedges reflect the
 *   motion too — every mirror moves, exactly like the real toy.
 * - Breathe: the slice swells up to +40% zoom on a slow sine (zoom-in
 *   only, so the auto-cover guarantee can never break).
 * - Beat kick: on the song's low end the array swings around an extra
 *   wedge (additive, resting EXACTLY at the dialed look between kicks)
 *   AND the source snaps to a fresh hashed spot — fifth-second buckets,
 *   the filter-utils contract — so the pattern re-forms on every kick,
 *   even with the wander dial at zero.
 *
 * The drift shifts which part of the source the wedges sample, so the
 * auto-cover factor is computed from the WORST-CASE sampled point (the
 * center's nearest-edge distance minus the maximum drift) — with no
 * motion the cover is byte-identical to the old math.
 *
 * Clock: the motion follows the decorative style clock (wall clock live so
 * the mirror keeps turning while paused; song time in exports), the
 * app-wide contract for ambient motion — deterministic files, alive
 * previews.
 *
 * Deterministic: no Math.random, no time-hashed noise — same frame in, same
 * pixels out, so the live preview and offline exports agree frame-exactly.
 * Skipped on transparent backgrounds like every full-frame filter.
 */
import type { AudioFrame, KaleidoscopeFilterConfig, RenderContext } from './types'
import { beatAmount, clamp01, getWork, hash01, resetWork } from './filter-utils'

const TAU = Math.PI * 2

export function drawKaleidoscopeFilter(
  rc: RenderContext,
  cfg: KaleidoscopeFilterConfig | undefined,
  frame: Pick<AudioFrame, 'bass' | 'styleTime'>,
  transparent: boolean,
): void {
  if (!cfg?.enabled || transparent) return
  const { ctx, width: W, height: H } = rc
  if (W < 16 || H < 16) return

  const blend = clamp01(cfg.blend ?? 1)
  if (blend <= 0.001) return

  const segments = Math.max(2, Math.round(cfg.segments ?? 8))
  const zoom = Math.max(1, cfg.zoom ?? 1.4)
  const cx = (clamp01((cfg.centerX ?? 50) / 100) * W) | 0
  const cy = (clamp01((cfg.centerY ?? 50) / 100) * H) | 0

  // Beat kick — additive on kicks, resting at exactly 0 between them: the
  // array swings around by up to half a wedge on a full low-end hit.
  const beat = beatAmount(cfg, frame.bass)
  const spinAngle = (cfg.spin ?? 0.05) * frame.styleTime * TAU + beat * 0.5

  // Source drift — the Lissajous walk (two incommensurate sines, so the
  // path never repeats) plus the beat snap: on a kick the source jumps to
  // a fresh hashed spot (fifth-second buckets), so the pattern re-forms
  // on every kick even with the wander dial parked at zero.
  const wander = clamp01(cfg.wander ?? 0)
  const wanderSpeed = Math.max(0, cfg.wanderSpeed ?? 0.1)
  const ph = frame.styleTime * wanderSpeed * TAU
  const ax = wander * W * 0.1
  const ay = wander * H * 0.1
  const ox = ax * Math.sin(ph)
  const oy = ay * Math.sin(ph * 1.618 + 1.7)
  const snapMax = cfg.beatReactive ? clamp01(cfg.beatStrength ?? 0.5) : 0
  const snapX = snapMax * 0.12 * W
  const snapY = snapMax * 0.12 * H
  const bucket = Math.floor(frame.styleTime * 5)
  const dx = ox + (beat > 0 ? snapX * (hash01(bucket, 73) * 2 - 1) : 0)
  const dy = oy + (beat > 0 ? snapY * (hash01(bucket, 79) * 2 - 1) : 0)

  // Breathe — the slice swells (zoom-in only: a bigger zoom samples a
  // SMALLER region of the source, so coverage can only get safer).
  const breathe = clamp01(cfg.breathe ?? 0)
  const zoomEff =
    breathe > 0 ? zoom * (1 + breathe * 0.4 * (0.5 + 0.5 * Math.sin(ph * 0.77 + 2.1))) : zoom

  // Corner radius from the picked center — the wedge print must reach
  // everywhere in the frame.
  const radius = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy))
  // Auto-cover, compensated for the drift: the wedges sample around a
  // point that can wander (max offsets + beat snap) this far from the
  // picked center, so the cover stretches from the WORST-CASE nearest
  // edge — with no motion this is byte-identical to the old math.
  const maxOff = Math.max(ax + snapX, ay + snapY)
  const edgeDist = Math.max(1, Math.min(cx, W - cx, cy, H - cy) - maxOff)
  const cover = radius / edgeDist

  const src = getWork('kaleido:src', W, H)
  const sctx = resetWork(src.getContext('2d')!)
  sctx.drawImage(ctx.canvas, 0, 0)

  // Segment style — how each wedge treats the slice.
  const mode = cfg.mirrorMode ?? 'alternate'
  const never = mode === 'direct'
  const always = mode === 'mandala'

  ctx.save()
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.shadowBlur = 0
  const segAngle = TAU / segments
  for (let i = 0; i < segments; i++) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(spinAngle + i * segAngle)
    if (never ? false : always ? true : i % 2 === 1) ctx.scale(1, -1)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, radius + 1, -segAngle / 2 - 0.004, segAngle / 2 + 0.004)
    ctx.closePath()
    ctx.clip()
    ctx.scale(zoomEff * cover, zoomEff * cover)
    // The drifted sample point: the picture slides around under the
    // mirrors (mirrored wedges reflect the motion — the whole array moves
    // like one scope).
    ctx.drawImage(src, -cx + dx, -cy + dy)
    ctx.restore()
  }
  // Mix below 1: fade the untouched frame back through the mirror print.
  if (blend < 0.999) {
    ctx.globalAlpha = 1 - blend
    ctx.drawImage(src, 0, 0)
  }
  ctx.restore()
}
