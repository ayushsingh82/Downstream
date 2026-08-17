import { runQuery, type GraphPath, type PathNode, type Consistency } from "./hydradb"
import { versionId, packageId, projectId } from "./ingest"
import type { Ecosystem } from "./depsdev"

/**
 * The relationship types that make up an exposure chain:
 *
 *   PackageVersion -RESOLVES_TO-> PackageVersion   (resolved dependency)
 *   Lockfile       -PINS->        PackageVersion   (what actually got installed)
 *   Project        -HAS_LOCKFILE-> Lockfile
 *   Service        -RUNS->        Project
 *
 * These are inlined as a literal array in every procedure call rather than
 * passed as a parameter. That is not a style choice: `relTypes: $relTypes` is
 * rejected by the node with "composite parameter $relTypes is only supported as
 * an UNWIND input". Scalar config values ($sourceNode, $maxLen, $pathCount) are
 * fine as parameters — only the list has to be literal.
 */
const CLOSURE_REL_TYPES = "['RESOLVES_TO','PINS','HAS_LOCKFILE','RUNS']"

export interface ExposedService {
  serviceId: number
  serviceName: string
  /** Number of relationships between the compromised version and this service. */
  hops: number
  /** The chain, nearest-to-compromise first, as "Label:name" for display. */
  via: string[]
}

export interface BlastRadiusResult {
  sourceId: number
  /** Distinct services reachable from the compromised version, closest first. */
  exposedServices: ExposedService[]
  /** Every distinct project touched, whether or not a Service node runs it. */
  exposedProjects: { projectId: number; projectName: string; hops: number }[]
  /** Raw paths, for the UI's graph view. */
  paths: GraphPath[]
  pathCount: number
  /**
   * True when the traversal returned exactly `pathCount` paths, meaning the cap
   * was reached and there may be exposures beyond it. Silently truncating here
   * would read as "these are all the affected services", which during an
   * incident is the most expensive kind of wrong.
   */
  truncated: boolean
  readEpoch?: number
}

function labelOf(node: PathNode): string {
  return node.labels[0] ?? "Node"
}

function displayName(node: PathNode): string {
  const props = node.properties
  const label = labelOf(node)

  if (label === "Lockfile" && typeof props.resolved_at === "number") {
    return `Lockfile:${new Date(props.resolved_at).toISOString().slice(0, 16).replace("T", " ")}`
  }
  return `${label}:${props.name ?? props.version ?? node.id}`
}

/**
 * Traces the reverse-dependency closure from one compromised package version
 * out to every exposed service, in a single native call.
 *
 * `algo.SSpaths` (paths from one source) is the right procedure for a single
 * compromise event — plan.md originally sketched `algo.MSpaths`, which is for
 * fanning several sources against one target set at once. `relDirection:'both'`
 * is what makes this a *reverse* closure: the stored edges point downstream
 * (dependent → dependency, lockfile → version), and exposure runs the other
 * way, so the traversal has to walk them against their direction.
 */
export async function getBlastRadius(
  ecosystem: Ecosystem,
  name: string,
  version: string,
  options: { maxLen?: number; pathCount?: number; consistency?: Consistency; bookmark?: string } = {}
): Promise<BlastRadiusResult> {
  const { maxLen = 8, pathCount = 500, consistency = "causal", bookmark } = options
  const sourceId = versionId(ecosystem, name, version)

  const { rows, readEpoch } = await runQuery<{ path: GraphPath }>(
    `CALL algo.SSpaths({sourceNode: $sourceId, relTypes: ${CLOSURE_REL_TYPES},
                        relDirection: 'both', maxLen: $maxLen, pathCount: $pathCount})
     YIELD path RETURN path`,
    { params: { sourceId, maxLen, pathCount }, consistency, bookmark }
  )

  const paths = rows.map((row) => row.path).filter(Boolean)

  // One traversal returns every prefix of every chain, so the same service shows
  // up on many paths. Keep the shortest chain per service — that's the one worth
  // showing an on-call engineer.
  const services = new Map<number, ExposedService>()
  const projects = new Map<number, { projectId: number; projectName: string; hops: number }>()

  for (const path of paths) {
    const terminal = path.nodes[path.nodes.length - 1]
    if (!terminal) continue
    const hops = path.relationships.length
    const via = path.nodes.slice(1).map(displayName)

    if (labelOf(terminal) === "Service") {
      const existing = services.get(terminal.id)
      if (!existing || hops < existing.hops) {
        services.set(terminal.id, {
          serviceId: terminal.id,
          serviceName: String(terminal.properties.name ?? terminal.id),
          hops,
          via,
        })
      }
    }

    for (const node of path.nodes) {
      if (labelOf(node) !== "Project") continue
      const seen = projects.get(node.id)
      if (!seen || hops < seen.hops) {
        projects.set(node.id, {
          projectId: node.id,
          projectName: String(node.properties.name ?? node.id),
          hops,
        })
      }
    }
  }

  return {
    sourceId,
    exposedServices: [...services.values()].sort((a, b) => a.hops - b.hops),
    exposedProjects: [...projects.values()].sort((a, b) => a.hops - b.hops),
    paths,
    pathCount: paths.length,
    truncated: paths.length >= pathCount,
    readEpoch,
  }
}

