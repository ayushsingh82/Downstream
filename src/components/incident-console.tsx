"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { BlastGraph, type GraphPath } from "./blast-graph"

interface ExposedService {
  serviceId: number
  serviceName: string
  hops: number
  via: string[]
  /** Which pass found it — the lockfile lookup, or the upstream walk. */
  foundBy?: "lockfile" | "closure"
}

interface BlastRadius {
  mode: "exhaustive" | "sspaths"
  sourceId: number
  exposedServices: ExposedService[]
  exposedProjects: { projectId: number; projectName: string; hops: number }[]
  paths: GraphPath[]
  pathCount: number
  truncated: boolean
  /** Present in exhaustive mode: how much of the graph the closure walked. */
  closure?: {
    versionsReached: number
    nodesReached: number
    rounds: number
    queries: number
    directHits: number
    closureOnlyHits: number
    directMs: number
    closureMs: number
  }
}

interface Stats {
  healthy: boolean
  packages?: number
  versions?: number
  services?: number
}

type LogLevel = "info" | "ok" | "warn" | "err"
interface LogLine {
  level: LogLevel
  text: string
  at: number
}

const LOG_COLOR: Record<LogLevel, string> = {
  info: "text-neutral-500",
  ok: "text-[#0A7B34]",
  warn: "text-[#B45309]",
  err: "text-[#FC0001]",
}

/**
 * The scenario: a real npm package subtree from deps.dev, two internal services
 * whose lockfiles pin versions inside it, then a compromise on a *transitive*
 * dependency — the case declared-range tooling misses, because nothing in either
 * service's package.json names the compromised package at all.
 */
const SCENARIO = {
  root: { ecosystem: "npm" as const, name: "express", version: "4.19.2" },
  compromise: { ecosystem: "npm" as const, name: "cookie", version: "0.6.0" },
  services: [
    {
      serviceName: "checkout-api",
      projectName: "checkout",
      resolvedAt: Date.UTC(2023, 10, 14, 9, 0),
      entries: [
        { name: "express", version: "4.19.2" },
        { name: "body-parser", version: "1.20.2" },
        { name: "cookie", version: "0.6.0" },
      ],
    },
    {
      serviceName: "billing-worker",
      projectName: "billing",
      resolvedAt: Date.UTC(2023, 10, 14, 9, 8),
      entries: [{ name: "cookie", version: "0.6.0" }],
    },
  ],
}

