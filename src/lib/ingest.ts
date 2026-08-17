import { runQuery } from "./hydradb"
import { stableId } from "./id"
import { getDependencyGraph, type Ecosystem } from "./depsdev"
import { getRegistryMeta } from "./registry"
import { findTyposquatCandidates } from "./similarity"

export function packageId(ecosystem: Ecosystem, name: string): number {
  return stableId(`pkg:${ecosystem}:${name}`)
}

export function versionId(ecosystem: Ecosystem, name: string, version: string): number {
  return stableId(`pkgver:${ecosystem}:${name}@${version}`)
}

export interface IngestSubtreeResult {
  packagesIngested: number
  versionsIngested: number
  edgesIngested: number
  maintainersIngested: number
}

/**
 * Pulls the resolved (not just declared) dependency graph for one package
 * version from deps.dev, plus registry maintainer metadata for the root
 * package, and batch-loads it into HydraDB via the documented two-pass
 * UNWIND shape: upsert vertices, then MATCH-and-connect (cypher-compat.md).
 */
export async function ingestPackageSubtree(
  ecosystem: Ecosystem,
  name: string,
  version: string
): Promise<IngestSubtreeResult> {
  const graph = await getDependencyGraph(ecosystem, name, version)

  const nodeIdByIndex = graph.nodes.map((n) =>
    versionId(ecosystem, n.versionKey.name, n.versionKey.version)
  )

  const packageRows = new Map<number, { vertex: number; name: string; ecosystem: string }>()
  const versionRows: { vertex: number; package_id: number; version: string }[] = []

  for (const node of graph.nodes) {
    const pkgId = packageId(ecosystem, node.versionKey.name)
    packageRows.set(pkgId, { vertex: pkgId, name: node.versionKey.name, ecosystem })
    versionRows.push({
      vertex: versionId(ecosystem, node.versionKey.name, node.versionKey.version),
      package_id: pkgId,
      version: node.versionKey.version,
    })
  }

  await runQuery(
    `UNWIND $rows AS row MERGE (n {id: row.vertex}) SET n:Package, n.name = row.name, n.ecosystem = row.ecosystem`,
    { params: { rows: [...packageRows.values()] }, consistency: "strong" }
  )
  await runQuery(
    `UNWIND $rows AS row MERGE (n {id: row.vertex}) SET n:PackageVersion, n.package_id = row.package_id, n.version = row.version`,
    { params: { rows: versionRows }, consistency: "strong" }
  )
  await runQuery(
    `UNWIND $rows AS row
     MATCH (p {id: row.package_id}), (v {id: row.vertex})
     MERGE (p)-[:HAS_VERSION]->(v)`,
    { params: { rows: versionRows }, consistency: "strong" }
  )

  const edgeRows = graph.edges.map((e) => ({
    source_vertex: nodeIdByIndex[e.fromNode],
    destination_vertex: nodeIdByIndex[e.toNode],
    requirement: e.requirement,
  }))

  if (edgeRows.length > 0) {
    await runQuery(
      `UNWIND $rows AS row
       MATCH (s {id: row.source_vertex}), (d {id: row.destination_vertex})
       MERGE (s)-[r:RESOLVES_TO]->(d)
       SET r.requirement = row.requirement`,
      { params: { rows: edgeRows }, consistency: "strong" }
    )
  }

  const maintainersIngested = await ingestMaintainers(ecosystem, name)

  return {
    packagesIngested: packageRows.size,
    versionsIngested: versionRows.length,
    edgesIngested: edgeRows.length,
    maintainersIngested,
  }
}

