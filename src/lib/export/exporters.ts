"use client";

import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { zip } from "fflate";
import { renderFrame, createRenderState } from "@/lib/render/renderer";
import type { VisualState } from "@/lib/types";
import { analyzeForExport, decodeAudioFile, type AudioTrackAnalysis } from "@/lib/audio/offline-spectrum";

/**
 * Deterministic exporters.
 *
 * MP4 : renders every frame at exact time frameIndex/fps via WebCodecs
 *       (H.264) and muxes the ORIGINAL audio file (AAC) alongside it.
 *       → frame-exact timestamps, untouched audio, one universal file that
 *       opens in DaVinci Resolve / Premiere / YouTube directly. No recorded
 *       audio track = no clicks, no drift.
 *
 * PNG : writes every frame as a PNG (alpha preserved) into a ZIP — the path
 *       to use when you need transparency compositing in Resolve.
 */

export class ExportCancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "ExportCancelledError";
  }
}

export interface ExportOptions {
  audioFile: File | Blob;
  audioName: string;
  vis: VisualState;
  bgImage: HTMLImageElement | null;
  fps: number;
  width: number; // will be snapped to even
  height: number;
  durationLimit?: number; // seconds — trim for quick test exports
  onProgress: (stage: string, progress: number) => void;
  shouldCancel: () => boolean;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  frameCount: number;
  durationSec: number;
  detail: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function evenize(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

async function loadAudio(options: ExportOptions): Promise<AudioTrackAnalysis> {
  const buf = await options.audioFile.arrayBuffer();
  const decoded = await decodeAudioFile(buf, 48000);
  return analyzeForExport(decoded, {
    fps: options.fps,
    durationLimit: options.durationLimit,
    smoothing: 0.8,
    onProgress: (_phase, done, total) => {
      options.onProgress(`Analyzing audio ${done}/${total}`, (done / total) * 0.25);
    },
    shouldCancel: options.shouldCancel,
  });
}

interface RenderTarget {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  state: ReturnType<typeof createRenderState>;
}

function createTarget(width: number, height: number): RenderTarget {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true })!;
  return { canvas, ctx, state: createRenderState() };
}

function renderExportFrame(
  target: RenderTarget,
  analysis: AudioTrackAnalysis,
  options: ExportOptions,
  frameIndex: number,
  opaque: boolean
): void {
  const t = frameIndex / analysis.fps;
  renderFrame(
    {
      ctx: target.ctx,
      w: target.canvas.width,
      h: target.canvas.height,
      time: t,
      dt: 1 / analysis.fps,
      freq: analysis.spectrumFrames[frameIndex],
      wave: analysis.waveformFrames[frameIndex],
      vis: options.vis,
      bgImage: options.bgImage,
      opaque, // MP4: paint black behind transparent scenes. PNG: keep real alpha when transparentBg is on.
    },
    target.state
  );
}

// ------------------------- MP4 -------------------------

const AVC_CANDIDATES = [
  "avc1.640033", // High 5.1
  "avc1.640028", // High 4.0
  "avc1.4d0032", // Main 5.0
  "avc1.4d0028", // Main 4.0
  "avc1.42E01E", // Baseline 3.1
];

async function pickVideoCodec(width: number, height: number, fps: number, bitrate: number): Promise<string> {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("WebCodecs not available — use Chrome or Edge 94+ for MP4 export.");
  }
  for (const codec of AVC_CANDIDATES) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
      });
      if (support.supported) return codec;
    } catch {
      /* try next */
    }
  }
  throw new Error("No supported H.264 encoder configuration found.");
}

async function pickAacConfig(sampleRate: number, channelCount: number) {
  if (typeof AudioEncoder === "undefined") return null;
  const channels = Math.min(2, channelCount);
  const config: AudioEncoderConfig = {
    codec: "mp4a.40.2",
    sampleRate,
    numberOfChannels: channels,
    bitrate: 192_000,
  };
  try {
    const support = await AudioEncoder.isConfigSupported(config);
    return support.supported ? { config, channels } : null;
  } catch {
    return null;
  }
}

