import { NextRequest, NextResponse } from "next/server"
import {
  ingestPackageSubtree,
  ingestTyposquatEdges,
  ingestGithubIdentities,
} from "@/lib/ingest"
import type { Ecosystem } from "@/lib/depsdev"

interface IngestRequestBody {
  ecosystem: Ecosystem
  name: string
  version: string
  /** Optional: other package names already known, to precompute typosquat edges against. */
  typosquatCorpus?: string[]
  /**
   * Also resolve the source repository's GitHub identities. Off by default: it
   * costs two GitHub API calls, and unauthenticated that budget is 60 an hour.
   */
  linkGithub?: boolean
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<IngestRequestBody>

  if (!body.ecosystem || !body.name || !body.version) {
    return NextResponse.json({ error: "ecosystem, name, and version are required" }, { status: 400 })
  }
  if (body.ecosystem !== "npm" && body.ecosystem !== "pypi") {
    return NextResponse.json({ error: "ecosystem must be 'npm' or 'pypi'" }, { status: 400 })
  }

  const result = await ingestPackageSubtree(body.ecosystem, body.name, body.version)

  let typosquatEdges = 0
  if (body.typosquatCorpus && body.typosquatCorpus.length > 0) {
    typosquatEdges = await ingestTyposquatEdges(body.ecosystem, body.name, body.typosquatCorpus)
  }

  // A GitHub failure — rate limit, private repo, no GitHub source at all — is
  // not an ingest failure. The dependency graph is already written and useful;
  // the identity layer is an addition to it.
  let github = null
  if (body.linkGithub) {
    try {
      github = await ingestGithubIdentities(body.ecosystem, body.name, body.version)
    } catch (error) {
      github = { error: (error as Error).message }
    }
  }

  return NextResponse.json({ ok: true, ...result, typosquatEdges, github })
}
