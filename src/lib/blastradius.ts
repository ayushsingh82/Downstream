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

/**
 * `algo.SSpaths` never returns more than 1024 paths, whatever `pathCount` says.
 *
 * Measured against a live node: pathCount 100 → 100 paths, 1024 → 1024,
 * 2000 → 1024, 5000 → 1024. Asking for more than 100,000 is rejected outright
 * ("native_path_count rejected by admission control"), which reads as though
 * anything below that is honoured. It is not. A deep traversal also trips a
 * second limit — "client_cursor_buffer_bytes ... exceeds limit 67108864" — so
 * even the paths that fit under the cap can fail to come back.
 *
 * This is why blast radius cannot be one path call. The cap is silent: 1024
 * paths look like a complete answer, and on a graph with more dependents than
 * that, they are not.
 */
const SSPATHS_PATH_CAP = 1024

export interface ExposedService {
  serviceId: number
  serviceName: string
  /**
   * "lockfile" — the service's lockfile pins the compromised version outright,
   * found by the sub-second direct query. "closure" — only the upstream walk
   * found it, which means that lockfile does not record the dependency.
   */
  foundBy?: "lockfile" | "closure"
  /** Number of relationships between the compromised version and this service. */
  hops: number
  /** The chain, nearest-to-compromise first, as "Label:name" for display. */
  via: string[]
}

export interface BlastRadiusResult {
  /** Which traversal produced this result — the two differ in what they guarantee. */
  mode: "sspaths"
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
  // 1024 rather than 500: that is the engine's own ceiling (see SSPATHS_PATH_CAP),
  // so asking for less only truncates earlier without any saving worth having.
  const { maxLen = 8, pathCount = SSPATHS_PATH_CAP, consistency = "causal", bookmark } = options
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
    mode: "sspaths",
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
    // The id binds inside the pattern, not in a WHERE: the pattern form uses the
    // id index, the WHERE form scans the label. Same rows, 14x apart on a large
    // graph, and past a certain size the scanning form exceeds the 120s query
    // ceiling and returns nothing at all. Every id-keyed read here follows this.
    `MATCH (m:Maintainer)-[:MAINTAINS]->(p:Package {id: $pkgId})
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
      `MATCH (m:Maintainer {id: $maintainerId})-[:MAINTAINS]->(other:Package)
       WHERE other.id <> $pkgId
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
    `MATCH (l:Lockfile)-[:PINS]->(v:PackageVersion {id: $versionId})
     WHERE l.resolved_at >= $windowStart AND l.resolved_at <= $windowEnd
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
    `MATCH (p:Package {id: $pkgId})-[r:NAME_SIMILAR_TO]->(other:Package)
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


/* ------------------------------------------------------------------------- *
 * Exhaustive closure — the traversal that is allowed to say "this is all"    *
 * ------------------------------------------------------------------------- */

/** How many expansions are in flight at once. */
const FRONTIER_CONCURRENCY = Number(process.env.BLAST_CONCURRENCY ?? 24)

/**
 * Levels walked per expansion call.
 *
 * Measured on the 3,000-version load graph, full closure from the deepest hub:
 * depth 3 took 177s over 2,276 queries (7 of them capped and redone a level at a
 * time), depth 1 took 253s over 2,269 queries. Deeper calls return redundant
 * path prefixes, but the round trip dominates — the graph-node is fetching cold
 * vertices from the object store at roughly 100ms each, and fewer, fatter calls
 * win. Depth 3 also stays well clear of the 1024-path cap on this shape; on a
 * denser graph the cap retries would push the balance back towards 1.
 */
const DEFAULT_EXPAND_DEPTH = Number(process.env.BLAST_EXPAND_DEPTH ?? 3)

export interface ClosureStats {
  /** Services found by the direct lockfile lookup, before any traversal. */
  directHits: number
  /** Extra services only the upstream walk found — incomplete lockfiles. */
  closureOnlyHits: number
  /** ms to the first usable answer (the direct lookup). */
  directMs: number
  /** ms for the upstream closure on top of it. Zero when it was skipped. */
  closureMs: number
  /** Distinct vertices reached upstream of the compromise, all labels. */
  nodesReached: number
  /** Of those, PackageVersion vertices — the dependents proper. */
  versionsReached: number
  /** BFS rounds until the frontier emptied. */
  rounds: number
  /** Round trips issued. */
  queries: number
  /** Expansions that hit the 1024-path cap and were redone one level at a time. */
  capRetries: number
  /** Expansions that fell back to a row query because even one level exceeded the cap. */
  rowFallbacks: number
}

export interface ExhaustiveBlastRadius {
  mode: "exhaustive"
  sourceId: number
  exposedServices: ExposedService[]
  exposedProjects: { projectId: number; projectName: string; hops: number }[]
  paths: GraphPath[]
  pathCount: number
  /** Always false: every dependent is enumerated, so there is nothing to cap. */
  truncated: boolean
  closure: ClosureStats
  readEpoch?: number
}

/** Runs `fn` over `items` with a bounded number in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

interface Reached {
  id: number
  label: string
  name: string
  /** Hops from the compromised version. */
  distance: number
}

