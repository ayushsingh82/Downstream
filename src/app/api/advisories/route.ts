import { NextRequest, NextResponse } from "next/server"
import { listGraphVersions } from "@/lib/blastradius"
import { queryBatch, getVuln } from "@/lib/osv"
import type { Ecosystem } from "@/lib/depsdev"

/**
 * Scans what is actually in the graph against OSV.dev and returns the versions
 * that carry a real advisory.
 *
 * This is what turns the demo from "click the button marked compromise" into an
 * incident that started somewhere outside this app: the compromise target is
 * chosen by a public vulnerability feed, and the id shown next to it
 * (GHSA-…/CVE-…) is one anybody can look up. OSV.dev's querybatch takes up to
 * 1000 package queries per request and returns ids only, so the summary text for
 * the ones we display is a second, bounded fetch.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const limit = Math.min(Number(params.get("limit") ?? 200), 1000)
  const detail = Math.min(Number(params.get("detail") ?? 5), 20)
  const ecosystem = (params.get("ecosystem") as Ecosystem | null) ?? "npm"

  const startedAt = Date.now()
  // ?scope=all scans every package in the graph; the default scans only those
  // with registry maintainers, which is what keeps load-test fixtures out of the
  // OSV request budget.
  const maintainedOnly = params.get("scope") !== "all"
  const versions = (await listGraphVersions(limit, maintainedOnly)).filter(
    (row) => (row.ecosystem ?? "npm") === ecosystem
  )

  if (versions.length === 0) {
    return NextResponse.json({ scanned: 0, affected: [], elapsedMs: Date.now() - startedAt })
  }

  const results = await queryBatch(
    versions.map((row) => ({ ecosystem, name: row.name, version: row.version }))
  )

  const affected = versions
    .map((row, i) => ({ ...row, vulns: (results[i] ?? []).map((v) => v.id) }))
    .filter((row) => row.vulns.length > 0)

  // Advisory prose for the first few, so the console can name the incident
  // rather than printing an opaque id.
  const described = await Promise.all(
    affected.slice(0, detail).map(async (row) => {
      try {
        const vuln = await getVuln(row.vulns[0])
        return { ...row, summary: vuln.summary ?? vuln.details?.slice(0, 200) ?? null }
      } catch {
        return { ...row, summary: null }
      }
    })
  )

  return NextResponse.json({
    scanned: versions.length,
    affected: [...described, ...affected.slice(detail)],
    elapsedMs: Date.now() - startedAt,
  })
}
