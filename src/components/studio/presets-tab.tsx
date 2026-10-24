'use client'

import { useEffect, useState } from 'react'
import { FolderOpen, Loader2, Save, Trash2, Upload, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  GRADIENT_PRESETS,
  type GradientPresetId,
  type StudioConfig,
  type VisualizerStyle,
} from '@/lib/visualizer/types'
import { useStudioStore } from '@/store/studio'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { gradientCss } from '@/components/studio/color-utils'
import { MicroLabel } from '@/components/studio/controls'

/* --------------------------------- look presets -------------------------------- */

interface LookPreset {
  id: string
  name: string
  style: VisualizerStyle
  gradient: GradientPresetId
  background: { mode: 'solid' | 'gradient' | 'transparent'; color: string }
  glow: boolean
}

const LOOK_PRESETS: LookPreset[] = [
  { id: 'neon-pulse', name: 'Neon Pulse', style: 'bars', gradient: 'neon', background: { mode: 'solid', color: '#0a0a0a' }, glow: true },
  { id: 'aurora-ring', name: 'Aurora Ring', style: 'radial', gradient: 'aurora', background: { mode: 'solid', color: '#05070a' }, glow: true },
  { id: 'sunset-drive', name: 'Sunset Drive', style: 'bars', gradient: 'sunset', background: { mode: 'solid', color: '#0a0a0a' }, glow: true },
  { id: 'ember-storm', name: 'Ember Storm', style: 'particles', gradient: 'ember', background: { mode: 'solid', color: '#0d0705' }, glow: true },
  { id: 'mono-matrix', name: 'Mono Matrix', style: 'grid', gradient: 'mono', background: { mode: 'solid', color: '#050505' }, glow: false },
  { id: 'deep-wave', name: 'Deep Wave', style: 'wave', gradient: 'aurora', background: { mode: 'solid', color: '#030608' }, glow: true },
  { id: 'liquid-violet', name: 'Liquid Violet', style: 'blob', gradient: 'sunset', background: { mode: 'solid', color: '#070510' }, glow: true },
  { id: 'alpha-grid', name: 'Alpha Cut', style: 'grid', gradient: 'neon', background: { mode: 'transparent', color: '#0a0a0a' }, glow: true },
]

/* ----------------------------------- projects ---------------------------------- */

