# Plan — Track 2, Option A: Supply Chain Blast Radius

Real-time npm/PyPI dependency graph in HydraDB, answering "what's exposed" the instant a package is flagged compromised.

## Why HydraDB fits this problem

The defender's question — "package X was compromised at 09:00, which of our services are exposed by 09:06" — is a transitive reverse-dependency closure over a graph with tens of millions of versioned nodes. That's traversal, not similarity search, and it has to come back fast at incident time. This is exactly what HydraDB's native path procedures and object-store-backed graph model are built for.

## HydraDB surface we use

| HydraDB feature | How we use it |
|---|---|
| `graph-node` (Docker: `ghcr.io/hydra-db/hydradb`) | Local dev node — Bolt `:7687`, HTTPS query API `:8443`, admin/metrics `:9090` |
| HTTPS JSON query API (`POST /v1/graphs/{graph}/query`) | **The client actually used**, for both ingestion and query. `neo4j-driver` over Bolt was the original plan; HTTP won because Next.js route handlers are short-lived and a pooled TCP connection buys nothing here. The wire contract is documented in `HYDRADB-NOTES.md`. |
| `UNWIND ... MERGE/CREATE` batch writes | Bulk-load package/version/maintainer/dependency edges from deps.dev and registry data — this is the only way to get millions of edges in without one round trip per edge |
| `algo.SSpaths` | **The core query.** One compromised `PackageVersion` as source, `relDirection: 'both'` across `RESOLVES_TO`/`PINS`/`HAS_LOCKFILE`/`RUNS`, resolving the reverse-dependency closure in one native call instead of fanning out client-side per target. `algo.MSpaths` (many sources) is the wrong shape for a single compromise event and is reserved for evaluating several compromised versions at once. |
| `algo.SPpaths` | "Explain this exposure" — the exact shortest path from a specific service back to the compromised version, for the UI's path-highlight view |
| Property indexes + `WHERE` time-range filters | "Which lockfiles resolved to the bad version while it was live" — filter `Lockfile.resolvedAt` against the compromise window |
| Bookmarks + `causal` reads | Every response carries a durable sequence. The compromise write hands its bookmark to the traversal that follows, so a `causal` read is guaranteed to observe the flag without paying `strong` on the expensive half. |

### Graph data model

Property names are snake_case on the vertex, since that is what the Cypher reads.

```
(:Package {id, name, ecosystem})                     // ecosystem: npm | pypi
(:PackageVersion {id, version, compromised, compromised_at})
(:Maintainer {id, name, email})
(:Project {id, name})                                 // an internal "our service" node
(:Lockfile {id, projectId, resolvedAt})
(:Service {id, name})

(:Package)-[:HAS_VERSION]->(:PackageVersion)
(:PackageVersion)-[:DEPENDS_ON {range}]->(:Package)   // declared range
(:PackageVersion)-[:RESOLVES_TO]->(:PackageVersion)   // what a lockfile actually pinned
(:Maintainer)-[:MAINTAINS]->(:Package)
(:Lockfile)-[:PINS]->(:PackageVersion)
(:Project)-[:HAS_LOCKFILE]->(:Lockfile)
(:Service)-[:RUNS]->(:Project)
```

