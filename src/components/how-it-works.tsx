"use client"

import { motion } from "framer-motion"

const ease = [0.22, 1, 0.36, 1] as const

const STEPS = [
  {
    num: "01",
    title: "Ingest & Index",
    desc: "Pull resolved dependency graphs from deps.dev, registry metadata from npm and PyPI, and real advisories from OSV.dev. Batch-load into HydraDB via UNWIND.",
  },
  {
    num: "02",
    title: "Mark Compromised",
    desc: "Flag a package version compromised. HydraDB reads strong-consistent immediately after, so the UI never shows stale exposure state.",
  },
  {
    num: "03",
    title: "Trace Blast Radius",
    desc: "algo.SSpaths resolves the reverse-dependency closure from the compromised version in one native call — not a client-side fan-out per target.",
  },
  {
    num: "04",
    title: "Contain & Notify",
    desc: "See shared maintainers, live-window lockfile resolutions, and typosquat neighbors. Explain any single exposure with algo.SPpaths.",
  },
]

const STEP_STYLES = [
  { bg: "#FC0001", numColor: "rgba(255,255,255,0.1)", titleColor: "#ffffff", descColor: "rgba(255,255,255,0.62)" },
  { bg: "#ffffff",  numColor: "rgba(252,0,1,0.08)",    titleColor: "#0a0a0a",  descColor: "#666666" },
  { bg: "#FC0001", numColor: "rgba(255,255,255,0.1)", titleColor: "#ffffff", descColor: "rgba(255,255,255,0.62)" },
  { bg: "#ffffff",  numColor: "rgba(252,0,1,0.08)",    titleColor: "#0a0a0a",  descColor: "#666666" },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="w-full px-6 py-20 lg:px-12">
      {/* Section label */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease }}
        className="flex items-center gap-4 mb-10"
      >
        <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground font-mono">
          {"// SECTION: HOW_IT_WORKS"}
        </span>
        <div className="flex-1 border-t border-border" />
        <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground font-mono">002</span>
      </motion.div>

      {/* Headline */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, ease }}
        className="mb-12"
      >
        <h2 className="text-3xl lg:text-5xl font-mono font-black tracking-tight uppercase leading-tight">
          Four steps.<br />
          <span className="text-[#FC0001]">Six minutes or less.</span>
        </h2>
      </motion.div>

      {/* Steps grid — alternating red / white */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 border-2 border-foreground">
        {STEPS.map((step, i) => {
          const s = STEP_STYLES[i]
          return (
            <motion.div
              key={step.num}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.5, ease }}
              className={`flex flex-col p-8 lg:p-10 min-h-[280px]
                ${i < 3 ? "border-b-2 lg:border-b-0 lg:border-r-2" : ""}
                border-foreground`}
              style={{ background: s.bg }}
            >
              <div
                className="font-mono font-black leading-none mb-8"
                style={{ fontSize: "clamp(48px,6vw,72px)", color: s.numColor }}
              >
                {step.num}
              </div>
              <h3
                className="font-mono font-black uppercase tracking-tight mb-3"
                style={{ fontSize: "clamp(13px,1.2vw,16px)", color: s.titleColor }}
              >
                {step.title}
              </h3>
              <p className="font-mono leading-relaxed" style={{ fontSize: 13, color: s.descColor }}>
                {step.desc}
              </p>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}
