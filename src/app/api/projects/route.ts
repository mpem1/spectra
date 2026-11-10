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

const createSchema = z.object({
  name: projectNameSchema,
  config: projectConfigSchema,
})

/** GET /api/projects — recent projects (id/name/updatedAt), newest first. */
export async function GET() {
  try {
    const projects = await db.project.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, name: true, updatedAt: true },
    })
    return NextResponse.json({
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error('GET /api/projects failed:', err)
    return NextResponse.json({ error: 'Could not list projects' }, { status: 500 })
  }
}

/** POST /api/projects — create a project from { name, config }. */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const config = normalizeConfigInput(parsed.data.config)
  if (!config.ok) {
    return NextResponse.json({ error: config.error }, { status: 400 })
  }

  try {
    const project = await db.project.create({
      data: { name: resolveName(parsed.data.name), config: config.value },
    })
    return NextResponse.json({ project: presentProject(project) }, { status: 201 })
  } catch (err) {
    console.error('POST /api/projects failed:', err)
    return NextResponse.json({ error: 'Could not save project' }, { status: 500 })
  }
}
