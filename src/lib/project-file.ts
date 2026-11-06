/**
 * .spectra project files — the whole look as a single downloadable file.
 *
 * Unlike share links (a gzip'd URL with a hard length budget), a file has
 * no size limit, so NOTHING gets stripped: album art, separate disc face,
 * background image/video data, watermark logo and pulse image all travel
 * inside the JSON. The audio track is not part of the config, so it is not
 * in the file — open the file, then load your song as usual.
 */
import type { StudioConfig } from '@/lib/visualizer/types'

const APP = 'spectra'
const KIND = 'spectra-project'
/** Bump when the config shape changes in a breaking way. */
const VERSION = 1

interface ProjectFile {
  app: typeof APP
  kind: typeof KIND
  version: number
  savedAt: string
  name: string
  config: StudioConfig
}

export function serializeProject(config: StudioConfig, name: string): string {
  const file: ProjectFile = {
    app: APP,
    kind: KIND,
    version: VERSION,
    savedAt: new Date().toISOString(),
    name,
    config,
  }
  return JSON.stringify(file)
}

/**
 * Parse a .spectra file's text. Returns the project name + raw config (the
 * store's setConfig merges it over the factory defaults, so files saved by
 * older versions load cleanly). Null for anything foreign or broken.
 */
export function parseProject(text: string): { name: string; config: StudioConfig } | null {
  try {
    const parsed = JSON.parse(text) as Partial<ProjectFile> | null
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.app !== APP || parsed.kind !== KIND) return null
    if (typeof parsed.version !== 'number' || parsed.version > VERSION) return null
    const cfg = parsed.config
    if (!cfg || typeof cfg !== 'object') return null
    if (!('visualizer' in cfg) || !('background' in cfg) || !('lyrics' in cfg)) return null
    return {
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : 'Project',
      config: cfg as StudioConfig,
    }
  } catch {
    return null
  }
}

/** Filesystem-safe base name (no extension). */
export function sanitizeFileName(name: string): string {
  const clean = name
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return clean || 'spectra-project'
}

/** Serialize + trigger a browser download of `<name>.spectra`. */
export function downloadProjectFile(config: StudioConfig, name: string): void {
  const json = serializeProject(config, name)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${sanitizeFileName(name)}.spectra`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}
