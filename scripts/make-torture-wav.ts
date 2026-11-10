/** E2E torture track — 12 s: LOUD held 45 Hz drone the whole way + kicks at 1..10.
 * The byte bass meter pins at its ceiling under this drone (the user's bug),
 * so only the clean sub channel can hear the kicks. 16-bit PCM mono 48 kHz. */
const SR = 48000
const DUR = 12
const n = SR * DUR
const pcm = new Float32Array(n)

// loud held drone
{
  let phase = 0
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * 45) / SR
    pcm[i] = 0.5 * Math.sin(phase)
  }
}
// kicks at 1..10 s
for (let k = 1; k <= 10; k++) {
  const start = k * SR
  let phase = 0
  for (let i = 0; i < 0.4 * SR && start + i < n; i++) {
    const x = i / SR
    const f = x < 0.05 ? 45 + 105 * Math.exp(-x / 0.02) : 45
    phase += (2 * Math.PI * f) / SR
    pcm[start + i] += 1.0 * 0.9 * Math.exp(-x / 0.09) * Math.sin(phase)
    if (x < 0.004) pcm[start + i] += 0.4 * (Math.random() * 2 - 1) * (1 - x / 0.004)
  }
}
// normalize to ~0.89 peak and write WAV
let peak = 0
for (const v of pcm) peak = Math.max(peak, Math.abs(v))
const g = 0.89 / peak
const buf = Buffer.alloc(44 + n * 2)
buf.write('RIFF', 0)
buf.writeUInt32LE(36 + n * 2, 4)
buf.write('WAVE', 8)
buf.write('fmt ', 12)
buf.writeUInt32LE(16, 16)
buf.writeUInt16LE(1, 20) // PCM
buf.writeUInt16LE(1, 22) // mono
buf.writeUInt32LE(SR, 24)
buf.writeUInt32LE(SR * 2, 28)
buf.writeUInt16LE(2, 32)
buf.writeUInt16LE(16, 34)
buf.write('data', 36)
buf.writeUInt32LE(n * 2, 40)
for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i] * g)) * 32767), 44 + i * 2)
await Bun.write('/tmp/torture-kicks.wav', buf)
console.log('wrote /tmp/torture-kicks.wav', buf.length, 'bytes')
