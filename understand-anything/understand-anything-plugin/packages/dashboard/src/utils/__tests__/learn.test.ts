import { describe, it, expect, afterEach } from "vitest";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import { buildChapters, chapterPrompt, complexityOf, firstSentence } from "../learn";
import { loadGraphStyle } from "../../store";

const node = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  type: "file",
  name: `${id}.ts`,
  filePath: `src/${id}.ts`,
  summary: `${id} does things. More detail.`,
  tags: [],
  complexity: "simple",
  ...extra,
});

const graph = (over: Partial<KnowledgeGraph> = {}): KnowledgeGraph => ({
  version: "1",
  project: { name: "demo", languages: [], frameworks: [], description: "A demo app. It is small.", analyzedAt: "", gitCommitHash: "" },
  nodes: [node("a"), node("b"), node("c")],
  edges: [],
  layers: [
    { id: "l1", name: "Core", description: "The core", nodeIds: ["a", "b"] },
    { id: "l2", name: "Empty", description: "Nothing", nodeIds: [] },
  ],
  tour: [],
  ...over,
});

describe("buildChapters", () => {
  it("uses the tour in order and drops unknown or repeated ids", () => {
    const chapters = buildChapters(
      graph({
        tour: [
          { order: 2, title: "Second", description: "Then this", nodeIds: ["c", "missing"] },
          { order: 1, title: "First", description: "Start here", nodeIds: ["a", "a", "b"], languageLesson: "TS basics" },
        ],
      }),
    );
    expect(chapters.map((c) => c.title)).toEqual(["First", "Second"]);
    expect(chapters[0].nodeIds).toEqual(["a", "b"]);
    expect(chapters[0].languageLesson).toBe("TS basics");
    expect(chapters[1].nodeIds).toEqual(["c"]);
  });

  it("falls back to one chapter per non-empty group when there is no tour", () => {
    const chapters = buildChapters(graph());
    expect(chapters).toEqual([{ title: "Core", description: "The core", nodeIds: ["a", "b"], kind: "group" }]);
  });

  it("grows with the codebase: after the tour, every group adds the files the tour did not show", () => {
    const chapters = buildChapters(
      graph({
        tour: [{ order: 1, title: "Start", description: "Begin", nodeIds: ["a"] }],
        nodes: [node("a"), node("b"), node("c"), node("lib", { type: "module", filePath: undefined })],
        layers: [
          { id: "l1", name: "Core", description: "The core", nodeIds: ["a", "b"] },
          { id: "l2", name: "Extras", description: "More", nodeIds: ["c", "lib"] },
          { id: "l3", name: "Seen", description: "All shown already", nodeIds: ["a"] },
        ],
      }),
    );
    expect(chapters.map((c) => [c.kind, c.title, c.nodeIds])).toEqual([
      ["tour", "Start", ["a"]],
      ["group", "Core", ["b"]],
      ["group", "Extras", ["c"]],
    ]);
  });
});

describe("chapterPrompt", () => {
  it("names the step, its files and asks for plain words", () => {
    const g = graph();
    const text = chapterPrompt(g, buildChapters(g)[0], 0, 3);
    expect(text).toContain("STEP 1 OF 3: Core");
    expect(text).toContain("- src/a.ts: a does things. More detail.");
    expect(text).toContain("PROJECT: demo — A demo app.");
    expect(text).toMatch(/plain English/);
  });
});

describe("helpers", () => {
  it("firstSentence and complexityOf", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
    expect(firstSentence("no full stop")).toBe("no full stop");
    expect(complexityOf({ complexity: "complex" })).toBe("complex");
    expect(complexityOf({ complexity: "weird" as never })).toBe("simple");
  });
});

describe("loadGraphStyle", () => {
  const original = globalThis.localStorage;
  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
  });
  const withSaved = (v: string | null) =>
    Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => v }, configurable: true });

  it("opens Learn on a first visit and for the retired classic view", () => {
    withSaved(null);
    expect(loadGraphStyle()).toBe("learn");
    withSaved("classic");
    expect(loadGraphStyle()).toBe("learn");
  });

  it("keeps a saved Obsidian or Graphify choice", () => {
    withSaved("obsidian");
    expect(loadGraphStyle()).toBe("obsidian");
    withSaved("graphify");
    expect(loadGraphStyle()).toBe("graphify");
  });
});
