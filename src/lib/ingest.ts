import { HydraSession } from "./hydradb"
import { stableId } from "./id"
import { getDependencyGraph, getVersionInfo, type Ecosystem } from "./depsdev"
import { getRegistryMeta } from "./registry"
import { findTyposquatCandidates } from "./similarity"
import { getRepoIdentities, parseGithubUrl } from "./github"
import { writeVertices, writeEdges, chunk, type VertexRow, type EdgeRow } from "./graphwrite"

export function packageId(ecosystem: Ecosystem, name: string): number {
  return stableId(`pkg:${ecosystem}:${name}`)
}

export function versionId(ecosystem: Ecosystem, name: string, version: string): number {
  return stableId(`pkgver:${ecosystem}:${name}@${version}`)
}

export function projectId(name: string): number {
  return stableId(`project:${name}`)
}

export function serviceId(name: string): number {
  return stableId(`service:${name}`)
}

export interface IngestSubtreeResult {
  packagesIngested: number
  versionsIngested: number
  edgesIngested: number
  maintainersIngested: number
  bookmark?: string
}

/**
 * Pulls the resolved (not just declared) dependency graph for one package
 * version from deps.dev, plus registry maintainer metadata for the root
 * package, and batch-loads it into HydraDB.
 *
 * deps.dev returns a node list plus edges indexed into it, which is already the
 * shape we want: the edges are between concrete resolved versions, so they
 * become PackageVersion→PackageVersion RESOLVES_TO edges directly. Declared
 * semver ranges alone could not answer "what actually got installed."
 */
export async function ingestPackageSubtree(
  ecosystem: Ecosystem,
  name: string,
  version: string
): Promise<IngestSubtreeResult> {
  const graph = await getDependencyGraph(ecosystem, name, version)
  const session = new HydraSession()

  const nodeIdByIndex = graph.nodes.map((n) =>
    versionId(ecosystem, n.versionKey.name, n.versionKey.version)
  )

  const packageRows = new Map<number, VertexRow>()
  const versionRows = new Map<number, VertexRow>()
  const hasVersionEdges = new Map<string, EdgeRow>()

  for (const node of graph.nodes) {
    const pkgId = packageId(ecosystem, node.versionKey.name)
    const verId = versionId(ecosystem, node.versionKey.name, node.versionKey.version)

    packageRows.set(pkgId, { vertex: pkgId, name: node.versionKey.name, ecosystem })
    versionRows.set(verId, {
      vertex: verId,
      package_id: pkgId,
      version: node.versionKey.version,
      compromised: false,
      compromised_at: 0,
    })
    hasVersionEdges.set(`${pkgId}:${verId}`, { from: pkgId, to: verId })
  }

  for (const batch of chunk([...packageRows.values()])) {
    await writeVertices(session, "Package", batch)
  }
  for (const batch of chunk([...versionRows.values()])) {
    await writeVertices(session, "PackageVersion", batch)
  }
  for (const batch of chunk([...hasVersionEdges.values()])) {
    await writeEdges(session, "Package", "HAS_VERSION", "PackageVersion", batch)
  }

  // deps.dev's edge list can name the same (from, to) pair more than once when
  // a dependency is reached by several requirement strings; collapse them so
  // one edge carries one requirement rather than issuing redundant writes.
  const resolvesEdges = new Map<string, EdgeRow>()
  for (const edge of graph.edges) {
    const from = nodeIdByIndex[edge.fromNode]
    const to = nodeIdByIndex[edge.toNode]
    if (from === undefined || to === undefined) continue
    resolvesEdges.set(`${from}:${to}`, { from, to, requirement: edge.requirement ?? "" })
  }

  let edgesIngested = 0
  for (const batch of chunk([...resolvesEdges.values()])) {
    edgesIngested += await writeEdges(
      session,
      "PackageVersion",
      "RESOLVES_TO",
      "PackageVersion",
      batch
    )
  }

  const maintainersIngested = await ingestMaintainers(ecosystem, name, session)

  return {
    packagesIngested: packageRows.size,
    versionsIngested: versionRows.size,
    edgesIngested,
    maintainersIngested,
    bookmark: session.lastBookmark,
  }
}

