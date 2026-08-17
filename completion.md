# Completion — Radius (Track 2A, supply chain blast radius)

Tracks what's actually built vs. what plan.md describes. Updated as work lands.

## Done

- [x] Landing page (full: navbar, hero with radar-sweep, marquee, single-row bento grid, feature cards, how-it-works, benchmarks, pricing, CTA, footer) — branded "Radius," red accent, visually distinct from track3's layout
- [x] `src/lib/hydradb.ts` — HTTP JSON query client (`POST /v1/graphs/{graph}/query`), causal/strong consistency, `checkHealth()` against `/readyz`
- [x] `src/lib/id.ts` — `stableId()`: deterministic string → non-negative integer, same scheme as track3
- [x] `src/lib/depsdev.ts` — deps.dev v3 client. **Response shape verified live** against `api.deps.dev` (`GET /v3/systems/{system}/packages/{name}/versions/{version}:dependencies` → `{nodes:[{versionKey,bundled,relation,errors}], edges:[{fromNode,toNode,requirement}]}`)
- [x] `src/lib/registry.ts` — npm (`registry.npmjs.org`) + PyPI (`pypi.org/pypi/.../json`) maintainer + publish-time metadata
- [x] `src/lib/osv.ts` — OSV.dev `POST /v1/querybatch` + `GET /v1/vulns/{id}`, shape verified live
- [x] `src/lib/similarity.ts` — Levenshtein distance + typosquat candidate finder
- [x] `src/lib/ingest.ts` — batch loaders (two-pass UNWIND, per cypher-compat.md):
  - `ingestPackageSubtree()` — pulls a deps.dev resolved dependency graph, writes Package/PackageVersion vertices + HAS_VERSION/RESOLVES_TO edges directly between version nodes (not just declared ranges)
  - `ingestMaintainers()` — Maintainer vertices + MAINTAINS edges
  - `ingestLockfile()` — Project/Lockfile vertices + HAS_LOCKFILE/PINS edges
  - `ingestTyposquatEdges()` — precomputes NAME_SIMILAR_TO edges via similarity.ts (HydraDB's Cypher subset has no string-distance functions, so this can't happen at query time)
  - `markCompromised()` — flags a PackageVersion
- [x] `src/lib/blastradius.ts` — query layer:
  - `getBlastRadius()` — **uses `algo.SSpaths`** (paths from one source), not `algo.MSpaths` as plan.md originally sketched — SSpaths is the correct native procedure for a single compromise event; MSpaths is reserved for batching several compromised versions against the same target set at once (not yet needed)
  - `explainExposure()` — `algo.SPpaths` for one project ↔ compromised-version path
  - `getMaintainers()` / `getSharedMaintainerPackages()`
  - `getLiveWindowLockfiles()` — time-range filter on `Lockfile.resolved_at`
  - `getTyposquatCandidates()`
- [x] API routes: `GET /api/health`, `POST /api/ingest`, `POST /api/compromise` (write + strong-read blast radius back), `GET /api/blast-radius`, `GET /api/typosquat`
- [x] `npx tsc --noEmit` clean
- [x] `npm run build` clean — all 5 routes registered as dynamic (ƒ), landing page static (○)
- [x] **Live-tested the four external data clients against real APIs** (not mocked):
  - `getDependencyGraph('npm','express','4.19.2')` → 71 nodes, 128 edges
  - `getRegistryMeta('npm','express')` → real maintainer list
  - `queryBatch(...)` for express@4.19.2 → 1 real OSV advisory found
  - `findTyposquatCandidates('lodash', [...])` → correct distance-1 matches
- [x] `.env.example`

## Not done yet

- [ ] **Live verification of the HydraDB-facing code.** Docker daemon wasn't up on this machine during this session, so none of the Cypher in `ingest.ts` / `blastradius.ts` has run against a real graph-node — only the external API clients (deps.dev/npm/PyPI/OSV) were exercised live. The Cypher is modeled closely on `cypher-compat.md`'s exact documented forms, but that's not confirmation. **This is the top priority next step.**
- [ ] The HTTP response envelope in `hydradb.ts` is inferred from the README's one curl example, not confirmed.
- [ ] `RESOLVES_TO` / `NAME_SIMILAR_TO` relationship `MERGE` patterns have no inline identity property (matching the plain, non-UNWIND `MERGE (u {id:1})-[:FOLLOWS]->(v {id:2})` doc example) — needs a live check that this dedupes correctly on repeat ingestion rather than creating parallel edges.
- [ ] `algo.SSpaths`/`algo.SPpaths` config keys used here (`relTypes` as a multi-type array through Package→Version→Lockfile→Project) aren't shown multi-type in the docs' own examples (only single-type `['RELATES']`/`['FOLLOWS']`) — needs a live check that multiple relationship types in one path-procedure call actually works as expected.
- [ ] No real ingestion run yet at the "500K+ package versions" scale claimed on the landing page — only a single 71-node smoke subtree (express@4.19.2).
- [ ] No UI wiring — the landing page doesn't call any of these API routes yet (no "run a scan" flow, no blast-radius graph visualization).
- [ ] No typosquat corpus-building step (a real deployment needs a background job populating `typosquatCorpus` from the broader registry, not passed in by the caller).

## How to verify locally once Docker is up

```bash
mkdir -p .hydradb/store .hydradb/cache
printf '%s\n' 'local-development-token-32-bytes' > .hydradb/auth-token
docker run --rm --user "$(id -u):$(id -g)" \
  -p 7687:7687 -p 8443:8443 -p 9090:9090 \
  -v "$PWD/.hydradb:/data" \
  -e CLOUD_PROVIDER=local -e LOCAL_PATH=/data/store \
  -e GRAPH_NAMESPACE=default -e GRAPH_ID=default \
  -e GRAPH_CELL_ID=cell-0 -e GRAPH_CELLS=cell-0 -e GRAPH_NODE_ID=node-0 \
  -e GRAPH_BOLT_NODE_ADDRESSES=node-0=127.0.0.1:7687 \
  -e GRAPH_ADVERTISED_BOLT_ADDR=127.0.0.1:7687 \
  -e GRAPH_DATA_CACHE_DIR=/data/cache \
  -e GRAPH_AUTH_TOKEN_FILE=/data/auth-token \
  -e GRAPH_ALLOW_PLAINTEXT=true -e RUST_MIN_STACK=33554432 \
  ghcr.io/hydra-db/hydradb:latest

# separate shell
cp .env.example .env.local
npm run dev
curl localhost:3000/api/health
curl -X POST localhost:3000/api/ingest -H 'content-type: application/json' -d '{
  "ecosystem": "npm", "name": "express", "version": "4.19.2"
}'
curl -X POST localhost:3000/api/compromise -H 'content-type: application/json' -d '{
  "ecosystem": "npm", "name": "express", "version": "4.19.2"
}'
curl "localhost:3000/api/blast-radius?ecosystem=npm&name=express&version=4.19.2"
```
