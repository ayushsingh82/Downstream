#!/usr/bin/env node
/**
 * Load test: builds a registry-shaped dependency graph large enough to make the
 * traversal question real, then measures the blast-radius answer on it.
 *
 * The demo graph (one 71-version express subtree) proves correctness and
 * nothing about scale, and the incident SLA the plan targets — "compromised at
 * 09:00, exposed services by 09:06" — is a claim about a graph with hundreds of
 * thousands of versioned nodes. This script produces that graph.
 *
 * Writes go straight to the graph-node rather than through /api/ingest, because
 * the app's ingest path is bound to deps.dev and no public API hands out
 * 200,000 versions on demand. The two UNWIND forms here are the same ones
 * src/lib/graphwrite.ts issues, with the same constraints (HYDRADB-NOTES.md).
 *
 *   node scripts/scale-check.mjs                        # 50k versions, 200 services
 *   node scripts/scale-check.mjs --versions 200000 --services 500
 *   node scripts/scale-check.mjs --versions 5000 --skip-write   # query-only re-run
 *   node scripts/scale-check.mjs --versions 5000 --cleanup      # remove what it wrote
 */

import { createHash } from "node:crypto"

const args = {
  versions: 50_000,
  services: 200,
  layers: 6,
  fanout: 4,
  pinsPerService: 60,
  batch: 500,
  concurrency: 4,
  base: process.env.SCALE_BASE_URL ?? "http://localhost:3002",
  http: process.env.HYDRADB_HTTP_URL ?? "http://127.0.0.1:8443",
  token: process.env.HYDRADB_AUTH_TOKEN ?? "local-development-token-32-bytes",
  namespace: process.env.HYDRADB_NAMESPACE ?? "default",
  graph: process.env.HYDRADB_GRAPH ?? "default",
  cell: process.env.HYDRADB_CELL_ID ?? "cell-0",
  prefix: "scale",
  skipWrite: false,
  cleanup: false,
  closure: false,
}

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]
  const next = () => process.argv[++i]
  if (arg === "--versions") args.versions = Number(next())
  else if (arg === "--services") args.services = Number(next())
  else if (arg === "--layers") args.layers = Number(next())
  else if (arg === "--fanout") args.fanout = Number(next())
  else if (arg === "--pins") args.pinsPerService = Number(next())
  else if (arg === "--batch") args.batch = Number(next())
  else if (arg === "--concurrency") args.concurrency = Number(next())
  else if (arg === "--base") args.base = next()
  else if (arg === "--prefix") args.prefix = next()
  else if (arg === "--skip-write") args.skipWrite = true
  else if (arg === "--cleanup") {
    // Cleanup is a removal pass, not a build-then-remove: writing the graph
    // again first would be minutes of pointless work.
    args.cleanup = true
    args.skipWrite = true
  }
  else if (arg === "--closure") args.closure = true
  else {
    console.error(`Unknown argument: ${arg}`)
    process.exit(1)
  }
}

