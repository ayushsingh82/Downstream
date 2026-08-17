/**
 * HydraDB's Cypher subset has no string-distance functions (no CONTAINS, no
 * fuzzy match — see cypher-compat.md "Not supported"), so typosquat
 * candidates are computed here at ingest time and stored as graph edges
 * ((:Package)-[:NAME_SIMILAR_TO {distance}]->(:Package)); the query itself
 * is then a plain graph read.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  let prev = new Array(n + 1)
  let curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

export interface SimilarityCandidate {
  name: string
  distance: number
}

/** Names within `maxDistance` edits of `target`, sorted closest first. */
export function findTyposquatCandidates(
  target: string,
  corpus: string[],
  maxDistance = 2
): SimilarityCandidate[] {
  const out: SimilarityCandidate[] = []
  for (const name of corpus) {
    if (name === target) continue
    // Cheap length prefilter before paying for the full edit-distance pass.
    if (Math.abs(name.length - target.length) > maxDistance) continue
    const distance = levenshtein(target, name)
    if (distance <= maxDistance) out.push({ name, distance })
  }
  return out.sort((a, b) => a.distance - b.distance)
}
