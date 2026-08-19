import { NextRequest, NextResponse } from "next/server"
import { markCompromised } from "@/lib/ingest"
import { blastRadius, type BlastRadiusMode } from "@/lib/blastradius"
import type { Ecosystem } from "@/lib/depsdev"

interface CompromiseRequestBody {
  ecosystem: Ecosystem
  name: string
  version: string
  compromisedAt?: number
  /** "exhaustive" (default, no path cap) or "sspaths" (one native call). */
  mode?: BlastRadiusMode
  /** Levels per expansion call in exhaustive mode; 1 is fastest (see blastradius.ts). */
  expandDepth?: number
  /** Skip the upstream closure and return the sub-second lockfile answer only. */
  skipClosure?: boolean
  /** How many exposed services get a drawn chain (default 10; 0 for none). */
  chainLimit?: number
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<CompromiseRequestBody>

  if (!body.ecosystem || !body.name || !body.version) {
    return NextResponse.json({ error: "ecosystem, name, and version are required" }, { status: 400 })
  }

  const compromisedAt = body.compromisedAt ?? Date.now()
  const startedAt = Date.now()

  let marked: { versionId: number; bookmark?: string }
  try {
    marked = await markCompromised(body.ecosystem, body.name, body.version, compromisedAt)
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 404 })
  }

  // The write's bookmark is threaded into the read, so a `causal` read is
  // guaranteed to observe the compromise flag we just set without paying for
  // `strong` consistency on the traversal itself — which is the expensive half.
  const radius = await blastRadius(body.ecosystem, body.name, body.version, {
    bookmark: marked.bookmark,
    mode: body.mode,
    expandDepth: body.expandDepth,
    skipClosure: body.skipClosure,
    chainLimit: body.chainLimit,
  })

  return NextResponse.json({
    ok: true,
    compromisedAt,
    elapsedMs: Date.now() - startedAt,
    versionId: marked.versionId,
    blastRadius: radius,
  })
}