interface Expansion {
  reached: Reached[]
  queries: number
  capRetries: number
  rowFallbacks: number
}

function nodeName(node: PathNode): string {
  const props = node.properties
  if (typeof props.name === "string") return props.name
  if (typeof props.version === "string") return props.version
  return String(node.id)
}

/**
 * Walks upstream from one vertex and returns everything reached, with distance.
 *
 * `relDirection: 'incoming'` is what makes this a reverse closure that stays
 * reverse. The obvious `'both'` also finds dependents, but it walks back *down*
 * through each one's other dependencies as well, so the traversal fans out over
 * the whole graph and blows the 64MB cursor buffer at depth 6. Incoming-only
 * follows exactly the direction exposure travels: dependent → dependency,
 * lockfile → version, project → lockfile, service → project, all read backwards.
 *
 * Three strategies, in cost order. The fast one is tried first and its result is
 * used only when it is provably complete — a call that comes back holding
 * exactly 1024 paths is treated as truncated, never as an answer.
 */
async function expandUpstream(
  from: Reached,
  depth: number,
  options: { consistency?: Consistency; bookmark?: string }
): Promise<Expansion> {
  const { consistency = "causal", bookmark } = options

  const call = async (maxLen: number) => {
    const { rows } = await runQuery<{ path: GraphPath }>(
      `CALL algo.SSpaths({sourceNode: $id, relTypes: ${CLOSURE_REL_TYPES},
                          relDirection: 'incoming', maxLen: $maxLen, pathCount: $pathCount})
       YIELD path RETURN path`,
      {
        params: { id: from.id, maxLen, pathCount: SSPATHS_PATH_CAP },
        consistency,
        bookmark,
      }
    )
    return rows.map((row) => row.path).filter(Boolean)
  }

  const collect = (paths: GraphPath[]): Reached[] => {
    const found = new Map<number, Reached>()
    for (const path of paths) {
      // SSpaths returns the source first, so position in the path is hop count.
      path.nodes.forEach((node, index) => {
        if (index === 0) return
        const existing = found.get(node.id)
        const distance = from.distance + index
        if (existing && existing.distance <= distance) return
        found.set(node.id, {
          id: node.id,
          label: node.labels[0] ?? "Node",
          name: nodeName(node),
          distance,
        })
      })
    }
    return [...found.values()]
  }

  let queries = 0
  let capRetries = 0
  let rowFallbacks = 0

  if (depth > 1) {
    const paths = await call(depth)
    queries++
    if (paths.length < SSPATHS_PATH_CAP) {
      return { reached: collect(paths), queries, capRetries, rowFallbacks }
    }
    capRetries++
  }

  const oneLevel = await call(1)
  queries++
  if (oneLevel.length < SSPATHS_PATH_CAP) {
    return { reached: collect(oneLevel), queries, capRetries, rowFallbacks }
  }

  // More than 1024 direct dependents — the `debug`/`ms` tier. A row query has no
  // path cap, and binding the id *inside the pattern* rather than in a WHERE is
  // what keeps it from degrading into a scan: measured on the same vertex,
  // `WHERE dep.id = $id` took 29s where `(dep {id: $id})` took 2.3s.
  rowFallbacks++
  const { rows } = await runQuery<{ id: number; label: string; name: string }>(
    `MATCH (dep:PackageVersion {id: $id})<-[:RESOLVES_TO]-(dependent:PackageVersion)
     RETURN DISTINCT dependent.id AS id, dependent.version AS name`,
    { params: { id: from.id }, consistency, bookmark }
  )
  queries++
  return {
    reached: rows.map((row) => ({
      id: Number(row.id),
      label: "PackageVersion",
      name: String(row.name ?? row.id),
      distance: from.distance + 1,
    })),
    queries,
    capRetries,
    rowFallbacks,
  }
}

/**
 * Blast radius with no silent truncation.
 *
 * A single `algo.SSpaths` call cannot answer this question on a real graph: it
 * returns every *prefix* of every chain, and it stops at 1024 paths whatever you
 * ask for, so on anything larger than a demo the answer is a sample presented as
 * a set. During an incident that is the most expensive kind of wrong — a service
 * that never appears in the output is a service nobody patches.
 *
 * So the closure is enumerated instead, breadth-first, using the native path
 * procedure as the expansion primitive (`maxLen` levels at a time, incoming
 * only) and falling back a level at a time whenever a call comes back capped.
 * Every vertex is visited once, so the cost is O(reached vertices) rather than
 * O(paths), and completeness is a property of the algorithm rather than of the
 * budget. `algo.SPpaths` then produces the display chain per exposed service —
 * bounded work against a target already known to be exposed, where the cap
 * cannot hide anything.
 */
