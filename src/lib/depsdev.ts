/**
 * Client for the deps.dev v3 API (https://docs.deps.dev/api/v3/).
 * Response shapes verified live against api.deps.dev, e.g.:
 *   GET /v3/systems/npm/packages/express/versions/4.19.2:dependencies
 *   -> { nodes: [{ versionKey: {system,name,version}, bundled, relation, errors }],
 *        edges: [{ fromNode, toNode, requirement }] }
 */

export type Ecosystem = "npm" | "pypi"

const SYSTEM_MAP: Record<Ecosystem, string> = { npm: "NPM", pypi: "PYPI" }

const BASE_URL = "https://api.deps.dev/v3"

export interface DepsDevVersionKey {
  system: string
  name: string
  version: string
}

export interface DepsDevNode {
  versionKey: DepsDevVersionKey
  bundled: boolean
  relation: "SELF" | "DIRECT" | "INDIRECT"
  errors: string[]
}

export interface DepsDevEdge {
  fromNode: number
  toNode: number
  requirement: string
}

export interface DepsDevDependencyGraph {
  nodes: DepsDevNode[]
  edges: DepsDevEdge[]
  error?: string
}

/** Resolved (not just declared) transitive dependency graph for one package version. */
export async function getDependencyGraph(
  ecosystem: Ecosystem,
  name: string,
  version: string
): Promise<DepsDevDependencyGraph> {
  const system = SYSTEM_MAP[ecosystem]
  const url = `${BASE_URL}/systems/${system}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}:dependencies`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) {
    throw new Error(`deps.dev dependency graph request failed (${res.status}) for ${ecosystem}/${name}@${version}`)
  }
  return res.json()
}

export interface DepsDevPackageInfo {
  packageKey: { system: string; name: string }
  versions: { versionKey: DepsDevVersionKey; publishedAt?: string; isDefault?: boolean }[]
}

/** Package metadata, including all known versions. */
export interface DepsDevLink {
  label: string
  url: string
}

export interface DepsDevVersionInfo {
  versionKey: DepsDevVersionKey
  publishedAt?: string
  links?: DepsDevLink[]
}

/**
 * GET /v3/systems/{system}/packages/{name}/versions/{version} — per-version
 * metadata. The useful part here is `links`, which carries a `SOURCE_REPO`
 * entry pointing at the forge; that is what connects a published package to the
 * repository whose contributors can change it.
 */
export async function getVersionInfo(
  ecosystem: Ecosystem,
  name: string,
  version: string
): Promise<DepsDevVersionInfo> {
  const system = SYSTEM_MAP[ecosystem]
  const url = `${BASE_URL}/systems/${system}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) {
    throw new Error(
      `deps.dev version info request failed (${res.status}) for ${ecosystem}/${name}@${version}`
    )
  }
  return res.json()
}

export async function getPackageInfo(ecosystem: Ecosystem, name: string): Promise<DepsDevPackageInfo> {
  const system = SYSTEM_MAP[ecosystem]
  const url = `${BASE_URL}/systems/${system}/packages/${encodeURIComponent(name)}`
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) {
    throw new Error(`deps.dev package info request failed (${res.status}) for ${ecosystem}/${name}`)
  }
  return res.json()
}
