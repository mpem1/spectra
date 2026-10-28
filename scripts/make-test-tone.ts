/**
 * Generates public/test-tone.wav — a 40s structured test track:
 * bass kick every 0.5s, chord pads, melody arpeggio, stereo widening.
 * Run: bun scripts/make-test-tone.ts
 */
import { writeFileSync, mkdirSync } from "fs";

const SR = 48000;
const DUR = 40;
const N = SR * DUR;
const L = new Float32Array(N);
const R = new Float32Array(N);

const note = (semi: number) => 440 * Math.pow(2, semi / 12);

function addSine(startSec: number, durSec: number, freq: number, amp: number, pan = 0, decay = 3) {
  const start = Math.floor(startSec * SR);
  const len = Math.floor(durSec * SR);
  for (let i = 0; i < len && start + i < N; i++) {
    const t = i / SR;
    const env = Math.min(1, t * 200) * Math.exp(-t * decay);
    const v = Math.sin(2 * Math.PI * freq * t) * amp * env;
    L[start + i] += v * (1 - Math.max(0, pan));
    R[start + i] += v * (1 + Math.min(0, pan));
  }
}

function addKick(startSec: number) {
  const start = Math.floor(startSec * SR);
  const len = Math.floor(0.18 * SR);
  for (let i = 0; i < len && start + i < N; i++) {
    const t = i / SR;
    const f = 120 * Math.exp(-t * 18) + 42;
    const env = Math.exp(-t * 9);
    const v = Math.sin(2 * Math.PI * f * t) * env * 0.85;
    L[start + i] += v;
    R[start + i] += v;
  }
}

// chord progression: Am - F - C - G (2s each, looped)
const chords: number[][] = [
  [-12, 0, 3, 7], // Am
  [-16, -4, 0, 5], // F
  [-9, -1, 2, 7], // C
  [-14, -2, 2, 5], // G
];

for (let bar = 0; bar < DUR / 2; bar++) {
  const chord = chords[bar % 4];
  const t0 = bar * 2;
  // pad
  for (const semi of chord) addSine(t0, 2.1, note(semi), 0.1, 0, 1.2);
  // kick on beats
  addKick(t0);
  addKick(t0 + 1);
  // arpeggio 8ths
  for (let k = 0; k < 4; k++) {
    const semi = chord[(k * 3) % chord.length] + 12;
    addSine(t0 + k * 0.5, 0.45, note(semi), 0.16, k % 2 === 0 ? -0.5 : 0.5, 5);
  }
}

// soft-clip
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 1.1) * 0.9;
  R[i] = Math.tanh(R[i] * 1.1) * 0.9;
}

// WAV encode (16-bit stereo)
const dataSize = N * 2 * 2;
const buf = new ArrayBuffer(44 + dataSize);
const view = new DataView(buf);
const wstr = (o: number, s: string) => {
  for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
};
wstr(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); wstr(8, "WAVE");
wstr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
view.setUint16(22, 2, true); view.setUint32(24, SR, true); view.setUint32(28, SR * 4, true);
view.setUint16(32, 4, true); view.setUint16(34, 16, true);
wstr(36, "data"); view.setUint32(40, dataSize, true);
let off = 44;
for (let i = 0; i < N; i++) {
  view.setInt16(off, Math.max(-1, Math.min(1, L[i])) * 32767, true); off += 2;
  view.setInt16(off, Math.max(-1, Math.min(1, R[i])) * 32767, true); off += 2;
}

mkdirSync("public", { recursive: true });
writeFileSync("public/test-tone.wav", Buffer.from(buf));
console.log(`Wrote public/test-tone.wav (${((44 + dataSize) / 1e6).toFixed(1)} MB, ${DUR}s)`);
