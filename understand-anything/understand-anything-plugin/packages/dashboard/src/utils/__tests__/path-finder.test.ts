import { describe, it, expect } from "vitest";
import type { GraphEdge, GraphNode } from "@understand-anything/core/types";
import { rankMatches, shortestPath } from "../path-finder";

const edge = (source: string, target: string): GraphEdge => ({ source, target, type: "imports", direction: "forward", weight: 1 });
const node = (id: string, name: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, name, type: "file", filePath: `src/${name}`, summary: "", tags: [], complexity: "simple", ...extra,
});

describe("shortestPath", () => {
  const edges = [edge("a", "b"), edge("b", "c"), edge("d", "c"), edge("a", "x"), edge("x", "y"), edge("y", "c")];

  it("finds the shortest chain, following links either way", () => {
    expect(shortestPath(edges, "a", "c")).toEqual(["a", "b", "c"]);
    expect(shortestPath(edges, "a", "d")).toEqual(["a", "b", "c", "d"]);
  });

  it("only passes through the parts it is allowed to", () => {
    // a → b → c is shortest, but b is "a library": go round through x and y instead
    expect(shortestPath(edges, "a", "c", (id) => id !== "b")).toEqual(["a", "x", "y", "c"]);
  });

  it("returns null when the two are not connected", () => {
    expect(shortestPath([...edges, edge("p", "q")], "a", "q")).toBeNull();
  });
});

describe("rankMatches", () => {
  const nodes = [
    node("1", "authors.ts"),
    node("2", "auth()", { type: "function", lineRange: [1, 5], filePath: "src/authors.ts" }),
    node("3", "authz.ts"),
    node("4", "login.ts", { filePath: "src/auth/login.ts" }),
  ];

  it("puts exact and prefix matches first, files before functions, then path matches", () => {
    expect(rankMatches(nodes, "auth", 10).map((n) => n.id)).toEqual(["1", "3", "2", "4"]);
    expect(rankMatches(nodes, "authz.ts", 10).map((n) => n.id)).toEqual(["3"]);
  });

  it("returns nothing for an empty query and respects the limit", () => {
    expect(rankMatches(nodes, "  ", 10)).toEqual([]);
    expect(rankMatches(nodes, "auth", 2)).toHaveLength(2);
  });
});
