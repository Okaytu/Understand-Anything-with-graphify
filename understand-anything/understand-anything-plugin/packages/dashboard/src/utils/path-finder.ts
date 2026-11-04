/** Logic behind "How are two parts connected?" (the Path Finder). */
import type { GraphEdge, GraphNode } from "@understand-anything/core/types";
import { isFileNode } from "./obsidian-graph";

/**
 * Shortest chain of links between two nodes, following links in either direction. When
 * `canPass` is given, only nodes it accepts may sit in the middle of the chain.
 */
export function shortestPath(
  edges: GraphEdge[],
  from: string,
  to: string,
  canPass?: (id: string) => boolean,
): string[] | null {
  if (from === to) return [from];
  const adjacent = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adjacent.get(a);
    if (list) list.push(b);
    else adjacent.set(a, [b]);
  };
  for (const e of edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }
  const previous = new Map<string, string>([[from, from]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const next of adjacent.get(id) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, id);
      if (next === to) {
        const path = [to];
        for (let cur = to; cur !== from; ) {
          cur = previous.get(cur)!;
          path.push(cur);
        }
        return path.reverse();
      }
      if (!canPass || canPass(next)) queue.push(next);
    }
  }
  return null;
}

/** What the reader typed, matched against names and paths: exact, then prefix, then anywhere; files first. */
export function rankMatches(nodes: GraphNode[], query: string, limit: number): GraphNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: [number, GraphNode][] = [];
  for (const n of nodes) {
    const name = n.name.toLowerCase();
    const where = (n.filePath ?? "").toLowerCase();
    const rank = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : where.includes(q) ? 3 : -1;
    if (rank >= 0) scored.push([rank * 2 + (isFileNode(n) ? 0 : 1), n]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
    .slice(0, limit)
    .map(([, n]) => n);
}
