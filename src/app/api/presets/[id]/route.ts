import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/presets/[id]
 * Fetch a single preset by id.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const preset = await db.preset.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        config: true,
        createdAt: true,
      },
    })
    if (!preset) {
      return NextResponse.json(
        { error: 'Preset not found' },
        { status: 404 }
      )
    }
    return NextResponse.json({ preset })
  } catch (error) {
    console.error(`[GET /api/presets/${id}] DB error:`, error)
    return NextResponse.json(
      { error: 'Failed to fetch preset' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/presets/[id]
 * Delete a preset by id. Returns { ok: true } whether or not it existed.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    await db.preset.deleteMany({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error(`[DELETE /api/presets/${id}] DB error:`, error)
    return NextResponse.json(
      { error: 'Failed to delete preset' },
      { status: 500 }
    )
  }
}
