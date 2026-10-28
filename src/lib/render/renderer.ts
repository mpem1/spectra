"use client";

import type { VisualState } from "@/lib/types";

/**
 * Pure, deterministic canvas renderer.
 *
 * The SAME renderFrame() draws the live preview (rAF + live analyser) and the
 * offline export (precomputed spectrum + fixed dt). All time-dependent state
 * lives in an explicit RenderState so exported frames are reproducible and
 * independent of wall-clock speed.
 */

export interface Particle {
  x: number; // normalized 0..1
  y: number;
  vx: number; // normalized units / second
  vy: number;
  size: number; // fraction of min(w,h)
  seed: number;
}

interface LyricVisual {
  y: number; // smoothed pixel y
}

export interface RenderState {
  afterglowCanvas: HTMLCanvasElement | null;
  afterglowCtx: CanvasRenderingContext2D | null;
  particles: Particle[];
  particlesSeeded: boolean;
  lyricVisuals: Map<string, LyricVisual>;
}

export function createRenderState(): RenderState {
  return {
    afterglowCanvas: null,
    afterglowCtx: null,
    particles: [],
    particlesSeeded: false,
    lyricVisuals: new Map(),
  };
}

export interface FrameInput {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  time: number;
  dt: number;
  freq: Uint8Array;
  wave: Uint8Array;
  vis: VisualState;
  bgImage: HTMLImageElement | null;
  /** MP4 has no alpha channel — paint black behind transparent scenes. */
  opaque?: boolean;
}

// ---------- helpers ----------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Rotate the hue of a hex color by `deg` degrees. */
function rotateHue(hex: string, deg: number): string {
  if (deg === 0) return hex;
  let [r, g, b] = hexToRgb(hex).map((x) => x / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  h = (h + deg) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rr = 0;
  let gg = 0;
  let bb = 0;
  if (h < 60) [rr, gg, bb] = [c, x, 0];
  else if (h < 120) [rr, gg, bb] = [x, c, 0];
  else if (h < 180) [rr, gg, bb] = [0, c, x];
  else if (h < 240) [rr, gg, bb] = [0, x, c];
  else if (h < 300) [rr, gg, bb] = [x, 0, c];
  else [rr, gg, bb] = [c, 0, x];
  return rgbToHex((rr + m) * 255, (gg + m) * 255, (bb + m) * 255);
}

function buildGradient(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  vis: VisualState,
  time: number
): CanvasGradient {
  const rad = (vis.gradientAngle * Math.PI) / 180;
  const len = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
  const cx = w / 2;
  const cy = h / 2;
  const dx = (Math.cos(rad) * len) / 2;
  const dy = (Math.sin(rad) * len) / 2;
  const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  const shift = vis.gradientCycle ? (time * vis.gradientCycleSpeed) % 360 : 0;
  const stops = [...vis.gradientStops].sort((a, b) => a.position - b.position);
  if (stops.length === 1) {
    grad.addColorStop(0, rotateHue(stops[0].color, shift));
    grad.addColorStop(1, rotateHue(stops[0].color, shift));
  } else {
    for (const s of stops) {
      grad.addColorStop(Math.max(0, Math.min(1, s.position)), rotateHue(s.color, shift));
    }
  }
  return grad;
}

/** Average energy of the low bins (0..1) — drives radial pulse & particle speed. */
function bassEnergy(freq: Uint8Array): number {
  let sum = 0;
  const n = Math.min(10, freq.length);
  for (let i = 0; i < n; i++) sum += freq[i];
  return sum / (n * 255);
}

// ---------- particles ----------

function seedParticles(vis: VisualState): Particle[] {
  const rng = mulberry32(0x5eed);
  const out: Particle[] = [];
  for (let i = 0; i < vis.particleCount; i++) {
    const ang = rng() * Math.PI * 2;
    const speed = 0.02 + rng() * 0.05;
    out.push({
      x: rng(),
      y: rng(),
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      size: 0.002 + rng() * 0.004,
      seed: rng(),
    });
  }
  return out;
}

function updateAndDrawParticles(
  ctx: CanvasRenderingContext2D,
  input: FrameInput,
  state: RenderState
): void {
  const { w, h, dt, freq, vis } = input;
  if (!vis.particlesEnabled) {
    state.particles = [];
    state.particlesSeeded = false;
    return;
  }
  if (!state.particlesSeeded || state.particles.length !== vis.particleCount) {
    state.particles = seedParticles(vis);
    state.particlesSeeded = true;
  }
  const grad = buildGradient(ctx, w, h, vis, input.time);
  const energy = bassEnergy(freq);
  const speedScale = 1 + energy * 2.2;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.17; // central repel zone

  ctx.save();
  for (const p of state.particles) {
    // repel from central circle (where lyrics live)
    const px = p.x * w;
    const py = p.y * h;
    const ddx = px - cx;
    const ddy = py - cy;
    const dist = Math.hypot(ddx, ddy) || 0.0001;
    if (dist < R) {
      const force = ((R - dist) / R) * 0.9;
      p.vx += (ddx / dist) * force * dt * 3;
      p.vy += (ddy / dist) * force * dt * 3;
    }
    p.x += p.vx * dt * speedScale;
    p.y += p.vy * dt * speedScale;

    // bounce off walls
    if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx); }
    if (p.x > 1) { p.x = 1; p.vx = -Math.abs(p.vx); }
    if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy); }
    if (p.y > 1) { p.y = 1; p.vy = -Math.abs(p.vy); }

    // gentle speed clamp
    const sp = Math.hypot(p.vx, p.vy);
    const maxSp = 0.35;
    if (sp > maxSp) {
      p.vx = (p.vx / sp) * maxSp;
      p.vy = (p.vy / sp) * maxSp;
    }

    const r = Math.max(1, p.size * Math.min(w, h));
    ctx.globalAlpha = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(input.time * 2 + p.seed * 20));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------- lyrics ----------

