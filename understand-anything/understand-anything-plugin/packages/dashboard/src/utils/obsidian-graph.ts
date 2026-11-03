/**
 * Data helpers for the Obsidian-style graph view (ObsidianGraphView) and its
 * note panel (ObsidianNotePanel). Pure functions, no DOM — unit-tested in
 * utils/__tests__/obsidian-graph.test.ts.
 */
import type { GraphEdge, GraphNode, KnowledgeGraph, NodeType } from "@understand-anything/core/types";

/** Code symbol types; with "functions & classes" off they (and anything else a file contains) fold into their file. */
export const SYMBOL_TYPES: ReadonlySet<string> = new Set(["function", "class"]);

export interface ObsNode {
  id: string;
  name: string;
  type: NodeType;
  /** index into graph.layers, or -1 when the node is in no layer */
  group: number;
  degree: number;
}

export interface ObsLink {
  source: string;
  target: string;
  /** distinct edge types folded into this link, e.g. ["imports", "calls"] */
  types: string[];
}

export interface ObsGraph {
  nodes: ObsNode[];
  links: ObsLink[];
  /** visible node id for every graph node id (hidden symbols map to their file) */
  visibleIdOf: Map<string, string>;
  neighbors: Map<string, Set<string>>;
}

export interface BuildOptions {
  /** show function/class nodes; when false they are folded into their file node */
  includeSymbols: boolean;
}

/** True when the graph has code symbols that live inside files (so the toggle is meaningful). */
export function hasSymbols(graph: KnowledgeGraph): boolean {
  if (graph.nodes.some((n) => SYMBOL_TYPES.has(n.type))) return true;
  const fileIds = new Set(graph.nodes.filter((n) => n.type === "file").map((n) => n.id));
  return graph.edges.some((e) => e.type === "contains" && fileIds.has(e.source));
}

/**
 * Turn a KnowledgeGraph into the dots-and-lines graph Obsidian draws.
 *
 * With includeSymbols=false, every function/class is folded into the file that
 * contains it (via a `contains` edge from a file, else a file node with the same
 * filePath), and its edges are lifted to that file — so `a.ts:foo() calls b.ts:bar()`
 * becomes one `a.ts — b.ts` line. Parallel edges between the same pair collapse into
 * one link that remembers all edge types.
 */
export function buildObsidianGraph(graph: KnowledgeGraph, opts: BuildOptions): ObsGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const fileByPath = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.type === "file" && n.filePath && !fileByPath.has(n.filePath)) fileByPath.set(n.filePath, n.id);
  }
  const parentFile = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.type !== "contains") continue;
    const src = byId.get(e.source);
    if (src?.type === "file" && !parentFile.has(e.target)) parentFile.set(e.target, e.source);
  }

  const visibleIdOf = new Map<string, string>();
  for (const n of graph.nodes) {
    // Folded view: anything a file contains (functions, classes, constants, types)
    // becomes part of that file's dot; function/class nodes also match by filePath.
    const container =
      parentFile.get(n.id) ?? (SYMBOL_TYPES.has(n.type) && n.filePath ? fileByPath.get(n.filePath) : undefined);
    if (opts.includeSymbols || n.type === "file" || !container) {
      if (opts.includeSymbols || !SYMBOL_TYPES.has(n.type)) visibleIdOf.set(n.id, n.id);
      // a function/class with no file to fold into is dropped from the folded view
      continue;
    }
    visibleIdOf.set(n.id, container);
  }

  const groupOf = new Map<string, number>();
  graph.layers.forEach((layer, i) => {
    for (const id of layer.nodeIds) if (!groupOf.has(id)) groupOf.set(id, i);
  });

  const linkMap = new Map<string, ObsLink>();
  for (const e of graph.edges) {
    const s = visibleIdOf.get(e.source);
    const t = visibleIdOf.get(e.target);
    if (!s || !t || s === t) continue;
    const key = s < t ? `${s}\u0000${t}` : `${t}\u0000${s}`;
    const existing = linkMap.get(key);
    if (existing) {
      if (!existing.types.includes(e.type)) existing.types.push(e.type);
    } else {
      linkMap.set(key, { source: s, target: t, types: [e.type] });
    }
  }
  const links = [...linkMap.values()];

  const neighbors = new Map<string, Set<string>>();
  for (const l of links) {
    if (!neighbors.has(l.source)) neighbors.set(l.source, new Set());
    if (!neighbors.has(l.target)) neighbors.set(l.target, new Set());
    neighbors.get(l.source)!.add(l.target);
    neighbors.get(l.target)!.add(l.source);
  }

  const visibleIds = new Set(visibleIdOf.values());
  const nodes: ObsNode[] = [];
  for (const id of visibleIds) {
    const n = byId.get(id);
    if (!n) continue;
    const group = groupOf.get(id) ?? (parentFile.has(id) ? groupOf.get(parentFile.get(id)!) : undefined) ?? -1;
    nodes.push({ id, name: n.name, type: n.type, group, degree: neighbors.get(id)?.size ?? 0 });
  }
  return { nodes, links, visibleIdOf, neighbors };
}

