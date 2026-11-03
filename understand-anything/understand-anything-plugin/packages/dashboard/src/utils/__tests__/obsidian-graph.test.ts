import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import {
  buildNameIndex,
  buildObsidianGraph,
  childrenOf,
  connectionsOf,
  edgeLabel,
  groupColor,
  hasSymbols,
  nodeRadius,
  splitWikilinks,
} from "../obsidian-graph";

function node(id: string, type: string, name: string, filePath?: string) {
  return { id, type, name, filePath, summary: "", tags: [], complexity: "simple" } as KnowledgeGraph["nodes"][number];
}
function edge(source: string, target: string, type: string, direction = "forward") {
  return { source, target, type, direction, weight: 1 } as KnowledgeGraph["edges"][number];
}

const codeGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: { name: "p", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
  nodes: [
    node("f:a", "file", "a.ts", "src/a.ts"),
    node("f:b", "file", "b.ts", "src/b.ts"),
    node("c:Engine", "class", "Engine", "src/a.ts"),
    node("fn:run", "function", "run", "src/a.ts"),
    node("fn:helper", "function", "helper", "src/b.ts"), // no contains edge: found by filePath
    node("m:lodash", "module", "lodash"),
    node("k:MAX", "concept", "MAX", "src/a.ts"),
  ],
  edges: [
    edge("f:a", "k:MAX", "contains"),
    edge("f:a", "c:Engine", "contains"),
    edge("f:a", "fn:run", "contains"),
    edge("f:a", "f:b", "imports"),
    edge("fn:run", "fn:helper", "calls"),
    edge("f:b", "m:lodash", "imports"),
  ],
  layers: [
    { id: "l0", name: "Core", description: "", nodeIds: ["f:a"] },
    { id: "l1", name: "Utils", description: "", nodeIds: ["f:b", "m:lodash"] },
  ],
  tour: [],
};

describe("buildObsidianGraph", () => {
  it("folds functions and classes into their files and lifts their edges", () => {
    const g = buildObsidianGraph(codeGraph, { includeSymbols: false });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["f:a", "f:b", "m:lodash"]);
    expect(g.visibleIdOf.get("fn:run")).toBe("f:a");
    expect(g.visibleIdOf.get("fn:helper")).toBe("f:b");
    expect(g.visibleIdOf.get("k:MAX")).toBe("f:a"); // constants inside a file fold too
    // a->b imports and run->helper calls collapse into one line remembering both types
    const ab = g.links.find((l) => [l.source, l.target].sort().join() === "f:a,f:b");
    expect(ab?.types.sort()).toEqual(["calls", "imports"]);
    expect(g.links).toHaveLength(2);
    // contains edges become self-links after folding and are dropped
    expect(g.links.some((l) => l.source === l.target)).toBe(false);
  });

  it("shows symbols as their own dots when asked", () => {
    const g = buildObsidianGraph(codeGraph, { includeSymbols: true });
    expect(g.nodes).toHaveLength(7);
    expect(g.neighbors.get("fn:run")?.has("fn:helper")).toBe(true);
    // a symbol inherits its file's group
    expect(g.nodes.find((n) => n.id === "fn:run")?.group).toBe(0);
  });

  it("computes groups and degree", () => {
    const g = buildObsidianGraph(codeGraph, { includeSymbols: false });
    const b = g.nodes.find((n) => n.id === "f:b")!;
    expect(b.group).toBe(1);
    expect(b.degree).toBe(2);
    expect(hasSymbols(codeGraph)).toBe(true);
  });
});

describe("connectionsOf", () => {
  it("splits links (outgoing) from backlinks (incoming) and merges edge types", () => {
    const c = connectionsOf(codeGraph, "f:b", { skipContains: true });
    expect(c.outgoing.map((x) => x.name)).toEqual(["lodash"]);
    expect(c.incoming.map((x) => x.name)).toEqual(["a.ts"]);
    expect(connectionsOf(codeGraph, "f:a").outgoing.map((x) => x.name)).toEqual(["b.ts", "Engine", "MAX", "run"]);
    // symbols carry the file they live in; files and modules don't
    const out = connectionsOf(codeGraph, "f:a").outgoing;
    expect(out.find((x) => x.name === "run")?.file).toBe("a.ts");
    expect(out.find((x) => x.name === "b.ts")?.file).toBeUndefined();
    expect(connectionsOf(codeGraph, "f:a", { skipContains: true }).outgoing.map((x) => x.name)).toEqual(["b.ts"]);
  });

  it("honours backward and bidirectional edges", () => {
    const g = { ...codeGraph, edges: [edge("f:a", "f:b", "related", "bidirectional"), edge("m:lodash", "f:a", "uses", "backward")] };
    const c = connectionsOf(g, "f:a");
    expect(c.outgoing.map((x) => x.nodeId).sort()).toEqual(["f:b", "m:lodash"]);
    expect(c.incoming.map((x) => x.nodeId)).toEqual(["f:b"]);
  });

  it("lists what a file defines", () => {
    expect(childrenOf(codeGraph, "f:a").map((n) => n.name)).toEqual(["MAX", "Engine", "run"]);
  });
});

describe("wikilinks", () => {
  const notes: KnowledgeGraph = {
    ...codeGraph,
    nodes: [node("article:Costs", "article", "Costs"), node("topic:Money", "topic", "Money"), node("x", "file", "costs")],
    edges: [],
  };
  const index = buildNameIndex(notes);

  it("prefers notes when names collide", () => {
    expect(index.get("costs")).toBe("article:Costs");
  });

  it("splits text into text and resolved / unresolved links", () => {
    const segs = splitWikilinks("See [[Costs]], [[money|the money]] and [[Taxes#Rates]].", index);
    expect(segs).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", text: "Costs", nodeId: "article:Costs" },
      { kind: "text", text: ", " },
      { kind: "link", text: "the money", nodeId: "topic:Money" },
      { kind: "text", text: " and " },
      { kind: "link", text: "Taxes", nodeId: null },
      { kind: "text", text: "." },
    ]);
    expect(splitWikilinks("no links", index)).toEqual([{ kind: "text", text: "no links" }]);
  });
});

describe("styling helpers", () => {
  it("sizes dots by connections, capped", () => {
    expect(nodeRadius(0)).toBeLessThan(nodeRadius(9));
    expect(nodeRadius(10_000)).toBe(18);
  });
  it("colors groups and ungrouped nodes", () => {
    expect(groupColor(-1)).toBe("#9a9a9a");
    expect(groupColor(0)).toBe(groupColor(10));
  });
  it("labels edge types", () => {
    expect(edgeLabel(["imports", "depends_on"])).toBe("imports, depends on");
  });
});
