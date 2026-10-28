"use client";

/**
 * Deterministic offline audio analysis.
 *
 * MediaRecorder / live analyser capture is wall-clock based: dropped frames,
 * WebM/Opus duration bloat and pre-skip all accumulate into the drift the user
 * heard when lining the recorded track against the original MP3. For export we
 * instead pre-compute the exact spectrum for every output frame directly from
 * the decoded PCM at sample position `frameIndex * sampleRate / fps`. This
 * makes frame N mathematically identical no matter how long the export takes.
 *
 * The dB mapping replicates Chrome's AnalyserNode byte output
 * (min/maxDecibels -100/-30, Hann-windowed FFT) so exported visuals match the
 * live preview.
 */

export interface AudioTrackAnalysis {
  sampleRate: number;
  duration: number;
  channelCount: number;
  channels: Float32Array[]; // planar PCM
  fps: number;
  frameCount: number;
  spectrumFrames: Uint8Array[]; // per frame, frequencyBinCount bytes 0..255
  waveformFrames: Uint8Array[]; // per frame, fftSize bytes centered at 128
  bins: number;
  fftSize: number;
}

const MIN_DB = -100;
const MAX_DB = -30;

export async function decodeAudioFile(
  data: ArrayBuffer,
  targetSampleRate = 48000
): Promise<{ sampleRate: number; duration: number; channelCount: number; channels: Float32Array[] }> {
  const OAC = (
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext
  )!;
  // 1-frame context used purely as a decoder host.
  const ctx = new OAC(2, 1, targetSampleRate);
  const buf = await ctx.decodeAudioData(data);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c).slice());
  return {
    sampleRate: buf.sampleRate,
    duration: buf.duration,
    channelCount: buf.numberOfChannels,
    channels,
  };
}

/** In-place iterative radix-2 Cooley–Tukey FFT (real+imag split arrays). */
class FFT {
  private n: number;
  private levels: number;
  private cosTable: Float32Array;
  private sinTable: Float32Array;

  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error("FFT size must be a power of 2");
    this.n = n;
    this.levels = Math.round(Math.log2(n));
    this.cosTable = new Float32Array(n / 2);
    this.sinTable = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / n);
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / n);
    }
  }

  /** re/im are length-n arrays, modified in place. */
  transform(re: Float32Array, im: Float32Array): void {
    const n = this.n;
    // bit-reversal permutation
    for (let i = 0; i < n; i++) {
      const j = reverseBits(i, this.levels);
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * this.cosTable[k] + im[l] * this.sinTable[k];
          const tim = -re[l] * this.sinTable[k] + im[l] * this.cosTable[k];
          re[l] = re[j] - tre;
          im[l] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
  }
}

function reverseBits(x: number, bits: number): number {
  let y = 0;
  for (let i = 0; i < bits; i++) {
    y = (y << 1) | (x & 1);
    x >>>= 1;
  }
  return y;
}

export interface AnalyzeProgress {
  (phase: "analyze", done: number, total: number): void;
}

/**
 * Pre-compute spectrum + waveform for every output frame.
 * smoothing replicates AnalyserNode.smoothingTimeConstant (EMA over frames).
 */
export async function analyzeForExport(
  audio: { sampleRate: number; duration: number; channelCount: number; channels: Float32Array[] },
  opts: {
    fps: number;
    durationLimit?: number; // seconds, trim
    smoothing?: number; // 0..0.99, matches engine analyser (0.8)
    onProgress?: AnalyzeProgress;
    shouldCancel?: () => boolean;
  }
): Promise<AudioTrackAnalysis> {
  const { fps, durationLimit, smoothing = 0.8, onProgress, shouldCancel } = opts;
  const { sampleRate, channels } = audio;
  const mono = mixToMono(channels);
  const dur = Math.min(audio.duration, durationLimit ?? audio.duration);
  const fftSize = 2048;
  const bins = fftSize / 2;
  const frameCount = Math.max(1, Math.ceil(dur * fps));

  const fft = new FFT(fftSize);
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    // periodic Hann
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / fftSize));
  }

  const spectrumFrames: Uint8Array[] = new Array(frameCount);
  const waveformFrames: Uint8Array[] = new Array(frameCount);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const prevMag = new Float32Array(bins);
  const mag = new Float32Array(bins);
  const dbByte = new Uint8Array(bins);

  // Full-scale sine via this windowed FFT peaks at |X| = N/4 → normalize by that.
  const NORM = 1 / (fftSize / 4);
  const dbScale = 255 / (MAX_DB - MIN_DB);

  const hop = sampleRate / fps;

  for (let f = 0; f < frameCount; f++) {
    if (shouldCancel?.()) throw new Error("cancelled");
    const start = Math.min(mono.length - 1, Math.round(f * hop));
    const avail = Math.max(0, mono.length - start);
    const count = Math.min(fftSize, avail);

    // waveform bytes (time domain)
    const w = new Uint8Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      const v = i < count ? mono[start + i] : 0;
      w[i] = Math.max(0, Math.min(255, Math.round(v * 128 + 128)));
    }
    waveformFrames[f] = w;

    // windowed frame
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < count; i++) re[i] = mono[start + i] * window[i];
    fft.transform(re, im);

    // magnitudes (only lower half), EMA smoothing like the live analyser
    for (let k = 0; k < bins; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * NORM;
      const s = smoothing > 0 ? smoothing * prevMag[k] + (1 - smoothing) * m : m;
      prevMag[k] = s;
      mag[k] = s;
    }
    for (let k = 0; k < bins; k++) {
      const db = 20 * Math.log10(mag[k] + 1e-9);
      const clamped = Math.max(MIN_DB, Math.min(MAX_DB, db));
      dbByte[k] = Math.round((clamped - MIN_DB) * dbScale);
    }
    spectrumFrames[f] = new Uint8Array(dbByte);

    if (onProgress && (f % 120 === 0 || f === frameCount - 1)) {
      onProgress("analyze", f + 1, frameCount);
    }
    // Yield occasionally so the UI thread can breathe on long tracks.
    if (f % 480 === 479) await nextTick();
  }

  return {
    sampleRate,
    duration: dur,
    channelCount: audio.channelCount,
    channels,
    fps,
    frameCount,
    spectrumFrames,
    waveformFrames,
    bins,
    fftSize,
  };
}

function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const len = channels[0].length;
  const out = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) out[i] += ch[i];
  const g = 1 / channels.length;
  for (let i = 0; i < len; i++) out[i] *= g;
  return out;
}

function nextTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
