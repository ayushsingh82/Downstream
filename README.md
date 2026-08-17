# Track 2 (Option A) — Supply Chain Blast Radius

**Hack Hydra** · Aug 12-20, 2026 · Built on [HydraDB](https://github.com/hydra-db/hydradb)

## Problem statement

Search the graph, and catch chained vulnerabilities before they land.

Supply chain attacks through npm and PyPI are surging, and developer tools today fail to give real time, deep context on malicious dependencies. This is fundamentally a graph traversal and dependency problem, not a semantic similarity problem.

Software supply chain attacks stopped being a nuisance and became an automated, worm driven problem. In the TanStack compromise this May, 84 malicious package artifacts were published across 42 packages within six minutes of the CI pipeline being breached. The worm went on to hit Mistral AI, UiPath and over 160 other npm and PyPI packages, self propagating and persisting in `.claude/` and `.vscode/` directories in a way that survived `npm uninstall`.

The defender's problem is speed. When a package is compromised at 09:00, which of your services are exposed by 09:06? That is a transitive reverse dependency closure over an ecosystem graph with tens of millions of versioned nodes, and it is the kind of question a vector index cannot answer at all.

## What to build

Build the npm or PyPI dependency graph in HydraDB and answer, when a package is compromised:

- Which internal services are transitively exposed?
- Which version of the dependency introduced the vulnerability?
- Which applications resolved the compromised version while it was live?
- Which other packages share maintainers or infrastructure with it?
- Are there likely typosquat packages nearby?
- What is the complete blast radius?

Then go further: which packages share a maintainer with the compromised one, which lockfiles resolved to the bad version during the window it was live, and which names sit close enough to a popular package to be a typosquat.

## What a strong submission needs

- A functional product or demo
- Real ingestion and retrieval workflows
- A clear use case
- A thoughtful technical implementation
- HydraDB doing real work (graph-native data model, not just sitting in the README)

## Rules recap

- Work starts on or after **August 12, 2026** — fresh repo, no prior commits.
- HydraDB must be genuinely used — be ready to explain what the project would lose without it.
- Submission requires: public GitHub repo (with OSS license, README, setup instructions, HydraDB usage explanation, third-party attribution), a demo video (≤ 3 min), and the submission form.
- Deadline: **August 20, 2026, 11:59 PM PT**.

Full event details: see `../hack-hydra.md`.

## Stack

Next.js (App Router, TypeScript, Tailwind) + HydraDB.

---

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `src/app/page.tsx`. The page auto-updates as you edit the file.