async function query(cypher, parameters, consistency = "causal") {
  const res = await fetch(`${args.http}/v1/graphs/${args.graph}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.token}`,
      "X-Graph-Namespace": args.namespace,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cell_id: args.cell,
      query: cypher,
      ...(parameters ? { parameters } : {}),
      consistency,
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`graph-node ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

/** Byte-for-byte the identity src/lib/id.ts computes, so ids line up with the app. */
function stableId(key) {
  const hash = createHash("sha256").update(key).digest()
  let value = 0
  for (let i = 0; i < 6; i++) value = value * 256 + hash[i]
  return value
}

/** Deterministic PRNG — a rerun has to hit the same graph to be comparable. */
function rng(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const random = rng(20260818)

async function writeVertices(label, rows) {
  const properties = Object.keys(rows[0]).filter((k) => k !== "vertex")
  const setClauses = [`n:${label}`, ...properties.map((p) => `n.${p} = row.${p}`)].join(", ")
  await query(`UNWIND $rows AS row MERGE (n {id: row.vertex}) SET ${setClauses}`, { rows })
}

async function writeEdges(fromLabel, relType, toLabel, rows) {
  const payload = rows.map((row) => ({
    ...row,
    rel: stableId(`edge:${relType}:${row.from}:${row.to}`),
  }))
  await query(
    `UNWIND $rows AS row
     MATCH (s:${fromLabel} {id: row.from}), (d:${toLabel} {id: row.to})
     MERGE (s)-[r:${relType} {id: row.rel}]->(d)`,
    { rows: payload }
  )
}

/** Runs batched writes with a bounded number of requests in flight. */
async function writeAll(rows, fn) {
  if (rows.length === 0) return
  const batches = []
  for (let i = 0; i < rows.length; i += args.batch) batches.push(rows.slice(i, i + args.batch))
  let done = 0
  for (let i = 0; i < batches.length; i += args.concurrency) {
    const slice = batches.slice(i, i + args.concurrency)
    await Promise.all(slice.map(fn))
    done += slice.reduce((n, b) => n + b.length, 0)
    process.stdout.write(`\r  ${done}/${rows.length}   `)
  }
  process.stdout.write("\r" + " ".repeat(40) + "\r")
}

/* ------------------------------------------------------------------ *
 * Graph shape                                                        *
 * ------------------------------------------------------------------ */

// Layer 0 is application-level; the last layer is the utility packages every
// tree bottoms out in. Real registries are shaped like this — a handful of
// nodes with enormous fan-in (the cookie/debug/ms tier) under a long tail. A
// compromise down there is the expensive case, and the only one worth testing.
const perLayer = Math.max(1, Math.floor(args.versions / args.layers))
const layers = []
let counter = 0
for (let l = 0; l < args.layers; l++) {
  const size = l === args.layers - 1 ? Math.max(1, Math.floor(perLayer / 20)) : perLayer
  const layer = []
  for (let i = 0; i < size && counter < args.versions; i++, counter++) {
    const name = `${args.prefix}-l${l}-p${i}`
    layer.push({
      name,
      version: "1.0.0",
      pkgId: stableId(`pkg:npm:${name}`),
      verId: stableId(`pkgver:npm:${name}@1.0.0`),
      layer: l,
    })
  }
  layers.push(layer)
}
const allVersions = layers.flat()

console.log(`target       ${allVersions.length} versions across ${args.layers} layers`)
console.log(`             layer sizes ${layers.map((l) => l.length).join(", ")}`)
console.log(`services     ${args.services}, ${args.pinsPerService} direct picks each`)
console.log(`graph-node   ${args.http}`)
console.log(`app          ${args.base}\n`)

const dependencies = new Map()
for (let l = 0; l < args.layers - 1; l++) {
  const below = layers[l + 1]
  for (const node of layers[l]) {
    const deps = new Set()
    for (let d = 0; d < args.fanout; d++) {
      // Biased towards the front of the layer, which is what produces the few
      // very-high-fan-in packages a real registry has.
      const skew = Math.floor(below.length * random() * random())
      deps.add(below[Math.min(skew, below.length - 1)].verId)
    }
    dependencies.set(node.verId, [...deps])
  }
}

if (!args.skipWrite) {
  const writeStart = Date.now()
  let written = 0

  console.log("writing packages…")
  await writeAll(
    allVersions.map((v) => ({ vertex: v.pkgId, name: v.name, ecosystem: "npm" })),
    (batch) => writeVertices("Package", batch)
  )
  written += allVersions.length

  console.log("writing versions…")
  await writeAll(
    allVersions.map((v) => ({
      vertex: v.verId,
      package_id: v.pkgId,
      version: v.version,
      compromised: false,
      compromised_at: 0,
    })),
    (batch) => writeVertices("PackageVersion", batch)
  )
  written += allVersions.length

  console.log("writing HAS_VERSION…")
  await writeAll(
    allVersions.map((v) => ({ from: v.pkgId, to: v.verId })),
    (batch) => writeEdges("Package", "HAS_VERSION", "PackageVersion", batch)
  )
  written += allVersions.length

  const resolvesRows = []
  for (const [from, tos] of dependencies) for (const to of tos) resolvesRows.push({ from, to })
  console.log(`writing RESOLVES_TO (${resolvesRows.length})…`)
  await writeAll(resolvesRows, (batch) =>
    writeEdges("PackageVersion", "RESOLVES_TO", "PackageVersion", batch)
  )
  written += resolvesRows.length

  const services = []
  const projects = []
  const lockfiles = []
  const runs = []
  const hasLockfile = []
  const pins = []
  const resolvedAt = Date.UTC(2026, 7, 1)

  for (let i = 0; i < args.services; i++) {
    const svcName = `${args.prefix}-svc-${i}`
    const projName = `${args.prefix}-proj-${i}`
    const svcId = stableId(`service:${svcName}`)
    const projId = stableId(`project:${projName}`)
    const lockId = stableId(`lockfile:${projName}:${resolvedAt}`)

    services.push({ vertex: svcId, name: svcName })
    projects.push({ vertex: projId, name: projName })
    lockfiles.push({ vertex: lockId, project_id: projId, resolved_at: resolvedAt })
    runs.push({ from: svcId, to: projId })
    hasLockfile.push({ from: projId, to: lockId })

    // A lockfile pins what actually got installed: the direct picks plus their
    // whole resolved subtree. Pinning only the direct picks would make every
    // exposure one hop deep and quietly turn the load test into a toy.
    const pinned = new Set()
    const queue = []
    for (let p = 0; p < args.pinsPerService; p++) {
      queue.push(layers[0][Math.floor(random() * layers[0].length)].verId)
    }
    while (queue.length) {
      const id = queue.pop()
      if (pinned.has(id)) continue
      pinned.add(id)
      for (const dep of dependencies.get(id) ?? []) queue.push(dep)
    }
    for (const verId of pinned) pins.push({ from: lockId, to: verId })
  }

  console.log(`writing ${services.length} services / ${pins.length} PINS…`)
  await writeAll(services, (batch) => writeVertices("Service", batch))
  await writeAll(projects, (batch) => writeVertices("Project", batch))
  await writeAll(lockfiles, (batch) => writeVertices("Lockfile", batch))
  await writeAll(runs, (batch) => writeEdges("Service", "RUNS", "Project", batch))
  await writeAll(hasLockfile, (batch) => writeEdges("Project", "HAS_LOCKFILE", "Lockfile", batch))
  await writeAll(pins, (batch) => writeEdges("Lockfile", "PINS", "PackageVersion", batch))
  written += services.length * 3 + runs.length + hasLockfile.length + pins.length

  const seconds = (Date.now() - writeStart) / 1000
  console.log(
    `\nwrote        ${written} vertices+edges in ${seconds.toFixed(1)}s ` +
      `(${Math.round(written / seconds)}/sec)\n`
  )
}

/* ------------------------------------------------------------------ *
 * Cleanup                                                            *
 * ------------------------------------------------------------------ */

// Synthetic packages left in the graph would pollute anything that reads it as
// a registry — the OSV scan in particular, which asks the advisory feed about
// every package it finds and would spend that budget on names that do not
// exist. `DELETE` is accepted by the mutation engine and, like every other
// write here, has to bind its target by id inside the pattern.
if (args.cleanup) {
  const started = Date.now()
  const resolvedAt = Date.UTC(2026, 7, 1)

  // Edges first, and separately, because vertex deletion is the operation the
  // node refuses at size. `DELETE n` and `DETACH DELETE n` both scan every edge
  // in the graph — not the vertex's own edges — and trip
  // `delete_vertex_scan_edges rejected by admission control: actual 1000001
  // exceeds limit 1000000` on a graph this test itself creates. Deleting the
  // synthetic edges first drops the graph back under that ceiling, after which
  // the vertices can go too.
  const edgePatterns = [
    ["Package", "HAS_VERSION", "PackageVersion", allVersions.map((v) => v.pkgId)],
    ["PackageVersion", "RESOLVES_TO", "PackageVersion", allVersions.map((v) => v.verId)],
  ]
  for (let i = 0; i < args.services; i++) {
    edgePatterns.push(["Service", "RUNS", "Project", [stableId(`service:${args.prefix}-svc-${i}`)]])
    edgePatterns.push([
      "Project",
      "HAS_LOCKFILE",
      "Lockfile",
      [stableId(`project:${args.prefix}-proj-${i}`)],
    ])
    edgePatterns.push([
      "Lockfile",
      "PINS",
      "PackageVersion",
      [stableId(`lockfile:${args.prefix}-proj-${i}:${resolvedAt}`)],
    ])
  }

  let done = 0
  const totalSources = edgePatterns.reduce((n, [, , , ids]) => n + ids.length, 0)
  for (const [fromLabel, relType, toLabel, ids] of edgePatterns) {
    for (let i = 0; i < ids.length; i += args.concurrency) {
      await Promise.all(
        ids
          .slice(i, i + args.concurrency)
          .map((id) =>
            query(`MATCH (s:${fromLabel} {id: $id})-[r:${relType}]->(d:${toLabel}) DELETE r`, { id })
          )
      )
      done += Math.min(args.concurrency, ids.length - i)
      process.stdout.write(`\r  edges from ${done}/${totalSources} vertices   `)
    }
  }
  process.stdout.write("\r" + " ".repeat(44) + "\r")
  console.log(`removed      edges from ${totalSources} vertices`)

  const ids = [...allVersions.map((v) => v.pkgId), ...allVersions.map((v) => v.verId)]
  for (let i = 0; i < args.services; i++) {
    ids.push(stableId(`service:${args.prefix}-svc-${i}`))
    ids.push(stableId(`project:${args.prefix}-proj-${i}`))
    ids.push(stableId(`lockfile:${args.prefix}-proj-${i}:${resolvedAt}`))
  }

  console.log(`deleting ${ids.length} vertices…`)
  try {
    await writeAll(
      ids.map((id) => ({ vertex: id })),
      (batch) =>
        query(`UNWIND $rows AS row MATCH (n {id: row.vertex}) DETACH DELETE n`, { rows: batch })
    )
    console.log(`removed      ${ids.length} vertices in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  } catch (error) {
    // Said plainly rather than thrown: the edges are gone, so nothing traverses
    // into this data any more, but the vertices stay until the graph as a whole
    // is under the scan limit.
    console.error(`\nvertex deletion refused: ${error.message}`)
    console.error(
      `Edges are removed, so the synthetic graph is unreachable, but its vertices\n` +
        `remain. Vertex deletion scans every edge in the graph — not just the\n` +
        `vertex's own — so it only succeeds below the 1,000,000-edge limit. Re-run\n` +
        `--cleanup once other workloads have shrunk, or start a fresh graph-node.`
    )
    process.exit(1)
  }
  process.exit(0)
}

/* ------------------------------------------------------------------ *
 * The query the whole thing exists to answer                         *
 * ------------------------------------------------------------------ */

// The first package in the deepest layer: highest fan-in by construction, worst
// case for the traversal, and the realistic shape of a supply chain incident.
const hub = layers[args.layers - 1][0]
console.log(`compromising ${hub.name}@${hub.version} (layer ${hub.layer}, deepest tier)\n`)

async function measure(label, options) {
  const started = Date.now()
  const res = await fetch(`${args.base}/api/compromise`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ecosystem: "npm", name: hub.name, version: hub.version, ...options }),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.log(`${label.padEnd(18)} FAILED ${payload.error ?? res.status}`)
    return null
  }
  const radius = payload.blastRadius
  const elapsed = Date.now() - started
  const c = radius.closure
  console.log(
    `${label.padEnd(18)} ${String(radius.exposedServices.length).padStart(5)} services  ` +
      `${String(elapsed).padStart(7)}ms  ` +
      (radius.truncated ? `TRUNCATED at ${radius.pathCount} paths` : "complete") +
      (c
        ? `  (query ${c.directMs}ms · closure ${c.closureMs}ms · ` +
          `${c.versionsReached} versions walked · ${c.queries} queries)`
        : "")
  )
  return { services: radius.exposedServices.length, elapsed, truncated: radius.truncated }
}

// The lockfile lookup is the incident answer; the closure is the completeness
// check behind it. They are timed separately because they cost three orders of
// magnitude apart, and quoting only one of them would be a half-truth either way.
const direct = await measure("lockfile lookup", { skipClosure: true })
const sspaths = await measure("sspaths", { mode: "sspaths" })
const exhaustive = args.closure ? await measure("full closure", {}) : null

if (!args.closure) {
  console.log(`\n(--closure re-runs with the upstream walk; on this graph that is minutes, not ms)`)
}

const complete = exhaustive ?? direct
if (complete && sspaths) {
  const missed = complete.services - sspaths.services
  console.log()
  console.log(
    missed > 0
      ? `sspaths missed ${missed} of ${complete.services} exposed services ` +
          `(${((missed / complete.services) * 100).toFixed(1)}%) — the 1024-path cap, not a bug.`
      : `sspaths and the enumerated answer agree on ${complete.services} exposed services.`
  )
}

const stats = await (await fetch(`${args.base}/api/stats`)).json()
console.log(`\ngraph now    ${JSON.stringify(stats)}`)