/** Fetches registry maintainer data for one package and links it into the graph. */
export async function ingestMaintainers(ecosystem: Ecosystem, name: string): Promise<number> {
  const meta = await getRegistryMeta(ecosystem, name)
  const pkgId = packageId(ecosystem, name)

  if (meta.maintainers.length === 0) return 0

  const rows = meta.maintainers.map((m) => ({
    vertex: stableId(`maintainer:${ecosystem}:${m.name}`),
    name: m.name,
    package_id: pkgId,
  }))

  await runQuery(
    `UNWIND $rows AS row MERGE (n {id: row.vertex}) SET n:Maintainer, n.name = row.name`,
    { params: { rows }, consistency: "strong" }
  )
  await runQuery(
    `UNWIND $rows AS row
     MATCH (m {id: row.vertex}), (p {id: row.package_id})
     MERGE (m)-[:MAINTAINS]->(p)`,
    { params: { rows }, consistency: "strong" }
  )

  return rows.length
}

export interface LockfileEntry {
  name: string
  version: string
}

/** Registers a consuming project + one lockfile snapshot pinning specific resolved versions. */
export async function ingestLockfile(
  projectName: string,
  ecosystem: Ecosystem,
  entries: LockfileEntry[],
  resolvedAt: number
): Promise<{ lockfileId: number }> {
  const projectId = stableId(`project:${projectName}`)
  const lockfileId = stableId(`lockfile:${projectName}:${resolvedAt}`)

  await runQuery(`MERGE (p {id: $projectId}) SET p:Project, p.name = $projectName`, {
    params: { projectId, projectName },
    consistency: "strong",
  })
  await runQuery(
    `MERGE (l {id: $lockfileId}) SET l:Lockfile, l.project_id = $projectId, l.resolved_at = $resolvedAt`,
    { params: { lockfileId, projectId, resolvedAt }, consistency: "strong" }
  )
  await runQuery(`MATCH (p {id: $projectId}), (l {id: $lockfileId}) MERGE (p)-[:HAS_LOCKFILE]->(l)`, {
    params: { projectId, lockfileId },
    consistency: "strong",
  })

  const rows = entries.map((e) => ({
    lockfile_id: lockfileId,
    version_vertex: versionId(ecosystem, e.name, e.version),
  }))

  if (rows.length > 0) {
    await runQuery(
      `UNWIND $rows AS row
       MATCH (l {id: row.lockfile_id}), (v {id: row.version_vertex})
       MERGE (l)-[:PINS]->(v)`,
      { params: { rows }, consistency: "strong" }
    )
  }

  return { lockfileId }
}

/**
 * Precomputes name-similarity ("typosquat") candidates for one package
 * against a corpus of other known package names, and stores them as
 * NAME_SIMILAR_TO edges — HydraDB's Cypher subset has no string-distance
 * functions, so this has to happen at ingest time (see similarity.ts).
 */
export async function ingestTyposquatEdges(
  ecosystem: Ecosystem,
  name: string,
  corpus: string[],
  maxDistance = 2
): Promise<number> {
  const candidates = findTyposquatCandidates(name, corpus, maxDistance)
  if (candidates.length === 0) return 0

  const pkgId = packageId(ecosystem, name)
  const rows = candidates.map((c) => ({
    source_vertex: pkgId,
    destination_vertex: packageId(ecosystem, c.name),
    distance: c.distance,
  }))

  await runQuery(
    `UNWIND $rows AS row
     MATCH (s {id: row.source_vertex}), (d {id: row.destination_vertex})
     MERGE (s)-[r:NAME_SIMILAR_TO]->(d)
     SET r.distance = row.distance`,
    { params: { rows }, consistency: "strong" }
  )
  return rows.length
}

/** Flags one package version compromised at a point in time (epoch ms). */
export async function markCompromised(
  ecosystem: Ecosystem,
  name: string,
  version: string,
  compromisedAt: number
): Promise<{ versionId: number }> {
  const vId = versionId(ecosystem, name, version)
  await runQuery(`MATCH (v {id: $versionId}) SET v.compromised = true, v.compromised_at = $compromisedAt`, {
    params: { versionId: vId, compromisedAt },
    consistency: "strong",
  })
  return { versionId: vId }
}
