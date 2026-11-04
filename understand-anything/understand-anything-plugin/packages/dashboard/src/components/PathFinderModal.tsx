/**
 * "How are two parts connected?": pick two parts of the project by typing their names and
 * see the chain of links between them, with the reason for each link in plain words.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { GraphEdge, GraphNode } from "@understand-anything/core/types";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { firstSentence } from "../utils/learn";
import { explanationOf } from "../utils/obsidian-graph";
import { rankMatches, shortestPath } from "../utils/path-finder";

interface PathFinderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_MATCHES = 30;

export default function PathFinderModal({ isOpen, onClose }: PathFinderModalProps) {
  const graph = useDashboardStore((s) => s.graph);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const setGraphStyle = useDashboardStore((s) => s.setGraphStyle);
  const { t } = useI18n();
  const P = t.pathFinder;
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  // undefined: not asked yet; null: asked, no connection
  const [path, setPath] = useState<string[] | null | undefined>(undefined);
  const modalRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  const edgeByPair = useMemo(() => {
    const m = new Map<string, GraphEdge>();
    for (const e of graph?.edges ?? []) m.set(`${e.source}\u0000${e.target}`, e);
    return m;
  }, [graph]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !graph) return null;

  const from = fromId ? byId.get(fromId) ?? null : null;
  const to = toId ? byId.get(toId) ?? null : null;
  const same = !!from && !!to && from.id === to.id;
  const canFind = !!from && !!to && !same;

  // a chain through an outside library or a package entry ("both use Next.js") says nothing
  const passThrough = (id: string) => {
    const n = byId.get(id);
    return !!n && !id.startsWith("ref_") && n.type !== "concept" && n.type !== "module";
  };

  const link = (a: string, b: string) => {
    const labels = t.edgeLabels as Partial<Record<string, { forward: string; backward: string }>>;
    const forward = edgeByPair.get(`${a}\u0000${b}`);
    const edge = forward ?? edgeByPair.get(`${b}\u0000${a}`);
    if (!edge) return null;
    const words = labels[edge.type];
    const label = words ? (forward ? words.forward : words.backward) : edge.type.replace(/_/g, " ");
    // the converter's own "graphify: calls · EXTRACTED" notes are not reasons; only real ones show
    return { label, why: explanationOf(edge) };
  };

  const show = (id: string) => {
    const st = useDashboardStore.getState();
    if (st.viewMode === "domain") st.setViewMode(st.isKnowledgeGraph ? "knowledge" : "structural");
    selectNode(id);
    setGraphStyle("obsidian");
    onClose();
  };

  return (
    // closes from the backdrop itself: a document-wide "click outside" check would also fire for
    // a picked match, whose button is already gone by the time that listener runs
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-root/80 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="path-finder-heading"
        className="glass-heavy rounded-xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden animate-fade-slide-in"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-border-subtle">
          <div>
            <h2 id="path-finder-heading" className="font-heading text-2xl text-text-primary">
              {P.heading}
            </h2>
            <p className="mt-1 text-base leading-relaxed text-text-secondary max-w-prose">{P.intro}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.obsidian.close}
            className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-elevated transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-5 space-y-4">
          <NodePicker
            label={P.from}
            nodes={graph.nodes}
            value={from}
            onChange={(id) => {
              setFromId(id);
              setPath(undefined);
            }}
            autoFocus
          />
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => {
                setFromId(toId);
                setToId(fromId);
                setPath(undefined);
              }}
              disabled={!from && !to}
              className="rounded-lg border border-border-medium px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-elevated disabled:opacity-40"
            >
              ⇅ {P.swap}
            </button>
          </div>
          <NodePicker
            label={P.to}
            nodes={graph.nodes}
            value={to}
            onChange={(id) => {
              setToId(id);
              setPath(undefined);
            }}
          />

          {same && <p className="text-sm text-amber-300">{P.same}</p>}

          <button
            type="button"
            onClick={() => setPath(shortestPath(graph.edges, from!.id, to!.id, passThrough))}
            disabled={!canFind}
            className="w-full h-12 rounded-xl bg-accent text-root text-base font-semibold hover:opacity-90 transition-opacity disabled:bg-elevated disabled:text-text-muted"
          >
            {P.find}
          </button>

          {path === null && (
            <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-base text-rose-200">{P.noPath}</p>
          )}

          {path && path.length > 1 && (
            <section aria-live="polite" className="pt-2">
              <h3 className="text-lg font-semibold text-text-primary">
                {path.length === 2 ? P.foundOne : P.foundMany.replace("{n}", String(path.length - 1))}
              </h3>
              <ol className="mt-3">
                {path.map((id, idx) => {
                  const n = byId.get(id);
                  if (!n) return null;
                  const next = path[idx + 1];
                  const step = next ? link(id, next) : null;
                  return (
                    <li key={id}>
                      <div className="flex items-start gap-3">
                        <span className="shrink-0 mt-0.5 w-8 h-8 rounded-full bg-accent/20 text-accent text-sm font-semibold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-base font-semibold text-text-primary break-words">{n.name}</div>
                          {n.filePath && <div className="font-mono text-xs text-text-muted break-all">{n.filePath}</div>}
                          {n.summary && <p className="mt-1 text-sm leading-relaxed text-text-secondary">{firstSentence(n.summary)}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => show(id)}
                          className="shrink-0 rounded-lg border border-border-medium px-3 py-2 text-sm text-text-primary hover:bg-elevated"
                        >
                          {t.learnMode.showOnMap}
                        </button>
                      </div>
                      {step && (
                        <div className="ml-4 my-1 border-l-2 border-accent/40 pl-7 py-2">
                          <div className="text-sm font-medium text-accent">{step.label}</div>
                          {step.why && <p className="text-sm leading-relaxed text-text-secondary">{step.why}</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function NodePicker({
  label,
  nodes,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  nodes: GraphNode[];
  value: GraphNode | null;
  onChange: (id: string | null) => void;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const P = t.pathFinder;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => rankMatches(nodes, query, MAX_MATCHES), [nodes, query]);
  const listId = `picker-${label.replace(/\W+/g, "-")}`;

  const choose = (n: GraphNode) => {
    onChange(n.id);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && matches[active]) {
      e.preventDefault();
      choose(matches[active]);
    } else if (e.key === "Escape" && open && query) {
      // close the list first; a second Escape closes the dialog
      e.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    }
  };

  if (value) {
    return (
      <div>
        <div className="mb-1.5 text-sm font-medium text-text-secondary">{label}</div>
        <div className="flex items-center gap-3 rounded-xl border border-accent/40 bg-elevated px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-text-primary break-words">{value.name}</div>
            {value.filePath && <div className="font-mono text-xs text-text-muted break-all">{value.filePath}</div>}
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 rounded-lg border border-border-medium px-3 py-2 text-sm text-text-primary hover:bg-surface"
          >
            {P.change}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-text-secondary">
        {label}
        <input
          type="text"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={P.placeholder}
          role="combobox"
          aria-expanded={open && !!query.trim()}
          aria-controls={listId}
          aria-autocomplete="list"
          className="mt-1.5 block w-full h-12 rounded-xl border border-border-medium bg-elevated px-4 text-base font-normal text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
      </label>
      {open && query.trim() && (
        <ul
          id={listId}
          role="listbox"
          className="mt-1 max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-border-medium bg-surface shadow-2xl"
        >
          {matches.length === 0 ? (
            <li className="px-4 py-3 text-sm text-text-muted">{P.noMatches}</li>
          ) : (
            matches.map((n, i) => (
              <li key={n.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  // mousedown, not click: the pick must land before the input's blur closes the list
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(n);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`w-full text-left px-4 py-2.5 ${i === active ? "bg-elevated" : ""}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-base text-text-primary break-words">{n.name}</span>
                    <span className="shrink-0 text-xs text-text-muted">{n.type}</span>
                  </div>
                  {n.filePath && <div className="font-mono text-xs text-text-muted break-all">{n.filePath}</div>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
