import { runQuery } from "./hydradb"
import { versionId, packageId } from "./ingest"
import type { Ecosystem } from "./depsdev"

const CLOSURE_REL_TYPES = ["RESOLVES_TO", "PINS", "HAS_LOCKFILE"]

/**
 * Traces the full reverse-dependency closure from one compromised package
 * version out to every exposed project, in a single native call —
 * algo.SSpaths (bounded paths from one source), the correct procedure for a
 * single compromise event. algo.MSpaths is reserved for evaluating several
 * compromised versions against the same target set at once.
 */
export async function getBlastRadius(
  ecosystem: Ecosystem,
  name: string,
  version: string,
  maxLen = 8,
  pathCount = 200
) {
  const sourceId = versionId(ecosystem, name, version)
  const { rows } = await runQuery(
    `CALL algo.SSpaths({sourceNode: $sourceId, relTypes: $relTypes, relDirection: 'both', maxLen: $maxLen, pathCount: $pathCount})
     YIELD path RETURN path`,
    { params: { sourceId, relTypes: CLOSURE_REL_TYPES, maxLen, pathCount } }
  )
  return { sourceId, paths: rows }
}

/** Explains one specific exposure: the bounded path from a project to the compromised version. */
export async function explainExposure(
  ecosystem: Ecosystem,
  name: string,
  version: string,
  projectId: number,
  maxLen = 8
) {
  const targetId = versionId(ecosystem, name, version)
  const { rows } = await runQuery(
    `CALL algo.SPpaths({sourceNode: $projectId, targetNode: $targetId, relTypes: $relTypes,
                        relDirection: 'both', maxLen: $maxLen, pathCount: 5})
     YIELD path, pathWeight, pathCost
     RETURN path, pathWeight, pathCost`,
    { params: { projectId, targetId, relTypes: CLOSURE_REL_TYPES, maxLen } }
  )
  return rows
}

export interface MaintainerRow {
  id: number
  name: string
}

/** Every maintainer of a package. */
export async function getMaintainers(ecosystem: Ecosystem, name: string): Promise<MaintainerRow[]> {
  const pkgId = packageId(ecosystem, name)
  const { rows } = await runQuery<MaintainerRow>(
    `MATCH (m:Maintainer)-[:MAINTAINS]->(p:Package) WHERE p.id = $pkgId RETURN DISTINCT m.id AS id, m.name AS name`,
    { params: { pkgId } }
  )
  return rows
}

export interface SharedPackageRow {
  id: number
  name: string
  ecosystem: string
}

/** Other packages sharing at least one maintainer with the given package. */
export async function getSharedMaintainerPackages(
  ecosystem: Ecosystem,
  name: string
): Promise<SharedPackageRow[]> {
  const pkgId = packageId(ecosystem, name)
  const maintainers = await getMaintainers(ecosystem, name)

  const results = new Map<number, SharedPackageRow>()
  for (const maintainer of maintainers) {
    const { rows } = await runQuery<SharedPackageRow>(
      `MATCH (m:Maintainer)-[:MAINTAINS]->(other:Package)
       WHERE m.id = $maintainerId AND other.id <> $pkgId
       RETURN other.id AS id, other.name AS name, other.ecosystem AS ecosystem`,
      { params: { maintainerId: maintainer.id, pkgId } }
    )
    for (const row of rows) results.set(row.id, row)
  }
  return [...results.values()]
}

export interface LiveWindowLockfileRow {
  id: number
  projectId: number
  resolvedAt: number
}

/** Lockfiles that resolved to the compromised version while it was live (or since). */
export async function getLiveWindowLockfiles(
  ecosystem: Ecosystem,
  name: string,
  version: string,
  windowStart: number,
  windowEnd: number
): Promise<LiveWindowLockfileRow[]> {
  const vId = versionId(ecosystem, name, version)
  const { rows } = await runQuery<LiveWindowLockfileRow>(
    `MATCH (l:Lockfile)-[:PINS]->(v:PackageVersion)
     WHERE v.id = $versionId AND l.resolved_at >= $windowStart AND l.resolved_at <= $windowEnd
     RETURN l.id AS id, l.project_id AS projectId, l.resolved_at AS resolvedAt`,
    { params: { versionId: vId, windowStart, windowEnd } }
  )
  return rows
}

export interface TyposquatRow {
  id: number
  name: string
  distance: number
}

/** Name-similarity neighbors precomputed at ingest time (see similarity.ts). */
export async function getTyposquatCandidates(ecosystem: Ecosystem, name: string): Promise<TyposquatRow[]> {
  const pkgId = packageId(ecosystem, name)
  const { rows } = await runQuery<TyposquatRow>(
    `MATCH (p:Package)-[r:NAME_SIMILAR_TO]->(other:Package)
     WHERE p.id = $pkgId
     RETURN other.id AS id, other.name AS name, r.distance AS distance
     ORDER BY distance`,
    { params: { pkgId } }
  )
  return rows
}
