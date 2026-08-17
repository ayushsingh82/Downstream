# Radius — Supply Chain Blast Radius

**Hack Hydra** · Track 2, Option A · Aug 12–20, 2026 · Built on [HydraDB](https://github.com/hydra-db/hydradb)

A package is flagged compromised at 09:00. Which of our services are exposed by 09:06?

Radius keeps the **resolved** npm/PyPI dependency graph in HydraDB alongside a map of
internal services and the lockfiles they ship. Marking a version compromised resolves the
reverse-dependency closure out to every affected service in one native traversal.

Measured on a local graph-node: **compromising a transitive dependency identifies both
exposed services in 47–49ms**, and `algo.SPpaths` explains any single exposure in ~21ms.

## Why this needs a graph database

The defender's question is a transitive reverse-dependency closure over a versioned graph.
It is traversal, not similarity search, and it has to return fast during an incident.

The demo compromises `cookie@0.6.0` — a *transitive* dependency of `express@4.19.2`.
Neither demo service names `cookie` in its own manifest. The exposure exists only in the
resolved graph, which is exactly the case `npm audit`-style declared-range tooling misses.

### What this loses without HydraDB

- **`algo.SSpaths` with `relDirection: 'both'`** walks four different relationship types in
  one call, against the stored edge direction. Without a native path procedure this becomes
  a client-side BFS: one round trip per frontier node per hop, which at incident time is the
  difference between an answer and a spreadsheet.
- **`UNWIND` batch writes** load 128 resolved edges in a handful of statements instead of
  one round trip per edge.
- **Bookmark-threaded causal reads** let the compromise write hand its durable sequence to
  the traversal that follows it, so the UI never shows a stale blast radius without paying
  `strong` consistency on the expensive half of the request.
- **`algo.SPpaths`** returns whole paths with weights. A plain `MATCH` projects endpoints
  only, so "why is checkout-api affected" would not be answerable at all.

## Graph model

```
(:Package {id, name, ecosystem})                    // npm | pypi
(:PackageVersion {id, version, compromised, compromised_at})
(:Maintainer {id, name, email})
(:Project {id, name})
(:Lockfile {id, project_id, resolved_at})
(:Service {id, name})

(:Package)-[:HAS_VERSION]->(:PackageVersion)
(:PackageVersion)-[:RESOLVES_TO {requirement}]->(:PackageVersion)   // resolved, not declared
(:Maintainer)-[:MAINTAINS]->(:Package)
(:Lockfile)-[:PINS]->(:PackageVersion)
(:Project)-[:HAS_LOCKFILE]->(:Lockfile)
(:Service)-[:RUNS]->(:Project)
(:Package)-[:NAME_SIMILAR_TO {distance}]->(:Package)                // typosquat, precomputed
```

`RESOLVES_TO` comes from deps.dev's computed graph, so it records what actually got
installed. Declared semver ranges alone cannot answer "transitively exposed."

`NAME_SIMILAR_TO` is precomputed at ingest because HydraDB's `WHERE` has no string-distance
or substring operators at all — no `CONTAINS`, no `ENDS WITH` — so this cannot be a
query-time computation.

## Setup

Requires Node 20+, Docker, and no API keys — every external API used here is public and
unauthenticated.

```bash
# 1. Start a HydraDB graph-node
mkdir -p .hydradb/store .hydradb/cache
printf '%s\n' 'local-development-token-32-bytes' > .hydradb/auth-token
docker run -d --name hydradb --user "$(id -u):$(id -g)" \
  -p 7687:7687 -p 8443:8443 -p 9090:9090 -v "$PWD/.hydradb:/data" \
  -e CLOUD_PROVIDER=memory \
  -e GRAPH_NAMESPACE=default -e GRAPH_ID=default \
  -e GRAPH_CELL_ID=cell-0 -e GRAPH_CELLS=cell-0 -e GRAPH_NODE_ID=node-0 \
  -e GRAPH_BOLT_NODE_ADDRESSES=node-0=127.0.0.1:7687 \
  -e GRAPH_ADVERTISED_BOLT_ADDR=127.0.0.1:7687 \
  -e GRAPH_DATA_CACHE_DIR=/data/cache \
  -e GRAPH_AUTH_TOKEN_FILE=/data/auth-token \
  -e GRAPH_ALLOW_PLAINTEXT=true -e RUST_MIN_STACK=33554432 \
  ghcr.io/hydra-db/hydradb:latest

# RUST_MIN_STACK is mandatory. Without it the node serves /readyz and then
# aborts with a stack overflow on the first query.
```

> **Use `CLOUD_PROVIDER=memory`, not `local`.** The local-filesystem object
> store does not implement conditional writes — after enough writes SlateDB
> needs a `PutMode::Update` on its manifest and `LocalFileSystem` rejects it,
> surfacing as `HTTP 500 internal query execution error` on an arbitrary
> statement with the real cause only in the node's own log:
> `Operation put_opts with mode PutMode::Update not yet implemented by
> LocalFileSystem`. Small demos survive it; any sustained ingest does not.
> `memory` has no such limit but is not durable across a container restart —
> for a long run, keep the container up, or point at S3/MinIO instead.

```bash
# 2. In another shell
cp .env.example .env.local
npm install
npm run dev
```

Open <http://localhost:3000>, scroll to **Live incident console**, and click through
`seed real graph → compromise cookie@0.6.0 → typosquat neighbours`. Every number shown is
read back from the graph-node.

Readiness check: `curl -sf localhost:9090/readyz`.

## API

| Route | Purpose |
|---|---|
| `GET /api/health` | graph-node reachability (`/readyz`) |
| `GET /api/stats` | Package / version / service counts |
| `POST /api/ingest` | Pull a deps.dev subtree + registry maintainers into the graph |
| `POST /api/service` | Register a Service → Project → Lockfile with pinned versions |
| `POST /api/compromise` | Flag a version, then bookmark-read its blast radius back |
| `GET /api/blast-radius` | Blast radius + shared maintainers + live-window lockfiles + optional path explanation |
| `GET /api/typosquat` | Precomputed `NAME_SIMILAR_TO` neighbours |

```bash
curl -X POST localhost:3000/api/ingest -H 'content-type: application/json' \
  -d '{"ecosystem":"npm","name":"express","version":"4.19.2"}'

curl -X POST localhost:3000/api/service -H 'content-type: application/json' \
  -d '{"ecosystem":"npm","serviceName":"checkout-api","projectName":"checkout",
       "entries":[{"name":"cookie","version":"0.6.0"}]}'

curl -X POST localhost:3000/api/compromise -H 'content-type: application/json' \
  -d '{"ecosystem":"npm","name":"cookie","version":"0.6.0"}'
```

## HydraDB notes

`HYDRADB-NOTES.md` records the wire contract as verified against a live node, including
several constraints the published docs do not state — the request field is `parameters`
not `params`, rows are positional and type-tagged, standalone vertex `MERGE` is rejected,
`UNWIND` edge writes require one label per endpoint plus an inline relationship id, and
`relTypes` must be a literal rather than a parameter. Worth reading before editing any
Cypher in `src/lib/`.

## Third-party attribution

| Source | Use | Licence |
|---|---|---|
| [HydraDB](https://github.com/hydra-db/hydradb) | Graph database | see upstream repo |
| [deps.dev API](https://docs.deps.dev/api/v3/) (Google) | Resolved transitive dependency graphs | public API, Apache-2.0 project |
| [npm registry API](https://registry.npmjs.org) | Package metadata, maintainers, publish times | public API |
| [PyPI JSON API](https://pypi.org) | Package metadata, releases | public API |
| [OSV.dev](https://osv.dev) (Google) | Real vulnerability / malicious-package records | public API, Apache-2.0 project |
| TanStack npm/PyPI incident (May 2025) | Scenario shape, from public advisory reporting only | — |
| Next.js, React, Tailwind CSS, Framer Motion, lucide-react, Geist | App framework and UI | MIT / Apache-2.0 |

This project ingests **metadata and resolved-dependency graphs only**. It never downloads,
installs, or executes package code, malicious or otherwise.

## Status

See `completion.md` for what is built, what is verified live, and what remains.

## Licence

MIT — see `LICENSE`.
