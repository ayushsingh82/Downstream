import type { Ecosystem } from "./depsdev"

export interface RegistryMaintainer {
  name: string
  email?: string
}

export interface RegistryPackageMeta {
  name: string
  ecosystem: Ecosystem
  maintainers: RegistryMaintainer[]
  /** version -> publish timestamp, epoch ms */
  publishedAt: Record<string, number>
}

/** GET https://registry.npmjs.org/{name} — full package document. */
async function fetchNpmMeta(name: string): Promise<RegistryPackageMeta> {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`)
  if (!res.ok) {
    throw new Error(`npm registry request failed (${res.status}) for ${name}`)
  }
  const doc = (await res.json()) as {
    maintainers?: { name: string; email?: string }[]
    time?: Record<string, string>
  }

  const publishedAt: Record<string, number> = {}
  for (const [version, iso] of Object.entries(doc.time ?? {})) {
    if (version === "created" || version === "modified") continue
    const ms = Date.parse(iso)
    if (!Number.isNaN(ms)) publishedAt[version] = ms
  }

  return {
    name,
    ecosystem: "npm",
    maintainers: doc.maintainers ?? [],
    publishedAt,
  }
}

/** GET https://pypi.org/pypi/{name}/json — full project document. */
async function fetchPypiMeta(name: string): Promise<RegistryPackageMeta> {
  const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`)
  if (!res.ok) {
    throw new Error(`PyPI registry request failed (${res.status}) for ${name}`)
  }
  const doc = (await res.json()) as {
    info?: { author?: string; author_email?: string; maintainer?: string; maintainer_email?: string }
    releases?: Record<string, { upload_time_iso_8601?: string }[]>
  }

  const maintainers: RegistryMaintainer[] = []
  if (doc.info?.maintainer) {
    maintainers.push({ name: doc.info.maintainer, email: doc.info.maintainer_email })
  } else if (doc.info?.author) {
    maintainers.push({ name: doc.info.author, email: doc.info.author_email })
  }

  const publishedAt: Record<string, number> = {}
  for (const [version, releases] of Object.entries(doc.releases ?? {})) {
    const iso = releases[0]?.upload_time_iso_8601
    if (!iso) continue
    const ms = Date.parse(iso)
    if (!Number.isNaN(ms)) publishedAt[version] = ms
  }

  return { name, ecosystem: "pypi", maintainers, publishedAt }
}

export async function getRegistryMeta(ecosystem: Ecosystem, name: string): Promise<RegistryPackageMeta> {
  return ecosystem === "npm" ? fetchNpmMeta(name) : fetchPypiMeta(name)
}
