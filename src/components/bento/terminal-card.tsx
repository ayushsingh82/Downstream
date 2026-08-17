"use client"

import { useEffect, useState } from "react"

const LOG_LINES = [
  "> Initializing radius scan runtime...",
  "> Loading dependency graph index...",
  "> Ecosystem: npm + PyPI",
  "> Package flagged: COMPROMISED",
  "> Resolving reverse dependency closure...",
  "> algo.MSpaths: sourceValues=1 targetValues=1204",
  "> Traversal: maxLen=8 relDirection=both",
  "> Exposed services found: 37",
  "> Shared maintainers found: 4",
  "> Lockfiles resolved during live window: 12",
  "> Typosquat candidates: 3 (distance <= 2)",
  "> Query latency: 48ms",
  "> Writing incident report: 1 nodes, 37 paths [STORED]",
  "> Alert dispatched: SECURITY_CHANNEL",
  "> --------- SCAN_CYCLE_COMPLETE ---------",
]

export function TerminalCard() {
  const [lines, setLines] = useState<string[]>([])
  const [currentLine, setCurrentLine] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentLine((prev) => {
        const next = prev + 1
        if (next >= LOG_LINES.length) {
          setLines([])
          return 0
        }
        setLines((l) => [...l.slice(-8), LOG_LINES[next]])
        return next
      })
    }, 600)
    setLines([LOG_LINES[0]])
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 border-b-2 border-foreground px-4 py-2">
        <span className="h-2 w-2 rounded-full bg-[#FC0001]" />
        <span className="h-2 w-2 bg-foreground" />
        <span className="h-2 w-2 border border-foreground" />
        <span className="ml-auto text-[10px] tracking-widest text-muted-foreground uppercase">
          scan.log
        </span>
      </div>
      <div className="flex-1 bg-foreground p-4 overflow-hidden">
        <div className="flex flex-col gap-1">
          {lines.map((line, i) => (
            <span
              key={`${currentLine}-${i}`}
              className="text-xs text-background font-mono block"
              style={{ opacity: i === lines.length - 1 ? 1 : 0.6 }}
            >
              {line}
            </span>
          ))}
          <span className="text-xs text-[#FC0001] font-mono animate-blink">{"_"}</span>
        </div>
      </div>
    </div>
  )
}
