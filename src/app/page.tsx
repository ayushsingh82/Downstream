import { Navbar } from "@/components/navbar"
import { HeroSection } from "@/components/hero-section"
import { IncidentConsole } from "@/components/incident-console"
import { FeatureGrid } from "@/components/feature-grid"
import { HowItWorks } from "@/components/how-it-works"
import { AboutSection } from "@/components/about-section"
import { CtaSection } from "@/components/cta-section"
import { Footer } from "@/components/footer"

export default function Page() {
  return (
    <div className="min-h-screen bg-white text-foreground overflow-x-hidden">
      <Navbar />
      <main className="font-mono">
        <HeroSection />

        {/* Marquee */}
        <div className="border-y-2 border-[#FC0001] bg-[#FC0001] text-white py-3 flex overflow-hidden">
          <div className="flex animate-marquee whitespace-nowrap gap-16 font-bold uppercase tracking-[0.35em] text-xs">
            {[
              "Built on HydraDB", "↗", "algo.SSpaths Native Traversal", "↗",
              "Reverse Dependency Closure", "↗", "Typosquat Detection", "↗",
              "Shared Maintainer Graph", "↗", "Live Lockfile Windows", "↗",
              "Built on HydraDB", "↗", "algo.SSpaths Native Traversal", "↗",
              "Reverse Dependency Closure", "↗", "Typosquat Detection", "↗",
              "Shared Maintainer Graph", "↗", "Live Lockfile Windows", "↗",
            ].map((t, i) => <span key={i}>{t}</span>)}
          </div>
        </div>

        <IncidentConsole />
        <HowItWorks />
        <FeatureGrid />
        <AboutSection />
        <CtaSection />
      </main>
      <Footer />
    </div>
  )
}
