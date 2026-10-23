'use client'

import { useRef, useState } from 'react'
import { AudioWaveform, FolderOpen, Loader2, Music, Save, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useStudioStore } from '@/store/studio'
import { getEngine } from '@/components/studio/engine-registry'
import { formatTime } from '@/components/studio/controls'
import type { StudioConfig } from '@/lib/visualizer/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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

export function TopBar() {
  const audioMeta = useStudioStore((s) => s.audioMeta)
  const projectId = useStudioStore((s) => s.projectId)
  const setAudioMeta = useStudioStore((s) => s.setAudioMeta)
  const setProjectId = useStudioStore((s) => s.setProjectId)
  const setConfig = useStudioStore((s) => s.setConfig)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [loadingAudio, setLoadingAudio] = useState(false)
  const [saving, setSaving] = useState(false)
  const [openDialog, setOpenDialog] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [listLoading, setListLoading] = useState(false)

  const handleAudioFile = async (file: File) => {
    const engine = getEngine()
    if (!engine) {
      toast.error('Audio engine not ready', { description: 'Wait for the preview to mount.' })
      return
    }
    setLoadingAudio(true)
    try {
      const meta = await engine.loadFile(file)
      setAudioMeta({ name: meta.name, duration: meta.duration })
      toast.success('Audio loaded', {
        description: `${meta.name} · ${formatTime(meta.duration)}`,
      })
    } catch (err) {
      toast.error('Could not load audio', {
        description: err instanceof Error ? err.message : 'Unsupported file.',
      })
    } finally {
      setLoadingAudio(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

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
    const name = audioMeta?.name ?? 'Untitled project'
    setSaving(true)
    try {
      const res = await fetch(projectId ? `/api/projects/${projectId}` : '/api/projects', {
        method: projectId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config }),
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
      toast.success(projectId ? 'Project updated' : 'Project saved', { description: name })
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
      setOpenDialog(false)
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

  return (
    <header className="shrink-0 border-b border-zinc-800 bg-zinc-950">
      <div className="flex h-14 items-center gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
            <AudioWaveform className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 truncate">
            <div className="truncate text-sm font-semibold leading-tight text-zinc-100">Pulse Studio</div>
            <div className="hidden text-[10px] uppercase tracking-wider text-zinc-500 sm:block">
              Music visualizer &amp; lyric video maker
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            aria-label="Audio file input"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleAudioFile(file)
            }}
          />
          <Button
            size="sm"
            className="bg-emerald-500 font-medium text-zinc-950 shadow-none hover:bg-emerald-400"
            disabled={loadingAudio}
            onClick={() => fileInputRef.current?.click()}
          >
            {loadingAudio ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Music className="size-4" aria-hidden />
            )}
            Load audio
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-zinc-800 bg-zinc-900/60 hover:border-zinc-600 hover:bg-zinc-900"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            Save
          </Button>
          <Dialog
            open={openDialog}
            onOpenChange={(next) => {
              setOpenDialog(next)
              if (next) void fetchProjects()
            }}
          >
            <Button
              size="sm"
              variant="outline"
              className="border-zinc-800 bg-zinc-900/60 hover:border-zinc-600 hover:bg-zinc-900"
              aria-haspopup="dialog"
              onClick={() => {
                setOpenDialog(true)
                void fetchProjects()
              }}
            >
              <FolderOpen className="size-4" aria-hidden />
              Open
            </Button>
            <DialogContent className="border-zinc-800 bg-zinc-900 sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-zinc-100">Saved projects</DialogTitle>
                <DialogDescription className="text-zinc-500">
                  Projects save your visualizer, background and lyrics configuration.
                </DialogDescription>
              </DialogHeader>
              <div className="slim-scrollbar max-h-80 space-y-1.5 overflow-y-auto pr-1">
                {listLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-xs text-zinc-500">
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
                  </div>
                ) : projects.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-600">
                    No saved projects yet.
                  </p>
                ) : (
                  projects.map((project) => (
                    <div
                      key={project.id}
                      className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-zinc-200">
                          {project.name}
                        </div>
                        {project.updatedAt ? (
                          <div className="text-[10px] text-zinc-600">
                            {new Date(project.updatedAt).toLocaleString()}
                          </div>
                        ) : null}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-emerald-500/40 text-emerald-400 hover:border-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-300"
                        onClick={() => void handleLoad(project.id)}
                      >
                        <Upload className="size-3.5" aria-hidden />
                        Load
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-zinc-500 hover:text-red-400"
                        aria-label={`Delete project ${project.name}`}
                        onClick={() => void handleDelete(project.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </header>
  )
}
