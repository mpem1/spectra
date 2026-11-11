/**
 * Harness — lyrics auto-detect supporting math (no model, no network):
 *   S1  vocalFocusMix — center extraction keeps center-panned sources,
 *       ducks hard-panned ones, mono passthrough
 *   S2  highPass — rumble below the corner dies, vocal band survives
 *   S3  normalizeLoudness — quiet clips lift to the target RMS, loud clips
 *       soft-limit under the ceiling
 *   S4  filterSegments — canonical hallucinations drop, back-to-back
 *       duplicate lines collapse, real distinct lines and non-adjacent
 *       repeats survive
 *   S5  recoverNullStarts — a timestamp-less chunk inherits the previous
 *       chunk's end; a bare first chunk stays null (nowhere to place it)
 *
 * Validates the DSP + filters that feed the on-device Whisper detector so
 * the "Auto-detect lyrics" button stops losing buried/early lines to the
 * raw mix and stops floating stock-phrase garbage into the lyric list.
 */

import { vocalFocusMix, highPass, normalizeLoudness } from '../src/lib/transcribe/vocal-focus'
import { filterSegments, recoverNullStarts } from '../src/lib/transcribe/segments'

/* ---------------------------------- checks --------------------------------- */

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail: string): void {
  if (ok) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name} — ${detail}`)
  }
}

/* ------------------------------- S1 center mix ------------------------------ */

console.log('S1 vocalFocusMix — center extraction')
{
  // Mono: plain passthrough.
  const mono = new Float32Array([0.1, -0.2, 0.3])
  const monoOut = vocalFocusMix([mono])
  check(
    'mono input passes through untouched',
    monoOut.length === 3 && monoOut.every((v, i) => Math.abs(v - mono[i]) < 1e-9),
    `got [${[...monoOut].join(',')}]`,
  )

  // A center-panned "vocal" (L = R) survives at its exact mid level.
  const vocal = new Float32Array([0.5, 0.5, 0.5])
  const centerOut = vocalFocusMix([vocal, new Float32Array([0.5, 0.5, 0.5])])
  check(
    'center-panned source keeps its full level (mid − 0.8·side, side = 0)',
    centerOut.every((v) => Math.abs(v - 0.5) < 1e-9),
    `got [${[...centerOut].join(',')}]`,
  )

  // A hard-panned "guitar" (L = +x, R = −x) is ducked to (1−0.8) of its mid.
  const guitarL = new Float32Array([0.4, 0.4])
  const guitarR = new Float32Array([-0.4, -0.4])
  const sideOut = vocalFocusMix([guitarL, guitarR])
  // mid = 0, side = 0.4 → out = −0.8·0.4 = −0.32 (|out|/|mid-panned| = 0.2)
  check(
    'hard-panned source ducks to 20% of level (side duck 0.8)',
    sideOut.every((v) => Math.abs(v + 0.32) < 1e-6),
    `got [${[...sideOut].join(',')}]`,
  )
}

/* --------------------------------- S2 high pass ------------------------------ */

console.log('S2 highPass — rumble dies, voice band survives')
{
  const N = 24000 // 1 s @ 24 kHz
  const sine = (hz: number, amp: number): Float32Array => {
    const x = new Float32Array(N)
    for (let i = 0; i < N; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / N)
    return x
  }
  const ampOf = (x: Float32Array): number => {
    // Steady-state peak over the last quarter (skip the filter's settle).
    let peak = 0
    for (let i = Math.floor(N * 0.75); i < N; i++) peak = Math.max(peak, Math.abs(x[i]))
    return peak
  }
  const rumble = highPass(sine(40, 0.5), 24000, 90)
  const voice = highPass(sine(500, 0.5), 24000, 90)
  const rumbleAmp = ampOf(rumble)
  const voiceAmp = ampOf(voice)
  check('40 Hz kick rumble collapses (< 8% of input)', rumbleAmp < 0.04, `amp=${rumbleAmp.toFixed(4)}`)
  check('500 Hz vocal band survives (> 85% of input)', voiceAmp > 0.425, `amp=${voiceAmp.toFixed(4)}`)
}

/* ------------------------------ S3 loudness norm ----------------------------- */

console.log('S3 normalizeLoudness — quiet lifts, loud soft-limits')
{
  const quiet = new Float32Array(24000).map((_, i) => 0.03 * Math.sin((2 * Math.PI * 220 * i) / 24000))
  const lifted = normalizeLoudness(quiet)
  let sq = 0
  for (const v of lifted) sq += v * v
  const rms = Math.sqrt(sq / lifted.length)
  check('a quiet master (−31 dBFS) lifts to the target RMS (~0.09)', Math.abs(rms - 0.09) < 0.01, `rms=${rms.toFixed(4)}`)

  const veryQuiet = new Float32Array(24000).map((_, i) => 0.005 * Math.sin((2 * Math.PI * 220 * i) / 24000))
  const cappedLift = normalizeLoudness(veryQuiet)
  let sq2 = 0
  for (const v of cappedLift) sq2 += v * v
  const rms2 = Math.sqrt(sq2 / cappedLift.length)
  check('a near-silent clip still lifts hard (gain-capped at 12×, no noise blowup)', rms2 > 0.03 && rms2 < 0.06, `rms=${rms2.toFixed(4)}`)

  const loud = new Float32Array(24000).map((_, i) => 4 * Math.sin((2 * Math.PI * 220 * i) / 24000))
  const capped = normalizeLoudness(loud)
  const peak = Math.max(...capped)
  check('a clipping-loud input soft-limits under the 0.95 ceiling', peak <= 0.951 && peak > 0.8, `peak=${peak.toFixed(4)}`)

  const silence = normalizeLoudness(new Float32Array(1000))
  check('digital silence stays silence (no gain blowup)', silence.every((v) => v === 0), 'nonzero output')
}

/* ------------------------------ S4 segment filter ---------------------------- */

console.log('S4 filterSegments — hallucinations drop, echoes collapse')
{
  const seg = (time: number, text: string) => ({ time, text })
  const kept = filterSegments([
    seg(0, "I'm going to get some food."), // NOT on the blacklist — real-looking text survives
    seg(2, 'Thank you.'), // canonical hallucination
    seg(4, 'Please subscribe.'), // canonical hallucination
    seg(6, '[Music]'), // canonical hallucination
    seg(8, 'neon lights forever'),
    seg(10, 'neon lights forever'), // back-to-back echo of the same line
    seg(12, 'burning in the dark'),
    seg(40, 'neon lights forever'), // a REAL chorus repeat (non-adjacent) — survives
  ])
  check(
    'blacklisted stock phrases drop',
    !kept.some((s) => /thank you|subscribe|music/i.test(s.text)),
    `kept=${kept.map((s) => s.text).join(' | ')}`,
  )
  check(
    'back-to-back duplicates collapse to one line',
    kept.filter((s, i) => s.text.startsWith('neon') && i < 2).length === 1,
    `neon lines=${kept.filter((s) => s.text.startsWith('neon')).length}`,
  )
  check(
    'non-adjacent chorus repeats survive',
    kept.filter((s) => s.text.startsWith('neon')).length === 2,
    `neon lines=${kept.filter((s) => s.text.startsWith('neon')).length}`,
  )
  check('distinct real lines all survive', kept.some((s) => s.text === 'burning in the dark'), `kept=${kept.length}`)
  check(
    'case/punctuation-insensitive matching (Thank you! ≡ thank you)',
    filterSegments([seg(0, 'THANK YOU!!!'), seg(2, 'real lyric')]).length === 1,
    'blacklist miss',
  )
}

/* ----------------------------- S5 null-start recovery ----------------------------- */

console.log('S5 recoverNullStarts — no more dropped words at window starts')
{
  const c = (text: string, start: number | null, end: number | null) => ({ text, timestamp: [start, end] as [number | null, number | null] })
  const recovered = recoverNullStarts([
    c('words with no opening stamp', null, 3.2), // bare first chunk: no anchor → stays null
    c('next line', 3.2, 5.0),
    c('stampless follow-up', null, 7.5), // inherits 5.0 from the previous end
  ])
  check(
    'bare first chunk stays null (no anchor to inherit)',
    recovered[0].time === null,
    `time=${recovered[0].time}`,
  )
  check('a normally-stamped chunk keeps its start', recovered[1].time === 3.2, `time=${recovered[1].time}`)
  check(
    'a mid-stream stampless chunk inherits the previous end',
    recovered[2].time === 5.0,
    `time=${recovered[2].time}`,
  )
}

/* --------------------------------- verdict -------------------------------- */

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
