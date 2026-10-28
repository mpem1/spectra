import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** Maximum name length after trimming */
const MAX_NAME_LENGTH = 40
/** Maximum color string length after trimming (any CSS color string, e.g. "#10b981") */
const MAX_COLOR_LENGTH = 40

/**
 * GET /api/color-presets
 * List the most recent color presets (max 200), newest first.
 */
export async function GET() {
  try {
    const colorPresets = await db.colorPreset.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        name: true,
        colorA: true,
        colorB: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ colorPresets })
  } catch (error) {
    console.error('[GET /api/color-presets] DB error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch color presets' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/color-presets
 * Create a color preset. Body: { name: string, colorA: string, colorB: string }
 * - name: non-empty string, trimmed to max 40 chars
 * - colorA / colorB: non-empty strings, trimmed to max 40 chars (any CSS color string)
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

    const { name, colorA, colorB } = (body ?? {}) as {
      name?: unknown
      colorA?: unknown
      colorB?: unknown
    }

    // Validate name
    if (typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Name is required and must be a non-empty string' },
        { status: 400 }
      )
    }
    const trimmedName = name.trim().slice(0, MAX_NAME_LENGTH)

    // Validate colorA
    if (typeof colorA !== 'string' || colorA.trim().length === 0) {
      return NextResponse.json(
        { error: 'colorA is required and must be a non-empty string' },
        { status: 400 }
      )
    }
    if (colorA.trim().length > MAX_COLOR_LENGTH) {
      return NextResponse.json(
        { error: `colorA is too long (max ${MAX_COLOR_LENGTH} characters)` },
        { status: 400 }
      )
    }
    const trimmedColorA = colorA.trim()

    // Validate colorB
    if (typeof colorB !== 'string' || colorB.trim().length === 0) {
      return NextResponse.json(
        { error: 'colorB is required and must be a non-empty string' },
        { status: 400 }
      )
    }
    if (colorB.trim().length > MAX_COLOR_LENGTH) {
      return NextResponse.json(
        { error: `colorB is too long (max ${MAX_COLOR_LENGTH} characters)` },
        { status: 400 }
      )
    }
    const trimmedColorB = colorB.trim()

    const colorPreset = await db.colorPreset.create({
      data: {
        name: trimmedName,
        colorA: trimmedColorA,
        colorB: trimmedColorB,
      },
      select: {
        id: true,
        name: true,
        colorA: true,
        colorB: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ colorPreset }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/color-presets] DB error:', error)
    return NextResponse.json(
      { error: 'Failed to create color preset' },
      { status: 500 }
    )
  }
}
