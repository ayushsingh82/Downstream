import { NextRequest, NextResponse } from "next/server"
import {
  getBlastRadius,
  getSharedMaintainerPackages,
  getLiveWindowLockfiles,
  explainExposure,
} from "@/lib/blastradius"
import type { Ecosystem } from "@/lib/depsdev"

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const ecosystem = params.get("ecosystem") as Ecosystem | null
  const name = params.get("name")
  const version = params.get("version")

  if (!ecosystem || !name || !version) {
    return NextResponse.json({ error: "?ecosystem=&name=&version= are required" }, { status: 400 })
  }

  const windowStart = Number(params.get("windowStart") ?? 0)
  const windowEnd = Number(params.get("windowEnd") ?? Date.now())
  const explainProject = params.get("explainProject")

  const startedAt = Date.now()
  const [radius, sharedMaintainerPackages, liveWindowLockfiles, explanation] = await Promise.all([
    getBlastRadius(ecosystem, name, version),
    getSharedMaintainerPackages(ecosystem, name),
    getLiveWindowLockfiles(ecosystem, name, version, windowStart, windowEnd),
    explainProject ? explainExposure(ecosystem, name, version, explainProject) : Promise.resolve(null),
  ])

  return NextResponse.json({
    radius,
    sharedMaintainerPackages,
    liveWindowLockfiles,
    explanation,
    elapsedMs: Date.now() - startedAt,
  })
}
