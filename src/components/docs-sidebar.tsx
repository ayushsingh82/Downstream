"use client"

import { useEffect, useState } from "react"

interface Section {
  id: string
  label: string
}

/** Sticky table-of-contents that highlights whichever section is in view. */
export function DocsSidebar({ sections }: { sections: Section[] }) {
  const [activeId, setActiveId] = useState(sections[0]?.id)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
            break
          }
        }
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    )

    for (const section of sections) {
      const el = document.getElementById(section.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [sections])

  return (
    <nav className="sticky top-20 hidden h-fit w-48 shrink-0 flex-col gap-1 lg:flex">
      <span className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-400">
        On this page
      </span>
      {sections.map((s) => {
        const active = s.id === activeId
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={`border-l-2 py-1 pl-3 text-[11px] uppercase tracking-wide transition-colors ${
              active
                ? "border-[#FC0001] text-black font-bold"
                : "border-transparent text-neutral-500 hover:border-neutral-300 hover:text-black"
            }`}
          >
            {s.label}
          </a>
        )
      })}
    </nav>
  )
}
