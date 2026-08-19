import { Database, Search, TriangleAlert } from "lucide-react"
import { IncidentConsole } from "@/components/incident-console"
import { SubpageHeader } from "@/components/subpage-header"

const STEPS = [
  {
    n: "01",
    icon: Database,
    label: "Seed",
    detail: "Pull a real deps.dev dependency subtree, register two consuming services.",
  },
  {
    n: "02",
    icon: TriangleAlert,
    label: "Compromise",
    detail: "Flag one transitive version. Trace the reverse-dependency closure live.",
  },
  {
    n: "03",
    icon: Search,
    label: "Explore",
    detail: "Hop chains per exposed service, shared maintainers, typosquat neighbours.",
  },
]

const VERIFIED_FACTS = [
  "SSpaths closure: 47–320ms depending on graph size",
  "SPpaths explain: ~21ms, one exposure",
  "Wire contract: parameters (not params), positional row decoding — HYDRADB-NOTES.md",
  "Consistency: strong read fired immediately after every compromise write",
]

/**
 * A dedicated operator view of the incident console — not a marketing page.
 * Deliberately does not reuse the landing page's HowItWorks / FeatureGrid /
 * AboutSection sections; those sell the product, this runs it.
 */
export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-white text-foreground font-mono">
      <SubpageHeader label="dashboard" />

      <section className="px-6 py-10 lg:px-12">
        <div className="mx-auto max-w-6xl">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.35em] text-[#FC0001]">
            Operator view
          </p>
          <h1 className="max-w-2xl text-2xl font-black uppercase tracking-tight md:text-4xl">
            One graph. One compromise.
            <br />
            Full exposure, live.
          </h1>

          <div className="mt-8 grid grid-cols-1 gap-px border-2 border-black bg-black sm:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.n} className="bg-white p-5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold tracking-widest text-[#FC0001]">{step.n}</span>
                  <step.icon size={16} strokeWidth={2} className="text-neutral-300" />
                </div>
                <div className="mt-2 text-sm font-black uppercase tracking-wide">{step.label}</div>
                <div className="mt-1 text-xs leading-relaxed text-neutral-500">{step.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <IncidentConsole />

      <footer className="border-t-2 border-black bg-black px-6 py-6 lg:px-12">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-8 gap-y-2">
          {VERIFIED_FACTS.map((fact) => (
            <div key={fact} className="flex items-center gap-2">
              <span className="h-1 w-1 shrink-0 rounded-full bg-[#FC0001]" />
              <span className="text-[10px] tracking-wide text-white/70">{fact}</span>
            </div>
          ))}
        </div>
      </footer>
    </div>
  )
}
