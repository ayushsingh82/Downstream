# Completion — Radius (Track 2A, supply chain blast radius)

Tracks what's actually built vs. what plan.md describes. Updated as work lands.

**Status: the backend is complete and verified end-to-end against a live HydraDB
graph-node with real deps.dev data.** The remaining gaps are scale and presentation, not
correctness.

## Verified live against a running graph-node

All of the following was executed, not inferred from documentation:

- **Ingestion from real APIs into a real graph**: `express@4.19.2` → 70 packages,
  71 versions, 128 `RESOLVES_TO` edges, 5 maintainers, 3 `NAME_SIMILAR_TO` edges.
- **Service layer**: two services registered with lockfiles pinning resolved versions;
  `checkout-api` → `checkout` (3 pins), `billing-worker` → `billing` (1 pin).
- **Blast radius**: compromising `cookie@0.6.0` — a *transitive* dependency neither
  service names in its own manifest — correctly identified **both** exposed services in
  **47–49ms**, with full chains
  (`Lockfile:2023-11-14 09:00 → Project:checkout → Service:checkout-api`).
- **Path explanation**: `algo.SPpaths` returned the 3-hop chain with `pathWeight` 3 in 21ms.
- **Live-window lockfiles**: both lockfiles correctly returned for a time range spanning
  their `resolved_at`.
- **Typosquat**: `lodash` against a corpus returned `1odash` (d1), `loadsh` (d2),
  `lodahs` (d2); `express` returned `expres` (d1), `expresss` (d1), `expressjs` (d2).
- **Idempotency**: re-running an identical edge batch leaves `count(*) = 1`.
- **Negative case**: compromising a version not in the graph returns a clean 404 rather
  than silently appearing to succeed.
- **Four external API clients** exercised against the real services (deps.dev v3, npm
  registry, PyPI JSON, OSV.dev `querybatch`).
- `npx tsc --noEmit` clean · `npm run build` clean, 8 routes registered.

## Done

- [x] Landing page (navbar, hero, marquee, bento grid, feature cards, how-it-works,
      benchmarks, pricing, CTA, footer) — branded "Radius," red accent
- [x] **Live incident console** wired to the real API — seed → compromise → typosquat, with
      measured elapsed time, hop chains, and a truncation warning when the traversal hits
      its path cap
- [x] `src/lib/hydradb.ts` — HTTP client with the **verified** wire contract: `parameters`
      (not `params`), positional type-tagged row decoding, path decoding, `HydraSession`
      bookmark threading, structured error surfacing
- [x] `src/lib/graphwrite.ts` — the two `UNWIND` batch forms HydraDB actually executes,
      with the labelled-endpoint and inline-relationship-id requirements enforced in one place
- [x] `src/lib/ingest.ts` — subtree, maintainer, service/lockfile, typosquat, and
      compromise writes; deduplicates deps.dev edges that repeat a pair
- [x] `src/lib/blastradius.ts` — `algo.SSpaths` closure decoded into distinct exposed
      services (shortest chain per service), `algo.SPpaths` explanation, shared maintainers,
      live-window lockfiles, typosquat candidates, label counts
- [x] `src/lib/depsdev.ts` / `registry.ts` / `osv.ts` / `similarity.ts` — all response
      shapes verified live
- [x] `Service` + `RUNS` layer — closes the gap where plan.md's headline query targeted
      `Service` nodes the schema could not reach
- [x] API routes: `health`, `stats`, `ingest`, `service`, `compromise`, `blast-radius`,
      `typosquat`
- [x] `LICENSE` (MIT), README with setup + HydraDB usage + third-party attribution
- [x] `HYDRADB-NOTES.md` — the wire contract as verified, including the constraints the
      published docs don't state
- [x] plan.md reconciled, with a divergences section rather than silent edits
- [x] Landing-page metrics replaced with measured figures; the fabricated "500K+ versions",
      "48ms p50", and "99.9% uptime SLA" claims are gone, and `algo.MSpaths` references
      corrected to `SSpaths`

## Not done yet

- [ ] **Scale.** One 71-version subtree is ingested. The plan targets hundreds of thousands
      of versioned nodes, and no load test has run. This is the largest gap: the traversal
      is fast here, but 128 edges does not prove anything about 128,000.
- [ ] **The traversal hits its 500-path cap on the demo graph.** Surfaced honestly in the
      UI and the API response (`truncated: true`), but it means the exposed-service set is
      complete for the paths returned rather than proven exhaustive. Needs either a higher
      cap, or a two-stage query that enumerates reachable services before pathing to them.
- [ ] **No graph visualisation.** The console shows hop chains as text. plan.md called for
      a force-directed graph view with path highlighting.
- [ ] **OSV.dev is not wired into the demo flow.** The client is built and verified, but the
      console's compromise trigger is manual rather than seeded from a real advisory.
- [ ] **Typosquat corpus is caller-supplied.** A real deployment needs a background job
      populating it from the broader registry.
- [ ] **PyPI path is untested end-to-end.** The client is verified but no PyPI subtree has
      been ingested into the graph.
- [ ] **GitHub API integration** (maintainer identity resolution, org membership) is listed
      in plan.md and not started.
- [ ] Demo video not recorded.

## Reproduce the verification

```bash
# graph-node (RUST_MIN_STACK is mandatory — see README)
docker run --rm --name hydradb --user "$(id -u):$(id -g)" \
  -p 7687:7687 -p 8443:8443 -p 9090:9090 -v "$PWD/.hydradb:/data" \
  -e CLOUD_PROVIDER=local -e LOCAL_PATH=/data/store \
  -e GRAPH_NAMESPACE=default -e GRAPH_ID=default \
  -e GRAPH_CELL_ID=cell-0 -e GRAPH_CELLS=cell-0 -e GRAPH_NODE_ID=node-0 \
  -e GRAPH_BOLT_NODE_ADDRESSES=node-0=127.0.0.1:7687 \
  -e GRAPH_ADVERTISED_BOLT_ADDR=127.0.0.1:7687 \
  -e GRAPH_DATA_CACHE_DIR=/data/cache -e GRAPH_AUTH_TOKEN_FILE=/data/auth-token \
  -e GRAPH_ALLOW_PLAINTEXT=true -e RUST_MIN_STACK=33554432 \
  ghcr.io/hydra-db/hydradb:latest

cp .env.example .env.local && npm install && npm run dev

curl localhost:3000/api/health
curl -X POST localhost:3000/api/ingest -H 'content-type: application/json' \
  -d '{"ecosystem":"npm","name":"express","version":"4.19.2"}'
curl -X POST localhost:3000/api/service -H 'content-type: application/json' \
  -d '{"ecosystem":"npm","serviceName":"checkout-api","projectName":"checkout",
       "entries":[{"name":"cookie","version":"0.6.0"}]}'
curl -X POST localhost:3000/api/compromise -H 'content-type: application/json' \
  -d '{"ecosystem":"npm","name":"cookie","version":"0.6.0"}'
```
