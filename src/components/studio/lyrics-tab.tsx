'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Captions, Copy, Heading1, Plus, Timer, Trash2, Type } from 'lucide-react'
import type { LyricLine } from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { getPreviewControls } from '@/components/studio/engine-registry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ColorPickerButton } from '@/components/studio/color-picker'
import { GradientEditor, defaultLyricsGradient } from '@/components/studio/gradient-editor'
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
  autoFocusText,
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
  autoFocusText?: boolean
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
        autoFocus={autoFocusText}
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
  const title = useStudioStore((s) => s.config.title)
  const visualizerGradient = useStudioStore((s) => s.config.visualizer.gradient)
  const audioMeta = useStudioStore((s) => s.audioMeta)
  const patchLyrics = useStudioStore((s) => s.patchLyrics)
  const patchTitle = useStudioStore((s) => s.patchTitle)
  const [raw, setRaw] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [activeLine, setActiveLine] = useState(-1)
  const [justAdded, setJustAdded] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Title start-time text: editable mirror of config.title.startTime with the
  // same render-phase re-seed pattern as LyricRow's time field.
  const [titleStartText, setTitleStartText] = useState(() => formatTimeInput(title.startTime))
  const [prevTitleStart, setPrevTitleStart] = useState(title.startTime)
  if (prevTitleStart !== title.startTime) {
    setPrevTitleStart(title.startTime)
    setTitleStartText(formatTimeInput(title.startTime))
  }
  // The source text the current lines were imported from — lets "Distribute
  // evenly" tell "re-import" apart from "the user has been editing the rows".
  const lastImportedRef = useRef('')

  const duration = audioMeta?.duration ?? 60

  const handleParseLrc = () => {
    const lines = parseLrc(raw)
    if (lines.length === 0) return
    patchLyrics({ lines, enabled: true })
    lastImportedRef.current = raw
    setSelected(null)
  }

  /** Re-spaces existing lines' start times evenly — text is left untouched. */
  const redistributeTimes = useCallback(
    (lines: LyricLine[]) => {
      if (lines.length === 0) return
      const n = lines.length
      patchLyrics({
        lines: lines.map((l, i) => ({
          ...l,
          time: duration > 0 ? (i / n) * duration : 0,
        })),
      })
    },
    [duration, patchLyrics],
  )

  const handleDistribute = () => {
    const parts = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    if (parts.length === 0) {
      // Box is empty: just re-space the times of the lines already below.
      redistributeTimes(lyrics.lines)
      return
    }
    if (raw === lastImportedRef.current && lyrics.lines.length > 0) {
      // Same text as the last import — the user has been editing the rows,
      // so only re-space their times instead of wiping those edits.
      redistributeTimes(lyrics.lines)
      return
    }
    const lines = parts.map((text, i) => ({
      time: duration > 0 ? (i / parts.length) * duration : 0,
      text,
    }))
    patchLyrics({ lines, enabled: true })
    lastImportedRef.current = raw
    setSelected(null)
  }

  const setLine = (index: number, partial: Partial<LyricLine>) => {
    patchLyrics({ lines: lyrics.lines.map((l, i) => (i === index ? { ...l, ...partial } : l)) })
  }

  /** Appends an empty row after the last line (or at the playhead for the first). */
  const addLine = () => {
    const lines = lyrics.lines
    const last = lines.length > 0 ? lines[lines.length - 1] : null
    const playhead = getPreviewControls()?.getTime() ?? 0
    const time = last ? Math.max(last.time + 3, playhead) : Math.max(playhead, 0)
    patchLyrics({
      lines: [...lines, { time, text: '' }],
      enabled: lines.length === 0 ? true : lyrics.enabled,
    })
    const index = lines.length
    setSelected(index)
    setJustAdded(index)
  }

  const deleteLine = (index: number) => {
    patchLyrics({ lines: lyrics.lines.filter((_, i) => i !== index) })
    setSelected(null)
  }

  // Release the one-shot autofocus flag for the freshly added row.
  useEffect(() => {
    if (justAdded === null) return
    const t = window.setTimeout(() => setJustAdded(null), 600)
    return () => window.clearTimeout(t)
  }, [justAdded])

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
          placeholder={
            'Type or paste lyrics — one line per row:\nFirst line of the verse\nSecond line\n\nOptional [00:12.50] timestamps are understood too.'
          }
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
            <>
              <span className="text-[11px] tabular-nums text-zinc-500">
                {lyrics.lines.length} {lyrics.lines.length === 1 ? 'line' : 'lines'}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 rounded-md border-zinc-800 px-2 text-[11px] hover:border-emerald-500/60 hover:text-emerald-400"
                onClick={addLine}
              >
                <Plus className="size-3" /> Add
              </Button>
            </>
          }
        >
          Lines
        </SectionTitle>
        <p className="text-[11px] leading-snug text-zinc-600">
          Each row is one lyric line. Add more with{' '}
          <span className="text-zinc-400">+ Add</span>, or paste several lines above and hit{' '}
          <span className="text-zinc-400">Distribute evenly</span>. Select a row and press{' '}
          <kbd className="rounded border border-zinc-700 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-300">
            S
          </kbd>{' '}
          (or the timer button) to sync it to the playhead.
        </p>
        {lyrics.lines.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-600">
            No lines yet — paste lyrics above and hit Distribute evenly, or add one with + Add.
          </p>
        ) : (
          <div ref={listRef} className="slim-scrollbar max-h-96 space-y-1 overflow-y-auto pr-1">
            {lyrics.lines.map((line, index) => (
              // Stable positional key — a key derived from time/text would
              // remount the row on every keystroke (same trap as the
              // gradient stop rows and their popover).
              <div key={index} data-line-index={index}>
                <LyricRow
                  line={line}
                  index={index}
                  selected={selected === index}
                  active={activeLine === index}
                  autoFocusText={justAdded === index}
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
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-zinc-500 hover:text-emerald-400"
              onClick={addLine}
            >
              <Plus className="size-3.5" /> Add line
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-zinc-500 hover:text-zinc-200"
              onClick={() => {
                patchLyrics({ lines: [] })
                setSelected(null)
              }}
            >
              <Trash2 className="size-3.5" /> Clear all
            </Button>
          </div>
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
        <SliderRow
          label="Auto-hide"
          value={lyrics.holdTime}
          min={1}
          max={12}
          step={0.5}
          onChange={(holdTime) => patchLyrics({ holdTime })}
          format={(v) => `${v.toFixed(1)}s`}
        />
        <p className="-mt-1 text-[11px] leading-snug text-zinc-600">
          Each new line appears underneath and the older line glides up; when the third line
          arrives the oldest is pushed off. A line that is never replaced fades out after this
          many seconds.
        </p>

        <div className="flex h-7 items-center justify-between">
          <MicroLabel>Uppercase</MicroLabel>
          <Switch
            aria-label="Uppercase lyrics"
            checked={lyrics.uppercase}
            onCheckedChange={(uppercase) => patchLyrics({ uppercase })}
          />
        </div>

        {/* Fill: flat color or palette sweep */}
        <div className="space-y-1.5">
          <MicroLabel>Fill</MicroLabel>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
            {(['solid', 'gradient'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={lyrics.fill === mode}
                onClick={() => patchLyrics({ fill: mode })}
                className={cn(
                  'h-7 rounded-md text-xs capitalize transition-colors',
                  lyrics.fill === mode
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'text-zinc-400 hover:text-zinc-200',
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          {lyrics.fill === 'gradient' ? (
            <div className="space-y-2">
              {/* Gradient source: ride along with the visualizer palette or use lyrics' own */}
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
                {(['visualizer', 'custom'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={lyrics.gradientMode === mode}
                    onClick={() => patchLyrics({ gradientMode: mode })}
                    className={cn(
                      'h-7 rounded-md text-xs transition-colors',
                      lyrics.gradientMode === mode
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'text-zinc-400 hover:text-zinc-200',
                    )}
                  >
                    {mode === 'visualizer' ? 'Match visualizer' : 'Custom'}
                  </button>
                ))}
              </div>
              {lyrics.gradientMode === 'custom' ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <MicroLabel>Lyrics palette</MicroLabel>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 rounded-md px-2 text-[11px] text-zinc-500 hover:text-emerald-400"
                      aria-label="Copy visualizer palette to lyrics"
                      title="Copy the visualizer palette as a starting point"
                      onClick={() => patchLyrics({ gradient: structuredClone(visualizerGradient) })}
                    >
                      <Copy className="size-3" aria-hidden />
                      Copy visualizer palette
                    </Button>
                  </div>
                  <GradientEditor
                    value={lyrics.gradient}
                    onChange={(gradient) => patchLyrics({ gradient })}
                    default={defaultLyricsGradient()}
                  />
                </div>
              ) : (
                <p className="text-[11px] leading-snug text-zinc-600">
                  Sweeps the visualizer palette across the text — edit it in the Style tab, or
                  switch to Custom to give the lyrics their own colors.
                </p>
              )}
            </div>
          ) : (
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
          )}
        </div>

        {/* Outline */}
        <div className="flex h-8 items-center gap-2">
          <MicroLabel className="flex-1">Outline</MicroLabel>
          <Switch
            aria-label="Lyrics outline"
            checked={lyrics.outline}
            onCheckedChange={(outline) => patchLyrics({ outline })}
          />
          <ColorPickerButton
            value={lyrics.outlineColor}
            onChange={(outlineColor) => patchLyrics({ outlineColor })}
            ariaLabel="Outline color"
          />
        </div>
        {lyrics.outline ? (
          <SliderRow
            label="Outline width"
            value={lyrics.outlineWidth}
            min={1}
            max={12}
            step={0.5}
            onChange={(outlineWidth) => patchLyrics({ outlineWidth })}
            format={(v) => `${v.toFixed(1)}px`}
          />
        ) : null}

        {/* Glow */}
        <div className="flex h-8 items-center gap-2">
          <MicroLabel className="flex-1">Glow</MicroLabel>
          <Switch
            aria-label="Lyrics glow"
            checked={lyrics.glow}
            onCheckedChange={(glow) => patchLyrics({ glow })}
          />
          <ColorPickerButton
            value={lyrics.glowColor}
            onChange={(glowColor) => patchLyrics({ glowColor })}
            ariaLabel="Glow color"
          />
        </div>
        {lyrics.glow ? (
          <SliderRow
            label="Glow strength"
            value={lyrics.glowStrength}
            min={0}
            max={1}
            step={0.05}
            onChange={(glowStrength) => patchLyrics({ glowStrength })}
          />
        ) : null}
      </section>

      {/* Title card — timed intro text with its own styling */}
      <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="flex h-7 items-center justify-between">
          <SectionTitle icon={Heading1}>Title card</SectionTitle>
          <Switch
            aria-label="Enable title card"
            checked={title.enabled}
            onCheckedChange={(enabled) => patchTitle({ enabled })}
          />
        </div>
        <p className="text-[11px] leading-snug text-zinc-600">
          A big intro title — fades in at its start time, holds for the set duration, then
          fades out. One line per row; extra lines stack downwards.
        </p>

        <Textarea
          value={title.text}
          onChange={(e) => patchTitle({ text: e.target.value })}
          placeholder={'Song title\nArtist name'}
          className="min-h-16 bg-zinc-950/60 font-mono text-xs"
          aria-label="Title text"
        />

        {/* Timing */}
        <div className="flex h-8 items-center gap-2">
          <MicroLabel className="flex-1">Starts at</MicroLabel>
          <Input
            value={titleStartText}
            onChange={(e) => {
              setTitleStartText(e.target.value)
              const parsed = parseTimeInput(e.target.value)
              if (parsed !== null) patchTitle({ startTime: parsed })
            }}
            onBlur={() => setTitleStartText(formatTimeInput(title.startTime))}
            className="h-8 w-20 px-2 font-mono text-xs tabular-nums"
            aria-label="Title start time"
            placeholder="0:00.00"
          />
        </div>
        <SliderRow
          label="Hold for"
          value={title.duration}
          min={1}
          max={30}
          step={0.5}
          onChange={(duration) => patchTitle({ duration })}
          format={(v) => `${v.toFixed(1)}s`}
        />
        <SliderRow
          label="Fade"
          value={title.fade}
          min={0}
          max={3}
          step={0.05}
          onChange={(fade) => patchTitle({ fade })}
          format={(v) => `${v.toFixed(2)}s`}
        />

        {/* Type */}
        <div className="space-y-1.5">
          <MicroLabel>Font</MicroLabel>
          <Select
            value={title.font}
            onValueChange={(font) => patchTitle({ font: font as typeof title.font })}
          >
            <SelectTrigger size="sm" className="w-full" aria-label="Title font">
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
          value={title.size}
          min={24}
          max={140}
          step={1}
          onChange={(size) => patchTitle({ size })}
          format={(v) => `${Math.round(v)}px`}
        />
        <SliderRow
          label="Weight"
          value={title.weight}
          min={300}
          max={800}
          step={100}
          onChange={(weight) => patchTitle({ weight })}
        />
        <div className="flex h-7 items-center justify-between">
          <MicroLabel>Uppercase</MicroLabel>
          <Switch
            aria-label="Uppercase title"
            checked={title.uppercase}
            onCheckedChange={(uppercase) => patchTitle({ uppercase })}
          />
        </div>

        {/* Move */}
        <SliderRow
          label="Position X"
          value={title.positionX}
          min={0}
          max={100}
          step={1}
          onChange={(positionX) => patchTitle({ positionX })}
          format={(v) => `${Math.round(v)}%`}
        />
        <SliderRow
          label="Position Y"
          value={title.positionY}
          min={0}
          max={100}
          step={1}
          onChange={(positionY) => patchTitle({ positionY })}
          format={(v) => `${Math.round(v)}%`}
        />

        {/* Fill: flat color or palette sweep */}
        <div className="space-y-1.5">
          <MicroLabel>Fill</MicroLabel>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
            {(['solid', 'gradient'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={title.fill === mode}
                onClick={() => patchTitle({ fill: mode })}
                className={cn(
                  'h-7 rounded-md text-xs capitalize transition-colors',
                  title.fill === mode
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'text-zinc-400 hover:text-zinc-200',
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          {title.fill === 'gradient' ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
                {(['visualizer', 'custom'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={title.gradientMode === mode}
                    onClick={() => patchTitle({ gradientMode: mode })}
                    className={cn(
                      'h-7 rounded-md text-xs transition-colors',
                      title.gradientMode === mode
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'text-zinc-400 hover:text-zinc-200',
                    )}
                  >
                    {mode === 'visualizer' ? 'Match visualizer' : 'Custom'}
                  </button>
                ))}
              </div>
              {title.gradientMode === 'custom' ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <MicroLabel>Title palette</MicroLabel>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 rounded-md px-2 text-[11px] text-zinc-500 hover:text-emerald-400"
                      aria-label="Copy visualizer palette to title"
                      title="Copy the visualizer palette as a starting point"
                      onClick={() => patchTitle({ gradient: structuredClone(visualizerGradient) })}
                    >
                      <Copy className="size-3" aria-hidden />
                      Copy visualizer palette
                    </Button>
                  </div>
                  <GradientEditor
                    value={title.gradient}
                    onChange={(gradient) => patchTitle({ gradient })}
                    default={defaultLyricsGradient()}
                  />
                </div>
              ) : (
                <p className="text-[11px] leading-snug text-zinc-600">
                  Sweeps the visualizer palette across the title — switch to Custom to give it
                  its own colors.
                </p>
              )}
            </div>
          ) : (
            <div className="flex h-8 items-center gap-2">
              <MicroLabel className="flex-1">Color</MicroLabel>
              <ColorPickerButton
                value={title.color}
                onChange={(color) => patchTitle({ color })}
                ariaLabel="Title color"
              />
              <input
                type="color"
                value={toHex6(parseColor(title.color) ?? { r: 255, g: 255, b: 255, a: 1 })}
                onChange={(e) => patchTitle({ color: e.target.value })}
                className="h-7 w-10 cursor-pointer rounded-md border border-zinc-800 bg-zinc-950 p-0.5"
                aria-label="Native title color picker"
              />
            </div>
          )}
        </div>

        {/* Outline */}
        <div className="flex h-8 items-center gap-2">
          <MicroLabel className="flex-1">Outline</MicroLabel>
          <Switch
            aria-label="Title outline"
            checked={title.outline}
            onCheckedChange={(outline) => patchTitle({ outline })}
          />
          <ColorPickerButton
            value={title.outlineColor}
            onChange={(outlineColor) => patchTitle({ outlineColor })}
            ariaLabel="Title outline color"
          />
        </div>
        {title.outline ? (
          <SliderRow
            label="Outline width"
            value={title.outlineWidth}
            min={1}
            max={12}
            step={0.5}
            onChange={(outlineWidth) => patchTitle({ outlineWidth })}
            format={(v) => `${v.toFixed(1)}px`}
          />
        ) : null}

        {/* Glow */}
        <div className="flex h-8 items-center gap-2">
          <MicroLabel className="flex-1">Glow</MicroLabel>
          <Switch
            aria-label="Title glow"
            checked={title.glow}
            onCheckedChange={(glow) => patchTitle({ glow })}
          />
          <ColorPickerButton
            value={title.glowColor}
            onChange={(glowColor) => patchTitle({ glowColor })}
            ariaLabel="Title glow color"
          />
        </div>
        {title.glow ? (
          <SliderRow
            label="Glow strength"
            value={title.glowStrength}
            min={0}
            max={1}
            step={0.05}
            onChange={(glowStrength) => patchTitle({ glowStrength })}
          />
        ) : null}
      </section>
    </div>
  )
}
