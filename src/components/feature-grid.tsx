"use client"

import { TerminalCard } from "@/components/bento/terminal-card"
import { DitherCard } from "@/components/bento/dither-card"
import { MetricsCard } from "@/components/bento/metrics-card"
import { StatusCard } from "@/components/bento/status-card"
import { motion } from "framer-motion"
import { Network, GitBranch, Zap, Users, Fingerprint, Layers } from "lucide-react"

const ease = [0.22, 1, 0.36, 1] as const

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease },
  }),
}

const FEATURES = [
  {
    icon: Network,
    title: "Reverse Dependency Closure",
    desc: "algo.SSpaths resolves the full transitive blast radius from one compromised version to every exposed service in a single native call.",
  },
  {
    icon: GitBranch,
    title: "Resolved, Not Declared",
    desc: "Graph edges come from actually-resolved dependency trees via deps.dev — not just declared semver ranges that don't reflect what got installed.",
  },
  {
    icon: Zap,
    title: "Live Compromise Windows",
    desc: "Time-range queries over lockfile resolution timestamps show exactly which builds pulled the bad version while it was live.",
  },
  {
    icon: Users,
    title: "Shared Maintainer Graph",
    desc: "Trace every other package a compromised maintainer's account touches — a common vector for cascading supply-chain worms.",
  },
  {
    icon: Fingerprint,
    title: "Typosquat Proximity",
    desc: "Name-similarity edges precomputed at ingest surface look-alike packages sitting one keystroke away from a popular dependency.",
  },
  {
    icon: Layers,
    title: "Any Registry",
    desc: "npm and PyPI today, with the same graph model extending to Maven, Cargo, and Go via deps.dev's unified resolution data.",
  },
]

export function FeatureGrid() {
  return (
    <section id="features" className="w-full px-6 py-20 lg:px-12">
      {/* Section label */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease }}
        className="flex items-center gap-4 mb-10"
      >
        <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground font-mono">
          {"// SECTION: DEPENDENCY_STACK"}
        </span>
        <div className="flex-1 border-t border-border" />
        <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground font-mono">003</span>
      </motion.div>

      {/* Headline */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, ease }}
        className="mb-12 max-w-2xl"
      >
        <h2 className="text-3xl lg:text-5xl font-mono font-black tracking-tight uppercase leading-tight mb-4">
          Dependency intelligence<br />
          <span className="text-[#FC0001]">built for incident speed.</span>
        </h2>
        <p className="text-sm font-mono text-muted-foreground leading-relaxed">
          Not a static SBOM scanner. A live, queryable graph of your entire
          dependency surface, built to answer &ldquo;what&apos;s exposed&rdquo; before the
          worm finishes propagating.
        </p>
      </motion.div>

      {/* Bento grid — single row */}
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-60px" }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-2 border-foreground mb-6"
      >
        <motion.div custom={0} variants={cardVariants} className="border-b-2 sm:border-r-2 lg:border-b-0 border-foreground min-h-[280px]">
          <TerminalCard />
        </motion.div>
        <motion.div custom={1} variants={cardVariants} className="border-b-2 lg:border-r-2 lg:border-b-0 border-foreground min-h-[280px]">
          <DitherCard />
        </motion.div>
        <motion.div custom={2} variants={cardVariants} className="border-b-2 sm:border-r-2 lg:border-b-0 border-foreground min-h-[280px]">
          <MetricsCard />
        </motion.div>
        <motion.div custom={3} variants={cardVariants} className="border-foreground min-h-[280px]">
          <StatusCard />
        </motion.div>
      </motion.div>

      {/* Feature cards 6-grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 border-2 border-foreground mt-12">
        {FEATURES.map((feat, i) => (
          <motion.div
            key={feat.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08, duration: 0.5, ease }}
            className={`flex flex-col gap-3 p-6
              ${i % 3 !== 2 ? "lg:border-r-2" : ""}
              ${i % 2 !== 1 ? "sm:border-r-2 lg:border-r-0" : ""}
              ${i < 3 ? "border-b-2" : ""}
              border-foreground group hover:bg-[#FC0001] transition-colors duration-300`}
          >
            <feat.icon size={20} strokeWidth={1.5} className="text-[#FC0001] group-hover:text-white transition-colors" />
            <h3 className="text-sm font-mono font-black uppercase tracking-wide text-foreground group-hover:text-white transition-colors">
              {feat.title}
            </h3>
            <p className="text-xs font-mono text-muted-foreground leading-relaxed group-hover:text-white/70 transition-colors">
              {feat.desc}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
