import { NextRequest, NextResponse } from "next/server"
import { markCompromised } from "@/lib/ingest"
import { getBlastRadius } from "@/lib/blastradius"
import type { Ecosystem } from "@/lib/depsdev"

interface CompromiseRequestBody {
  ecosystem: Ecosystem
  name: string
  version: string
  compromisedAt?: number
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<CompromiseRequestBody>

  if (!body.ecosystem || !body.name || !body.version) {
    return NextResponse.json({ error: "ecosystem, name, and version are required" }, { status: 400 })
  }

  const compromisedAt = body.compromisedAt ?? Date.now()
  await markCompromised(body.ecosystem, body.name, body.version, compromisedAt)

  // Strong-consistency read immediately after the write, so the caller sees
  // the blast radius as of this exact compromise event — not a stale view.
  const radius = await getBlastRadius(body.ecosystem, body.name, body.version)

  return NextResponse.json({ ok: true, compromisedAt, blastRadius: radius })
}