interface ProjectSummary {
  id: string
  name: string
  updatedAt: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function extractProjectList(json: unknown): ProjectSummary[] {
  const root = asRecord(json)
  const arr = Array.isArray(json)
    ? json
    : root && Array.isArray(root.projects)
      ? root.projects
      : null
  if (!arr) return []
  const out: ProjectSummary[] = []
  for (const item of arr) {
    const rec = asRecord(item)
    if (!rec) continue
    const id =
      typeof rec.id === 'string' ? rec.id : typeof rec.id === 'number' ? String(rec.id) : null
    if (!id) continue
    out.push({
      id,
      name: typeof rec.name === 'string' ? rec.name : 'Untitled project',
      updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : null,
    })
  }
  return out
}

function looksLikeConfig(value: unknown): value is StudioConfig {
  const rec = asRecord(value)
  return rec !== null && 'visualizer' in rec && 'background' in rec && 'lyrics' in rec
}

/**
 * Presets tab: one-click look presets + cloud project save / open / delete.
 */
export function PresetsTab() {
  const patchVisualizer = useStudioStore((s) => s.patchVisualizer)
  const patchBackground = useStudioStore((s) => s.patchBackground)
  const audioMeta = useStudioStore((s) => s.audioMeta)
  const projectId = useStudioStore((s) => s.projectId)
  const setProjectId = useStudioStore((s) => s.setProjectId)
  const setConfig = useStudioStore((s) => s.setConfig)

  const [saving, setSaving] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    void fetchProjects()
  }, [])

  const fetchProjects = async () => {
    setListLoading(true)
    try {
      const res = await fetch('/api/projects')
      if (!res.ok) throw new Error(`Server responded ${res.status}`)
      const json: unknown = await res.json()
      setProjects(extractProjectList(json))
    } catch (err) {
      setProjects([])
      toast.error('Could not load saved projects', {
        description: err instanceof Error ? err.message : 'Unknown error.',
      })
    } finally {
      setListLoading(false)
    }
  }

  const handleSave = async () => {
    const { config } = useStudioStore.getState()
    const projectName = (name.trim() || audioMeta?.name || 'Untitled project').slice(0, 80)
    setSaving(true)
    try {
      const res = await fetch(projectId ? `/api/projects/${projectId}` : '/api/projects', {
        method: projectId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName, config }),
      })
      if (!res.ok) throw new Error(`Server responded ${res.status}`)
      const json: unknown = await res.json()
      const rec = asRecord(json)
      const project = rec ? asRecord(rec.project) : null
      const id =
        rec && typeof rec.id === 'string'
          ? rec.id
          : project && typeof project.id === 'string'
            ? project.id
            : projectId
      if (id) setProjectId(id)
      toast.success(projectId ? 'Project updated' : 'Project saved', { description: projectName })
      void fetchProjects()
    } catch (err) {
      toast.error('Could not save project', {
        description: err instanceof Error ? err.message : 'Save API not available yet.',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleLoad = async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${id}`)
      if (!res.ok) throw new Error(`Server responded ${res.status}`)
      const json: unknown = await res.json()
      const rec = asRecord(json)
      const project = rec ? (asRecord(rec.project) ?? rec) : null
      const config = project ? project.config : null
      if (!looksLikeConfig(config)) throw new Error('Saved project has no valid config')
      setConfig(config)
      setProjectId(id)
      toast.success('Project loaded')
    } catch (err) {
      toast.error('Could not load project', {
        description: err instanceof Error ? err.message : 'Unknown error.',
      })
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Server responded ${res.status}`)
      setProjects((prev) => prev.filter((p) => p.id !== id))
      if (projectId === id) setProjectId(null)
      toast.success('Project deleted')
    } catch (err) {
      toast.error('Could not delete project', {
        description: err instanceof Error ? err.message : 'Unknown error.',
      })
    }
  }

  const applyLook = (preset: LookPreset) => {
    const stops = GRADIENT_PRESETS[preset.gradient].stops.map((s) => ({ ...s }))
    patchVisualizer({
      style: preset.style,
      glow: preset.glow,
      gradient: { ...useStudioStore.getState().config.visualizer.gradient, stops },
    })
    patchBackground({
      mode: preset.background.mode,
      ...(preset.background.mode === 'solid' ? { color: preset.background.color } : {}),
    })
    toast.success(`Applied “${preset.name}”`)
  }

  return (
    <div className="space-y-5">
      {/* Look presets */}
      <section className="space-y-2">
        <MicroLabel className="text-[11px] tracking-widest text-zinc-500">LOOK PRESETS</MicroLabel>
        <div className="space-y-1.5">
          {LOOK_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-label={`Apply ${preset.name} preset`}
              onClick={() => applyLook(preset)}
              className="group flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-2 text-left transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/5"
            >
              <span
                className="h-8 w-12 shrink-0 rounded-md border border-zinc-800"
                style={{ background: gradientCss(GRADIENT_PRESETS[preset.gradient].stops, 90) }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-zinc-200">
                  {preset.name}
                </span>
                <span className="block text-[10px] capitalize text-zinc-500">
                  {preset.style} · {GRADIENT_PRESETS[preset.gradient].name} ·{' '}
                  {preset.background.mode === 'transparent' ? 'alpha' : 'solid bg'}
                </span>
              </span>
              <Wand2
                className="size-3.5 shrink-0 text-zinc-600 group-hover:text-emerald-400"
                aria-hidden
              />
            </button>
          ))}
        </div>
      </section>

      {/* Projects */}
      <section className="space-y-2 border-t border-zinc-800 pt-4">
        <MicroLabel className="text-[11px] tracking-widest text-zinc-500">PROJECTS</MicroLabel>
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name…"
            className="h-9 flex-1 text-xs"
            aria-label="Project name"
          />
          <Button
            size="sm"
            className="h-9 bg-zinc-100 font-medium text-zinc-900 shadow-none hover:bg-white"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="size-3.5" aria-hidden />
            )}
            Save
          </Button>
        </div>

        {listLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-zinc-500">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </div>
        ) : projects.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-600">
            No saved projects yet — tune the style and hit Save.
          </p>
        ) : (
          <div className="slim-scrollbar max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {projects.map((project) => (
              <div
                key={project.id}
                className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-2"
              >
                <FolderOpen className="size-3.5 shrink-0 text-zinc-600" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-zinc-200">{project.name}</div>
                  {project.updatedAt ? (
                    <div className="text-[10px] text-zinc-600">
                      {new Date(project.updatedAt).toLocaleString()}
                    </div>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-emerald-500/40 text-emerald-400 hover:border-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-300"
                  onClick={() => void handleLoad(project.id)}
                >
                  <Upload className="size-3" aria-hidden />
                  Load
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-zinc-500 hover:text-red-400"
                  aria-label={`Delete project ${project.name}`}
                  onClick={() => void handleDelete(project.id)}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
