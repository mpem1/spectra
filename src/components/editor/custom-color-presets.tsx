'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ColorPresetSummary } from '@/lib/types'
import { useEditorStore } from '@/store/editor'
import { toast } from '@/hooks/use-toast'

/**
 * User-saveable gradient color pairs, persisted server-side via
 * /api/color-presets. Click a swatch to apply it to the editor.
 */
export function CustomColorPresets() {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const queryClient = useQueryClient()

  const colorA = useEditorStore((s) => s.config.colorA)
  const colorB = useEditorStore((s) => s.config.colorB)
  const setConfig = useEditorStore((s) => s.setConfig)

  const { data, isLoading } = useQuery({
    queryKey: ['color-presets'],
    queryFn: async (): Promise<ColorPresetSummary[]> => {
      const res = await fetch('/api/color-presets')
      if (!res.ok) throw new Error('Failed to load color presets')
      const json = (await res.json()) as { colorPresets: ColorPresetSummary[] }
      return json.colorPresets
    },
  })

  const save = async () => {
    setSaving(true)
    try {
      const count = data?.length ?? 0
      const finalName = (name.trim() || `My gradient ${count + 1}`).slice(0, 40)
      const res = await fetch('/api/color-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: finalName,
          colorA: useEditorStore.getState().config.colorA,
          colorB: useEditorStore.getState().config.colorB,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? 'Save failed')
      }
      setName('')
      await queryClient.invalidateQueries({ queryKey: ['color-presets'] })
      toast({ title: 'Color preset saved', description: `“${finalName}” added to your gradients.` })
    } catch (err) {
      toast({
        title: 'Could not save color preset',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (preset: ColorPresetSummary) => {
    try {
      const res = await fetch(`/api/color-presets/${preset.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      await queryClient.invalidateQueries({ queryKey: ['color-presets'] })
    } catch {
      toast({ title: 'Could not delete color preset', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name this gradient…"
          aria-label="Custom gradient name"
          maxLength={40}
          className="h-8 text-xs"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-8 shrink-0 px-2.5"
          onClick={() => void save()}
          disabled={saving}
          aria-label="Save gradient colors"
          title="Save current gradient A/B colors"
        >
          <Save className="h-3.5 w-3.5" aria-hidden />
          Save
        </Button>
      </div>

      {isLoading && (
        <p className="text-xs text-zinc-500">Loading saved gradients…</p>
      )}

      {data && data.length > 0 && (
        <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1 [scrollbar-color:#3f3f46_transparent] [scrollbar-width:thin]">
          {data.map((preset) => (
            <li key={preset.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfig({ colorA: preset.colorA, colorB: preset.colorB })}
                title={`Apply “${preset.name}”`}
                aria-label={`Apply gradient ${preset.name}`}
                className={`h-6 w-6 shrink-0 rounded-full border transition hover:scale-110 ${
                  preset.colorA.toLowerCase() === colorA.toLowerCase() &&
                  preset.colorB.toLowerCase() === colorB.toLowerCase()
                    ? 'border-emerald-400 ring-2 ring-emerald-500/40'
                    : 'border-zinc-700'
                }`}
                style={{ background: `linear-gradient(135deg, ${preset.colorA}, ${preset.colorB})` }}
              />
              <button
                type="button"
                onClick={() => setConfig({ colorA: preset.colorA, colorB: preset.colorB })}
                className="min-w-0 flex-1 truncate text-left text-xs text-zinc-300 hover:text-emerald-300"
                title={preset.name}
              >
                {preset.name}
              </button>
              <button
                type="button"
                onClick={() => void remove(preset)}
                aria-label={`Delete gradient ${preset.name}`}
                className="shrink-0 text-zinc-600 transition hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {data && data.length === 0 && (
        <p className="text-xs text-zinc-600">
          No saved gradients yet — pick two colors and hit Save.
        </p>
      )}
    </div>
  )
}
