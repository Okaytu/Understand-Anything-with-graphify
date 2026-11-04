/**
 * Learn mode: the codebase as a roadmap you read step by step (Back / Next, or the arrow
 * keys). Each step explains its files the way the classic view did (what it is, how hard
 * it is to read, what is inside, how it connects, language notes) as a page of text
 * instead of a canvas of cards.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode, KnowledgeGraph } from "@understand-anything/core/types";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { buildChapters, chapterPrompt, complexityOf, firstSentence } from "../utils/learn";
import {
  childrenOf,
  connectionsOf,
  edgeLabel,
  fileConnectionsOf,
  isFileNode,
  type Connection,
} from "../utils/obsidian-graph";

const FILES_SHOWN = 8;
const INSIDE_SHOWN = 6;
const LINKS_SHOWN = 5;

const COMPLEXITY_DOT = {
  simple: "bg-emerald-400",
  moderate: "bg-amber-400",
  complex: "bg-rose-400",
} as const;

interface Saved {
  index: number;
  visited: number[];
}

function readSaved(key: string): Saved {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const v = raw ? (JSON.parse(raw) as Partial<Saved>) : {};
    return { index: Number(v.index) || 0, visited: Array.isArray(v.visited) ? v.visited : [] };
  } catch {
    return { index: 0, visited: [] };
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

export default function LearnMode() {
  const graph = useDashboardStore((s) => s.graph);
  if (!graph) return null;
  // keyed by project: the reader's saved place is read and written under that project's key
  return <LearnReader key={graph.project.name} graph={graph} />;
}

function LearnReader({ graph }: { graph: KnowledgeGraph }) {
  const pathFinderOpen = useDashboardStore((s) => s.pathFinderOpen);
  const { t } = useI18n();
  const L = t.learnMode;
  const chapters = useMemo(() => buildChapters(graph), [graph]);
  // the reader's place belongs to this project and this roadmap (a refresh that changes the
  // chapters starts the reader afresh instead of opening an unrelated step)
  const storeKey = `ua.learn.${graph.project.name}.${hashText(chapters.map((c) => c.title).join("|"))}`;
  const [saved] = useState(() => readSaved(storeKey));
  const [index, setIndex] = useState(saved.index);
  const [visited, setVisited] = useState(() => new Set(saved.visited));
  const [copied, setCopied] = useState(false);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);

  const last = Math.max(chapters.length - 1, 0);
  const i = Math.min(Math.max(index, 0), last);

  useEffect(() => {
    setVisited((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
    setShowAllFiles(false);
    setCopied(false);
    mainRef.current?.scrollTo({ top: 0 });
  }, [i]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(storeKey, JSON.stringify({ index: i, visited: [...visited] }));
    } catch {
      /* storage unavailable: the reader's place just isn't remembered */
    }
  }, [storeKey, i, visited]);

  // ← / → turn the pages, unless the reader is typing or a dialog is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pathFinderOpen || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      // only on the Learn page, and never behind a dialog (help, onboarding, the large code viewer)
      if (useDashboardStore.getState().graphStyle !== "learn" || document.querySelector('[aria-modal="true"]')) return;
      if (e.key === "ArrowRight") setIndex(Math.min(i + 1, last));
      else if (e.key === "ArrowLeft") setIndex(Math.max(i - 1, 0));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [i, last, pathFinderOpen]);

  if (chapters.length === 0) {
    return <div className="h-full flex items-center justify-center p-8 text-lg text-text-secondary">{L.noChapters}</div>;
  }

  const chapter = chapters[i];
  // headings only help when the roadmap has both the guided path and the part-by-part chapters
  const sections = chapters.some((c) => c.kind === "tour") && chapters.some((c) => c.kind === "group");
  // counted within the current section: "Guided path · Step 3 of 11", not "3 of 44"
  const inSection = sections ? chapters.filter((c) => c.kind === chapter.kind) : chapters;
  const pos = inSection.indexOf(chapter);
  const stepText = L.stepOf.replace("{n}", String(pos + 1)).replace("{total}", String(inSection.length));
  const counter = sections ? `${chapter.kind === "tour" ? L.guidedPath : L.everyPart} · ${stepText}` : stepText;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes = chapter.nodeIds.map((id) => byId.get(id)).filter((n): n is GraphNode => Boolean(n));
  const shownNodes = showAllFiles ? nodes : nodes.slice(0, FILES_SHOWN);

  return (
    <div className="h-full flex min-h-0">
      <nav
        className="hidden md:block w-64 lg:w-72 shrink-0 border-r border-border-subtle bg-surface overflow-y-auto overscroll-contain px-3 py-4"
        aria-label={L.roadmap}
      >
        <h2 className="px-2 pb-3 text-base font-semibold text-text-primary">{L.roadmap}</h2>
        <ol className="space-y-0.5">
          {chapters.map((c, j) => (
            <li key={`${j}-${c.title}`}>
              {sections && (j === 0 || chapters[j - 1].kind !== c.kind) && (
                <div className={`px-2 pb-1 text-sm font-medium text-text-secondary ${j === 0 ? "" : "pt-4"}`}>
                  {c.kind === "tour" ? L.guidedPath : L.everyPart}
                </div>
              )}
              <button
                type="button"
                onClick={() => setIndex(j)}
                aria-current={j === i ? "step" : undefined}
                className={`w-full flex items-start gap-3 rounded-lg px-2 py-2.5 text-left text-[15px] transition-colors ${
                  j === i ? "bg-accent/15 text-text-primary" : "text-text-secondary hover:bg-elevated hover:text-text-primary"
                }`}
              >
                <span
                  className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold border ${
                    j === i
                      ? "border-accent bg-accent text-root"
                      : visited.has(j)
                      ? "border-accent/50 text-accent"
                      : "border-border-medium text-text-secondary"
                  }`}
                  aria-hidden
                >
                  {visited.has(j) && j !== i ? "✓" : j + 1}
                </span>
                <span className="pt-0.5 leading-snug break-words">{c.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div ref={mainRef} className="flex-1 min-w-0 overflow-y-auto overscroll-contain">
        <article className="max-w-2xl mx-auto px-5 sm:px-8 py-8">
          {/* phones have no roadmap list: jump to any step from here */}
          <label className="md:hidden block mb-5">
            <span className="sr-only">{L.roadmap}</span>
            <select
              value={i}
              onChange={(e) => setIndex(Number(e.target.value))}
              className="w-full h-11 rounded-lg border border-border-medium bg-elevated px-3 text-base text-text-primary"
            >
              {chapters.map((c, j) => (
                <option key={`${j}-${c.title}`} value={j}>
                  {j + 1}. {c.title}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between gap-4 text-sm text-text-secondary">
            <span>{counter}</span>
          </div>
          <div
            className="mt-2 h-2 rounded-full bg-elevated overflow-hidden"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={inSection.length}
            aria-valuenow={pos + 1}
          >
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${((pos + 1) / inSection.length) * 100}%` }} />
          </div>

          <h1 className="mt-7 font-heading text-4xl leading-tight text-text-primary break-words">{chapter.title}</h1>
          {chapter.description && <p className="mt-4 text-lg leading-relaxed text-text-secondary">{chapter.description}</p>}
          {chapter.languageLesson && <Note title={L.languageConcept}>{chapter.languageLesson}</Note>}

          {nodes.length > 0 && (
            <>
              <h2 className="mt-10 text-xl font-semibold text-text-primary">
                {L.filesInStep} <span className="font-normal text-text-secondary">({nodes.length})</span>
              </h2>
              <div>
                {shownNodes.map((n) => (
                  <FileSection key={n.id} node={n} graph={graph} />
                ))}
              </div>
              {!showAllFiles && nodes.length > FILES_SHOWN && (
                <button
                  type="button"
                  onClick={() => setShowAllFiles(true)}
                  className="mt-4 h-11 rounded-lg border border-border-medium px-4 text-sm text-text-primary hover:bg-elevated"
                >
                  {L.showMore.replace("{n}", String(nodes.length - FILES_SHOWN))}
                </button>
              )}
            </>
          )}

          <div className="mt-10 rounded-xl border border-border-subtle bg-surface p-5">
            <button
              type="button"
              onClick={() => {
                void copyText(chapterPrompt(graph, chapter, i, chapters.length)).then(() => setCopied(true));
              }}
              className="mt-3 h-11 rounded-lg bg-accent px-5 text-base font-semibold text-root hover:opacity-90"
            >
              {copied ? L.copied : L.copyPrompt}
            </button>
            <p className="mt-3 text-base text-text-secondary">{L.pasteHint}</p>
          </div>

          <div className="mt-8 flex items-center justify-between gap-4 border-t border-border-subtle pt-6 pb-4">
            <button
              type="button"
              onClick={() => setIndex(i - 1)}
              disabled={i === 0}
              className="h-12 rounded-xl border border-border-medium px-6 text-base font-semibold text-text-primary hover:bg-elevated disabled:opacity-30 disabled:hover:bg-transparent"
            >
              ← {t.common.back}
            </button>
            {i === last ? (
              <div className="flex flex-col items-end gap-3">
                <span className="text-base text-text-secondary text-right">{L.finished}</span>
                <div className="flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIndex(0)}
                    className="h-12 rounded-xl border border-border-medium px-5 text-base font-semibold text-text-primary hover:bg-elevated"
                  >
                    {L.startAgain}
                  </button>
                  <button
                    type="button"
                    onClick={() => useDashboardStore.getState().setGraphStyle("obsidian")}
                    className="h-12 rounded-xl bg-accent px-6 text-base font-semibold text-root hover:opacity-90"
                  >
                    {L.exploreMap}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIndex(i + 1)}
                className="h-12 rounded-xl bg-accent px-7 text-base font-semibold text-root hover:opacity-90"
              >
                {t.learnPanel.next} →
              </button>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}

function Note({ title, children }: { title: string; children: string }) {
  return (
    <aside className="mt-5 border-l-4 border-accent/60 bg-accent/5 rounded-r-lg px-4 py-3">
      <div className="text-sm font-semibold text-accent">{title}</div>
      <p className="mt-1 text-base leading-relaxed text-text-secondary">{children}</p>
    </aside>
  );
}

function FileSection({ node, graph }: { node: GraphNode; graph: KnowledgeGraph }) {
  const { t } = useI18n();
  const L = t.learnMode;
  const selectNode = useDashboardStore((s) => s.selectNode);
  const setGraphStyle = useDashboardStore((s) => s.setGraphStyle);
  const openCodeViewer = useDashboardStore((s) => s.openCodeViewer);
  const [allInside, setAllInside] = useState(false);
  const isFile = isFileNode(node);
  // settings and docs files list keys and headings, not parts worth explaining one by one
  const listsInside = isFile && !/\.(json|md|mdx|ya?ml|toml|txt|ini|cfg)$/i.test(node.filePath ?? "");
  const inside = useMemo(() => (listsInside ? childrenOf(graph, node.id) : []), [graph, node.id, listsInside]);
  const conns = useMemo(
    () => (isFile ? fileConnectionsOf(graph, node.id) : connectionsOf(graph, node.id, { skipContains: true })),
    [graph, node.id, isFile],
  );
  const level = complexityOf(node);

  return (
    <section className="py-7 border-b border-border-subtle last:border-b-0">
      <h3 className="text-2xl font-semibold text-text-primary break-words">{node.name}</h3>
      {node.filePath && <div className="mt-1 font-mono text-sm text-text-secondary break-all">{node.filePath}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary">
        <span className="inline-flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${COMPLEXITY_DOT[level]}`} aria-hidden />
          {L[level]}
        </span>
        {!isFile && <span className="text-text-muted">{node.type}</span>}
      </div>

      {node.summary && <p className="mt-4 text-[17px] leading-relaxed text-text-secondary">{node.summary}</p>}
      {node.languageNotes && <Note title={L.languageConcept}>{node.languageNotes}</Note>}

      {inside.length > 0 && (
        <div className="mt-6">
          <h4 className="text-base font-semibold text-text-primary">
            {L.whatsInside} <span className="font-normal text-text-secondary">({inside.length})</span>
          </h4>
          <ul className="mt-2 space-y-2.5">
            {(allInside ? inside : inside.slice(0, INSIDE_SHOWN)).map((c) => (
              <li key={c.id}>
                <div className="font-mono text-sm text-text-primary break-words">{c.name}</div>
                {c.summary && <div className="text-sm leading-relaxed text-text-secondary">{firstSentence(c.summary)}</div>}
              </li>
            ))}
          </ul>
          {!allInside && inside.length > INSIDE_SHOWN && (
            <button
              type="button"
              onClick={() => setAllInside(true)}
              className="mt-2 h-9 rounded-lg px-3 -ml-3 text-sm text-accent hover:bg-elevated"
            >
              {L.showMore.replace("{n}", String(inside.length - INSIDE_SHOWN))}
            </button>
          )}
        </div>
      )}

      {(conns.outgoing.length > 0 || conns.incoming.length > 0) && (
        <div className="mt-6">
          <h4 className="text-base font-semibold text-text-primary">{L.howItConnects}</h4>
          <LinkList label={L.uses} items={conns.outgoing} showMore={L.showMore} />
          <LinkList label={L.usedBy} items={conns.incoming} showMore={L.showMore} />
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        {node.filePath && (
          <button
            type="button"
            onClick={() => openCodeViewer(node.id)}
            className="h-10 rounded-lg border border-border-medium px-4 text-sm text-text-primary hover:bg-elevated"
          >
            {t.common.openCode}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            // leave the domain view first: it can't show structural parts (and switching view clears the selection)
            const st = useDashboardStore.getState();
            if (st.viewMode === "domain") st.setViewMode(st.isKnowledgeGraph ? "knowledge" : "structural");
            selectNode(node.id);
            setGraphStyle("obsidian");
          }}
          className="h-10 rounded-lg border border-border-medium px-4 text-sm text-text-primary hover:bg-elevated"
        >
          {L.showOnMap}
        </button>
      </div>
    </section>
  );
}

function LinkList({ label, items, showMore }: { label: string; items: Connection[]; showMore: string }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="text-sm text-text-secondary">
        {label} ({items.length})
      </div>
      <ul className="mt-1.5 space-y-2.5">
        {(all ? items : items.slice(0, LINKS_SHOWN)).map((c) => (
          <li key={c.nodeId}>
            <div className="text-[15px] text-text-primary break-words">{c.name}</div>
            <div className="text-sm leading-relaxed text-text-secondary">{c.why || edgeLabel(c.edgeTypes)}</div>
          </li>
        ))}
        {!all && items.length > LINKS_SHOWN && (
          <li>
            <button
              type="button"
              onClick={() => setAll(true)}
              className="h-9 rounded-lg px-3 -ml-3 text-sm text-accent hover:bg-elevated"
            >
              {showMore.replace("{n}", String(items.length - LINKS_SHOWN))}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
