"use client"

import { useMemo, useState } from "react"

export interface GraphNode {
  id: number
  labels: string[]
  properties: Record<string, unknown>
}

export interface GraphRelationship {
  id: number
  type: string
  src: number
  dst: number
  properties: Record<string, unknown>
}

export interface GraphPath {
  nodes: GraphNode[]
  relationships: GraphRelationship[]
}

/** Column colour per label — the same red/black palette the console uses. Each
 *  node renders as a two-tier card: a solid header strip in `chip`/`chipText`,
 *  and a white body in `stroke`/`text`. */
const LABEL_STYLE: Record<
  string,
  { chip: string; chipText: string; stroke: string; text: string }
> = {
  PackageVersion: { chip: "#FC0001", chipText: "#FFFFFF", stroke: "#FC0001", text: "#000000" },
  Package: { chip: "#000000", chipText: "#FFFFFF", stroke: "#000000", text: "#000000" },
  Lockfile: { chip: "#B45309", chipText: "#FFFFFF", stroke: "#B45309", text: "#000000" },
  Project: { chip: "#000000", chipText: "#FFFFFF", stroke: "#000000", text: "#000000" },
  Service: { chip: "#0A7B34", chipText: "#FFFFFF", stroke: "#0A7B34", text: "#000000" },
}

const COLUMN_WIDTH = 272
const NODE_WIDTH = 160
const NODE_HEIGHT = 50
const CHIP_HEIGHT = 17
const ROW_HEIGHT = 80
const PADDING = 16
const HEADER_HEIGHT = 26

function label(node: GraphNode): string {
  return node.labels[0] ?? "Node"
}

function caption(node: GraphNode): string {
  const props = node.properties
  if (typeof props.name === "string") return props.name
  if (typeof props.version === "string") return `@${props.version}`
  if (typeof props.resolved_at === "number") {
    return new Date(props.resolved_at).toISOString().slice(0, 10)
  }
  return String(node.id)
}

interface Placed {
  node: GraphNode
  column: number
  row: number
}

/**
 * Draws the exposure chains the traversal returned.
 *
 * Layout is derived from the graph rather than simulated: a node's column is its
 * hop distance from the compromised version, which is exactly what the paths
 * encode, so the picture reads left-to-right as "the compromise, then what
 * pulled it in, then who runs that." A force-directed layout would scramble
 * that ordering into something prettier and less true — the distance from the
 * left edge is the whole point of the diagram.
 */
