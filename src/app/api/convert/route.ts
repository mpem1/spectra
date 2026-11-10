import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * POST /api/convert?format=mp4|prores4444
 * Body: raw WebM bytes (MediaRecorder output).
 *
 * Browsers only record WebM (VP8/VP9 + Opus), which DaVinci Resolve and most
 * NLEs cannot import. This route re-wraps/transcodes the clip with the local
 * ffmpeg binary into an editor-friendly container:
 *
 * - mp4       → H.264 + AAC in MP4 (universally importable; alpha flattened)
 * - prores4444→ Apple ProRes 4444 + PCM in MOV (alpha preserved — the format
 *               DaVinci Resolve prefers for transparent overlays)
 *
 * The input is decoded with `-c:v libvpx` for the ProRes path because ffmpeg's
 * native vp8/vp9 decoders silently DROP the alpha plane stored in WebM
 * BlockAdditional elements (verified in Task 9); libvpx honors alpha_mode.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_INPUT_BYTES = 500 * 1024 * 1024
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000

type Format = 'mp4' | 'prores4444'

/**
 * GET /api/convert — capability probe for the Convert dialog.
 * Returns whether this host has the ffmpeg binary. Hosts like Vercel run route
 * handlers on serverless functions without ffmpeg (and with small body caps),
 * so the dialog uses this to fall back to the in-browser wasm engine.
 */
let ffmpegProbe: boolean | null = null

function probeFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    let sawOutput = false
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    const child = spawn('ffmpeg', ['-version'])
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      done(sawOutput)
    }, 4000)
    child.stdout.on('data', () => {
      sawOutput = true
    })
    child.on('error', () => done(false))
    child.on('close', () => done(sawOutput))
  })
}

export async function GET() {
  if (ffmpegProbe === null) ffmpegProbe = await probeFfmpeg()
  return NextResponse.json(
    { ffmpeg: ffmpegProbe },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

function buildArgs(format: Format, input: string, output: string): string[] {
  if (format === 'mp4') {
    return [
      '-y',
      '-i', input,
      '-c:v', 'libx264',
      '-crf', '18',
      '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '192k',
      output,
    ]
  }
  return [
    '-y',
    // Decode with libvpx so the VP8/VP9 alpha plane survives into ProRes
    '-c:v', 'libvpx',
    '-i', input,
    '-c:v', 'prores_ks',
    '-profile:v', '4444',
    '-pix_fmt', 'yuva444p10le',
    '-c:a', 'pcm_s16le',
    output,
  ]
}

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args])
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), FFMPEG_TIMEOUT_MS)
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
      if (stderr.length > 8000) stderr = stderr.slice(-8000)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stderr })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: 1, stderr: `${stderr}\n${err.message}` })
    })
  })
}

export async function POST(req: NextRequest) {
  const format: Format = req.nextUrl.searchParams.get('format') === 'prores4444' ? 'prores4444' : 'mp4'

  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_INPUT_BYTES) {
    return NextResponse.json(
      { error: 'Clip too large — recordings up to 500 MB can be converted.' },
      { status: 413 }
    )
  }

  const input = Buffer.from(await req.arrayBuffer())
  if (input.byteLength === 0) {
    return NextResponse.json({ error: 'Empty upload.' }, { status: 400 })
  }
  if (input.byteLength > MAX_INPUT_BYTES) {
    return NextResponse.json(
      { error: 'Clip too large — recordings up to 500 MB can be converted.' },
      { status: 413 }
    )
  }

  const dir = await mkdtemp(join(tmpdir(), 'spectra-convert-'))
  const ext = format === 'mp4' ? 'mp4' : 'mov'
  const inPath = join(dir, 'input.webm')
  const outPath = join(dir, `output.${ext}`)

  try {
    await writeFile(inPath, input)
    const { code, stderr } = await runFfmpeg(buildArgs(format, inPath, outPath))
    if (code !== 0) {
      const tail = stderr.trim().split('\n').slice(-3).join(' · ')
      return NextResponse.json(
        { error: `ffmpeg could not convert this file. ${tail}` },
        { status: 422 }
      )
    }
    const data = await readFile(outPath)
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': format === 'mp4' ? 'video/mp4' : 'video/quicktime',
        'Content-Length': String(data.byteLength),
        'Content-Disposition': `attachment; filename="spectra-${format === 'mp4' ? 'h264' : 'prores4444'}-${Date.now()}.${ext}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Conversion failed' },
      { status: 500 }
    )
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
