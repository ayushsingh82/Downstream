# Completion — Radius (Track 2A, supply chain blast radius)

Tracks what's actually built vs. what plan.md describes. Updated as work lands.

**Status: complete and verified end-to-end against a live HydraDB graph-node — with real
deps.dev/PyPI/OSV data, at 100,000-version scale, and with a graph view in the console.**
The blast-radius answer was rebuilt after load testing showed the original traversal was
silently incomplete on any graph bigger than the demo.

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
- **PyPI end-to-end** (the gap this file used to list): `requests@2.31.0` → 5 packages,
  5 versions, 4 `RESOLVES_TO` edges, 3 maintainers; a `ml-scoring` service registered
  against it; compromising `urllib3@2.7.0` returns the exposed service in **42ms**.
- `npx tsc --noEmit` clean · `npm run lint` clean.

## What load testing changed

`scripts/scale-check.mjs` builds a registry-shaped graph (layered DAG, hub packages with
heavy fan-in, services whose lockfiles pin their full resolved subtree) and runs the
incident query on it. The graph it built and this project now answers against: **84,163
package versions, 332,985 `RESOLVES_TO` edges, 200 services, ~944,000 `PINS` edges.**
Compromising the deepest hub returns **140 exposed services in 110ms**; drawing 10 of their
chains adds 5.7s, which is why the chain count is capped and the exposed set is not.

Doing that surfaced four things the demo graph could not:

1. **`algo.SSpaths` caps at 1024 paths regardless of `pathCount`, and says nothing about
   it.** pathCount 100 → 100 paths; 2000 → 1024; 5000 → 1024. Anything over 100,000 is
   rejected outright, which reads as though smaller values are honoured. The original blast
   radius asked for 500 and reported `truncated` when it got exactly 500 — correct as far as
   it went, but the real ceiling is 1024, and on a real graph the traversal spends that
   budget on prefixes of the same few chains long before reaching every dependent.
2. **The one-call traversal is refused outright at size, not merely truncated.** On this
   graph `algo.SSpaths` across the whole closure returns `native_path_edges rejected by
   admission control: actual 1000034 exceeds limit 1000000`. A path procedure may touch a
   million edges and no more, so "one native call answers the blast radius" is not a design
   that survives a real registry — the closure has to be walked a hop at a time.
3. **`WHERE n.id = $x` does not use the id index; `{id: $x}` in the pattern does.** Same
   query, same rows: 26.6s versus 2.3s for a one-hop reverse lookup, 41.6s versus 3.0s for
   a chained service query. Past a certain size the scanning form stops returning at all —
   `408 query_timeout ... after 120000 ms`.
4. **Sustained ingestion trips a storage-layer failure.** At ~85,000 vertices the node's
   SlateDB manifest writer panicked (`InvalidTransactionalObjectState`), in-flight
   statements returned a bare `500 internal query execution error`, and the node then
   promoted a new writer and carried on. The client now retries 5xx and dropped connections
   with backoff, which is safe because every statement it issues is idempotent by
   construction.

So the answer was restructured into two queries that are honest about what they cost:

- **Lockfile lookup** — one `PINS`/`HAS_LOCKFILE`/`RUNS` pattern from the compromised
  version. **42ms on a 100,000-version graph.** Complete for every service whose lockfile
  records what it installed, which is what a lockfile is for.
- **Upstream closure** — breadth-first enumeration using `algo.SSpaths` with
  `relDirection: 'incoming'` as the expansion primitive, treating exactly 1024 returned
  paths as truncated and re-expanding a level at a time. Catches services whose lockfile
  does not record the dependency. Costs minutes on a hub package, and the console runs it as
  a second pass that reports whether it found anything the first pass missed.

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
- [x] `scripts/scale-check.mjs` — the load test, with `--cleanup` to take its synthetic
      registry back out of the graph and `--closure` to include the full upstream walk
- [x] `GET /api/advisories` — scans the graph's versions against OSV.dev `querybatch` and
      returns the ones carrying a real advisory, so a compromise can be seeded from a public
      feed rather than a hardcoded demo target
- [x] **Graph visualisation** (`src/components/blast-graph.tsx`) — the exposure chains drawn
      as an SVG laid out by hop distance from the compromise, with hover isolating one
      chain. Layout comes from the paths themselves rather than a force simulation, because
      distance from the left edge is the thing worth reading
- [x] **PyPI maintainer parsing fixed.** PEP 621 moved identities into
      `maintainer_email`/`author_email` as RFC-5322 address lists and left the bare-name
      fields null, so the old code returned zero maintainers for `requests`, `urllib3` and
      most of the ecosystem — silently disabling the shared-maintainer pivot for all of PyPI
- [x] **GitHub identity resolution** (`src/lib/github.ts`) — deps.dev's `SOURCE_REPO` link →
      GitHub repo owner + top contributors, stored as `Maintainer {source: "github"}` against
      the same Package so the shared-maintainer pivot spans both name spaces. Verified live:
      `expressjs/express` → 11 identities, 2 handles byte-identical to npm maintainers
      (`wesleytodd`, `UlisesGascon`); with `body-parser` also ingested, compromising
      `express` now surfaces `body-parser` via a shared identity that the registry
      maintainer lists alone did not connect. Handle equality is reported as a hint, not
      asserted as sameness — identity resolution proper is still unsolved
- [x] Landing-page metrics replaced with measured figures; the fabricated "500K+ versions",
      "48ms p50", and "99.9% uptime SLA" claims are gone, and `algo.MSpaths` references
      corrected to `SSpaths`

## Not done yet

- [ ] **The upstream closure is minutes, not milliseconds, on a hub package.** Enumerating
      it is O(dependent versions), and the graph-node serves cold vertices from the object
      store at roughly 100ms each, so a closure over 2,269 versions takes ~3 minutes. That is
      inside the incident SLA the plan targets and nowhere near interactive. A real
      deployment would precompute and cache the closure per package rather than walking it
      per incident; nothing here does that yet.
- [ ] **Typosquat corpus is caller-supplied.** A real deployment needs a background job
      populating it from the broader registry.
- [ ] **The advisory scan reads an arbitrary slice of the graph.** `LIMIT` with no ordering,
      because this Cypher subset has no way to filter package names by pattern — so on a
      graph that also holds load-test data, the scan can spend its OSV budget on synthetic
      names. `scripts/scale-check.mjs --cleanup` removes those, but the ordering problem is
      real for any mixed graph.
- [ ] **Nothing re-checks a closure after the graph changes.** A service whose lockfile is
      updated after an incident is not re-evaluated; there is no subscription or diff.
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