export function IncidentConsole() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [log, setLog] = useState<LogLine[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [radius, setRadius] = useState<BlastRadius | null>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [seeded, setSeeded] = useState(false)
  const [typosquats, setTyposquats] = useState<{ name: string; distance: number }[] | null>(null)
  const [selectedService, setSelectedService] = useState<number | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const append = useCallback((level: LogLevel, text: string) => {
    setLog((prev) => [...prev, { level, text, at: Date.now() }])
  }, [])

  /**
   * Reads graph-node state and pushes it into React when it arrives. setStats
   * runs in the promise continuation rather than in an effect body, so the
   * effect below only kicks off the request — it does not set state itself.
   */
  const refreshStats = useCallback(
    () =>
      fetch("/api/stats")
        .then((res) => res.json())
        .then((json: Stats) => setStats(json))
        .catch(() => setStats({ healthy: false })),
    []
  )

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/stats", { signal: controller.signal })
      .then((res) => res.json())
      .then((json: Stats) => setStats(json))
      .catch(() => {
        if (!controller.signal.aborted) setStats({ healthy: false })
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log])

  async function post(path: string, body: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? `${path} failed with ${res.status}`)
    return json
  }

  async function seed() {
    setBusy("seed")
    setRadius(null)
    try {
      append("info", `deps.dev → resolved dependency graph for ${SCENARIO.root.name}@${SCENARIO.root.version}`)
      const ingested = await post("/api/ingest", {
        ...SCENARIO.root,
        typosquatCorpus: ["expres", "expressjs", "express", "expresss", "react"],
      })
      append(
        "ok",
        `ingested ${ingested.packagesIngested} packages · ${ingested.versionsIngested} versions · ${ingested.edgesIngested} RESOLVES_TO edges · ${ingested.maintainersIngested} maintainers`
      )
      if (ingested.typosquatEdges) {
        append("ok", `precomputed ${ingested.typosquatEdges} NAME_SIMILAR_TO edges`)
      }

      for (const service of SCENARIO.services) {
        const result = await post("/api/service", { ecosystem: "npm", ...service })
        append(
          "ok",
          `registered ${service.serviceName} → ${service.projectName}, lockfile pins ${result.pinned}/${service.entries.length}`
        )
        if (result.skipped > 0) {
          append("warn", `${result.skipped} pin(s) skipped — those versions aren't in the graph`)
        }
      }

      setSeeded(true)
      await refreshStats()
      append("info", "graph ready — nothing is flagged compromised yet")
    } catch (error) {
      append("err", (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function compromise() {
    setBusy("compromise")
    setRadius(null)
    setElapsed(null)
    setSelectedService(null)
    const target = SCENARIO.compromise
    try {
      append("warn", `advisory: ${target.name}@${target.version} flagged compromised`)

      // Two passes, because they answer two different questions. The first is
      // the lockfile lookup: sub-second, and complete for every service whose
      // lockfile records what it installed — that is the number an on-call
      // engineer needs inside the incident. The second walks the resolved
      // dependency graph upstream to catch services whose lockfile does not
      // record the dependency at all, and takes as long as the closure is big.
      const startedAt = performance.now()
      const fast = await post("/api/compromise", { ...target, skipClosure: true })
      const took = performance.now() - startedAt

      setRadius(fast.blastRadius)
      setElapsed(Math.round(took))

      const radius: BlastRadius = fast.blastRadius
      const services: ExposedService[] = radius.exposedServices
      append(
        services.length ? "err" : "ok",
        `blast radius resolved in ${Math.round(took)}ms — ${services.length} service(s) exposed across ${radius.pathCount} paths`
      )
      if (radius.closure) {
        append(
          "ok",
          `lockfile pass answered in ${radius.closure.directMs}ms — ${radius.closure.directHits} service(s) pin it directly`
        )
      }
      if (radius.truncated) {
        append(
          "warn",
          `traversal hit its ${radius.pathCount}-path cap — there may be exposures beyond this set`
        )
      }
      for (const service of services) {
        append("err", `  ${service.serviceName} — ${service.hops} hops`)
      }
      if (!services.length) {
        append("ok", "no service reaches that version — seed the scenario first")
      }

      append("info", "confirming completeness — walking the resolved graph upstream…")
      const full = await fetch(
        `/api/blast-radius?ecosystem=${target.ecosystem}&name=${target.name}&version=${target.version}`
      ).then((res) => res.json())

      const complete: BlastRadius = full.radius
      setRadius(complete)
      const extra = complete.exposedServices.length - services.length
      append(
        extra > 0 ? "err" : "ok",
        extra > 0
          ? `${extra} further service(s) exposed through dependencies their lockfiles do not pin`
          : `closure agrees: ${complete.exposedServices.length} exposed, nothing missed by the lockfile pass`
      )
      if (complete.closure) {
        append(
          "info",
          `walked ${complete.closure.versionsReached} version(s), depth ${complete.closure.rounds}, ` +
            `${complete.closure.queries} queries · lockfile pass ${complete.closure.directMs}ms, ` +
            `closure ${complete.closure.closureMs}ms`
        )
      }
    } catch (error) {
      append("err", (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function lookupTyposquats() {
    setBusy("typosquat")
    try {
      const res = await fetch(`/api/typosquat?ecosystem=npm&name=${SCENARIO.root.name}`)
      const json = await res.json()
      setTyposquats(json.candidates ?? [])
      append("info", `${json.candidates?.length ?? 0} name-similar package(s) to ${SCENARIO.root.name}`)
    } catch (error) {
      append("err", (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const nodeDown = stats && !stats.healthy

  return (
    <section id="console" className="border-t-2 border-black bg-white px-6 py-20 md:px-12">
      <div className="mx-auto max-w-6xl">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.35em] text-[#FC0001]">
          Live incident console
        </p>
        <h2 className="mb-4 text-3xl font-bold uppercase tracking-tight md:text-5xl">
          Compromise a transitive dep.
          <br />
          Watch who is exposed.
        </h2>
        <p className="mb-10 max-w-2xl text-sm leading-relaxed text-neutral-600">
          Every number below comes from a real HydraDB graph-node and a real deps.dev
          resolved dependency graph. Nothing here is mocked. The compromised package is a
          transitive dependency, so neither service names it in its own manifest — the
          exposure only exists in the resolved graph.
        </p>

        {nodeDown && (
          <div className="mb-8 border-2 border-[#FC0001] bg-[#FFF1F1] p-4 text-sm">
            <span className="font-bold uppercase tracking-wider text-[#FC0001]">
              graph-node unreachable
            </span>
            <p className="mt-2 text-neutral-700">
              Start a local node (see README) and reload. The console talks to a real
              database; there is no offline fallback by design.
            </p>
          </div>
        )}

        <div className="mb-8 grid grid-cols-2 gap-px border-2 border-black bg-black md:grid-cols-4">
          {[
            { label: "node", value: stats ? (stats.healthy ? "ready" : "down") : "…" },
            { label: "packages", value: stats?.packages ?? "—" },
            { label: "versions", value: stats?.versions ?? "—" },
            { label: "services", value: stats?.services ?? "—" },
          ].map((tile) => (
            <div key={tile.label} className="bg-white p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-500">
                {tile.label}
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{tile.value}</div>
            </div>
          ))}
        </div>

        <div className="mb-8 flex flex-wrap gap-3">
          <button
            onClick={seed}
            disabled={busy !== null}
            className="border-2 border-black bg-black px-5 py-3 text-xs font-bold uppercase tracking-[0.2em] text-white transition-colors hover:bg-neutral-800 disabled:opacity-40"
          >
            {busy === "seed" ? "ingesting…" : "1 · seed real graph"}
          </button>
          <button
            onClick={compromise}
            disabled={busy !== null || !seeded}
            className="border-2 border-[#FC0001] bg-[#FC0001] px-5 py-3 text-xs font-bold uppercase tracking-[0.2em] text-white transition-colors hover:bg-[#d40001] disabled:opacity-40"
          >
            {busy === "compromise"
              ? "tracing…"
              : `2 · compromise ${SCENARIO.compromise.name}@${SCENARIO.compromise.version}`}
          </button>
          <button
            onClick={lookupTyposquats}
            disabled={busy !== null || !seeded}
            className="border-2 border-black bg-white px-5 py-3 text-xs font-bold uppercase tracking-[0.2em] transition-colors hover:bg-neutral-100 disabled:opacity-40"
          >
            3 · typosquat neighbours
          </button>
        </div>

        <div className="grid gap-px border-2 border-black bg-black lg:grid-cols-2">
          {/* Blast radius */}
          <div className="bg-white p-6">
            <div className="mb-4 flex items-baseline justify-between">
              <h3 className="text-xs font-bold uppercase tracking-[0.3em]">Blast radius</h3>
              {elapsed !== null && (
                <span className="text-xs font-bold tabular-nums text-[#FC0001]">{elapsed}ms</span>
              )}
            </div>

            {!radius && (
              <p className="text-sm text-neutral-500">
                Seed the graph, then trigger the compromise.
              </p>
            )}

            {radius && radius.exposedServices.length === 0 && (
              <p className="text-sm text-neutral-500">No exposed services found.</p>
            )}

            {radius?.truncated && (
              <p className="mb-4 border-2 border-[#B45309] bg-[#FFFBEB] p-3 text-[11px] text-[#B45309]">
                Traversal hit its {radius.pathCount}-path cap. This set is complete for the
                paths returned, but not proven exhaustive.
              </p>
            )}

            {radius && radius.paths.length > 0 && (
              <div className="mb-5">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-500">
                    exposure graph
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-neutral-400">
                    {radius.mode === "exhaustive" ? "closure enumerated" : "sspaths sample"} · hover a node
                  </span>
                </div>
                <BlastGraph
                  paths={radius.paths}
                  sourceId={radius.sourceId}
                  highlightService={selectedService}
                />
              </div>
            )}

            {radius?.exposedServices.map((service) => (
              <div
                key={service.serviceId}
                onMouseEnter={() => setSelectedService(service.serviceId)}
                onMouseLeave={() => setSelectedService(null)}
                className="mb-4 border-2 border-[#FC0001] bg-[#FFF6F6] p-4"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-bold uppercase tracking-wider text-[#FC0001]">
                    {service.serviceName}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">
                    {service.foundBy === "closure" ? "closure only · " : ""}
                    {service.hops} hops
                  </span>
                </div>
                <ol className="mt-3 space-y-1 text-xs text-neutral-700">
                  {service.via.map((step, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-neutral-400">{i === 0 ? "└" : " "}→</span>
                      <span className="break-all">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}

            {radius && radius.exposedProjects.length > 0 && (
              <div className="mt-4 border-t-2 border-black pt-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-500">
                  projects touched
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {radius.exposedProjects.map((p) => (
                    <span
                      key={p.projectId}
                      className="border-2 border-black px-2 py-1 text-[11px] font-bold uppercase tracking-wider"
                    >
                      {p.projectName} · {p.hops}h
                    </span>
                  ))}
                </div>
              </div>
            )}

            {typosquats && (
              <div className="mt-6 border-t-2 border-black pt-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-500">
                  name-similar to {SCENARIO.root.name}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {typosquats.length === 0 && (
                    <span className="text-xs text-neutral-500">none precomputed</span>
                  )}
                  {typosquats.map((t) => (
                    <span
                      key={t.name}
                      className="border-2 border-[#B45309] px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[#B45309]"
                    >
                      {t.name} · d{t.distance}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Log */}
          <div className="bg-white p-6">
            <h3 className="mb-4 text-xs font-bold uppercase tracking-[0.3em]">Trace</h3>
            <div
              ref={logRef}
              className="h-[26rem] overflow-y-auto border-2 border-black bg-neutral-50 p-3 text-[11px] leading-relaxed"
            >
              {log.length === 0 && <span className="text-neutral-400">waiting…</span>}
              {log.map((line, i) => (
                <div key={i} className={`${LOG_COLOR[line.level]} break-all`}>
                  <span className="text-neutral-400">
                    {new Date(line.at).toLocaleTimeString("en-GB", { hour12: false })}{" "}
                  </span>
                  {line.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
