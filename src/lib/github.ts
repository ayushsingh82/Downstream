/**
 * GitHub identity resolution for a package's source repository.
 *
 * The registry knows who can *publish* a package; GitHub knows who can *merge*
 * into it. Those are different attack surfaces and, more importantly, different
 * name spaces for the same people — the npm handle `dougwilson` and the GitHub
 * login `dougwilson` are only obviously the same person to a human. The track
 * brief calls identity resolution out as a hard part, and this is the honest
 * version of it: both identities are stored, linked to the same package, and
 * marked with where they came from. Nothing here claims two accounts are one
 * person; it makes the overlap visible instead.
 *
 * Unauthenticated the API allows 60 requests an hour, which is two packages a
 * minute — fine for a demo, not for a crawl. Set GITHUB_TOKEN to raise it.
 */

export interface GithubIdentity {
  login: string
  /** "owner" for the repo owner, "contributor" for a code contributor. */
  role: "owner" | "contributor"
  /** Commits attributed by the contributors endpoint; 0 for the owner row. */
  contributions: number
  type?: string
}

export interface GithubRepoRef {
  owner: string
  repo: string
}

/**
 * Pulls `owner/repo` out of whatever URL form deps.dev carries.
 *
 * Observed in the wild: `git+https://github.com/expressjs/express.git`,
 * `https://github.com/psf/requests`, `git://github.com/foo/bar.git`,
 * `ssh://git@github.com/foo/bar.git`. Non-GitHub forges return null rather than
 * a guess.
 */
export function parseGithubUrl(url: string | undefined): GithubRepoRef | null {
  if (!url) return null
  const match = url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function get<T>(path: string): Promise<T> {
  // `cache: "no-store"` is load-bearing, not hygiene. Next caches fetch() inside
  // route handlers, and this endpoint's most likely failure is a 403 from the
  // 60-request-an-hour unauthenticated limit — which then gets cached and
  // replayed long after the limit resets, so identity resolution silently keeps
  // returning nothing. Observed exactly that: a repo that resolved 11 identities
  // returned 1 for the rest of the session.
  const res = await fetch(`https://api.github.com${path}`, {
    headers: headers(),
    cache: "no-store",
  })
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("x-ratelimit-remaining")
    throw new Error(
      `GitHub API rate limited (${res.status}${remaining ? `, ${remaining} remaining` : ""})` +
        ` — set GITHUB_TOKEN to raise the 60/hour unauthenticated limit`
    )
  }
  if (!res.ok) {
    throw new Error(`GitHub API request failed (${res.status}) for ${path}`)
  }
  return res.json() as Promise<T>
}

/**
 * The repo's owner plus its top contributors, as identities.
 *
 * Two requests per package. Contributors are capped because the tail is long
 * and a one-commit drive-by is not an access-control fact.
 */
export async function getRepoIdentities(
  ref: GithubRepoRef,
  maxContributors = 10
): Promise<{ identities: GithubIdentity[]; fullName: string; stars?: number }> {
  const repo = await get<{
    full_name: string
    stargazers_count?: number
    owner?: { login: string; type?: string }
  }>(`/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`)

  const contributors = await get<{ login: string; contributions?: number; type?: string }[]>(
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/contributors?per_page=${maxContributors}`
  ).catch(() => [])

  const identities: GithubIdentity[] = []
  if (repo.owner?.login) {
    identities.push({ login: repo.owner.login, role: "owner", contributions: 0, type: repo.owner.type })
  }
  for (const contributor of contributors) {
    if (!contributor.login) continue
    if (identities.some((i) => i.login === contributor.login)) continue
    identities.push({
      login: contributor.login,
      role: "contributor",
      contributions: contributor.contributions ?? 0,
      type: contributor.type,
    })
  }

  return { identities, fullName: repo.full_name, stars: repo.stargazers_count }
}