export function BlastGraph({
  paths,
  sourceId,
  highlightService,
}: {
  paths: GraphPath[]
  sourceId: number
  highlightService?: number | null
}) {
  const [hovered, setHovered] = useState<number | null>(null)

  const { placed, edges, columns, width, height } = useMemo(() => {
    const nodeById = new Map<number, GraphNode>()
    const distance = new Map<number, number>()
    const edgeSet = new Map<string, { from: number; to: number; type: string }>()

    for (const path of paths) {
      for (const node of path.nodes) nodeById.set(node.id, node)

      // A path from SPpaths runs service → … → compromised version, and one
      // from SSpaths runs the other way. Orienting on the known source id keeps
      // both in the same left-to-right frame instead of guessing from order.
      const ordered =
        path.nodes[0]?.id === sourceId ? path.nodes : [...path.nodes].reverse()
      ordered.forEach((node, index) => {
        const existing = distance.get(node.id)
        if (existing === undefined || index < existing) distance.set(node.id, index)
      })

      for (const rel of path.relationships) {
        edgeSet.set(`${rel.src}:${rel.dst}:${rel.type}`, {
          from: rel.src,
          to: rel.dst,
          type: rel.type,
        })
      }
    }

    const byColumn = new Map<number, GraphNode[]>()
    for (const [id, node] of nodeById) {
      const column = distance.get(id) ?? 0
      const list = byColumn.get(column) ?? []
      list.push(node)
      byColumn.set(column, list)
    }

    const placed = new Map<number, Placed>()
    let maxRows = 0
    for (const [column, nodes] of [...byColumn.entries()].sort((a, b) => a[0] - b[0])) {
      nodes
        .sort((a, b) => caption(a).localeCompare(caption(b)))
        .forEach((node, row) => placed.set(node.id, { node, column, row }))
      maxRows = Math.max(maxRows, nodes.length)
    }

    const columns = Math.max(1, byColumn.size)
    return {
      placed,
      edges: [...edgeSet.values()],
      columns,
      width: columns * COLUMN_WIDTH + PADDING * 2,
      height: Math.max(1, maxRows) * ROW_HEIGHT + PADDING * 2 + HEADER_HEIGHT,
    }
  }, [paths, sourceId])

  if (paths.length === 0) return null

  const nodeX = (column: number) => PADDING + column * COLUMN_WIDTH
  const nodeY = (row: number) => PADDING + HEADER_HEIGHT + row * ROW_HEIGHT

  const centreOf = (id: number) => {
    const p = placed.get(id)
    if (!p) return null
    return {
      x: nodeX(p.column) + NODE_WIDTH / 2,
      y: nodeY(p.row) + NODE_HEIGHT / 2,
      column: p.column,
    }
  }

  const labelsPresent = [...new Set([...placed.values()].map(({ node }) => label(node)))]

  // Which nodes light up: the hovered node's chain, or the service the list
  // selected. Everything else drops to a muted stroke so one exposure can be
  // followed through a diagram with several.
  const focus = hovered ?? highlightService ?? null
  const onFocusChain = new Set<number>()
  if (focus !== null) {
    for (const path of paths) {
      if (!path.nodes.some((n) => n.id === focus)) continue
      for (const node of path.nodes) onFocusChain.add(node.id)
    }
  }
  const dimmed = (id: number) => focus !== null && !onFocusChain.has(id)

  return (
    <div className="border-2 border-black bg-white">
      {/* Legend — which label maps to which colour, drawn from what's on the board. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b-2 border-black bg-neutral-50 px-4 py-2">
        {labelsPresent.map((l) => {
          const style = LABEL_STYLE[l] ?? LABEL_STYLE.Package
          return (
            <div key={l} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 border border-black" style={{ background: style.chip }} />
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-600">
                {l}
              </span>
            </div>
          )
        })}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 border border-black bg-[#FC0001]" />
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#FC0001]">
            compromised
          </span>
        </div>
      </div>

      <div className="dot-grid-bg overflow-x-auto bg-white">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block min-w-full"
          role="img"
          aria-label="Exposure chains from the compromised package version to each affected service"
        >
          <defs>
            <marker
              id="blast-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#000000" />
            </marker>
            <marker
              id="blast-arrow-active"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#FC0001" />
            </marker>
          </defs>

          {/* Column headers — the hop count each vertical band represents. */}
          <line
            x1={0}
            y1={PADDING + HEADER_HEIGHT - 6}
            x2={width}
            y2={PADDING + HEADER_HEIGHT - 6}
            stroke="#000000"
            strokeWidth={1}
          />
          {Array.from({ length: columns }, (_, column) => {
            const x = nodeX(column)
            const isSource = column === 0
            return (
              <g key={`col-${column}`}>
                <text
                  x={x}
                  y={PADDING + HEADER_HEIGHT - 12}
                  className="text-[9px] font-bold uppercase tracking-[0.25em]"
                  fill={isSource ? "#FC0001" : "#737373"}
                >
                  {`hop ${column}`}
                  {isSource ? " · source" : ""}
                </text>
                {isSource && (
                  <rect
                    x={x}
                    y={PADDING + HEADER_HEIGHT - 6}
                    width={NODE_WIDTH}
                    height={2}
                    fill="#FC0001"
                  />
                )}
              </g>
            )
          })}

          {edges.map((edge) => {
            const from = centreOf(edge.from)
            const to = centreOf(edge.to)
            if (!from || !to) return null
            const faded = dimmed(edge.from) || dimmed(edge.to)
            const active = focus !== null && !faded
            const stroke = active ? "#FC0001" : "#000000"
            const startX = from.x + NODE_WIDTH / 2
            const endX = to.x - NODE_WIDTH / 2
            const midX = (startX + endX) / 2
            // Capped to the gap between columns so a long relationship name
            // (e.g. NAME_SIMILAR_TO) can't overflow under the neighbouring
            // node boxes, which paint over the edge layer.
            const maxChipWidth = Math.max(24, Math.abs(endX - startX) - 8)
            const chipLabel = edge.type
            const chipWidth = Math.min(chipLabel.length * 5.4 + 12, maxChipWidth)
            const chipMidY = (from.y + to.y) / 2
            return (
              <g
                key={`${edge.from}-${edge.to}-${edge.type}`}
                opacity={faded ? 0.15 : 1}
                className="transition-opacity"
              >
                <path
                  d={`M ${startX} ${from.y} H ${midX} V ${to.y} H ${endX}`}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={active ? 2 : 1.5}
                  markerEnd={active ? "url(#blast-arrow-active)" : "url(#blast-arrow)"}
                />
                <rect
                  x={midX - chipWidth / 2}
                  y={chipMidY - 15}
                  width={chipWidth}
                  height={12}
                  fill="#FFFFFF"
                  stroke={active ? "#FC0001" : "#000000"}
                  strokeWidth={1}
                />
                <text
                  x={midX}
                  y={chipMidY - 6.5}
                  textAnchor="middle"
                  className="text-[8px] font-bold uppercase tracking-wider"
                  fill={active ? "#FC0001" : "#000000"}
                >
                  {chipLabel}
                </text>
              </g>
            )
          })}

          {[...placed.values()].map(({ node, column, row }) => {
            const style = LABEL_STYLE[label(node)] ?? LABEL_STYLE.Package
            const x = nodeX(column)
            const y = nodeY(row)
            const isSource = node.id === sourceId
            return (
              <g
                key={node.id}
                opacity={dimmed(node.id) ? 0.25 : 1}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}
                className="transition-opacity"
              >
                <rect
                  x={x}
                  y={y}
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  fill="#FFFFFF"
                  stroke={style.stroke}
                  strokeWidth={isSource ? 3 : 2}
                />
                <rect
                  x={x}
                  y={y}
                  width={NODE_WIDTH}
                  height={CHIP_HEIGHT}
                  fill={style.chip}
                />
                <text
                  x={x + 8}
                  y={y + CHIP_HEIGHT - 5}
                  className="text-[9px] font-bold uppercase tracking-[0.2em]"
                  fill={style.chipText}
                >
                  {label(node)}
                </text>
                {!isSource && (
                  <text
                    x={x + NODE_WIDTH - 8}
                    y={y + CHIP_HEIGHT - 5}
                    textAnchor="end"
                    className="text-[9px] font-bold"
                    fill={style.chipText}
                  >
                    h{column}
                  </text>
                )}
                {isSource && (
                  <rect
                    x={x + NODE_WIDTH - 12}
                    y={y + 5}
                    width={7}
                    height={7}
                    fill="#FFFFFF"
                  />
                )}
                <text
                  x={x + 8}
                  y={y + CHIP_HEIGHT + 20}
                  className="text-[11px] font-bold"
                  fill={style.text}
                >
                  {caption(node).length > 22 ? caption(node).slice(0, 21) + "…" : caption(node)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
