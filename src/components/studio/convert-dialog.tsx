'use client'

import { useEffect, useRef, useState } from 'react'
import { FileVideo, Loader2, Repeat, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useStudioStore } from '@/store/studio'
import { formatTime } from '@/components/studio/controls'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

function pickConvertMime(): { mime: string; ext: string } {
  const candidates: { mime: string; ext: string }[] = [
    { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ]
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate.mime)) {
      return candidate
    }
  }
  return { mime: '', ext: 'webm' }
}

/**
 * Convert dialog: re-encodes a WebM recording (or any video file) into an
 * MP4 in real time via canvas capture + MediaRecorder. Falls back to WebM
 * with a notice when the browser has no MP4 recorder.
 */
export function ConvertDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const lastRecording = useStudioStore((s) => s.lastRecording)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cancelRef = useRef(false)
  const [converting, setConverting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    return () => {
      cancelRef.current = true
    }
  }, [])

  const convert = async (file: Blob, baseName: string) => {
    if (converting) return
    setConverting(true)
    setElapsed(0)
    setDuration(0)
    const { mime, ext } = pickConvertMime()
    if (!mime.startsWith('video/mp4')) {
      toast.warning('MP4 recorder unavailable', {
        description: 'This browser cannot encode MP4 here — output will be WebM.',
      })
    }
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.src = url
    video.playsInline = true

    let raf = 0
    let timer = 0
    let actx: AudioContext | null = null
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve()
        video.onerror = () => reject(new Error('Could not read the video file'))
      })
      if (video.duration === Infinity || Number.isNaN(video.duration)) {
        throw new Error('Unsupported stream-length video')
      }
      setDuration(video.duration)

      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 1280
      canvas.height = video.videoHeight || 720
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 2D unavailable')

      const stream = canvas.captureStream(30)
      if (!mime.startsWith('video/mp4')) {
        // Alpha/quality hints are moot here — keep the code path simple.
      }
      actx = new AudioContext()
      const srcNode = actx.createMediaElementSource(video)
      const dest = actx.createMediaStreamDestination()
      srcNode.connect(dest)
      srcNode.connect(actx.destination)
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t))

      const recorder = new MediaRecorder(stream, {
        mimeType: mime || undefined,
        videoBitsPerSecond: 8_000_000,
      })
      const chunks: Blob[] = []
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      const done = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }))
      })

      recorder.start(500)
      await video.play()

      const draw = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        if (!video.ended && !cancelRef.current) raf = requestAnimationFrame(draw)
      }
      raf = requestAnimationFrame(draw)
      timer = window.setInterval(() => setElapsed(video.currentTime), 250)

      await new Promise<void>((resolve) => {
        video.onended = () => resolve()
      })
      // Grace period so the last frames land in the muxer.
      await new Promise((r) => window.setTimeout(r, 400))
      recorder.stop()
      const blob = await done

      const outName = `${baseName}.${ext}`
      const dl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = dl
      a.download = outName
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(dl), 4000)
      toast.success(`Converted to ${ext.toUpperCase()}`, {
        description: `${outName} · ${(blob.size / (1024 * 1024)).toFixed(1)} MB`,
      })
      onOpenChange(false)
    } catch (err) {
      toast.error('Conversion failed', {
        description: err instanceof Error ? err.message : 'Unknown error.',
      })
    } finally {
      cancelRef.current = false
      if (raf) cancelAnimationFrame(raf)
      if (timer) window.clearInterval(timer)
      void actx?.close().catch(() => undefined)
      URL.revokeObjectURL(url)
      video.remove()
      setConverting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={converting ? undefined : onOpenChange}>
      <DialogContent className="border-zinc-800 bg-zinc-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-100">
            <Repeat className="size-4 text-emerald-400" aria-hidden />
            Convert video
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            Re-encodes a WebM recording (or any video file) into MP4 in real time with its audio
            track. Runs at playback speed — keep the tab visible.
          </DialogDescription>
        </DialogHeader>

        {converting ? (
          <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex items-center gap-2 text-xs text-zinc-300">
              <Loader2 className="size-4 animate-spin text-emerald-400" aria-hidden />
              Converting… {formatTime(elapsed)}
              {duration > 0 ? ` / ${formatTime(duration)}` : ''}
            </div>
            <p className="text-[11px] text-zinc-500">
              Conversion happens at playback speed for perfect audio sync.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {lastRecording ? (
              <Button
                variant="outline"
                className="h-11 w-full justify-start border-zinc-800 hover:border-emerald-500/60 hover:bg-emerald-500/5"
                onClick={() =>
                  void convert(lastRecording, 'spectra-recording-converted')
                }
              >
                <FileVideo className="size-4 text-emerald-400" aria-hidden />
                <span className="min-w-0 flex-1 text-left">
                  Use last recording
                  <span className="block text-[10px] text-zinc-500">
                    {(lastRecording.size / (1024 * 1024)).toFixed(1)} MB ·{' '}
                    {lastRecording.type || 'video/webm'}
                  </span>
                </span>
              </Button>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,.webm,.mp4,.mov"
              className="hidden"
              aria-label="Video file input"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void convert(file, file.name.replace(/\.[^.]+$/, '') || 'converted')
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
            />
            <Button
              variant="outline"
              className="h-11 w-full justify-start border-zinc-800 hover:border-zinc-600"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-4" aria-hidden />
              Pick a video file…
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