interface ActiveLyric {
  id: string;
  text: string;
  alpha: number;
  isNewest: boolean;
}

function lyricWindowEnd(
  lines: { id: string; time: number; text: string }[],
  idx: number,
  holdMult: number
): number {
  const cur = lines[idx];
  const next = lines[idx + 1];
  const gap = next ? Math.max(0.2, next.time - cur.time) : 3;
  return cur.time + Math.max(1.2, gap * holdMult);
}

function collectActiveLyrics(
  vis: VisualState,
  time: number
): ActiveLyric[] {
  const lines = vis.lyrics;
  if (!vis.lyricsEnabled || lines.length === 0) return [];
  const out: ActiveLyric[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time > time) break;
    const end = lyricWindowEnd(lines, i, vis.lyricsHoldMultiplier);
    if (time >= end) continue;
    const fadeStart = Math.max(lines[i].time, end - vis.lyricsFade);
    const alpha = time <= fadeStart ? 1 : Math.max(0, 1 - (time - fadeStart) / Math.max(0.05, vis.lyricsFade));
    if (alpha <= 0.001) continue;
    out.push({ id: lines[i].id, text: lines[i].text, alpha, isNewest: false });
  }
  // newest first; keep at most 2 (old on top, new beneath it)
  const kept = out.slice(-2).reverse();
  return kept.map((k, idx) => ({ ...k, isNewest: idx === 0 }));
}

function drawLyrics(ctx: CanvasRenderingContext2D, input: FrameInput, state: RenderState): void {
  const { w, h, dt, vis } = input;
  const active = collectActiveLyrics(vis, input.time);
  if (active.length === 0) return;

  const baseSize = vis.lyricsSize * Math.min(w, h);
  const centerY = h * 0.82;
  const lineStep = baseSize * 1.35;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = vis.lyricsGlowColor;
  ctx.shadowBlur = Math.min(48, Math.max(0, vis.lyricsGlow));
  ctx.fillStyle = vis.lyricsColor;

  for (const item of active) {
    // Smooth slot transition: newest line sits one step below while an older
    // line is still visible, then glides up to the primary spot.
    const targetY = item.isNewest && active.length > 1 ? centerY + lineStep : centerY;
    let lv = state.lyricVisuals.get(item.id);
    if (!lv) {
      lv = { y: targetY };
      state.lyricVisuals.set(item.id, lv);
    }
    lv.y += (targetY - lv.y) * Math.min(1, dt * 12);

    // fit long lines
    let size = baseSize;
    ctx.font = `700 ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    const maxW = w * 0.86;
    const textW = ctx.measureText(item.text).width;
    if (textW > maxW && textW > 0) {
      size = Math.max(baseSize * 0.45, size * (maxW / textW));
      ctx.font = `700 ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    }

    ctx.globalAlpha = item.alpha;
    ctx.fillText(item.text, w / 2, lv.y);
  }
  ctx.restore();
  // prune stale visuals
  if (state.lyricVisuals.size > 64) {
    const keep = new Set(active.map((a) => a.id));
    for (const key of state.lyricVisuals.keys()) {
      if (!keep.has(key)) state.lyricVisuals.delete(key);
    }
  }
}

// ---------- visual layer (what afterglow trails) ----------