export interface Connection {
  nodeId: string;
  name: string;
  type: NodeType;
  /** file the node lives in, for symbols (functions, classes, constants) */
  file?: string;
  /** distinct edge types between the two nodes in this direction */
  edgeTypes: string[];
}

/** "src/a/b.ts" → "b.ts" — shown next to symbols so you know which file they live in. */
export function fileLabel(node: Pick<GraphNode, "type" | "filePath">): string | undefined {
  if (!node.filePath || node.type === "file" || node.type === "article") return undefined;
  return node.filePath.split("/").pop();
}

export interface Connections {
  /** "Links": edges going out of the node (it imports / calls / links to these) */
  outgoing: Connection[];
  /** "Backlinks": edges coming in (these import / call / link to it) */
  incoming: Connection[];
}

/** Direction-aware connections of one node in the full (unfolded) graph. */
export function connectionsOf(graph: KnowledgeGraph, nodeId: string, opts?: { skipContains?: boolean }): Connections {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, Connection>();
  const inc = new Map<string, Connection>();
  const add = (bucket: Map<string, Connection>, other: GraphNode | undefined, e: GraphEdge) => {
    if (!other) return;
    const c = bucket.get(other.id);
    if (c) {
      if (!c.edgeTypes.includes(e.type)) c.edgeTypes.push(e.type);
    } else {
      bucket.set(other.id, {
        nodeId: other.id,
        name: other.name,
        type: other.type,
        file: fileLabel(other),
        edgeTypes: [e.type],
      });
    }
  };
  for (const e of graph.edges) {
    if (opts?.skipContains && e.type === "contains") continue;
    if (e.source === nodeId && e.target !== nodeId) {
      add(e.direction === "backward" ? inc : out, byId.get(e.target), e);
      if (e.direction === "bidirectional") add(inc, byId.get(e.target), e);
    } else if (e.target === nodeId && e.source !== nodeId) {
      add(e.direction === "backward" ? out : inc, byId.get(e.source), e);
      if (e.direction === "bidirectional") add(out, byId.get(e.source), e);
    }
  }
  const sort = (m: Map<string, Connection>) =>
    [...m.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { outgoing: sort(out), incoming: sort(inc) };
}

/** Nodes defined inside a node (file → its classes/functions), via `contains` edges. */
export function childrenOf(graph: KnowledgeGraph, nodeId: string): GraphNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges
    .filter((e) => e.type === "contains" && e.source === nodeId)
    .map((e) => byId.get(e.target))
    .filter((n): n is GraphNode => Boolean(n));
}

export type NoteSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; nodeId: string | null };

/**
 * Split text on Obsidian-style [[wikilinks]] ([[Target]], [[Target|alias]],
 * [[Target#heading]]) and resolve each target to a node id by name
 * (case-insensitive). Unresolved links keep nodeId=null — Obsidian shows those dimmed.
 */
export function splitWikilinks(text: string, nameIndex: Map<string, string>): NoteSegment[] {
  const segments: NoteSegment[] = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) segments.push({ kind: "text", text: text.slice(last, idx) });
    const target = m[1].trim();
    segments.push({ kind: "link", text: (m[2] ?? target).trim(), nodeId: nameIndex.get(target.toLowerCase()) ?? null });
    last = idx + m[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/** lower-cased node name → node id, preferring notes (article) over other types. */
export function buildNameIndex(graph: KnowledgeGraph): Map<string, string> {
  const index = new Map<string, string>();
  const rank = (t: string) => (t === "article" ? 0 : t === "file" ? 1 : 2);
  const best = new Map<string, number>();
  for (const n of graph.nodes) {
    const key = n.name.toLowerCase();
    const r = rank(n.type);
    if (!index.has(key) || r < (best.get(key) ?? 9)) {
      index.set(key, n.id);
      best.set(key, r);
    }
  }
  return index;
}

/** Obsidian-like color groups (one per layer), readable on the dark graph background. */
export const GROUP_COLORS = [
  "#a882ff", // Obsidian purple
  "#4fc1ff",
  "#ffb86c",
  "#7ee787",
  "#ff7b9c",
  "#e3d26f",
  "#56d4c8",
  "#ff9e64",
  "#c39bff",
  "#8bd5ff",
];

export function groupColor(group: number): string {
  return group < 0 ? "#9a9a9a" : GROUP_COLORS[group % GROUP_COLORS.length];
}

/** Dot radius grows with the square root of its connection count, like Obsidian. */
export function nodeRadius(degree: number): number {
  return Math.min(3.5 + Math.sqrt(degree) * 1.7, 18);
}

/** Human label for an edge type list: ["imports","calls"] → "imports, calls". */
export function edgeLabel(types: string[]): string {
  return types.map((t) => t.replace(/_/g, " ")).join(", ");
}
