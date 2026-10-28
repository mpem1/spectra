'use client'

import { useEffect, useRef, useState } from 'react'
import { Music4, Pause, Play, Repeat, Upload, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getAudioEngine } from '@/lib/audio/engine'
import { formatTime } from '@/lib/format'
import { useEditorStore } from '@/store/editor'

export function PlayerBar() {
  const track = useEditorStore((s) => s.track)
  const loadTrack = useEditorStore((s) => s.loadTrack)

  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loop, setLoop] = useState(false)
  const [volume, setVolume] = useState(0.9)
  const [scrub, setScrub] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Poll the engine for playback state (keeps the UI in sync incl. track end)
  useEffect(() => {
    const engine = getAudioEngine()
    const id = window.setInterval(() => {
      setPlaying(!engine.paused && !!engine.track)
      setCurrent(engine.currentTime)
      setDuration(engine.duration)
      setLoop(engine.loop)
    }, 200)
    return () => window.clearInterval(id)
  }, [])

  const togglePlay = async () => {
    const engine = getAudioEngine()
    if (!engine.track) {
      fileRef.current?.click()
      return
    }
    if (engine.paused) {
      try {
        await engine.play()
      } catch {
        /* autoplay rejection — user can click again */
      }
    } else {
      engine.pause()
    }
    setPlaying(!engine.paused)
  }

  const commitSeek = () => {
    if (scrub !== null) {
      getAudioEngine().seek(scrub)
      setScrub(null)
    }
  }

  const toggleLoop = () => {
    const engine = getAudioEngine()
    engine.setLoop(!engine.loop)
    setLoop(!engine.loop)
  }

  const toggleMute = () => {
    const next = volume > 0 ? 0 : 0.9
    setVolume(next)
    getAudioEngine().setVolume(next)
  }

  return (
    <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/40 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <Button
          size="icon"
          onClick={() => void togglePlay()}
          aria-label={playing ? 'Pause' : 'Play'}
          className="h-11 w-11 shrink-0 rounded-full"
        >
          {playing ? (
            <Pause className="h-5 w-5" aria-hidden />
          ) : (
            <Play className="h-5 w-5 translate-x-[1px]" aria-hidden />
          )}
        </Button>

        <div className="hidden min-w-0 flex-1 items-center gap-3 sm:flex">
          <span className="w-10 shrink-0 text-right font-mono text-xs text-zinc-400">
            {formatTime(scrub ?? current)}
          </span>
          <Slider
            value={[Math.min(scrub ?? current, duration || 1)]}
            max={Math.max(duration, 1)}
            step={0.1}
            disabled={!track}
            aria-label="Seek"
            className="flex-1"
            onValueChange={(v) => setScrub(v[0])}
            onValueCommit={commitSeek}
          />
          <span className="w-10 shrink-0 font-mono text-xs text-zinc-400">
            {formatTime(duration)}
          </span>
        </div>

        {/* Mobile: compact progress under controls */}
        <div className="order-last w-full sm:hidden">
          <Slider
            value={[Math.min(scrub ?? current, duration || 1)]}
            max={Math.max(duration, 1)}
            step={0.1}
            disabled={!track}
            aria-label="Seek"
            onValueChange={(v) => setScrub(v[0])}
            onValueCommit={commitSeek}
          />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-zinc-500">
            <span>{formatTime(scrub ?? current)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2 sm:w-auto sm:flex-none">
          <Music4 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          <span className="min-w-0 max-w-[10rem] truncate text-sm text-zinc-300" title={track?.name}>
            {track ? track.name : 'No track loaded'}
          </span>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-zinc-400 hover:text-zinc-100"
                  aria-label="Replace track"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-4 w-4" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Replace track</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={loop ? 'secondary' : 'ghost'}
            size="icon"
            className="h-9 w-9"
            aria-pressed={loop}
            aria-label="Toggle loop"
            onClick={toggleLoop}
          >
            <Repeat className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-9 w-9 sm:flex"
            aria-label={volume > 0 ? 'Mute' : 'Unmute'}
            onClick={toggleMute}
          >
            {volume > 0 ? (
              <Volume2 className="h-4 w-4" aria-hidden />
            ) : (
              <VolumeX className="h-4 w-4" aria-hidden />
            )}
          </Button>
          <Slider
            value={[Math.round(volume * 100)]}
            min={0}
            max={100}
            step={1}
            aria-label="Volume"
            className="hidden w-24 sm:flex"
            onValueChange={(v) => {
              setVolume(v[0] / 100)
              getAudioEngine().setVolume(v[0] / 100)
            }}
          />
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        aria-label="Load audio file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void loadTrack(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