function drawVisualLayer(ctx: CanvasRenderingContext2D, input: FrameInput): void {
  const { w, h, freq, wave, vis, time } = input;
  const grad = buildGradient(ctx, w, h, vis, time);
  const sensitivity = vis.sensitivity;

  ctx.save();
  if (vis.mode === "bars") {
    const n = vis.barCount;
    const usable = Math.floor(freq.length * 0.75);
    const slot = w / n;
    const barW = slot * 0.68;
    const baseY = h - h * 0.06;
    const maxH = h * 0.45;
    ctx.fillStyle = grad;
    for (let i = 0; i < n; i++) {
      const b0 = Math.floor(Math.pow(i / n, 1.7) * usable);
      const b1 = Math.max(b0 + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * usable));
      let peak = 0;
      for (let k = b0; k < b1 && k < freq.length; k++) peak = Math.max(peak, freq[k]);
      const v = Math.min(1, (peak / 255) * sensitivity);
      const bh = Math.max(2, v * maxH);
      const x = i * slot + (slot - barW) / 2;
      const y = baseY - bh;
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(x, y, barW, bh, Math.min(barW / 2, 5));
        ctx.fill();
      } else {
        ctx.fillRect(x, y, barW, bh);
      }
    }
  } else if (vis.mode === "wave") {
    const mid = h / 2;
    const amp = Math.min(w, h) * 0.2 * sensitivity;
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.006);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = vis.gradientStops[0]?.color ?? "#ffffff";
    ctx.shadowBlur = Math.min(w, h) * 0.02;
    ctx.beginPath();
    const step = Math.max(1, Math.floor(wave.length / Math.max(2, w / 3)));
    for (let x = 0, i = 0; x <= w; x += 3, i += step) {
      const v = i < wave.length ? (wave[i] - 128) / 128 : 0;
      const y = mid + v * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else {
    // radial
    const cx = w / 2;
    const cy = h / 2;
    const bass = bassEnergy(freq);
    const r0 = Math.min(w, h) * (0.16 + bass * 0.05 * sensitivity);
    const n = vis.barCount;
    const usable = Math.floor(freq.length * 0.75);
    const maxLen = Math.min(w, h) * 0.16 * sensitivity;
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.005);
    ctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const b0 = Math.floor(Math.pow(i / n, 1.7) * usable);
      const b1 = Math.max(b0 + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * usable));
      let peak = 0;
      for (let k = b0; k < b1 && k < freq.length; k++) peak = Math.max(peak, freq[k]);
      const v = Math.min(1, (peak / 255) * sensitivity);
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      const r1 = r0 + 4;
      const r2 = r0 + 4 + Math.max(2, v * maxLen);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
      ctx.stroke();
    }
    // core disc
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r0);
    core.addColorStop(0, vis.gradientStops[Math.max(0, vis.gradientStops.length - 1)]?.color ?? "#ffffff");
    core.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, r0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------- main entry ----------

export function renderFrame(input: FrameInput, state: RenderState): void {
  const { ctx, w, h, vis } = input;

  // --- background ---
  if (vis.transparentBg) {
    if (input.opaque) {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.clearRect(0, 0, w, h);
    }
  } else {
    ctx.fillStyle = "#09090f";
    ctx.fillRect(0, 0, w, h);
    if (vis.bgEnabled && input.bgImage && input.bgImage.complete && input.bgImage.naturalWidth > 0) {
      const img = input.bgImage;
      const cover = Math.max(w / img.naturalWidth, h / img.naturalHeight) * vis.bgScale;
      const dw = img.naturalWidth * cover;
      const dh = img.naturalHeight * cover;
      const dx = (w - dw) / 2 + vis.bgOffsetX * w;
      const dy = (h - dh) / 2 + vis.bgOffsetY * h;
      ctx.save();
      if (vis.bgMirror) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
      if (vis.bgDim > 0) {
        ctx.fillStyle = `rgba(0,0,0,${vis.bgDim})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
  }

  // --- visual layer (+ afterglow trail) ---
  const ag = vis.afterglow;
  if (ag > 0.01) {
    // maintain trail canvas
    if (!state.afterglowCanvas) {
      state.afterglowCanvas = document.createElement("canvas");
      state.afterglowCtx = state.afterglowCanvas.getContext("2d");
    }
    const tc = state.afterglowCanvas!;
    if (tc.width !== w || tc.height !== h) {
      tc.width = w;
      tc.height = h;
    }
    const tctx = state.afterglowCtx!;
    // fps-independent decay
    const decay = 1 - Math.pow(ag, Math.max(0.0001, input.dt * 60));
    tctx.globalCompositeOperation = "destination-out";
    tctx.fillStyle = `rgba(0,0,0,${Math.min(1, decay)})`;
    tctx.fillRect(0, 0, w, h);
    tctx.globalCompositeOperation = "source-over";
    drawVisualLayer(tctx, input);
    ctx.drawImage(tc, 0, 0);
  } else {
    if (state.afterglowCanvas) {
      state.afterglowCanvas = null;
      state.afterglowCtx = null;
    }
    drawVisualLayer(ctx, input);
  }

  // --- particles ---
  updateAndDrawParticles(ctx, input, state);

  // --- lyrics ---
  drawLyrics(ctx, input, state);
}

export function averageSpectrumEnergy(freq: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < freq.length; i++) sum += freq[i];
  return sum / (freq.length * 255);
}
