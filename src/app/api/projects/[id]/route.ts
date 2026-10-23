import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  normalizeConfigInput,
  presentProject,
  projectConfigSchema,
  projectNameSchema,
  resolveName,
} from '@/lib/projects'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const updateSchema = z
  .object({
    name: projectNameSchema,
    config: projectConfigSchema.optional(),
  })
  .refine((data) => data.name !== undefined || data.config !== undefined, {
    message: 'Provide at least one of name or config',
  })

/** GET /api/projects/[id] — full project (config returned as a parsed object). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const project = await db.project.findUnique({ where: { id } })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    return NextResponse.json({ project: presentProject(project) })
  } catch (err) {
    console.error('GET /api/projects/[id] failed:', err)
    return NextResponse.json({ error: 'Could not load project' }, { status: 500 })
  }
}

/** PUT /api/projects/[id] — update name and/or config. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 })
  }

  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  let config: { ok: true; value: string } | { ok: false; error: string } | null = null
  if (parsed.data.config !== undefined) {
    const normalized = normalizeConfigInput(parsed.data.config)
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 })
    }
    config = normalized
  }

  try {
    const existing = await db.project.findUnique({ where: { id }, select: { id: true } })
    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    const project = await db.project.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: resolveName(parsed.data.name) } : {}),
        ...(config !== null ? { config: config.value } : {}),
      },
    })
    return NextResponse.json({ project: presentProject(project) })
  } catch (err) {
    console.error('PUT /api/projects/[id] failed:', err)
    return NextResponse.json({ error: 'Could not update project' }, { status: 500 })
  }
}

/** DELETE /api/projects/[id] */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const existing = await db.project.findUnique({ where: { id }, select: { id: true } })
    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    await db.project.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/projects/[id] failed:', err)
    return NextResponse.json({ error: 'Could not delete project' }, { status: 500 })
  }
}
