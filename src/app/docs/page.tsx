import Link from "next/link"
import { SubpageHeader } from "@/components/subpage-header"
import { DocsSidebar } from "@/components/docs-sidebar"
import { CodeBlock } from "@/components/code-block"

const QUICK_FACTS = [
  { value: "110ms", label: "Blast radius", sub: "140 services, 84K versions" },
  { value: "700ms", label: "Path explain", sub: "algo.SPpaths" },
  { value: "333K", label: "Resolved edges", sub: "load-tested graph" },
  { value: "0", label: "Vector calls", sub: "graph-native only" },
]

const API_ROUTES = [
  { route: "GET /api/health", purpose: "graph-node reachability (/readyz)" },
  { route: "GET /api/stats", purpose: "Package / version / service counts" },
  { route: "POST /api/ingest", purpose: "Pull a deps.dev subtree + registry maintainers into the graph" },
  { route: "POST /api/service", purpose: "Register a Service → Project → Lockfile with pinned versions" },
  { route: "POST /api/compromise", purpose: "Flag a version, then bookmark-read its blast radius back" },
  { route: "GET /api/blast-radius", purpose: "Blast radius + shared maintainers + live-window lockfiles" },
  { route: "GET /api/typosquat", purpose: "Precomputed NAME_SIMILAR_TO neighbours" },
]

