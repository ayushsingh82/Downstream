"use client"

import { useEffect, useState } from "react"

interface ScrambleNumberProps {
  target: string
  label: string
  delay?: number
}

function ScrambleNumber({ target, label, delay = 0 }: ScrambleNumberProps) {
  const [display, setDisplay] = useState(target.replace(/[0-9]/g, "0"))

  useEffect(() => {
    const timeout = setTimeout(() => {
      let iterations = 0
      const maxIterations = 20
      const interval = setInterval(() => {
        if (iterations >= maxIterations) {
          setDisplay(target)
          clearInterval(interval)
          return
        }
        setDisplay(
          target.split("").map((char, i) => {
            if (!/[0-9]/.test(char)) return char
            if (iterations > maxIterations - 5 && i < iterations - (maxIterations - 5)) return char
            return String(Math.floor(Math.random() * 10))
          }).join("")
        )
        iterations++
      }, 50)
      return () => clearInterval(interval)
    }, delay)
    return () => clearTimeout(timeout)
  }, [target, delay])

  return (
    <div className="flex flex-col gap-1">
      <span className="text-4xl lg:text-5xl font-mono font-bold tracking-tight text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
        {display}
      </span>
      <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{label}</span>
    </div>
  )
}

export function MetricsCard() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b-2 border-foreground px-4 py-2">
        <span className="text-[10px] tracking-widest text-muted-foreground uppercase">radius.metrics</span>
        <span className="inline-block h-2 w-2 rounded-full bg-[#FC0001]" />
      </div>
      <div className="flex-1 flex flex-col justify-center gap-6 p-6">
        <ScrambleNumber target="500K+" label="Package Versions Indexed" delay={500} />
        <ScrambleNumber target="48ms" label="Avg Traversal Latency" delay={800} />
        <ScrambleNumber target="6sec" label="Detection Window" delay={1100} />
        <ScrambleNumber target="2" label="Ecosystems Covered" delay={1400} />
      </div>
    </div>
  )
}