export interface ExposureExplanation {
  hops: number
  weight?: number
  cost?: number
  chain: string[]
  path: GraphPath
}

/**
 * Explains one specific exposure: the shortest chain from a project back to the
 * compromised version. This is the "why am I affected" answer — `algo.SPpaths`
 * returns whole paths with weights, which a plain MATCH cannot do (it projects
 * endpoints only).
 */
export async function explainExposure(
  ecosystem: Ecosystem,
  name: string,
  version: string,
  projectName: string,
  maxLen = 8
): Promise<ExposureExplanation[]> {
  const targetId = versionId(ecosystem, name, version)
  const sourceId = projectId(projectName)

  const { rows } = await runQuery<{ path: GraphPath; pathWeight?: number; pathCost?: number }>(
    `CALL algo.SPpaths({sourceNode: $sourceId, targetNode: $targetId, relTypes: ${CLOSURE_REL_TYPES},
                        relDirection: 'both', maxLen: $maxLen, pathCount: 5})
     YIELD path, pathWeight, pathCost
     RETURN path, pathWeight, pathCost`,
    { params: { sourceId, targetId, maxLen } }
  )

  return rows
    .filter((row) => row.path)
    .map((row) => ({
      hops: row.path.relationships.length,
      weight: row.pathWeight,
      cost: row.pathCost,
      chain: row.path.nodes.map(displayName),
      path: row.path,
    }))
}

export interface MaintainerRow {
  id: number
  name: string
}

/** Every maintainer of a package. */
export async function getMaintainers(ecosystem: Ecosystem, name: string): Promise<MaintainerRow[]> {
  const pkgId = packageId(ecosystem, name)
  const { rows } = await runQuery<MaintainerRow>(
    `MATCH (m:Maintainer)-[:MAINTAINS]->(p:Package) WHERE p.id = $pkgId
     RETURN DISTINCT m.id AS id, m.name AS name`,
    { params: { pkgId } }
  )
  return rows
}

export interface SharedPackageRow {
  id: number
  name: string
  ecosystem: string
  viaMaintainer: string
}

/**
 * Other packages sharing at least one maintainer with the given package — the
 * "if this account was taken over, what else could they have published" pivot.
 *
 * This is a query per maintainer rather than one query, because HydraDB has no
 * `IN` operator, so a set membership test over maintainer ids isn't expressible
 * in a single WHERE.
 */
export async function getSharedMaintainerPackages(
  ecosystem: Ecosystem,
  name: string
): Promise<SharedPackageRow[]> {
  const pkgId = packageId(ecosystem, name)
  const maintainers = await getMaintainers(ecosystem, name)

  const results = new Map<number, SharedPackageRow>()
  for (const maintainer of maintainers) {
    const { rows } = await runQuery<Omit<SharedPackageRow, "viaMaintainer">>(
      `MATCH (m:Maintainer)-[:MAINTAINS]->(other:Package)
       WHERE m.id = $maintainerId AND other.id <> $pkgId
       RETURN other.id AS id, other.name AS name, other.ecosystem AS ecosystem`,
      { params: { maintainerId: maintainer.id, pkgId } }
    )
    for (const row of rows) {
      if (!results.has(row.id)) results.set(row.id, { ...row, viaMaintainer: maintainer.name })
    }
  }
  return [...results.values()]
}

export interface LiveWindowLockfileRow {
  id: number
  projectId: number
  resolvedAt: number
}

/** Lockfiles that resolved to the compromised version while it was live. */
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

/** Name-similarity neighbours precomputed at ingest time (see similarity.ts). */
export async function getTyposquatCandidates(
  ecosystem: Ecosystem,
  name: string
): Promise<TyposquatRow[]> {
  const pkgId = packageId(ecosystem, name)
  const { rows } = await runQuery<TyposquatRow>(
    `MATCH (p:Package)-[r:NAME_SIMILAR_TO]->(other:Package) WHERE p.id = $pkgId
     RETURN other.id AS id, other.name AS name, r.distance AS distance
     ORDER BY distance`,
    { params: { pkgId } }
  )
  return rows
}

export interface GraphStats {
  packages: number
  versions: number
  services: number
}

/** Counts for the demo UI's header, one aggregate query per label. */
export async function getGraphStats(): Promise<GraphStats> {
  const count = async (label: string) => {
    const { rows } = await runQuery<{ total: number }>(
      `MATCH (n:${label}) RETURN count(*) AS total`
    )
    return Number(rows[0]?.total ?? 0)
  }
  const [packages, versions, services] = await Promise.all([
    count("Package"),
    count("PackageVersion"),
    count("Service"),
  ])
  return { packages, versions, services }
}
