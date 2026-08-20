import Link from "next/link"
import { ArrowLeft, Radar } from "lucide-react"

/**
 * Shared minimal header for non-landing pages (/dashboard, /docs). Not the
 * marketing Navbar — no nav links, no CTA, just a way back to the logo and
 * to the site. Kept as one component so both pages stay in sync instead of
 * carrying their own copies.
 */
export function SubpageHeader({ label }: { label: string }) {
  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b-2 border-black bg-white px-6 py-4 lg:px-12">
      <Link href="/" className="flex items-center gap-3">
        <Radar size={18} strokeWidth={2} className="text-[#FC0001]" />
        <span className="text-sm font-black uppercase tracking-[0.3em]">downstream</span>
        <span className="hidden text-[10px] uppercase tracking-[0.25em] text-neutral-400 sm:inline">
          / {label}
        </span>
      </Link>
      <Link
        href="/"
        className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-neutral-500 transition-colors hover:text-black"
      >
        <ArrowLeft size={12} /> Back to site
      </Link>
    </header>
  )
}
