import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** Maximum allowed length of the JSON-encoded config string (background images can be large) */
const MAX_CONFIG_LENGTH = 500_000
/** Maximum preset name length after trimming */
const MAX_NAME_LENGTH = 60

/**
 * GET /api/presets
 * List the most recent presets (max 100), newest first.
 */
export async function GET() {
  try {
    const presets = await db.preset.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        name: true,
        config: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ presets })
  } catch (error) {
    console.error('[GET /api/presets] DB error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch presets' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/presets
 * Create a preset. Body: { name: string, config: string }
 * - name: non-empty string, trimmed to max 60 chars
 * - config: string that parses as a JSON object (not array/null), max 500k chars
 */
export async function POST(req: Request) {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    const { name, config } = (body ?? {}) as { name?: unknown; config?: unknown }

    // Validate name
    if (typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Name is required and must be a non-empty string' },
        { status: 400 }
      )
    }
    const trimmedName = name.trim().slice(0, MAX_NAME_LENGTH)

    // Validate config: must be a string that parses as a JSON object
    if (typeof config !== 'string' || config.length === 0) {
      return NextResponse.json(
        { error: 'Config is required and must be a JSON string' },
        { status: 400 }
      )
    }
    if (config.length > MAX_CONFIG_LENGTH) {
      return NextResponse.json(
        { error: `Config is too large (max ${MAX_CONFIG_LENGTH} characters)` },
        { status: 400 }
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(config)
    } catch {
      return NextResponse.json(
        { error: 'Config must be valid JSON' },
        { status: 400 }
      )
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: 'Config must be a JSON object' },
        { status: 400 }
      )
    }

    const preset = await db.preset.create({
      data: {
        name: trimmedName,
        config,
      },
      select: {
        id: true,
        name: true,
        config: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ preset }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/presets] DB error:', error)
    return NextResponse.json(
      { error: 'Failed to create preset' },
      { status: 500 }
    )
  }
}
