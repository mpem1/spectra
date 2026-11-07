/**
 * Custom font registry — imported .ttf/.otf/.woff files for the lyrics and
 * the title card.
 *
 * Font FILES never live in the render path directly: the config stores each
 * font as a base64 data URL (CustomFontConfig.data), and this module turns
 * those into FontFace registrations on demand. Registration is idempotent and
 * awaited by the exporters in their preparing phase, so deterministic exports
 * draw with the exact same faces as the live preview.
 *
 * Determinism note: a font id that is not (yet) registered resolves to the
 * neutral built-in stack — the same graceful-degradation rule as a background
 * image that has not finished decoding before frame 0.
 */
import type { CustomFontConfig } from './types'

interface RegisteredFont {
  family: string
  face: FontFace
}

/** id → registered face. Module-level, exactly like the other render caches. */
const registry = new Map<string, RegisteredFont>()

/** Canvas font stack for a config font value: built-in ids map to the
 * classic stacks, a custom id resolves to its registered family (quoted,
 * with a system fallback while the face finishes loading). */
export function fontStack(font: string): string {
  if (font === 'serif') return 'Georgia, serif'
  if (font === 'mono') return 'monospace'
  if (font !== 'sans') {
    const family = registry.get(font)?.family
    if (family) return `"${family}", system-ui, sans-serif`
  }
  return 'system-ui, sans-serif'
}

/** Registered CSS family for a custom font id, or null. */
export function customFontFamily(id: string): string | null {
  return registry.get(id)?.family ?? null
}

/** Family name is never user-visible — uniqueness matters more than beauty,
 * so the id suffix keeps two files with the same name from merging faces. */
function familyNameFor(font: CustomFontConfig): string {
  const safe = font.name.replace(/["'\\]/g, '').trim().slice(0, 24) || 'Font'
  return `Spectra ${safe} ${font.id.slice(-4)}`
}

/**
 * Register every not-yet-loaded font from a config, awaiting each face so the
 * caller (exporter preparing phase, config-load effect) can rely on them.
 * Broken font data is skipped silently — the font stack falls back, the same
 * way a missing image falls back to the background color.
 */
export async function registerCustomFonts(fonts: CustomFontConfig[] | undefined): Promise<void> {
  if (!fonts || fonts.length === 0) return
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return
  await Promise.all(
    fonts.map(async (font) => {
      if (!font || typeof font.id !== 'string' || typeof font.data !== 'string') return
      if (font.data.length === 0 || registry.has(font.id)) return
      try {
        const family = familyNameFor(font)
        const face = new FontFace(family, `url(${font.data})`)
        await face.load()
        document.fonts.add(face)
        registry.set(font.id, { family, face })
      } catch {
        // Undecodable font file — leave it unregistered; fontStack() falls back.
      }
    }),
  )
}
