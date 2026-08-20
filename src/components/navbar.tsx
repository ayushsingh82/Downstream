"use client"

import { Radar } from "lucide-react"
import { motion } from "framer-motion"
import Link from "next/link"

const NAV_LINKS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Benchmarks", href: "#benchmarks" },
  { label: "Console", href: "#console" },
  { label: "Docs", href: "/docs" },
]

export function Navbar() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="w-full sticky top-0 z-50"
    >
      <nav className="w-full border-b border-black/10 bg-white/90 backdrop-blur-md px-6 py-3 lg:px-8">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="flex items-center gap-2.5"
            >
              <Radar size={17} strokeWidth={2} className="text-[#FC0001]" />
              <span className="text-xs font-mono tracking-[0.3em] uppercase font-black">radius</span>
            </motion.div>
          </Link>

          {/* Nav links */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="hidden md:flex items-center gap-6"
          >
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-[10px] font-mono tracking-widest uppercase text-foreground/50 hover:text-foreground transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </motion.div>

          {/* Right */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.4 }}
            className="flex items-center gap-3"
          >
            <Link
              href="/dashboard"
              className="text-[10px] font-mono tracking-widest uppercase px-5 py-2.5 bg-[#FC0001] text-white hover:opacity-80 transition-opacity font-bold"
            >
              Dashboard
            </Link>
          </motion.div>
        </div>
      </nav>
    </motion.div>
  )
}
