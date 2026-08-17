"use client"

import { useEffect, useState } from "react"

const CHANNELS = [
  { name: "NPM_REGISTRY", status: "ONLINE", latency: "14ms" },
  { name: "PYPI_REGISTRY", status: "ONLINE", latency: "19ms" },
  { name: "DEPS_DEV", status: "ONLINE", latency: "27ms" },
  { name: "OSV_DB", status: "ONLINE", latency: "11ms" },
  { name: "GITHUB_API", status: "ONLINE", latency: "33ms" },
]

export function StatusCard() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 2000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b-2 border-foreground px-4 py-2">
        <span className="text-[10px] tracking-widest text-muted-foreground uppercase">data.sources</span>
        <span className="text-[10px] tracking-widest text-muted-foreground">{`TICK:${String(tick).padStart(4, "0")}`}</span>
      </div>
      <div className="flex-1 flex flex-col p-4 gap-0">
        <div className="grid grid-cols-3 gap-2 border-b border-border pb-2 mb-2">
          <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground">Source</span>
          <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground">Status</span>
          <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground text-right">Latency</span>
        </div>
        {CHANNELS.map((ch) => (
          <div key={ch.name} className="grid grid-cols-3 gap-2 py-2 border-b border-border last:border-none">
            <span className="text-xs font-mono text-foreground">{ch.name}</span>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[#FC0001]" />
              <span className="text-xs font-mono text-muted-foreground">{ch.status}</span>
            </div>
            <span className="text-xs font-mono text-foreground text-right">{ch.latency}</span>
          </div>
        ))}
        <div className="mt-auto pt-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground">Graph Freshness</span>
            <span className="text-[9px] font-mono text-foreground">99.9%</span>
          </div>
          <div className="h-2 w-full border border-foreground">
            <div className="h-full bg-foreground" style={{ width: "99.9%" }} />
          </div>
        </div>
      </div>
    </div>
  )
}
