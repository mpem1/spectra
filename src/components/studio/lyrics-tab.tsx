'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Captions, Plus, Timer, Trash2, Type } from 'lucide-react'
import type { LyricLine } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { getPreviewControls } from '@/components/studio/engine-registry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { parseColor, toHex6 } from '@/components/studio/color-utils'
import { MicroLabel, SectionTitle, SliderRow } from '@/components/studio/controls'
import { cn } from '@/lib/utils'

function formatTimeInput(seconds: number): string {
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return `${m}:${rest.toFixed(2).padStart(5, '0')}`
}

function parseTimeInput(text: string): number | null {
  const t = text.trim()
  if (t.length === 0) return null
  const mmss = t.match(/^(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)$/)
  if (mmss) return parseInt(mmss[1], 10) * 60 + parseFloat(mmss[2])
  const secs = Number(t)
  return Number.isFinite(secs) && secs >= 0 ? secs : null
}

/** Parses `[mm:ss.xx] text` LRC lines (multiple tags per line supported). */
export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = []
  const tagRe = /\[(\d{1,3}):(\d{2})(?:[.,:](\d{1,3}))?\]/g
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim().length === 0) continue
    tagRe.lastIndex = 0
    let lastEnd = 0
    let match: RegExpExecArray | null
    const times: number[] = []
    while ((match = tagRe.exec(raw)) !== null) {
      const frac = match[3] ?? '0'
      const fracValue = parseInt(frac, 10) / Math.pow(10, frac.length)
      times.push(parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + fracValue)
      lastEnd = tagRe.lastIndex
    }
    if (times.length === 0) continue
    const lineText = raw.slice(lastEnd).trim()
    for (const time of times) out.push({ time, text: lineText })
  }
  return out.sort((a, b) => a.time - b.time)
}

function LyricRow({
  line,
  index,
  selected,
  active,
  onSelect,
  onTime,
  onText,
  onSync,
  onDelete,
}: {
  line: LyricLine
  index: number
  selected: boolean
  active: boolean
  onSelect: () => void
  onTime: (seconds: number) => void
  onText: (text: string) => void
  onSync: () => void
  onDelete: () => void
}) {
  const [prevTime, setPrevTime] = useState(line.time)
  const [timeText, setTimeText] = useState(() => formatTimeInput(line.time))

  // Re-seed the editable time text when the line time changes externally
  // (e.g. re-parse or sync) — render-time derived-state reset.
  if (prevTime !== line.time) {
    setPrevTime(line.time)
    setTimeText(formatTimeInput(line.time))
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect()
      }}
      className={cn(
        'flex cursor-pointer items-center gap-1.5 rounded-lg border px-1 py-1 transition-colors',
        selected
          ? 'border-emerald-500/60 bg-emerald-500/5'
          : active
            ? 'border-zinc-700 bg-zinc-800/40'
            : 'border-transparent hover:bg-zinc-800/30',
      )}
    >
      <Input
        value={timeText}
        onChange={(e) => {
          setTimeText(e.target.value)
          const parsed = parseTimeInput(e.target.value)
          if (parsed !== null) onTime(parsed)
        }}
        onBlur={() => setTimeText(formatTimeInput(line.time))}
        className="h-8 w-20 shrink-0 px-2 font-mono text-xs tabular-nums"
        aria-label={`Line ${index + 1} start time`}
        placeholder="0:00.00"
        onClick={(e) => e.stopPropagation()}
      />
      <Input
        value={line.text}
        onChange={(e) => onText(e.target.value)}
        className="h-8 flex-1 text-xs"
        aria-label={`Line ${index + 1} text`}
        placeholder="Lyric line"
        onClick={(e) => e.stopPropagation()}
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-zinc-500 hover:text-emerald-400"
        aria-label={`Sync line ${index + 1} to playhead (S)`}
        title="Sync at playhead (S)"
        onClick={(e) => {
          e.stopPropagation()
          onSync()
        }}
      >
        <Timer className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-zinc-500 hover:text-red-400"
        aria-label={`Delete line ${index + 1}`}
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}

