import { NextRequest, NextResponse } from "next/server"
import { getTyposquatCandidates } from "@/lib/blastradius"
import type { Ecosystem } from "@/lib/depsdev"

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const ecosystem = params.get("ecosystem") as Ecosystem | null
  const name = params.get("name")

  if (!ecosystem || !name) {
    return NextResponse.json({ error: "?ecosystem=&name= are required" }, { status: 400 })
  }

  const candidates = await getTyposquatCandidates(ecosystem, name)
  return NextResponse.json({ candidates })
}
