/**
 * Learn mode: the project as a step-by-step roadmap (chapters with Back / Next), explained
 * the way the classic view did (what a file is, how complex, what is inside, how it
 * connects, language concepts) but as a readable page instead of a canvas of cards.
 */
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";

export interface Chapter {
  title: string;
  description: string;
  nodeIds: string[];
  languageLesson?: string;
  /** "tour": a step of the project's guided tour; "group": a part of the project, one by one */
  kind: "tour" | "group";
}

/**
 * The roadmap grows with the codebase: the project's guided tour first, then one chapter for
 * every group (layer) with the files the tour has not shown yet, so every file is covered.
 */
export function buildChapters(graph: KnowledgeGraph): Chapter[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const keep = (ids: string[]) => [...new Set(ids)].filter((id) => byId.has(id));
  const tour: Chapter[] = [...(graph.tour ?? [])]
    .sort((a, b) => a.order - b.order)
    .filter((s) => s.title)
    .map((s) => ({ title: s.title, description: s.description, nodeIds: keep(s.nodeIds), languageLesson: s.languageLesson, kind: "tour" }));
  const shown = new Set(tour.flatMap((c) => c.nodeIds));
  const groups: Chapter[] = (graph.layers ?? [])
    .map((l) => ({
      title: l.name,
      description: l.description,
      // only parts a reader can open (files, notes); outside libraries have no file
      nodeIds: keep(l.nodeIds).filter((id) => !shown.has(id) && byId.get(id)?.filePath),
      kind: "group" as const,
    }))
    .filter((c) => c.nodeIds.length > 0);
  return [...tour, ...groups];
}

export function firstSentence(text: string): string {
  const m = (text ?? "").match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : text ?? "").trim();
}

export type ComplexityWord = "simple" | "moderate" | "complex";
export function complexityOf(node: Pick<GraphNode, "complexity">): ComplexityWord {
  return node.complexity === "complex" || node.complexity === "moderate" ? node.complexity : "simple";
}

const HEAD =
  "I am not a programmer. Please explain things to me in simple, plain English, as if to a smart beginner. " +
  "Avoid jargon; if you must use a technical word, explain it in brackets right after.";

/** A prompt the reader can paste into any AI chat to go deeper on one roadmap step. */
export function chapterPrompt(graph: KnowledgeGraph, chapter: Chapter, index: number, total: number): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const files = chapter.nodeIds.map((id) => byId.get(id)).filter((n): n is GraphNode => Boolean(n));
  const overview = firstSentence(graph.project.description ?? "");
  let t = `${HEAD}\n\nPROJECT: ${graph.project.name}${overview ? ` — ${overview}` : ""}\n`;
  t += `STEP ${index + 1} OF ${total}: ${chapter.title}\n`;
  if (chapter.description) t += `WHAT THIS STEP IS ABOUT: ${chapter.description}\n`;
  if (files.length > 0) {
    t += "\nTHE FILES IN THIS STEP:\n";
    t += files.map((n) => `- ${n.filePath ?? n.name}: ${n.summary || "(no summary yet)"}`).join("\n") + "\n";
  }
  if (chapter.languageLesson) t += `\nLANGUAGE NOTE: ${chapter.languageLesson}\n`;
  t +=
    "\nPlease, using everyday words:\n" +
    "1. Explain what this step of the project is about and why it matters.\n" +
    "2. For each file, say what its job is in one or two sentences.\n" +
    "3. Explain how these files work together, like a short story.\n" +
    "4. Give me one real-life analogy for this step.\n" +
    "5. Ask me three short questions to check I understood.\n" +
    "Finish by asking whether I am ready for the next step.";
  return t;
}
