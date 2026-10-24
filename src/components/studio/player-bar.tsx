'use client'

import { useRef } from 'react'
import { Music, Pause, Play, Repeat, Upload, Volume2, VolumeX } from 'lucide-react'
import { useStudioStore } from '@/store/studio'
import { loadAudioFile } from '@/components/studio/load-audio'
import { formatTime } from '@/components/studio/controls'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

/**
 * Sticky bottom player bar — play/pause, seek, track name + upload,
 * repeat toggle and output volume (mirrors the reference layout).
 */
export function PlayerBar({
  playing,
  currentTime,
  duration,
  onPlayToggle,
  onSeek,
}: {
  playing: boolean
  currentTime: number
  duration: number
  onPlayToggle: () => void
  onSeek: (time: number) => void
}) {
  const audioMeta = useStudioStore((s) => s.audioMeta)
  const loop = useStudioStore((s) => s.loop)
  const setLoop = useStudioStore((s) => s.setLoop)
  const volume = useStudioStore((s) => s.volume)
  const setVolume = useStudioStore((s) => s.setVolume)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2.5">
      <Button
        size="icon"
        onClick={onPlayToggle}
        aria-label={playing ? 'Pause' : 'Play'}
        className="size-10 shrink-0 rounded-full bg-zinc-800 text-zinc-100 shadow-none hover:bg-zinc-700"
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>

      <span className="w-11 shrink-0 text-right text-xs tabular-nums text-zinc-400">
        {formatTime(currentTime)}
      </span>
      <Slider
        aria-label="Seek"
        min={0}
        max={Math.max(1, duration)}
        step={0.1}
        value={[Math.min(currentTime, duration)]}
        onValueChange={(vals: number[]) => onSeek(vals[0] ?? 0)}
        className="min-w-[100px] flex-1 py-1"
      />
      <span className="w-11 shrink-0 text-xs tabular-nums text-zinc-400">
        {formatTime(duration)}
      </span>

      <div className="flex min-w-0 items-center gap-1.5 sm:ml-1">
        <Music className="size-3.5 shrink-0 text-zinc-500" aria-hidden />
        <span
          className={cn(
            'min-w-0 max-w-[140px] truncate text-xs',
            audioMeta ? 'text-zinc-200' : 'text-zinc-500',
          )}
        >
          {audioMeta?.name ?? 'No track loaded'}
        </span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        aria-label="Audio file input"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void loadAudioFile(file)
          if (fileInputRef.current) fileInputRef.current.value = ''
        }}
      />
      <Button
        size="icon"
        variant="ghost"
        className="size-8 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        aria-label="Load audio file"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="size-4" aria-hidden />
      </Button>

      <Button
        size="icon"
        variant="ghost"
        aria-label={loop ? 'Disable repeat' : 'Enable repeat'}
        aria-pressed={loop}
        className={cn(
          'size-8 shrink-0 hover:bg-zinc-800',
          loop ? 'text-emerald-400 hover:text-emerald-300' : 'text-zinc-400 hover:text-zinc-100',
        )}
        onClick={() => setLoop(!loop)}
      >
        <Repeat className="size-4" aria-hidden />
      </Button>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label={volume === 0 ? 'Unmute' : 'Mute'}
          onClick={() => setVolume(volume === 0 ? 1 : 0)}
        >
          {volume === 0 ? (
            <VolumeX className="size-4" aria-hidden />
          ) : (
            <Volume2 className="size-4" aria-hidden />
          )}
        </Button>
        <Slider
          aria-label="Volume"
          min={0}
          max={1}
          step={0.01}
          value={[volume]}
          onValueChange={(vals: number[]) => setVolume(vals[0] ?? 1)}
          className="w-20 py-1"
        />
      </div>
    </div>
  )
}
