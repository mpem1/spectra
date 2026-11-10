import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/color-presets/[id]
 * Fetch a single color preset by id.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const colorPreset = await db.colorPreset.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        colorA: true,
        colorB: true,
        createdAt: true,
      },
    })
    if (!colorPreset) {
      return NextResponse.json(
        { error: 'Color preset not found' },
        { status: 404 }
      )
    }
    return NextResponse.json({ colorPreset })
  } catch (error) {
    console.error(`[GET /api/color-presets/${id}] DB error:`, error)
    return NextResponse.json(
      { error: 'Failed to fetch color preset' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/color-presets/[id]
 * Delete a color preset by id. Returns { ok: true } whether or not it existed.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    await db.colorPreset.deleteMany({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error(`[DELETE /api/color-presets/${id}] DB error:`, error)
    return NextResponse.json(
      { error: 'Failed to delete color preset' },
      { status: 500 }
    )
  }
}