export async function getExhaustiveBlastRadius(
  ecosystem: Ecosystem,
  name: string,
  version: string,
  options: {
    maxDepth?: number
    expandDepth?: number
    /** Return the direct-lockfile answer only, skipping the upstream walk. */
    skipClosure?: boolean
    /** How many exposed services get a drawn chain. The set itself is never capped. */
    chainLimit?: number
    consistency?: Consistency
    bookmark?: string
  } = {}
): Promise<ExhaustiveBlastRadius> {
  const {
    maxDepth = 24,
    expandDepth = DEFAULT_EXPAND_DEPTH,
    skipClosure = false,
    chainLimit = 25,
    consistency = "causal",
    bookmark,
  } = options
  const sourceId = versionId(ecosystem, name, version)

  const seen = new Map<number, Reached>()
  let frontier: Reached[] = [
    { id: sourceId, label: "PackageVersion", name: `${name}@${version}`, distance: 0 },
  ]
  seen.set(sourceId, frontier[0])

  const stats: ClosureStats = {
    directHits: 0,
    closureOnlyHits: 0,
    directMs: 0,
    closureMs: 0,
    nodesReached: 0,
    versionsReached: 0,
    rounds: 0,
    queries: 0,
    capRetries: 0,
    rowFallbacks: 0,
  }

  // Pass 1 — the answer an on-call engineer gets in the first second.
  //
  // A lockfile records the *whole* resolved tree, transitive dependencies
  // included, which is exactly what makes this one query rather than a
  // traversal: if a service installed the compromised version, its lockfile
  // pins it by name whether or not any manifest mentions it. Measured on the
  // 3,000-version load graph, this returns all 20 exposed services in 740ms,
  // where the full upstream closure over the same graph takes four minutes and
  // finds the same 20.
  const directStart = Date.now()
  const { rows: directRows } = await runQuery<{
    sid: number
    sname: string
    pid: number
    pname: string
  }>(
    `MATCH (v:PackageVersion {id: $id})<-[:PINS]-(l:Lockfile)<-[:HAS_LOCKFILE]-(p:Project)<-[:RUNS]-(s:Service)
     RETURN DISTINCT s.id AS sid, s.name AS sname, p.id AS pid, p.name AS pname`,
    { params: { id: sourceId }, consistency, bookmark }
  )
  stats.directMs = Date.now() - directStart
  stats.queries++
  stats.directHits = directRows.length

  const direct = new Map<number, Reached>()
  for (const row of directRows) {
    direct.set(Number(row.sid), {
      id: Number(row.sid),
      label: "Service",
      name: String(row.sname),
      distance: 3,
    })
    const projectId = Number(row.pid)
    if (!seen.has(projectId)) {
      seen.set(projectId, {
        id: projectId,
        label: "Project",
        name: String(row.pname),
        distance: 2,
      })
    }
  }
  for (const [id, node] of direct) if (!seen.has(id)) seen.set(id, node)

  // Pass 2 — completeness. The direct lookup is only as good as the lockfiles:
  // a project ingested from a manifest rather than a lockfile, or a lockfile
  // that predates the dependency being pulled in, leaves an exposure the PINS
  // edge does not record. The upstream walk finds those, at a cost proportional
  // to how many versions depend on the compromised one.
  const closureStart = Date.now()

  while (skipClosure === false && frontier.length > 0 && stats.rounds < maxDepth) {
    // A Service is the top of the chain — nothing points at it, so expanding one
    // is a guaranteed-empty round trip.
    const expandable = frontier.filter((node) => node.label !== "Service")

    const expansions = await mapLimit(expandable, FRONTIER_CONCURRENCY, (node) =>
      expandUpstream(node, expandDepth, { consistency, bookmark })
    )

    const next: Reached[] = []
    for (const expansion of expansions) {
      stats.queries += expansion.queries
      stats.capRetries += expansion.capRetries
      stats.rowFallbacks += expansion.rowFallbacks

      for (const node of expansion.reached) {
        const existing = seen.get(node.id)
        if (existing) {
          if (node.distance < existing.distance) existing.distance = node.distance
          continue
        }
        seen.set(node.id, node)
        next.push(node)
      }
    }

    stats.rounds++
    frontier = next
  }

  stats.closureMs = skipClosure ? 0 : Date.now() - closureStart
  stats.nodesReached = seen.size
  stats.versionsReached = [...seen.values()].filter((n) => n.label === "PackageVersion").length
  stats.closureOnlyHits = [...seen.values()].filter(
    (node) => node.label === "Service" && !direct.has(node.id)
  ).length

  const services = [...seen.values()].filter((node) => node.label === "Service")
  const projects = [...seen.values()]
    .filter((node) => node.label === "Project")
    .map((node) => ({ projectId: node.id, projectName: node.name, hops: node.distance }))
    .sort((a, b) => a.hops - b.hops)

  // The chain to show an on-call engineer, computed by the database. Capped:
  // one shortest-path call per service is bounded work, but a thousand exposed
  // services is a thousand of them, and nobody reads chain nine hundred. The
  // exposed set itself is never capped — only the drawn explanation.
  const paths: GraphPath[] = []
  const withChains = services.slice(0, chainLimit)
  const withoutChains = services.slice(chainLimit).map((service) => ({
    serviceId: service.id,
    serviceName: service.name,
    foundBy: (direct.has(service.id) ? "lockfile" : "closure") as "lockfile" | "closure",
    hops: service.distance,
    via: [] as string[],
  }))
  const exposedServices = await mapLimit(withChains, 8, async (service) => {
    const foundBy: "lockfile" | "closure" = direct.has(service.id) ? "lockfile" : "closure"
    const { rows } = await runQuery<{ path: GraphPath }>(
      // 'outgoing', not 'both': every stored edge on this chain already points
      // from the service towards the dependency (RUNS → HAS_LOCKFILE → PINS →
      // RESOLVES_TO), so the shortest path is a strictly forward walk. Letting
      // it go both ways explores the reverse fan-out too and costs 9.1s a chain
      // where the directed form costs 1.7s, for the identical path.
      `CALL algo.SPpaths({sourceNode: $serviceId, targetNode: $targetId,
                          relTypes: ${CLOSURE_REL_TYPES}, relDirection: 'outgoing',
                          maxLen: $maxLen, pathCount: 1})
       YIELD path RETURN path`,
      {
        params: { serviceId: service.id, targetId: sourceId, maxLen: service.distance + 2 },
        consistency,
      }
    )
    const path = rows[0]?.path
    if (path) paths.push(path)
    return {
      serviceId: service.id,
      serviceName: service.name,
      foundBy,
      hops: path ? path.relationships.length : service.distance,
      // SPpaths runs service → … → compromised version; the console reads
      // outward from the compromise, so reverse and drop the source itself.
      via: path ? path.nodes.slice(0, -1).reverse().map(displayName) : [],
    }
  })
  stats.queries += withChains.length

  return {
    mode: "exhaustive",
    sourceId,
    exposedServices: [...exposedServices, ...withoutChains].sort((a, b) => a.hops - b.hops),
    exposedProjects: projects,
    paths,
    pathCount: paths.length,
    truncated: false,
    closure: stats,
  }
}

