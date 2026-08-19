"use client"

import { ArrowRight, BookOpen, Code2, Zap, Shield, Globe } from "lucide-react"
import { motion } from "framer-motion"
import { useState, useRef, useCallback } from "react"
import Link from "next/link"

const ease = [0.22, 1, 0.36, 1] as const

type Particle = { id: number; x: number; y: number; size: number }

// Measured on a local graph-node holding the synthetic load graph
// scripts/scale-check.mjs builds — 84,163 versions, 332,985 resolved edges,
// 200 services — plus real deps.dev subtrees. The load test reproduces all of
// it; the live console below reproduces the same queries at demo size.
const STATS = [
  { value: "110ms", label: "Blast radius", sub: "140 services, 84K versions" },
  { value: "700ms", label: "Path explain", sub: "algo.SPpaths, one exposure" },
  { value: "2",     label: "Ecosystems",  sub: "npm + PyPI" },
  { value: "84K",   label: "Versions", sub: "Load-tested graph" },
  { value: "1024",  label: "Path cap", sub: "Why we enumerate" },
  { value: "0",     label: "Vector calls", sub: "Graph-native only" },
]

const TECH_TAGS = [
  "npm", "PyPI", "GitHub Actions", "Dependabot", "Renovate",
  "GitLab CI", "CircleCI", "Snyk", "Socket", "OSV.dev",
]

const FEATURES = [
  { icon: Zap,    label: "Batched Graph Traversal" },
  { icon: Shield, label: "Real Vulnerability Data" },
  { icon: Globe,  label: "npm + PyPI Coverage" },
]

export function HeroSection() {
  const [particles, setParticles] = useState<Particle[]>([])
  const counter = useRef(0)

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const next: Particle[] = Array.from({ length: 4 }, () => ({
      id: counter.current++,
      x: cx + (Math.random() - 0.5) * 28,
      y: cy + (Math.random() - 0.5) * 28,
      size: Math.random() * 6 + 2,
    }))
    setParticles(prev => [...prev.slice(-120), ...next])
    next.forEach(p => {
      setTimeout(() => setParticles(prev => prev.filter(q => q.id !== p.id)), 1400)
    })
  }, [])

  return (
    <section
      onMouseMove={handleMouseMove}
      className="relative w-full px-6 pt-10 pb-16 lg:px-20 lg:pt-16 lg:pb-24 overflow-hidden"
      style={{ background: "#FC0001" }}
    >
      {/* White sparkle particles */}
      {particles.map(p => (
        <span
          key={p.id}
          className="animate-fp-star pointer-events-none absolute"
          style={{
            left: p.x,
            top: p.y,
            width: p.size,
            height: p.size,
            background: "#ffffff",
            borderRadius: "50%",
          }}
        />
      ))}

      {/* Radar sweep + concentric rings */}
      <div className="absolute inset-0 pointer-events-none select-none overflow-hidden flex items-center justify-center" aria-hidden="true">
        <div className="relative" style={{ width: "min(140vw, 1100px)", height: "min(140vw, 1100px)" }}>
          {[1, 0.72, 0.46, 0.22].map((scale) => (
            <div
              key={scale}
              className="absolute inset-0 m-auto rounded-full border border-white/10"
              style={{ width: `${scale * 100}%`, height: `${scale * 100}%` }}
            />
          ))}
          <motion.div
            className="absolute inset-0 m-auto rounded-full"
            style={{
              width: "100%",
              height: "100%",
              background:
                "conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.22) 22deg, transparent 55deg)",
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
          />
        </div>
      </div>

      <div className="relative flex flex-col items-center text-center max-w-5xl mx-auto">

        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease }}
          className="mb-6 inline-flex items-center gap-2 border border-white/25 px-4 py-1.5"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-white animate-blink" />
          <span className="text-[10px] font-mono tracking-[0.25em] uppercase text-white/70">
            Track 2A · Hack Hydra 2026
          </span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 30, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.7, ease }}
          className="text-5xl sm:text-7xl lg:text-8xl xl:text-9xl font-mono font-black tracking-tighter text-white mb-3 select-none uppercase leading-[0.9]"
        >
          BLAST.<br />
          <span className="text-white">RADIUS.</span>
        </motion.h1>

        {/* Sub */}
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3, ease }}
          className="text-sm lg:text-base text-white max-w-2xl mb-4 leading-relaxed font-mono tracking-wide"
        >
          A live npm and PyPI dependency graph on HydraDB. The moment a package
          is compromised, trace every exposed service, shared maintainer, and
          resolved lockfile — in seconds, not hours.
        </motion.p>

        {/* Feature chips */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="flex items-center gap-4 mb-10 flex-wrap justify-center"
        >
          {FEATURES.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5 text-white/60">
              <Icon size={12} strokeWidth={2} />
              <span className="text-[10px] font-mono tracking-widest uppercase">{label}</span>
            </div>
          ))}
        </motion.div>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5, ease }}
          className="flex flex-col sm:flex-row items-center gap-3 mb-12"
        >
          <button className="group flex items-center gap-0 bg-white text-[#FC0001] text-sm font-mono tracking-wider uppercase border-2 border-white hover:opacity-90 transition-opacity">
            <span className="flex items-center justify-center w-12 h-12 bg-[#FC0001]">
              <motion.span className="inline-flex" whileHover={{ x: 3 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
                <ArrowRight size={20} strokeWidth={3} className="text-white" />
              </motion.span>
            </span>
            <Link href="#console" className="px-8 py-3 font-bold tracking-[0.2em]">
              Run a Scan
            </Link>
          </button>

          <Link
            href="https://github.com/ayushsingh82/hydradb2#readme"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-[11px] font-mono tracking-widest uppercase text-white/60 hover:text-white transition-colors border border-white/25 px-6 py-3.5"
          >
            <BookOpen size={13} />
            Read Docs
          </Link>

          <Link
            href="https://github.com/ayushsingh82/hydradb2"
            className="flex items-center gap-2 text-[11px] font-mono tracking-widest uppercase text-white/60 hover:text-white transition-colors border border-white/25 px-6 py-3.5"
          >
            <Code2 size={13} />
            GitHub
          </Link>
        </motion.div>

        {/* 6-stat grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.6 }}
          className="w-full max-w-3xl grid grid-cols-3 lg:grid-cols-6 border border-white/20 mb-10"
        >
          {STATS.map((stat, i) => (
            <div
              key={stat.label}
              className={`flex flex-col items-center gap-1 py-4 px-3 ${i < STATS.length - 1 ? "border-r border-white/20" : ""}`}
            >
              <span className="text-xl lg:text-2xl font-mono font-black text-white tabular-nums">{stat.value}</span>
              <span className="text-[9px] font-mono tracking-widest uppercase text-white/60 font-bold text-center">{stat.label}</span>
              <span className="text-[8px] font-mono text-white/40 text-center">{stat.sub}</span>
            </div>
          ))}
        </motion.div>

        {/* Works with */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.5 }}
          className="flex flex-col items-center gap-3"
        >
          <span className="text-[9px] font-mono tracking-[0.3em] uppercase text-white">
            Data sources
          </span>
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
            {TECH_TAGS.map((tag) => (
              <span key={tag} className="text-[10px] font-mono tracking-widest text-white hover:text-white/80 transition-colors cursor-default">
                {tag}
              </span>
            ))}
          </div>
        </motion.div>

      </div>
    </section>
  )
}
