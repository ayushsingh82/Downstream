"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="relative border-2 border-black bg-neutral-50">
      <button
        onClick={copy}
        className="absolute right-3 top-3 flex items-center gap-1.5 border border-black/15 bg-white px-2.5 py-1.5 text-[10px] uppercase tracking-widest text-neutral-500 transition-colors hover:border-black hover:text-black"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto p-5 pr-24 text-[11px] leading-relaxed">{code}</pre>
    </div>
  )
}