export type BlastRadiusMode = "exhaustive" | "sspaths"
export type AnyBlastRadius = ExhaustiveBlastRadius | BlastRadiusResult

/**
 * The blast-radius entry point every caller should use.
 *
 * `exhaustive` is the default because an incident answer that silently omits an
 * exposed service is worse than a slower one. `sspaths` is kept because it is
 * the one-native-call version, and because running both is how the cap is
 * demonstrated rather than asserted (scripts/scale-check.mjs prints the
 * difference on a graph big enough to show it).
 */
export async function blastRadius(
  ecosystem: Ecosystem,
  name: string,
  version: string,
  options: {
    mode?: BlastRadiusMode
    maxLen?: number
    pathCount?: number
    expandDepth?: number
    skipClosure?: boolean
    consistency?: Consistency
    bookmark?: string
  } = {}
): Promise<AnyBlastRadius> {
  const { mode = "exhaustive", expandDepth, skipClosure, ...rest } = options
  return mode === "sspaths"
    ? getBlastRadius(ecosystem, name, version, rest)
    : getExhaustiveBlastRadius(ecosystem, name, version, {
        expandDepth,
        skipClosure,
        consistency: rest.consistency,
        bookmark: rest.bookmark,
      })
}

export interface GraphVersionRow {
  versionId: number
  name: string
  ecosystem: string
  version: string
}

/**
 * The package versions currently in the graph, for scanning against an advisory
 * feed. `LIMIT` is mandatory rather than optional: this is the one query in the
 * app whose result set grows with the whole registry.
 */
export async function listGraphVersions(limit = 500): Promise<GraphVersionRow[]> {
  const { rows } = await runQuery<GraphVersionRow>(
    `MATCH (p:Package)-[:HAS_VERSION]->(v:PackageVersion)
     RETURN v.id AS versionId, p.name AS name, p.ecosystem AS ecosystem, v.version AS version
     LIMIT $limit`,
    { params: { limit } }
  )
  return rows
}