/** Fetches registry maintainer data for one package and links it into the graph. */
export async function ingestMaintainers(
  ecosystem: Ecosystem,
  name: string,
  existing?: HydraSession
): Promise<number> {
  const session = existing ?? new HydraSession()
  const meta = await getRegistryMeta(ecosystem, name)
  const pkgId = packageId(ecosystem, name)

  if (meta.maintainers.length === 0) return 0

  const vertexRows: VertexRow[] = meta.maintainers.map((m) => ({
    vertex: stableId(`maintainer:${ecosystem}:${m.name}`),
    name: m.name,
    email: m.email ?? "",
  }))
  const edgeRows: EdgeRow[] = vertexRows.map((row) => ({ from: row.vertex, to: pkgId }))

  await writeVertices(session, "Maintainer", vertexRows)
  await writeEdges(session, "Maintainer", "MAINTAINS", "Package", edgeRows)

  return vertexRows.length
}

export interface GithubIdentityResult {
  /** "owner/repo" as GitHub reports it, or null when there is no GitHub source. */
  repo: string | null
  identitiesIngested: number
  /** Registry maintainers whose handle matches a GitHub login exactly. */
  overlappingHandles: string[]
}

/**
 * Links the GitHub identities behind a package into the graph.
 *
 * The registry says who can publish; the repository says who can merge. Storing
 * both against the same Package is what makes the shared-maintainer pivot
 * ("this account was taken over — what else could they reach") span the two
 * name spaces instead of stopping at the registry's edge.
 *
 * Identities are stored as `Maintainer` with a `source` property rather than as
 * a separate label, so the existing pivot query picks them up unchanged. Where
 * an npm handle and a GitHub login are byte-identical they are reported as
 * overlapping — that is a hint for a human, not a claim that two accounts are
 * one person. Real identity resolution is not solved here.
 */
export async function ingestGithubIdentities(
  ecosystem: Ecosystem,
  name: string,
  version: string,
  existing?: HydraSession
): Promise<GithubIdentityResult> {
  const info = await getVersionInfo(ecosystem, name, version)
  const sourceRepo = info.links?.find((link) => link.label === "SOURCE_REPO")
  const ref = parseGithubUrl(sourceRepo?.url)
  if (!ref) return { repo: null, identitiesIngested: 0, overlappingHandles: [] }

  const { identities, fullName } = await getRepoIdentities(ref)
  if (identities.length === 0) return { repo: fullName, identitiesIngested: 0, overlappingHandles: [] }

  const session = existing ?? new HydraSession()
  const pkgId = packageId(ecosystem, name)

  const vertexRows: VertexRow[] = identities.map((identity) => ({
    vertex: stableId(`maintainer:github:${identity.login}`),
    name: identity.login,
    email: "",
    source: "github",
    role: identity.role,
    contributions: identity.contributions,
  }))

  await writeVertices(session, "Maintainer", vertexRows)
  await writeVertices(session, "Package", [
    { vertex: pkgId, name, ecosystem, repo: fullName },
  ])
  await writeEdges(
    session,
    "Maintainer",
    "MAINTAINS",
    "Package",
    vertexRows.map((row) => ({ from: row.vertex, to: pkgId }))
  )

  const registry = await getRegistryMeta(ecosystem, name).catch(() => null)
  const registryHandles = new Set((registry?.maintainers ?? []).map((m) => m.name.toLowerCase()))
  const overlappingHandles = identities
    .map((identity) => identity.login)
    .filter((login) => registryHandles.has(login.toLowerCase()))

  return { repo: fullName, identitiesIngested: identities.length, overlappingHandles }
}

export interface LockfileEntry {
  name: string
  version: string
}

/**
 * Registers the consuming side of the graph: a Service that runs a Project,
 * whose Lockfile pins specific resolved versions. The Service layer is what
 * makes the blast-radius answer operational — "which of our services is
 * exposed" rather than "which of our repos."
 */
