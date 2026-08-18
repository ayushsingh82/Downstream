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

/**
 * Splits an RFC-5322 address list into maintainer records.
 *
 * Handles the three shapes PyPI actually serves: `Name <addr>` pairs, bare
 * addresses with no display name, and an empty field with the name carried in
 * the separate `author`/`maintainer` field instead. Splitting on commas is safe
 * here because display names in this field are not quoted in practice; a comma
 * inside a quoted name would over-split, which costs one duplicate row rather
 * than a wrong graph.
 */
function parseAddressList(field?: string, fallbackName?: string): RegistryMaintainer[] {
  if (!field) {
    return fallbackName ? [{ name: fallbackName }] : []
  }
  return field
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(.*?)\s*<([^>]+)>$/)
      if (match) {
        const name = match[1].trim().replace(/^"|"$/g, "")
        return { name: name || match[2], email: match[2] }
      }
      return { name: entry, email: entry.includes("@") ? entry : undefined }
    })
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

  // PyPI's `maintainer` / `author` fields are usually null on anything packaged
  // in the last few years: PEP 621 moved the identity into `maintainer_email` /
  // `author_email` as an RFC-5322 address list ("Ada Lovelace <ada@example.com>,
  // Alan Turing <alan@example.com>"), and the bare-name fields were left empty.
  // Reading only the name fields — as this did — returns zero maintainers for
  // `requests`, `urllib3`, and most of the ecosystem, which silently disables
  // the shared-maintainer pivot for every PyPI package.
  const maintainers = [
    ...parseAddressList(doc.info?.maintainer_email, doc.info?.maintainer),
    ...parseAddressList(doc.info?.author_email, doc.info?.author),
  ]

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