/** Minimal top-level MP4 box probe used for post-export sanity logging. */
function probeMp4(buf: ArrayBuffer): { boxes: string[]; durationSec: number; bytes: number } {
  const view = new DataView(buf);
  const boxes: string[] = [];
  let durationSec = 0;
  let offset = 0;
  const type = (o: number) =>
    String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  while (offset + 8 <= buf.byteLength) {
    const size = view.getUint32(offset);
    if (size < 8 || offset + size > buf.byteLength) break;
    const t = type(offset + 4);
    boxes.push(t);
    if (t === "moov") {
      // mvhd is normally the first child box
      const sub = offset + 8;
      if (sub + 36 <= buf.byteLength && type(sub + 4) === "mvhd") {
        const version = view.getUint8(sub + 8);
        if (version === 0) {
          const timescale = view.getUint32(sub + 20);
          const dur = view.getUint32(sub + 24);
          if (timescale > 0) durationSec = dur / timescale;
        } else {
          const timescale = view.getUint32(sub + 28);
          const durHi = view.getUint32(sub + 32);
          if (timescale > 0) durationSec = durHi / timescale;
        }
      }
    }
    offset += size;
  }
  return { boxes, durationSec, bytes: buf.byteLength };
}

export async function exportMp4(options: ExportOptions): Promise<ExportResult> {
  options.onProgress("Decoding audio…", 0.02);
  const analysis = await loadAudio(options);
  const width = evenize(options.width);
  const height = evenize(options.height);
  const fps = analysis.fps;
  const frameCount = analysis.frameCount;
  const target = createTarget(width, height);

  const bitrate =
    (width * height >= 1920 * 1080 ? 14_000_000 : 8_000_000) * (fps >= 60 ? 1.6 : 1);

  options.onProgress("Configuring encoder…", 0.26);
  const codec = await pickVideoCodec(width, height, fps, bitrate);
  const audioSetup = await pickAacConfig(analysis.sampleRate, analysis.channelCount);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height, frameRate: fps },
    ...(audioSetup
      ? {
          audio: {
            codec: "aac" as const,
            numberOfChannels: audioSetup.channels,
            sampleRate: analysis.sampleRate,
          },
        }
      : {}),
    fastStart: "in-memory",
  });

  let cancelled = false;
  let encoderError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e instanceof Error ? e : new Error(String(e));
    },
  });
  videoEncoder.configure({
    codec,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: "quality",
  });

  const frameDur = Math.round(1_000_000 / fps);
  const keyEvery = Math.max(1, Math.round(fps * 2));

  for (let i = 0; i < frameCount; i++) {
    if (options.shouldCancel() || encoderError) {
      cancelled = true;
      break;
    }
    renderExportFrame(target, analysis, options, i, true);
    const frame = new VideoFrame(target.canvas, {
      timestamp: Math.round((i * 1_000_000) / fps),
      duration: frameDur,
    });
    videoEncoder.encode(frame, { keyFrame: i % keyEvery === 0 });
    frame.close();

    if (videoEncoder.encodeQueueSize > 8) {
      while (videoEncoder.encodeQueueSize > 4) await sleep(3);
    }
    if (i % 8 === 0 || i === frameCount - 1) {
      options.onProgress(
        `Rendering frames ${i + 1}/${frameCount}`,
        0.28 + ((i + 1) / frameCount) * 0.5
      );
      await sleep(0);
    }
  }

  if (!cancelled && !encoderError) {
    options.onProgress("Flushing video encoder…", 0.8);
    await videoEncoder.flush();
  }
  videoEncoder.close();
  if (encoderError) throw encoderError;
  if (cancelled) throw new ExportCancelledError();

  // ---- audio (the ORIGINAL file, re-timestamped exactly) ----
  if (audioSetup) {
    options.onProgress("Encoding original audio (AAC)…", 0.84);
    let audioError: Error | null = null;
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => {
        audioError = e instanceof Error ? e : new Error(String(e));
      },
    });
    audioEncoder.configure(audioSetup.config);

    const channels = audioSetup.channels;
    const totalSamples = Math.min(
      analysis.channels[0].length,
      Math.round(analysis.duration * analysis.sampleRate)
    );
    const block = analysis.sampleRate; // 1s chunks
    const planes: Float32Array[] = [];
    for (let c = 0; c < channels; c++) planes.push(analysis.channels[Math.min(c, analysis.channels.length - 1)]);

    for (let off = 0; off < totalSamples; off += block) {
      if (options.shouldCancel() || audioError) {
        cancelled = true;
        break;
      }
      const n = Math.min(block, totalSamples - off);
      const data = new Float32Array(n * channels);
      for (let c = 0; c < channels; c++) {
        data.set(planes[c].subarray(off, off + n), c * n);
      }
      const ad = new AudioData({
        format: "f32-planar",
        sampleRate: analysis.sampleRate,
        numberOfFrames: n,
        numberOfChannels: channels,
        timestamp: Math.round((off / analysis.sampleRate) * 1_000_000),
        data,
      });
      audioEncoder.encode(ad);
      ad.close();
      if (audioEncoder.encodeQueueSize > 16) {
        while (audioEncoder.encodeQueueSize > 8) await sleep(3);
      }
      if (off % (block * 4) === 0) await sleep(0);
    }
    if (!cancelled && !audioError) await audioEncoder.flush();
    audioEncoder.close();
    if (audioError) throw audioError;
    if (cancelled) throw new ExportCancelledError();
  }

  options.onProgress("Finalizing MP4…", 0.94);
  muxer.finalize();
  const { buffer } = muxer.target as ArrayBufferTarget;

  const probe = probeMp4(buffer);
  console.info(
    `[Spectra] MP4 export OK — ${probe.bytes} bytes, boxes=[${probe.boxes.join(", ")}], ` +
      `mvhd duration=${probe.durationSec.toFixed(3)}s, frames=${frameCount}, fps=${fps}, ` +
      `audio=${audioSetup ? "aac (original file)" : "none"}, codec=${codec}`
  );

  options.onProgress("Done", 1);
  const baseName = sanitizeFilename(options.audioName || "spectra-export");
  return {
    blob: new Blob([buffer], { type: "video/mp4" }),
    filename: `${baseName}-${fps}fps.mp4`,
    frameCount,
    durationSec: probe.durationSec || analysis.duration,
    detail: `${frameCount} frames @ ${fps}fps · ${audioSetup ? "original audio muxed in (AAC)" : "video only — AAC encoder unavailable in this browser; drop the original MP3 on the timeline (video is frame-exact, it will align at 0:00)"}`,
  };
}

