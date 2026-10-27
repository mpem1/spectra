# Spectra — Audio Visualizer Editor

A browser-based music visualizer studio: load a track, design the look in real
time, and export frame-exact MP4 videos — fully offline, no server rendering.

Built with Next.js 16 (App Router) · TypeScript · Zustand · Canvas 2D ·
Tailwind CSS 4 · shadcn/ui · WebCodecs · Prisma (SQLite).

## Features

- **Visualizer styles** — Bars, Wave, Radial, Particles, Blob, Grid; each with
  configurable bar count, smoothing, glow, and spacing.
- **Gradient editor** — multi-stop gradients with per-stop opacity, linear or
  radial shape, angle control (0° = bottom→top, 90° = left→right, 180° =
  top→bottom), color cycling, named gradient presets (Sunset, Aurora, Ember,
  Neon, Mono) and user-saved gradients.
- **Mirror / Center modes** — with a movable offset axis (added in
  `00461d3`), so the reflection axis no longer has to be the canvas center.
- **Backgrounds** — solid, gradient, image (pan/zoom/scale), or transparent
  (alpha recording).
- **Lyrics tab** — synced lyric lines rendered into the visualizer.
- **Projects** — save/load studio configurations (Prisma + SQLite).

## Export pipeline (current state after session of 2026-10-26)

### Deterministic MP4 (WebCodecs, frame-exact)

Renders offline frame-by-frame (no rAF, deterministic smoothing state), encodes
H.264 + AAC and muxes to MP4 in-memory, then muxes the original decoded audio.
Export settings: format, frame rate (24/30/60), resolution (720p, 1080p,
1080×1080, 720×1280), length (full / 30s / 15s), and **quality tier**.

| Tier | Bits-per-pixel/frame | ~Bitrate @1080p30 | Clamp range |
|---|---|---|---|
| Standard | 0.10 | ~6.2 Mbps | 4–16 Mbps |
| High (default) | 0.20 | ~12.4 Mbps | 6–40 Mbps |
| Max | 0.35 | ~21.8 Mbps | 8–80 Mbps |

- Rate control: `bitrateMode: 'variable'` + `latencyMode: 'quality'`, chosen
  via `VideoEncoder.isConfigSupported()` with graceful fallbacks.
- H.264 High-profile **level is derived from resolution × fps** (4.0 / 4.2 /
  5.1) so files are always standards-legal (1080p60 → level 4.2, not 4.0).
- VBR undershoots the target on simple dark content by design; the tiers
  matter most for complex content (background images, particles, glow).
- **Audio: true stereo** straight from the decoded source buffer (no mono
  mixdown), **AAC-LC 256 kbps** (Opus 192 kbps fallback at 48 kHz), source
  sample rate preserved, and **truncated to the export length** so 15s/30s
  previews stay in sync.

### Live recording (MediaRecorder)

Real-time WebM capture of the preview canvas with an explicit
`videoBitsPerSecond` (0.2 bpp @30 fps, clamped 4–20 Mbps — Chrome's ~1 Mbps
default was the main quality killer). Alpha (VP9 + alpha) is used when the
background is transparent. Audio should come from the deterministic export for
perfect sync.

### Other capture

- **PNG snapshot** — current preview frame, lossless PNG.
- **PNG sequence** — offline frame-by-frame ZIP (capped frame count).
- **Convert dialog** — re-encodes a WebM recording (or any video) to MP4 in
  real time with its audio track.

## Development

```bash
bun install
bun run dev        # dev server on :3000 (logs in dev.log)
bun run lint       # eslint
bun run db:push    # push prisma schema to sqlite
```

- Dev server must run on port 3000; never run `bun run build` in this
  sandbox.
- z-ai-web-dev-sdk calls are backend-only.
- `worklog.md` at the repo root is the detailed per-task engineering log
  (Tasks 1–12 so far).

## Session notes / picking this up next time

**Verified working (browser E2E):** export config actually reaches the
encoder (12.44 Mbps target, VBR, `avc1.640028` at 1080p30); exported MP4
decodes clean at 1:1 (no banding/blocking); audio track verified via
in-page `decodeAudioData` — 2 channels, L/R correlation ≈ 0.25 (true
stereo), 15.01 s audio from a 20 s source (truncation correct), 44.1 kHz
preserved. Mobile layout of the Export tab checked at 390 px.

**Known minor issues:**

- Radix slider thumbs across the studio have no accessible name
  (`aria-label` needs to be added per-thumb) — noted in worklog Task 10.
- Export toast auto-dismisses fast; if you miss it, the size is shown only
  there (could persist last-export info in the Export tab).

**Ideas worth considering next:**

- Optional "lossless audio" toggle (PCM in MP4 is poorly supported; more
  realistic: expose a WAV download of the mixdown alongside the MP4).
- Alpha-channel MP4/WebM export path for transparent backgrounds in the
  deterministic pipeline (currently only live recording supports alpha).
- Bitrate readback: show actual encoded bitrate/size estimate before export.
- Presets that bundle gradient + style + background + export settings.
