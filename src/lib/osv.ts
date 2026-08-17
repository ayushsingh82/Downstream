import type { Ecosystem } from "./depsdev"

const OSV_ECOSYSTEM: Record<Ecosystem, string> = { npm: "npm", pypi: "PyPI" }

export interface OsvQuery {
  ecosystem: Ecosystem
  name: string
  version: string
}

export interface OsvVulnRef {
  id: string
  modified: string
}

/**
 * POST https://api.osv.dev/v1/querybatch — up to 1000 package queries per
 * request; returns vulnerability ids only (fetch /v1/vulns/{id} for detail).
 * Used to seed realistic "this version was compromised" scenarios from real
 * advisory data instead of fabricating them.
 */
export async function queryBatch(queries: OsvQuery[]): Promise<OsvVulnRef[][]> {
  if (queries.length === 0) return []

  const res = await fetch("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      queries: queries.map((q) => ({
        version: q.version,
        package: { name: q.name, ecosystem: OSV_ECOSYSTEM[q.ecosystem] },
      })),
    }),
  })
  if (!res.ok) {
    throw new Error(`OSV.dev querybatch failed (${res.status})`)
  }
  const body = (await res.json()) as { results: { vulns?: OsvVulnRef[] }[] }
  return body.results.map((r) => r.vulns ?? [])
}

export interface OsvVulnDetail {
  id: string
  summary?: string
  details?: string
  aliases?: string[]
}

/** GET https://api.osv.dev/v1/vulns/{id} — full advisory record. */
export async function getVuln(id: string): Promise<OsvVulnDetail> {
  const res = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`)
  if (!res.ok) {
    throw new Error(`OSV.dev vuln lookup failed (${res.status}) for ${id}`)
  }
  return res.json()
}