// ------------------------- PNG sequence -------------------------

export async function exportPngSequence(options: ExportOptions): Promise<ExportResult> {
  options.onProgress("Decoding audio…", 0.02);
  const analysis = await loadAudio(options);
  const width = evenize(options.width);
  const height = evenize(options.height);
  const fps = analysis.fps;
  const frameCount = analysis.frameCount;
  const target = createTarget(width, height);

  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < frameCount; i++) {
    if (options.shouldCancel()) throw new ExportCancelledError();
    renderExportFrame(target, analysis, options, i, false);
    const blob = await new Promise<Blob | null>((res) => target.canvas.toBlob(res, "image/png"));
    if (!blob) throw new Error("canvas.toBlob returned null");
    files[`frame_${String(i + 1).padStart(6, "0")}.png`] = new Uint8Array(await blob.arrayBuffer());
    if (i % 4 === 0 || i === frameCount - 1) {
      options.onProgress(`Rendering PNGs ${i + 1}/${frameCount}`, 0.05 + ((i + 1) / frameCount) * 0.75);
      await sleep(0);
    }
  }

  options.onProgress(`Packing ZIP (${frameCount} frames)…`, 0.85);
  const zipped = await new Promise<Uint8Array>((res, rej) => {
    zip(files, { level: 0 }, (err, data) => (err ? rej(err) : res(data)));
  });

  console.info(`[Spectra] PNG sequence OK — ${frameCount} PNGs, zip=${zipped.byteLength} bytes, ${width}x${height}@${fps}`);
  options.onProgress("Done", 1);
  const baseName = sanitizeFilename(options.audioName || "spectra-export");
  return {
    blob: new Blob([zipped], { type: "application/zip" }),
    filename: `${baseName}-png-sequence-${fps}fps.zip`,
    frameCount,
    durationSec: analysis.duration,
    detail: `${frameCount} PNGs @ ${fps}fps · ${width}×${height}${options.vis.transparentBg ? " · alpha preserved" : ""}`,
  };
}

export function sanitizeFilename(name: string): string {
  return (name.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9-_ ]/gi, "").trim() || "spectra-export")
    .replace(/\s+/g, "-")
    .slice(0, 60)
    .toLowerCase();
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
