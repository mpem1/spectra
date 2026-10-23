/**
 * Pulse Studio — shared helpers for the projects save/load API.
 *
 * The `config` column stores a JSON-serialized StudioConfig string; the API
 * always returns it PARSED back into an object (the UI validates the shape
 * with `looksLikeConfig`, which requires visualizer/background/lyrics keys).
 */
import { z } from 'zod'

/** name: optional/blank-tolerant (UI falls back to 'Untitled project'), max 200 chars. */
export const projectNameSchema = z.string().trim().max(200).optional()

/** config: accepts a JSON string or an already-parsed object — both stored as string. */
export const projectConfigSchema = z.union([z.string(), z.record(z.string(), z.unknown())])

export type ProjectRecord = {
  id: string
  name: string
  config: string
  createdAt: Date
  updatedAt: Date
}

function isConfigShape(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'visualizer' in value &&
    'background' in value &&
    'lyrics' in value
  )
}

export type NormalizeResult =
  | { ok: true; value: string }
  | { ok: false; error: string }

/**
 * Validates + normalizes an incoming config into the stored JSON string.
 * Objects are stringified; strings must be well-formed JSON with the
 * StudioConfig top-level shape.
 */
export function normalizeConfigInput(raw: unknown): NormalizeResult {
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isConfigShape(parsed)) {
        return { ok: false, error: 'config must be a StudioConfig object (visualizer/background/lyrics)' }
      }
      return { ok: true, value: raw }
    } catch {
      return { ok: false, error: 'config must be valid JSON' }
    }
  }
  if (isConfigShape(raw)) {
    return { ok: true, value: JSON.stringify(raw) }
  }
  return { ok: false, error: 'config must be a StudioConfig object or a JSON string' }
}

export function resolveName(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : 'Untitled project'
}

/** API presentation shape: ISO date strings + config parsed back to an object. */
export function presentProject(project: ProjectRecord): {
  id: string
  name: string
  config: unknown
  createdAt: string
  updatedAt: string
} {
  let config: unknown = project.config
  try {
    config = JSON.parse(project.config)
  } catch {
    // Should never happen (validated on write) — fall back to the raw string.
  }
  return {
    id: project.id,
    name: project.name,
    config,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}