export async function ingestService(
  serviceName: string,
  projectName: string,
  ecosystem: Ecosystem,
  entries: LockfileEntry[],
  resolvedAt: number
): Promise<{ serviceId: number; projectId: number; lockfileId: number; pinned: number }> {
  const session = new HydraSession()

  const svcId = serviceId(serviceName)
  const projId = projectId(projectName)
  const lockfileId = stableId(`lockfile:${projectName}:${resolvedAt}`)

  await writeVertices(session, "Service", [{ vertex: svcId, name: serviceName }])
  await writeVertices(session, "Project", [{ vertex: projId, name: projectName }])
  await writeVertices(session, "Lockfile", [
    { vertex: lockfileId, project_id: projId, resolved_at: resolvedAt },
  ])

  await writeEdges(session, "Service", "RUNS", "Project", [{ from: svcId, to: projId }])
  await writeEdges(session, "Project", "HAS_LOCKFILE", "Lockfile", [
    { from: projId, to: lockfileId },
  ])

  // A lockfile can only pin versions that exist as vertices — the UNWIND edge
  // form MATCHes both endpoints, so an entry for a version we never ingested is
  // silently skipped rather than creating a dangling node. Count what landed.
  const pinRows: EdgeRow[] = entries.map((e) => ({
    from: lockfileId,
    to: versionId(ecosystem, e.name, e.version),
  }))
  let pinned = 0
  for (const batch of chunk(pinRows)) {
    pinned += await writeEdges(session, "Lockfile", "PINS", "PackageVersion", batch)
  }

  return { serviceId: svcId, projectId: projId, lockfileId, pinned }
}

/**
 * Precomputes name-similarity ("typosquat") candidates for one package against
 * a corpus of other known package names, stored as NAME_SIMILAR_TO edges.
 * HydraDB's WHERE has no string-distance or substring operators at all — no
 * CONTAINS, no ENDS WITH — so this cannot be a query-time computation.
 */
export async function ingestTyposquatEdges(
  ecosystem: Ecosystem,
  name: string,
  corpus: string[],
  maxDistance = 2
): Promise<number> {
  const candidates = findTyposquatCandidates(name, corpus, maxDistance)
  if (candidates.length === 0) return 0

  const session = new HydraSession()
  const pkgId = packageId(ecosystem, name)

  // Candidates must exist as Package vertices for the edge MATCH to bind.
  const vertexRows: VertexRow[] = candidates.map((c) => ({
    vertex: packageId(ecosystem, c.name),
    name: c.name,
    ecosystem,
  }))
  await writeVertices(session, "Package", vertexRows)

  const edgeRows: EdgeRow[] = candidates.map((c) => ({
    from: pkgId,
    to: packageId(ecosystem, c.name),
    distance: c.distance,
  }))

  let written = 0
  for (const batch of chunk(edgeRows)) {
    written += await writeEdges(session, "Package", "NAME_SIMILAR_TO", "Package", batch)
  }
  return written
}

/**
 * Flags one package version compromised at a point in time (epoch ms).
 * MATCH-then-SET is the one mutation form that works on an existing vertex
 * without going through UNWIND. Note that it returns 200 with no rows when
 * nothing matched, so we confirm the version exists first — otherwise
 * "compromise express@9.9.9" would look like it succeeded.
 */
export async function markCompromised(
  ecosystem: Ecosystem,
  name: string,
  version: string,
  compromisedAt: number
): Promise<{ versionId: number; bookmark?: string }> {
  const vId = versionId(ecosystem, name, version)
  const session = new HydraSession("strong")

  const { rows } = await session.run<{ id: number }>(
    `MATCH (v:PackageVersion) WHERE v.id = $versionId RETURN v.id AS id`,
    { versionId: vId }
  )
  if (rows.length === 0) {
    throw new Error(
      `${ecosystem}:${name}@${version} is not in the graph — ingest it before marking it compromised`
    )
  }

  await session.run(
    `MATCH (v {id: $versionId}) SET v.compromised = true, v.compromised_at = $compromisedAt`,
    { versionId: vId, compromisedAt }
  )

  return { versionId: vId, bookmark: session.lastBookmark }
}