`RESOLVES_TO` is the resolved-dependency edge (from deps.dev's computed graph, not just declared ranges) — this is what makes "transitively exposed" answerable at all, since declared semver ranges alone don't tell you what actually got installed.

### Core query shapes

- **Blast radius** (as implemented — note `relTypes` is a literal, because passing it as a
  parameter is rejected with "composite parameter is only supported as an UNWIND input"):
  ```cypher
  CALL algo.SSpaths({sourceNode: $sourceId,
                     relTypes: ['RESOLVES_TO','PINS','HAS_LOCKFILE','RUNS'],
                     relDirection: 'both', maxLen: $maxLen, pathCount: $pathCount})
    YIELD path RETURN path
  ```
  Returned paths are decoded app-side into distinct exposed services, keeping the shortest
  chain per service. `DEPENDS_ON` (declared ranges) was dropped: `RESOLVES_TO` already
  carries the requirement string, and declared ranges add traversal breadth without adding
  answerable exposure.
- **Explain one exposure**: `algo.SPpaths` between one `Service` and the compromised `PackageVersion`.
- **Shared maintainer**: `MATCH (m:Maintainer)-[:MAINTAINS]->(p:Package) WHERE p.id = $compromisedPkg WITH m MATCH (m)-[:MAINTAINS]->(other:Package) RETURN other`
- **Live-window resolution**: `MATCH (l:Lockfile)-[:PINS]->(v:PackageVersion {id:$compromisedVersionId}) WHERE l.resolvedAt >= $compromiseStart AND l.resolvedAt <= $compromiseEnd RETURN l`
- **Typosquat proximity**: HydraDB's Cypher subset has no string-distance functions (no `CONTAINS`, no fuzzy match), so candidate name-similarity pairs are computed at ingest time in the app layer (Levenshtein/Jaro-Winkler over the package name index) and stored as `(:Package)-[:NAME_SIMILAR_TO {distance}]->(:Package)` edges — then it's a plain graph query at request time.

## Non-HydraDB repos and APIs

| Component | Source | Purpose |
|---|---|---|
| **deps.dev API** | [google/deps.dev](https://github.com/google/deps.dev), [docs.deps.dev](https://docs.deps.dev/api/v3/) | Primary data source — `GetDependencies` returns the **resolved** transitive dependency graph (not just declared ranges) for npm, PyPI, Maven, Cargo, Go; this is what turns into our `DEPENDS_ON`/`RESOLVES_TO` edges |
| **npm registry API** | `registry.npmjs.org` | Package metadata, versions, maintainer list, publish timestamps, dist-tags |
| **PyPI JSON API** | `pypi.org/pypi/<pkg>/json` | Package metadata, releases, maintainer/author info |
| **OSV.dev API** | [google/osv.dev](https://github.com/google/osv.dev), `api.osv.dev` | Real vulnerability/malicious-package records — `/v1/querybatch` to seed realistic "this version was compromised" scenarios instead of fabricating them, and to cross-check blast-radius results against a real advisory |
| **GitHub API** | `api.github.com` | Repo → maintainer identity resolution, org membership (a proxy for "shared infrastructure") |
| **TanStack npm/PyPI incident (May 2025)** | reference case study named in the track brief | Used as the scenario shape for the demo (compromise → propagation window → blast radius), reconstructed from public advisory/metadata, not from any malicious code itself |

We ingest metadata and resolved-dependency graphs only — never install or execute any actual package code, malicious or otherwise.

## App architecture (Next.js)

```
src/app/api/ingest/route.ts        # pulls deps.dev + registry data for a package subtree, UNWIND-batches into HydraDB
src/app/api/service/route.ts       # registers Service -> Project -> Lockfile with pinned versions
src/app/api/stats/route.ts         # label counts for the console header
src/app/api/compromise/route.ts    # marks a PackageVersion compromised (demo trigger), strong-reads the blast radius back
src/app/api/blast-radius/route.ts  # runs algo.MSpaths for a given compromised version against all known services
src/app/api/typosquat/route.ts     # returns NAME_SIMILAR_TO candidates for a package
src/lib/hydradb.ts                 # Bolt driver client + HTTP fallback, causal/strong helpers
src/lib/similarity.ts              # Levenshtein precompute for typosquat edges
src/lib/graphwrite.ts              # the two UNWIND batch forms HydraDB actually executes
src/components/incident-console.tsx # demo UI: seed a real graph, compromise a transitive dep, see exposed services with hop chains and a measured elapsed time
```

## 9-day build sequence

1. **Day 1–2**: `graph-node` up locally; define schema; ingest one real dependency subtree from deps.dev for a mid-size npm package, confirm `algo.MSpaths` returns sane paths.
2. **Day 3–4**: Build the full ingestion pipeline (deps.dev + registry + OSV.dev), batch-load a realistic-sized graph (aim for hundreds of thousands of versioned nodes).
3. **Day 5**: Implement "mark compromised" flow + `algo.MSpaths` blast-radius query + `algo.SPpaths` path explanation.
4. **Day 6**: Shared-maintainer query, live-window lockfile query, typosquat precompute + query.
5. **Day 7**: Demo UI — graph visualization, compromise timer, path highlight.
6. **Day 8**: Load-test against a large synthetic incident (many services exposed), polish, write up what the project loses without HydraDB (the MSpaths batched traversal vs. per-target client-side fan-out).
7. **Day 9**: Record demo video, finalize README, submit.

## Divergences from this plan, and why

Recorded rather than quietly edited, since the plan is part of the submission.

1. **HTTP instead of Bolt.** `neo4j-driver` is not a dependency. Next.js route handlers are
   short-lived, so a pooled Bolt connection buys nothing, and the HTTP API is the same
   engine. Consequence: batch writes go through the documented client transport anyway,
   since `UNWIND` list-of-maps parameters are a transport-level type either way.
2. **`algo.SSpaths` instead of `algo.MSpaths`.** MSpaths fans *many sources* against a
   target set. A compromise event has one source, so SSpaths is the correct procedure.
3. **`DEPENDS_ON` dropped.** `RESOLVES_TO` already carries the requirement string, and
   declared ranges do not add answerable exposure.
4. **`Service` and `RUNS` were missing from the code entirely** until they were added — the
   original schema stopped at `Project`, so the plan's headline query had no target to reach.
5. **Property indexes** are not created explicitly; the plan listed them but HydraDB's
   Cypher subset exposes no `CREATE INDEX`, and id-keyed lookups are the fast path already.
6. **Load-test at "hundreds of thousands of versioned nodes" has not been run.** One real
   71-version subtree is ingested and verified. This is the largest outstanding gap.