const WIRE_NOTES = [
  {
    title: "The parameter field is `parameters`, not `params`",
    body: "The HydraDB README's own curl example doesn't show a params-bearing query, so this had to be found by hitting the wire. Sending params yields a 400 claiming a missing OpenCypher parameter — source of truth is src/client/http.rs:283 (HttpQueryRequestBody).",
  },
  {
    title: "Rows are positional, not alias-keyed objects",
    body: "The response is { columns: [...], rows: [[{type,value}, ...], ...] } — a Vec<Vec<TypedValue>> aligned to columns, not an array of {alias: value} objects. Every value is wrapped as {type, value}, with type one of: null, vertex_id, integer, signed_integer, float, boolean, string, list, path.",
  },
  {
    title: "Standalone vertex MERGE is rejected outside UNWIND",
    body: "MERGE (u {id:$x}) SET u:User, ... fails with \"MERGE with following clauses is not executable.\" There is no way to create a lone vertex except through the UNWIND batch form, or by attaching it to a one-hop MERGE edge pattern.",
  },
  {
    title: "UNWIND edge writes have two undocumented requirements",
    body: "Both endpoints need exactly one label, and the relationship needs an inline {id: row.<field>} identity property — otherwise the statement doesn't parse. That inline id is also what makes re-running an identical batch idempotent: verified count(*) = 1 after two runs of the same edge set.",
  },
  {
    title: "relTypes must be a literal array in the query string",
    body: "Passing relTypes as a parameter fails: \"composite parameter $relTypes is only supported as an UNWIND input.\" Scalar config values (sourceNode, maxLen, pathCount) work fine as parameters.",
  },
  {
    title: "Multi-type, bidirectional relTypes traversal is real",
    body: "algo.SSpaths with relTypes: ['RESOLVES_TO','PINS','HAS_LOCKFILE'] and relDirection: 'both' correctly walks a mixed-edge-type chain against its stored direction — verified end to end from a compromised PackageVersion through to the exposed Project. This is the traversal the blast-radius query depends on.",
  },
  {
    title: "CLOUD_PROVIDER=memory, not local, for this demo",
    body: "The documented local file-store object provider doesn't implement the conditional write SlateDB needs once its manifest flushes, and the failure surfaces as a bare 500 on an unrelated statement. memory has no such limit but isn't durable across a container restart — fine for a demo, not for production.",
  },
]

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "graph-model", label: "Graph model" },
  { id: "why-graph", label: "What this loses without HydraDB" },
  { id: "wire-contract", label: "Wire contract, verified live" },
  { id: "api", label: "API" },
  { id: "run-locally", label: "Run it locally" },
  { id: "attribution", label: "Third-party attribution" },
]

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-white text-foreground font-mono">
      <SubpageHeader label="docs" />

      <div className="mx-auto flex max-w-6xl gap-12 px-6 py-10 lg:px-12">
        <DocsSidebar sections={SECTIONS} />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <section id="overview" className="pb-14">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.35em] text-[#FC0001]">
              How this was built
            </p>
            <h1 className="max-w-2xl text-2xl font-black uppercase tracking-tight md:text-4xl">
              The defender&apos;s question is a graph traversal.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-neutral-600">
              A package is flagged compromised at 09:00. Which services are exposed by 09:06?
              That&apos;s a transitive reverse-dependency closure over a versioned graph —
              traversal, not similarity search, and it has to come back fast. This page
              documents the graph model, what HydraDB does that a client-side approach
              can&apos;t, and the wire-level constraints that don&apos;t appear in HydraDB&apos;s
              own published docs.
            </p>

            <div className="mt-8 grid grid-cols-2 border-2 border-black sm:grid-cols-4">
              {QUICK_FACTS.map((f, i) => (
                <div
                  key={f.label}
                  className={`flex flex-col gap-1 p-4 ${i < QUICK_FACTS.length - 1 ? "border-r-2 border-black" : ""}`}
                >
                  <span className="text-xl font-mono font-black tabular-nums">{f.value}</span>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-600">
                    {f.label}
                  </span>
                  <span className="text-[10px] font-mono text-neutral-400">{f.sub}</span>
                </div>
              ))}
            </div>
          </section>

          <section id="graph-model" className="pb-14">
            <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-[#FC0001]">
              Graph model
            </h2>
            <CodeBlock
              code={`(:Package {id, name, ecosystem})                    // npm | pypi
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
(:Package)-[:NAME_SIMILAR_TO {distance}]->(:Package)                // typosquat, precomputed`}
            />
            <p className="mt-4 text-sm leading-relaxed text-neutral-600">
              <code className="bg-neutral-100 px-1">RESOLVES_TO</code> comes from deps.dev&apos;s
              computed dependency graph, so it records what actually got installed — declared
              semver ranges alone can&apos;t answer &ldquo;transitively exposed.&rdquo;{" "}
              <code className="bg-neutral-100 px-1">NAME_SIMILAR_TO</code> is precomputed at
              ingest because HydraDB&apos;s <code className="bg-neutral-100 px-1">WHERE</code>{" "}
              has no string-distance or substring operators at all — no{" "}
              <code className="bg-neutral-100 px-1">CONTAINS</code>, no{" "}
              <code className="bg-neutral-100 px-1">ENDS WITH</code> — so this can&apos;t be a
              query-time computation.
            </p>
          </section>

          <section id="why-graph" className="pb-14">
            <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-[#FC0001]">
              What this loses without HydraDB
            </h2>
            <ul className="flex flex-col gap-4 text-sm leading-relaxed text-neutral-700">
              <li>
                <strong>algo.SSpaths with relDirection: &apos;both&apos;</strong> walks four
                relationship types in one native call, against the stored edge direction.
                Without a native path procedure this becomes a client-side BFS — one round trip
                per frontier node per hop, which at incident time is the difference between an
                answer and a spreadsheet.
              </li>
              <li>
                <strong>UNWIND batch writes</strong> load 128 resolved edges in a handful of
                statements instead of one round trip per edge.
              </li>
              <li>
                <strong>Bookmark-threaded causal reads</strong> let the compromise write hand
                its durable sequence to the traversal that follows it, so the UI never shows a
                stale blast radius without paying strong consistency on the expensive half of
                the request.
              </li>
              <li>
                <strong>algo.SPpaths</strong> returns whole paths with weights. A plain{" "}
                <code className="bg-neutral-100 px-1">MATCH</code> projects endpoints only, so
                &ldquo;why is checkout-api affected&rdquo; wouldn&apos;t be answerable at all.
              </li>
            </ul>
          </section>

          <section id="wire-contract" className="pb-14">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.3em] text-[#FC0001]">
              HydraDB wire contract — verified live
            </h2>
            <p className="mb-6 text-sm leading-relaxed text-neutral-600">
              Every line below was confirmed by a real request against a running graph-node,
              not read off HydraDB&apos;s published documentation. Full detail in{" "}
              <code className="bg-neutral-100 px-1">HYDRADB-NOTES.md</code> in the repo.
            </p>
            <div className="flex flex-col gap-px border-2 border-black bg-black">
              {WIRE_NOTES.map((note) => (
                <div key={note.title} className="bg-white p-5">
                  <h3 className="mb-1.5 text-xs font-black uppercase tracking-wide">
                    {note.title}
                  </h3>
                  <p className="text-[13px] leading-relaxed text-neutral-600">{note.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="api" className="pb-14">
            <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-[#FC0001]">
              API
            </h2>
            <div className="border-2 border-black">
              {API_ROUTES.map((r, i) => (
                <div
                  key={r.route}
                  className={`grid grid-cols-1 gap-1 p-4 sm:grid-cols-[220px_1fr] sm:gap-4 ${
                    i < API_ROUTES.length - 1 ? "border-b border-neutral-200" : ""
                  }`}
                >
                  <code className="text-xs font-bold">{r.route}</code>
                  <span className="text-xs text-neutral-600">{r.purpose}</span>
                </div>
              ))}
            </div>
            <div className="mt-6">
              <CodeBlock
                code={`curl -X POST localhost:3000/api/ingest -H 'content-type: application/json' \\
  -d '{"ecosystem":"npm","name":"express","version":"4.19.2"}'

curl -X POST localhost:3000/api/service -H 'content-type: application/json' \\
  -d '{"ecosystem":"npm","serviceName":"checkout-api","projectName":"checkout",
       "entries":[{"name":"cookie","version":"0.6.0"}]}'

curl -X POST localhost:3000/api/compromise -H 'content-type: application/json' \\
  -d '{"ecosystem":"npm","name":"cookie","version":"0.6.0"}'`}
              />
            </div>
          </section>

          <section id="run-locally" className="pb-14">
            <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-[#FC0001]">
              Run it locally
            </h2>
            <p className="mb-4 text-sm leading-relaxed text-neutral-600">
              Requires Node 20+ and Docker. No API keys — every external source here (deps.dev,
              npm registry, PyPI JSON, OSV.dev) is public and unauthenticated.
            </p>
            <CodeBlock
              code={`mkdir -p .hydradb/store .hydradb/cache
printf '%s\\n' 'local-development-token-32-bytes' > .hydradb/auth-token

docker run -d --name hydradb --user "$(id -u):$(id -g)" \\
  -p 7687:7687 -p 8443:8443 -p 9090:9090 -v "$PWD/.hydradb:/data" \\
  -e CLOUD_PROVIDER=memory \\
  -e GRAPH_NAMESPACE=default -e GRAPH_ID=default \\
  -e GRAPH_CELL_ID=cell-0 -e GRAPH_CELLS=cell-0 -e GRAPH_NODE_ID=node-0 \\
  -e GRAPH_BOLT_NODE_ADDRESSES=node-0=127.0.0.1:7687 \\
  -e GRAPH_ADVERTISED_BOLT_ADDR=127.0.0.1:7687 \\
  -e GRAPH_DATA_CACHE_DIR=/data/cache \\
  -e GRAPH_AUTH_TOKEN_FILE=/data/auth-token \\
  -e GRAPH_ALLOW_PLAINTEXT=true -e RUST_MIN_STACK=33554432 \\
  ghcr.io/hydra-db/hydradb:latest

cp .env.example .env.local && npm install && npm run dev`}
            />
            <p className="mt-4 text-sm leading-relaxed text-neutral-600">
              Then open the{" "}
              <Link href="/dashboard" className="underline underline-offset-2 hover:text-black">
                dashboard
              </Link>{" "}
              and step through seed → compromise → typosquat. Readiness check:{" "}
              <code className="bg-neutral-100 px-1">curl -sf localhost:9090/readyz</code>.
            </p>
          </section>

          <section id="attribution" className="pb-14">
            <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-[#FC0001]">
              Third-party attribution
            </h2>
            <ul className="flex flex-col gap-1.5 text-[11px] text-neutral-600">
              <li>HydraDB — graph database</li>
              <li>deps.dev API (Google) — resolved transitive dependency graphs</li>
              <li>npm registry API — package metadata, maintainers, publish times</li>
              <li>PyPI JSON API — package metadata, releases</li>
              <li>OSV.dev (Google) — real vulnerability / malicious-package records</li>
              <li>TanStack npm/PyPI incident (May 2025) — scenario shape, from public reporting only</li>
              <li>Next.js, React, Tailwind CSS, Framer Motion, lucide-react, Geist — app framework and UI</li>
            </ul>
            <p className="mt-4 text-[11px] text-neutral-500">
              This project ingests metadata and resolved-dependency graphs only. It never
              downloads, installs, or executes package code, malicious or otherwise.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
