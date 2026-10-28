'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, ListMusic, Plus, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { getAudioEngine } from '@/lib/audio/engine'
import { findActiveLyricIndex, formatLyricTime, genLyricId, parseLrc } from '@/lib/lyrics'
import { useEditorStore } from '@/store/editor'
import { toast } from '@/hooks/use-toast'

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
      {children}
    </h3>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  display?: (v: number) => string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-zinc-400">{label}</Label>
        <span className="font-mono text-xs text-zinc-300">
          {display ? display(value) : value}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  )
}

export function LyricsPanel() {
  const showLyrics = useEditorStore((s) => s.showLyrics)
  const setShowLyrics = useEditorStore((s) => s.setShowLyrics)
  const lyrics = useEditorStore((s) => s.lyrics)
  const setLyrics = useEditorStore((s) => s.setLyrics)
  const lyricsSize = useEditorStore((s) => s.lyricsSize)
  const setLyricsSize = useEditorStore((s) => s.setLyricsSize)
  const lyricsPosition = useEditorStore((s) => s.lyricsPosition)
  const setLyricsPosition = useEditorStore((s) => s.setLyricsPosition)
  const lyricsColor = useEditorStore((s) => s.lyricsColor)
  const setLyricsColor = useEditorStore((s) => s.lyricsColor)
  const lyricsGlowColor = useEditorStore((s) => s.lyricsGlowColor)
  const setLyricsGlowColor = useEditorStore((s) => s.lyricsGlowColor)
  const lyricsGlow = useEditorStore((s) => s.lyricsGlow)
  const setLyricsGlow = useEditorStore((s) => s.setLyricsGlow)

  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const textRef = useRef<HTMLInputElement | null>(null)
  const focusTextRef = useRef(false)

  const sorted = useMemo(() => [...lyrics].sort((a, b) => a.time - b.time), [lyrics])
  // Derived selection: an id that no longer exists (delete/import) degrades to null.
  const selected = useMemo(
    () => sorted.find((l) => l.id === selectedId) ?? null,
    [sorted, selectedId]
  )

  // Focus (and scroll into view) the text input right after a new tab add /
  // next-tab jump. Plain row focus (clicking into an input) must NOT steal the
  // playhead or scroll, so it is gated behind the focusTextRef flag.
  useEffect(() => {
    if (focusTextRef.current && selected) {
      focusTextRef.current = false
      textRef.current?.focus()
      textRef.current?.select()
      textRef.current?.closest('[data-lyric-row]')?.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  // Track which line is currently on screen so the list shows live sequence.
  useEffect(() => {
    const tick = () => {
      const engine = getAudioEngine()
      if (!engine.duration || sorted.length === 0) {
        setActiveId(null)
        return
      }
      const idx = findActiveLyricIndex(sorted, engine.currentTime)
      setActiveId(idx >= 0 ? (sorted[idx]?.id ?? null) : null)
    }
    const iv = setInterval(tick, 300)
    return () => clearInterval(iv)
  }, [sorted])

  const importParsed = (lines: { time: number; text: string }[], source: string) => {
    if (lines.length === 0) {
      toast({
        title: 'No timestamped lines found',
        description: `Use [mm:ss.xx] line format${source ? ` in ${source}` : ''}.`,
        variant: 'destructive',
      })
      return
    }
    setLyrics(lines.map((l) => ({ ...l, id: genLyricId() })))
    setShowLyrics(true)
    toast({ title: 'Lyrics imported', description: `${lines.length} lines${source ? ` from ${source}` : ''}` })
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    file
      .text()
      .then((text) => importParsed(parseLrc(text), file.name))
      .catch(() => toast({ title: 'Could not read lyrics file', variant: 'destructive' }))
  }

  const importPaste = () => {
    importParsed(parseLrc(pasteText), '')
    setPasteOpen(false)
    setPasteText('')
  }

  const updateLine = (id: string, patch: Partial<{ time: number; text: string }>) => {
    setLyrics(lyrics.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  const removeLine = (id: string) => {
    const idx = sorted.findIndex((l) => l.id === id)
    const next = sorted[idx + 1] ?? sorted[idx - 1]
    setLyrics(lyrics.filter((l) => l.id !== id))
    setSelectedId(next?.id ?? null)
  }

  /** Stamp a fresh line at the current playhead and drop into its text. */
  const addAtPlayhead = () => {
    const t = Math.round(getAudioEngine().currentTime * 10) / 10
    const line = { id: genLyricId(), time: t, text: '' }
    setLyrics([...lyrics, line])
    setSelectedId(line.id)
    focusTextRef.current = true
  }

  /** Sync a line's trigger time to wherever the song is right now. */
  const syncLineToPlayhead = (id: string) => {
    const t = Math.round(getAudioEngine().currentTime * 10) / 10
    updateLine(id, { time: t })
    setSelectedId(id)
  }

  // Keyboard sync: S stamps the selected line at the current playhead — the
  // fast workflow (play the song, tap S on the beat, type later). Mirrors the
  // editor-app transport guard: ignore keys typed into form fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 's' && e.key !== 'S') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return
      if (!selectedId || !useEditorStore.getState().track) return
      e.preventDefault()
      syncLineToPlayhead(selectedId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId])

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <SectionTitle>Karaoke lyrics</SectionTitle>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-zinc-400">Show lyrics</Label>
          <Switch checked={showLyrics} onCheckedChange={setShowLyrics} aria-label="Show lyrics" />
        </div>

        <Button variant="outline" size="sm" className="w-full" onClick={addAtPlayhead}>
          <Plus className="h-4 w-4" /> Add tab at playhead
        </Button>

        {/* Time-ordered list — every line top to bottom so the sequence can be
            checked at a glance; the on-screen line is highlighted live. */}
        {sorted.length > 0 ? (
          <div
            className="max-h-72 overflow-y-auto rounded-xl border border-zinc-800 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent"
            data-testid="lyrics-list"
          >
            <div className="divide-y divide-zinc-800/70">
              {sorted.map((l, i) => {
                const isSelected = l.id === selectedId
                const isActive = l.id === activeId
                return (
                  <div
                    key={l.id}
                    data-lyric-row
                    onClick={(e) => {
                      // Clicking the row (not its inputs/buttons) selects the
                      // line so S can sync it at the right moment.
                      const el = e.target as HTMLElement
                      if (el.closest('input, button')) return
                      setSelectedId(l.id)
                    }}
                    className={`flex cursor-pointer items-center gap-2 p-2 transition-colors ${
                      isSelected ? 'bg-emerald-500/5' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => syncLineToPlayhead(l.id)}
                      aria-label={`Sync line ${i + 1} (${l.text || 'Untitled'}) to the current playhead`}
                      title="Sync this line to the playhead — its text triggers wherever the song is right now"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-500 transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/10 hover:text-emerald-300"
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                    </button>
                    <span
                      className={`w-4 shrink-0 text-center font-mono text-[10px] ${
                        isActive ? 'text-emerald-400' : 'text-zinc-600'
                      }`}
                      aria-hidden={i + 1 === 0}
                    >
                      {i + 1}
                    </span>
                    <Input
                      value={formatLyricTime(l.time)}
                      onFocus={() => setSelectedId(l.id)}
                      onChange={(e) => {
                        const parsed = parseLrc(`[${e.target.value}] x`)
                        if (parsed[0]) updateLine(l.id, { time: parsed[0].time })
                      }}
                      className={`h-7 w-20 shrink-0 border-l-2 font-mono text-xs ${
                        isActive
                          ? 'border-l-emerald-500 text-emerald-300'
                          : 'border-l-transparent text-zinc-300'
                      }`}
                      aria-label={`Line ${i + 1} time`}
                    />
                    <Input
                      ref={l.id === selectedId ? textRef : undefined}
                      value={l.text}
                      onFocus={() => setSelectedId(l.id)}
                      onChange={(e) => updateLine(l.id, { text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const next = sorted[i + 1]
                          if (next) {
                            setSelectedId(next.id)
                            focusTextRef.current = true
                          }
                        }
                      }}
                      className={`h-7 flex-1 text-xs ${
                        isActive ? 'text-emerald-200' : ''
                      }`}
                      aria-label={`Line ${i + 1} text`}
                      placeholder="Type the lyric…"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-zinc-500 hover:text-red-400"
                      onClick={() => removeLine(l.id)}
                      aria-label={`Delete line ${i + 1}: ${l.text || 'Untitled'}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">
            No lyrics yet — play the track and hit <span className="text-zinc-300">Add tab at
            playhead</span> on each vocal entry to stamp your lines, or import timestamps below.
          </p>
        )}
        <p className="text-[11px] leading-snug text-zinc-500">
          Every line is listed in track order. Play the song and hit the sync button on a line
          right when its lyric should appear — the row&rsquo;s time snaps to the current playhead
          and the list re-orders itself. You can also click a row to select it and tap
          <span className="text-zinc-400"> S</span> on the beat. Green highlight follows
          what&rsquo;s on screen.
        </p>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> Import .lrc
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={() => setPasteOpen((o) => !o)}>
            <ListMusic className="h-4 w-4" /> Paste timestamps
          </Button>
        </div>

        {pasteOpen && (
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'[00:12.34] First line\n[00:20.50] Second line'}
              rows={5}
              className="font-mono text-xs"
            />
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={importPaste}>
                Import lines
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPasteOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".lrc,.txt,text/plain"
          className="hidden"
          aria-label="Lyrics file"
          onChange={(e) => {
            onFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </section>

      <Separator className="bg-zinc-800/70" />

      <section className="space-y-4">
        <SectionTitle>Display</SectionTitle>
        <SliderRow
          label="Text size"
          value={lyricsSize}
          min={0.5}
          max={2.5}
          step={0.05}
          display={(v) => `${Math.round(v * 100)}%`}
          onChange={setLyricsSize}
        />
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-500">Position</Label>
          <Select value={lyricsPosition} onValueChange={(v) => setLyricsPosition(v as typeof lyricsPosition)}>
            <SelectTrigger size="sm" aria-label="Lyrics position">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top">Top</SelectItem>
              <SelectItem value="center">Center</SelectItem>
              <SelectItem value="bottom">Bottom</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <Separator className="bg-zinc-800/70" />

      <section className="space-y-4">
        <SectionTitle>Text style</SectionTitle>
        <p className="-mt-1 text-[11px] leading-snug text-zinc-500">
          Color and glow are the lyrics&rsquo; own settings — fully independent from the
          visualizer gradient.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-500">Text color</Label>
            <input
              type="color"
              value={lyricsColor}
              onChange={(e) => setLyricsColor(e.target.value)}
              aria-label="Lyrics text color"
              className="h-9 w-full cursor-pointer rounded-md border border-zinc-800 bg-zinc-900 p-1"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-500">Glow color</Label>
            <input
              type="color"
              value={lyricsGlowColor}
              onChange={(e) => setLyricsGlowColor(e.target.value)}
              aria-label="Lyrics glow color"
              className="h-9 w-full cursor-pointer rounded-md border border-zinc-800 bg-zinc-900 p-1"
            />
          </div>
        </div>
        <SliderRow
          label="Glow strength"
          value={lyricsGlow}
          min={0}
          max={48}
          step={1}
          onChange={setLyricsGlow}
        />
      </section>
    </div>
  )
}
