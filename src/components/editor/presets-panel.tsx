'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookmarkPlus, Check, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { DEFAULT_CONFIG, type PresetSummary, type VisualizerConfig } from '@/lib/types'
import { useEditorStore } from '@/store/editor'
import { toast } from '@/hooks/use-toast'

export function PresetsPanel() {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [appliedId, setAppliedId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const config = useEditorStore((s) => s.config)
  const trackName = useEditorStore((s) => s.track?.name)
  const replaceConfig = useEditorStore((s) => s.replaceConfig)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['presets'],
    queryFn: async (): Promise<PresetSummary[]> => {
      const res = await fetch('/api/presets')
      if (!res.ok) throw new Error('Failed to load presets')
      const json = (await res.json()) as { presets: PresetSummary[] }
      return json.presets
    },
  })

  useEffect(() => {
    // Suggest the track name as preset name once it becomes available
    if (!name && trackName) setName(trackName)
  }, [trackName, name])

  const save = async () => {
    const finalName = (name.trim() || trackName || 'Untitled preset').slice(0, 60)
    setSaving(true)
    try {
      const res = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: finalName,
          config: JSON.stringify(useEditorStore.getState().config),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? 'Save failed')
      }
      setName('')
      await queryClient.invalidateQueries({ queryKey: ['presets'] })
      toast({ title: 'Preset saved', description: `“${finalName}” is now in your library.` })
    } catch (err) {
      toast({
        title: 'Could not save preset',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const apply = (preset: PresetSummary) => {
    try {
      const parsed = JSON.parse(preset.config) as Partial<VisualizerConfig>
      replaceConfig({ ...DEFAULT_CONFIG, ...parsed })
      setAppliedId(preset.id)
      toast({ title: 'Preset applied', description: preset.name })
    } catch {
      toast({
        title: 'Corrupt preset',
        description: 'This preset could not be parsed.',
        variant: 'destructive',
      })
    }
  }

  const remove = async (preset: PresetSummary) => {
    try {
      const res = await fetch(`/api/presets/${preset.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      await queryClient.invalidateQueries({ queryKey: ['presets'] })
      toast({ title: 'Preset deleted', description: preset.name })
    } catch {
      toast({ title: 'Could not delete preset', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4 pr-3">
      <section className="space-y-2">
        <Label htmlFor="preset-name" className="text-xs text-zinc-400">
          Save current style as a preset
        </Label>
        <div className="flex gap-2">
          <Input
            id="preset-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Preset name"
            maxLength={60}
          />
          <Button onClick={() => void save()} disabled={saving} className="shrink-0">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <BookmarkPlus className="h-4 w-4" aria-hidden />
            )}
            Save
          </Button>
        </div>
        <p className="text-xs text-zinc-500">
          Stores all visualizer settings, colors and overlays on the server.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
          Library {data ? `(${data.length})` : ''}
        </h3>
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full bg-zinc-800/60" />
            <Skeleton className="h-14 w-full bg-zinc-800/60" />
            <Skeleton className="h-14 w-full bg-zinc-800/60" />
          </div>
        )}
        {isError && (
          <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            Could not load presets. Is the server reachable? Try again shortly.
          </p>
        )}
        {data && data.length === 0 && (
          <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-center text-xs text-zinc-500">
            No presets yet. Tweak the style, then save it here for instant recall.
          </p>
        )}
        {data && data.length > 0 && (
          <div className="max-h-96 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent">
            <ul className="space-y-2 pr-1">
              {data.map((preset) => (
                <li
                  key={preset.id}
                  className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-200">{preset.name}</p>
                    <p className="text-xs text-zinc-500">
                      {new Date(preset.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={appliedId === preset.id ? 'secondary' : 'outline'}
                    onClick={() => apply(preset)}
                    aria-label={`Apply preset ${preset.name}`}
                  >
                    {appliedId === preset.id ? (
                      <Check className="h-4 w-4" aria-hidden />
                    ) : null}
                    Apply
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 text-zinc-500 hover:text-red-400"
                    onClick={() => void remove(preset)}
                    aria-label={`Delete preset ${preset.name}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
