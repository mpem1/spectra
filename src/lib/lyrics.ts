/**
 * Helpers for the timestamped lyrics overlay: .lrc import parsing,
 * active-line lookup for the render loop, canvas word-wrap and time formatting.
 */
import type { LyricLine } from './types'

/** Generate a short unique id for a lyric line (no external deps). */
export function genLyricId(): string {
  return `ly_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Parse the standard .lrc lyrics format:
 *   [mm:ss]text  /  [mm:ss.xx]text  /  [mm:ss.xxx]text
 * Multiple timestamps per line (`[00:10.0][00:20.0] chorus`) expand into
 * separate lines. Metadata tags such as [ar:…], [ti:…], [offset:…] are ignored.
 * Returns lines sorted by time with empty texts dropped.
 */
export function parseLrc(text: string): { time: number; text: string }[] {
  const out: { time: number; text: string }[] = []
  const tag = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

  for (const rawLine of text.split(/\r?\n/)) {
    tag.lastIndex = 0
    const times: number[] = []
    let match: RegExpExecArray | null
    let lastEnd = 0
    while ((match = tag.exec(rawLine)) !== null) {
      // Only treat tags as timestamps when they run consecutively from the
      // start of the line (or right after the previous tag)
      if (match.index !== lastEnd) break
      const minutes = parseInt(match[1], 10)
      const seconds = parseInt(match[2], 10)
      const fracRaw = match[3]
      let frac = 0
      if (fracRaw) {
        frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length)
      }
      if (seconds < 60) {
        times.push(minutes * 60 + seconds + frac)
      }
      lastEnd = tag.lastIndex
    }
    if (times.length === 0) continue
    const lyricText = rawLine.slice(lastEnd).trim()
    if (!lyricText) continue
    for (const time of times) {
      out.push({ time, text: lyricText.slice(0, 300) })
    }
  }

  out.sort((a, b) => a.time - b.time)
  return out
}

/**
 * Index of the line currently on screen at track time `t`: the last line whose
 * timestamp is <= t. Returns -1 before the first line. Assumes lines are
 * sorted by time ascending.
 */
export function findActiveLyricIndex(lines: LyricLine[], t: number): number {
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= t) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/** Format seconds as m:ss.t for compact UI display (e.g. "1:23.4"). */
export function formatLyricTime(t: number): string {
  // Work in integer tenths of a second — floating point (28.2 - 28) * 10
  // floors to 1 instead of 2, which misrendered timestamps like 0:28.2.
  const total = Math.max(0, Math.round((Number.isFinite(t) ? t : 0) * 10))
  const minutes = Math.floor(total / 600)
  const rem = total % 600
  const whole = Math.floor(rem / 10)
  const tenths = rem % 10
  return `${minutes}:${String(whole).padStart(2, '0')}.${tenths}`
}

/**
 * Greedy word-wrap for canvas text. Words longer than maxWidth are hard-split
 * by character (keeps CJK lyrics working). Returns at most `maxRows` rows.
 */
export function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxRows: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const rows: string[] = []
  let current = ''

  const pushWord = (word: string) => {
    // Hard-split any single word that cannot fit on a row by itself
    let parts: string[] = [word]
    if (ctx.measureText(word).width > maxWidth && word.length > 1) {
      parts = []
      let chunk = ''
      for (const ch of word) {
        if (chunk && ctx.measureText(chunk + ch).width > maxWidth) {
          parts.push(chunk)
          chunk = ch
        } else {
          chunk += ch
        }
      }
      if (chunk) parts.push(chunk)
    }
    for (const part of parts) {
      const candidate = current ? `${current} ${part}` : part
      if (current && ctx.measureText(candidate).width > maxWidth) {
        rows.push(current)
        current = part
      } else {
        current = candidate
      }
      if (rows.length >= maxRows) return
    }
  }

  for (const word of words) {
    pushWord(word)
    if (rows.length >= maxRows) break
  }
  if (rows.length < maxRows && current) rows.push(current)

  // Ellipsis when the text did not fit
  if (rows.length === maxRows && (current || words.length)) {
    const last = rows[maxRows - 1]
    if (ctx.measureText(last).width > maxWidth - fontSizeEllipse(ctx)) {
      rows[maxRows - 1] = trimToWidth(ctx, last, maxWidth - fontSizeEllipse(ctx)) + '…'
    } else if (current && current !== last) {
      rows[maxRows - 1] = trimToWidth(ctx, `${last} ${current}`, maxWidth - fontSizeEllipse(ctx)) + '…'
    }
  }
  return rows
}

function fontSizeEllipse(ctx: CanvasRenderingContext2D): number {
  return ctx.measureText('…').width * 1.2
}

function trimToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  let out = text
  while (out.length > 1 && ctx.measureText(out).width > maxWidth) {
    out = out.slice(0, -1)
  }
  return out
}
