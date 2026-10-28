/**
 * Shareable looks — a whole StudioConfig compressed into the URL itself.
 *
 * The full config JSON is gzip-compressed (fflate) and base64url-encoded,
 * then carried in the `?p=` query parameter:
 *
 *   https://mpem1.github.io/spectra/?p=p1.H4sIAAAAAAAA...
 *
 * - Works on any static host (no server round-trip, nothing stored).
 * - `p1.` prefix versions the payload; base64url never contains a literal
 *   dot, so splitting on the first dot is safe forever.
 * - Background IMAGE pixels (data URLs) cannot fit in a URL and are
 *   stripped on encode — the recipient gets a solid background instead.
 *   Everything else (styles, gradients, glow, lyrics styling) travels.
 */
import { gzipSync, gunzipSync } from 'fflate'
import { looksLikeConfig } from '@/lib/project-store'
import type { StudioConfig } from '@/lib/visualizer/types'

const VERSION = 'p1'

/** Soft cap — most forums and chat apps mangle URLs beyond ~2k, so keep it tight. */
export const MAX_SHARE_URL_LENGTH = 6000

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
  const binary = atob(b64 + pad)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Make a config safe to travel in a URL. Background image pixels are the
 * only oversized field; image mode falls back to the solid color.
 */
export function makePortable(config: StudioConfig): {
  config: StudioConfig
  imageDropped: boolean
} {
  if (config.background.mode === 'image' && config.background.imageSrc) {
    return {
      config: {
        ...config,
        background: {
          ...config.background,
          mode: 'solid',
          color: config.background.color || '#0a0a0a',
          imageSrc: '',
        },
      },
      imageDropped: true,
    }
  }
  return { config, imageDropped: false }
}

/** Compact URL-safe token for a config ("p1.<base64url-gzip-json>"). */
export function encodeLook(config: StudioConfig): string {
  const { config: portable } = makePortable(config)
  const json = new TextEncoder().encode(JSON.stringify(portable))
  return `${VERSION}.${toBase64Url(gzipSync(json, { level: 9 }))}`
}

/** Inverse of encodeLook. Returns null for missing/broken/foreign payloads. */
export function decodeLook(token: string): StudioConfig | null {
  try {
    const dot = token.indexOf('.')
    if (dot < 0) return null
    const version = token.slice(0, dot)
    const payload = token.slice(dot + 1)
    if (version !== VERSION || payload.length === 0) return null
    const json = new TextDecoder().decode(gunzipSync(fromBase64Url(payload)))
    const parsed: unknown = JSON.parse(json)
    return looksLikeConfig(parsed) ? (parsed as StudioConfig) : null
  } catch {
    return null
  }
}

/**
 * Full shareable URL for the current page (origin + base path preserved),
 * plus whether a background image had to be dropped.
 */
export function buildShareUrl(
  config: StudioConfig,
  opts: { maxLength?: number } = {},
): { url: string; imageDropped: boolean; tooLong: boolean } {
  const maxLength = opts.maxLength ?? MAX_SHARE_URL_LENGTH
  const base = `${window.location.origin}${window.location.pathname}`
  const token = encodeLook(config)
  const url = `${base}?p=${token}`
  if (url.length <= maxLength) return { url, imageDropped: false, tooLong: false }

  // Too long (huge lyrics, most likely) — retry without lyric lines and with
  // a capped title text so the link always fits a reasonable URL budget.
  const trimmed: StudioConfig = {
    ...config,
    lyrics: { ...config.lyrics, lines: [] },
    title: { ...config.title, text: config.title.text.slice(0, 120) },
  }
  const lightUrl = `${base}?p=${encodeLook(trimmed)}`
  return {
    url: lightUrl.length <= maxLength ? lightUrl : url,
    imageDropped: false,
    tooLong: true,
  }
}

/** The `?p=` value from the current address bar, if present. */
export function readLookParam(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('p')
}

/** Remove `?p=` from the address bar without reloading. */
export function clearLookParam(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return
  const url = new URL(window.location.href)
  if (!url.searchParams.has('p')) return
  url.searchParams.delete('p')
  window.history.replaceState(null, '', url)
}