export function LyricsTab() {
  const lyrics = useStudioStore((s) => s.config.lyrics)
  const audioMeta = useStudioStore((s) => s.audioMeta)
  const patchLyrics = useStudioStore((s) => s.patchLyrics)
  const [raw, setRaw] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [activeLine, setActiveLine] = useState(-1)
  const listRef = useRef<HTMLDivElement | null>(null)

  const duration = audioMeta?.duration ?? 60

  const handleParseLrc = () => {
    const lines = parseLrc(raw)
    if (lines.length === 0) return
    patchLyrics({ lines, enabled: true })
    setSelected(null)
  }

  const handleDistribute = () => {
    const parts = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    if (parts.length === 0) return
    const lines = parts.map((text, i) => ({
      time: duration > 0 ? (i / parts.length) * duration : 0,
      text,
    }))
    patchLyrics({ lines, enabled: true })
    setSelected(null)
  }

  const setLine = (index: number, partial: Partial<LyricLine>) => {
    patchLyrics({ lines: lyrics.lines.map((l, i) => (i === index ? { ...l, ...partial } : l)) })
  }

  const deleteLine = (index: number) => {
    patchLyrics({ lines: lyrics.lines.filter((_, i) => i !== index) })
    setSelected(null)
  }

  /** Sets the target line's time to the current playhead, keeping the list time-ordered. */
  const syncLine = useCallback(
    (index: number) => {
      const lines = useStudioStore.getState().config.lyrics.lines
      if (index < 0 || index >= lines.length) return
      const target = lines[index]
      const t = getPreviewControls()?.getTime() ?? 0
      const next = lines
        .map((l) => (l === target ? { ...l, time: t } : l))
        .sort((a, b) => a.time - b.time)
      patchLyrics({ lines: next })
      setSelected(next.findIndex((l) => l.time === t && l.text === target.text))
    },
    [patchLyrics],
  )

  // "S" syncs the selected row at the playhead (ignored while typing).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 's' && e.key !== 'S') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target
      if (target instanceof HTMLElement) {
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable
        )
          return
      }
      setSelected((current) => {
        if (current === null) return current
        syncLine(current)
        return current
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [syncLine])

  // Follow-the-playhead: highlight the active line and scroll it into view.
  useEffect(() => {
    if (!lyrics.enabled || lyrics.lines.length === 0) return
    const timer = window.setInterval(() => {
      const t = getPreviewControls()?.getTime() ?? 0
      const lines = useStudioStore.getState().config.lyrics.lines
      let idx = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].time <= t) idx = i
        else break
      }
      setActiveLine((prev) => {
        if (prev !== idx) {
          if (idx >= 0) {
            listRef.current
              ?.querySelector(`[data-line-index="${idx}"]`)
              ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
          }
          return idx
        }
        return prev
      })
    }, 400)
    return () => window.clearInterval(timer)
  }, [lyrics.enabled, lyrics.lines.length])

  const textColor = parseColor(lyrics.color) ?? { r: 255, g: 255, b: 255, a: 1 }

  return (
    <div className="space-y-4">
      {/* Enable */}
      <div className="flex h-7 items-center justify-between">
        <SectionTitle icon={Captions}>Enable lyrics</SectionTitle>
        <Switch
          aria-label="Enable lyrics overlay"
          checked={lyrics.enabled}
          onCheckedChange={(enabled) => patchLyrics({ enabled })}
        />
      </div>

      {/* Source text */}
      <section className="space-y-2">
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={'Paste lyrics or .lrc here…\n[00:12.50] First line of the song\n[00:18.20] Second line'}
          className="min-h-28 bg-zinc-950/60 font-mono text-xs"
          aria-label="Lyrics source text"
        />
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-zinc-800 hover:border-emerald-500/60 hover:text-emerald-400"
            onClick={handleParseLrc}
          >
            Parse LRC
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-zinc-800 hover:border-emerald-500/60 hover:text-emerald-400"
            onClick={handleDistribute}
          >
            Distribute evenly
          </Button>
        </div>
      </section>

      {/* Parsed lines */}
      <section className="space-y-2">
        <SectionTitle
          icon={Type}
          right={
            <span className="text-[11px] tabular-nums text-zinc-500">
              {lyrics.lines.length} lines
            </span>
          }
        >
          Lines
        </SectionTitle>
        <p className="text-[11px] text-zinc-600">
          Click a row to select it, press{' '}
          <kbd className="rounded border border-zinc-700 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-300">
            S
          </kbd>{' '}
          (or the timer button) to sync it to the playhead.
        </p>
        {lyrics.lines.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-600">
            No lines yet — parse LRC or distribute text above.
          </p>
        ) : (
          <div ref={listRef} className="slim-scrollbar max-h-96 space-y-1 overflow-y-auto pr-1">
            {lyrics.lines.map((line, index) => (
              <div key={`${index}-${line.time}`} data-line-index={index}>
                <LyricRow
                  line={line}
                  index={index}
                  selected={selected === index}
                  active={activeLine === index}
                  onSelect={() => setSelected(index)}
                  onTime={(time) => setLine(index, { time })}
                  onText={(text) => setLine(index, { text })}
                  onSync={() => syncLine(index)}
                  onDelete={() => deleteLine(index)}
                />
              </div>
            ))}
          </div>
        )}
        {lyrics.lines.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full text-xs text-zinc-500 hover:text-zinc-200"
            onClick={() => {
              patchLyrics({ lines: [] })
              setSelected(null)
            }}
          >
            <Plus className="size-3.5" /> Clear all lines
          </Button>
        ) : null}
      </section>

      {/* Style */}
      <section className="space-y-3">
        <SectionTitle icon={Type}>Style</SectionTitle>

        <div className="space-y-1.5">
          <MicroLabel>Font</MicroLabel>
          <Select
            value={lyrics.font}
            onValueChange={(font) => patchLyrics({ font: font as typeof lyrics.font })}
          >
            <SelectTrigger size="sm" className="w-full" aria-label="Lyrics font">
              <SelectValue placeholder="Font" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sans">Sans</SelectItem>
              <SelectItem value="serif">Serif</SelectItem>
              <SelectItem value="mono">Mono</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <SliderRow
          label="Size"
          value={lyrics.size}
          min={20}
          max={96}
          step={1}
          onChange={(size) => patchLyrics({ size })}
          format={(v) => `${Math.round(v)}px`}
        />
        <SliderRow
          label="Weight"
          value={lyrics.weight}
          min={300}
          max={800}
          step={100}
          onChange={(weight) => patchLyrics({ weight })}
        />
        <SliderRow
          label="Position Y"
          value={lyrics.positionY}
          min={0}
          max={100}
          step={1}
          onChange={(positionY) => patchLyrics({ positionY })}
          format={(v) => `${Math.round(v)}%`}
        />
        <SliderRow
          label="Fade"
          value={lyrics.fade}
          min={0}
          max={1.5}
          step={0.05}
          onChange={(fade) => patchLyrics({ fade })}
          format={(v) => `${v.toFixed(2)}s`}
        />

        <div className="flex h-7 items-center justify-between">
          <MicroLabel>Uppercase</MicroLabel>
          <Switch
            aria-label="Uppercase lyrics"
            checked={lyrics.uppercase}
            onCheckedChange={(uppercase) => patchLyrics({ uppercase })}
          />
        </div>

        <div className="flex h-8 items-center gap-2">
          <MicroLabel className="flex-1">Color</MicroLabel>
          <ColorPickerButton
            value={lyrics.color}
            onChange={(color) => patchLyrics({ color })}
            ariaLabel="Lyrics color"
          />
          <input
            type="color"
            value={toHex6(textColor)}
            onChange={(e) => patchLyrics({ color: e.target.value })}
            className="h-7 w-10 cursor-pointer rounded-md border border-zinc-800 bg-zinc-950 p-0.5"
            aria-label="Native lyrics color picker"
          />
        </div>
      </section>
    </div>
  )
}
