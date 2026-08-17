import { NextRequest, NextResponse } from "next/server"
import { ingestService, type LockfileEntry } from "@/lib/ingest"
import type { Ecosystem } from "@/lib/depsdev"

interface ServiceRequestBody {
  serviceName: string
  projectName: string
  ecosystem: Ecosystem
  entries: LockfileEntry[]
  resolvedAt?: number
}

/**
 * Registers the consuming side of the graph: a Service running a Project whose
 * lockfile pins resolved versions. Without this, a blast radius has nothing to
 * terminate at — the whole point is answering "which of *our* services."
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<ServiceRequestBody>

  if (!body.serviceName || !body.projectName || !body.ecosystem || !Array.isArray(body.entries)) {
    return NextResponse.json(
      { error: "serviceName, projectName, ecosystem, and entries[] are required" },
      { status: 400 }
    )
  }

  const result = await ingestService(
    body.serviceName,
    body.projectName,
    body.ecosystem,
    body.entries,
    body.resolvedAt ?? Date.now()
  )

  return NextResponse.json({
    ok: true,
    ...result,
    skipped: body.entries.length - result.pinned,
  })
}
