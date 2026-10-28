/**
 * Pulse Studio — browser-local project storage (IndexedDB).
 *
 * Projects are named StudioConfig snapshots. They used to live in a
 * server-side SQLite database behind /api/projects; they now live entirely
 * in the visitor's browser so the app runs 100% client-side — a hard
 * requirement for hosting on GitHub Pages (static only).
 *
 * Same logical API as the old REST endpoints:
 *   listProjects()      → GET  /api/projects
 *   saveProject()       → POST /api/projects | PUT /api/projects/[id]
 *   getProject()        → GET  /api/projects/[id]
 *   deleteProject()     → DELETE /api/projects/[id]
 */
import { normalizeConfigInput, resolveName } from '@/lib/projects'
import type { StudioConfig } from '@/lib/visualizer/types'

export interface StoredProject {
  id: string
  name: string
  config: StudioConfig
  createdAt: string
  updatedAt: string
}

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
}

/** Mirror of the old API cap (50 most recent projects). */
export const MAX_PROJECTS = 50

const DB_NAME = 'spectra-studio'
const DB_VERSION = 1
const STORE = 'projects'

/** Defensively narrow an unknown value into a StudioConfig (same check the UI used). */
export function looksLikeConfig(value: unknown): value is StudioConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'visualizer' in value &&
    'background' in value &&
    'lyrics' in value
  )
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Local storage unavailable in this browser.'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open the local database.'))
    req.onblocked = () => reject(new Error('Local database is busy — close other Spectra tabs.'))
  })
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Local database error.'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Local database error.'))
    tx.onabort = () => reject(tx.error ?? new Error('Local database write failed.'))
  })
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/** Validate + normalize an incoming config the same way the old API did. */
function parseConfig(raw: unknown): StudioConfig {
  const normalized = normalizeConfigInput(raw)
  if (!normalized.ok) throw new Error(normalized.error)
  const parsed: unknown = JSON.parse(normalized.value)
  if (!looksLikeConfig(parsed)) {
    throw new Error('Project config is missing visualizer/background/lyrics.')
  }
  return parsed
}

/** All saved projects, newest first, capped at MAX_PROJECTS. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const all = await requestToPromise(tx.objectStore(STORE).getAll() as IDBRequest<StoredProject[]>)
    return all
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, MAX_PROJECTS)
      .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
  } finally {
    db.close()
  }
}

/**
 * Create or update a project. With `id` set, the existing record is updated
 * (name/config replaced, createdAt preserved) — otherwise a new one is made.
 * Throws with a readable message on invalid config or quota errors.
 */
export async function saveProject(input: {
  id?: string | null
  name?: string
  config: unknown
}): Promise<StoredProject> {
  const config = parseConfig(input.config)
  const name = resolveName(input.name)
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const now = new Date().toISOString()

    let existing: StoredProject | undefined
    if (input.id) {
      existing = await requestToPromise(store.get(input.id) as IDBRequest<StoredProject | undefined>)
    }

    const record: StoredProject = {
      id: existing?.id ?? makeId(),
      name,
      config,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    store.put(record)
    await txDone(tx)
    return record
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      throw new Error('Browser storage is full — delete a few old projects and try again.')
    }
    throw err
  } finally {
    db.close()
  }
}

/** One project by id, or null when missing. */
export async function getProject(id: string): Promise<StoredProject | null> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const found = await requestToPromise(tx.objectStore(STORE).get(id) as IDBRequest<StoredProject | undefined>)
    return found ?? null
  } finally {
    db.close()
  }
}

/** Remove a project by id (no-op when missing). */
export async function deleteProject(id: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    await txDone(tx)
  } finally {
    db.close()
  }
}
